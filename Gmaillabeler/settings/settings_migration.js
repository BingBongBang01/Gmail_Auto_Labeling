// settings/settings_migration.js

import { AIProviderRegistry } from "../ai/ai_provider_registry.js";
import { sanitizeCredentialList } from "./settings_schema.js";
import { SettingsStore } from "./settings_store.js";

/**
 * 예전 저장 구조(v1 = 평면 키, v2 = ai.providers 중첩)를 현재 구조(v3)로 옮긴다.
 *
 * 중요: 여기서 만드는 것은 "델타"다. 기본값 전체를 복사한 뒤 그 위에 몇 개만 덮어쓰면,
 * SettingsStore.setSettings의 깊은 병합 때문에 우리가 명시적으로 옮기지 않은 모든 설정이
 * 기본값으로 되돌아간다(예전 구현이 그랬고, v2 사용자는 gmail.classification, calendar.*,
 * advanced.* 등을 전부 잃었다).
 *
 * 옛 평면 키는 지우지 않는다. 마이그레이션이 뭔가 놓쳤을 때 되돌릴 근거가 남아 있는 편이 낫다.
 */

const SETTINGS_TARGET_SCHEMA_VERSION = 3;

function migrationNewId() {
  try {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (e) {
    /* fallthrough */
  }
  return `cred-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function migrationDefaultModel(providerId) {
  // 예전에는 `${providerId}-default-model` 같은 문자열을 만들어 넣어서
  // ("openai-default-model") 첫 호출부터 model_not_found 400이 났다.
  const known = AIProviderRegistry.getDefaultModel(providerId);
  if (known) return known;
  return "";
}

function migrationSetPath(target, path, value) {
  const keys = path.split(".");
  let node = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (!node[keys[i]] || typeof node[keys[i]] !== "object") node[keys[i]] = {};
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
}

function migrationCollectLegacyCredentials(existing, allData) {
  const credentials = [];
  let priority = 1;

  // v2: ai.providers[providerId].apiKeys[]
  if (existing.ai?.providers && typeof existing.ai.providers === "object") {
    for (const [providerId, provider] of Object.entries(existing.ai.providers)) {
      if (!provider || !Array.isArray(provider.apiKeys)) continue;
      for (const k of provider.apiKeys) {
        if (!k) continue;
        const apiKey = k.key || k.apiKey;
        if (!apiKey) continue; // 키가 없는 항목을 enabled로 넣으면 매 요청이 실패한다
        credentials.push({
          id: k.id || migrationNewId(),
          provider: providerId,
          name: k.label || k.name || `${providerId} 키`,
          apiKey,
          model: provider.selectedModel || migrationDefaultModel(providerId),
          enabled: k.enabled !== false,
          priority: priority++,
          status: "Unknown",
        });
      }
    }
    if (credentials.length) return credentials;
  }

  // v1: 평면 geminiApiKeys[] 또는 단일 geminiApiKey
  if (Array.isArray(allData.geminiApiKeys) && allData.geminiApiKeys.length) {
    for (const k of allData.geminiApiKeys) {
      if (!k || !k.key) continue;
      credentials.push({
        id: migrationNewId(),
        provider: "google",
        name: k.label || `Gemini 키 ${priority}`,
        apiKey: k.key,
        model: migrationDefaultModel("google"),
        enabled: k.active !== false,
        priority: priority++,
        status: "Unknown",
      });
    }
  } else if (typeof allData.geminiApiKey === "string" && allData.geminiApiKey) {
    credentials.push({
      id: migrationNewId(),
      provider: "google",
      name: "Gemini 키",
      apiKey: allData.geminiApiKey,
      model: migrationDefaultModel("google"),
      enabled: true,
      priority: priority++,
      status: "Unknown",
    });
  }

  return credentials;
}

function migrationResolveLanguage(existing, allData) {
  const stored = existing.general?.language || allData.uiLanguage;
  if (stored && stored !== "system") return stored;
  try {
    const browserLang = (chrome.i18n.getUILanguage() || "en").toLowerCase();
    if (browserLang.startsWith("ko")) return "ko";
    if (browserLang.startsWith("ja")) return "ja";
    if (browserLang.startsWith("zh")) return "zh_CN";
  } catch (e) {
    /* 기본값으로 떨어진다 */
  }
  return "en";
}

async function migrateToLatestSettings() {
  let allData;
  try {
    allData = await new Promise((resolve, reject) => {
      chrome.storage.local.get(null, (result) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(result || {});
      });
    });
  } catch (e) {
    console.warn("[Migration] 저장소를 읽지 못해 마이그레이션을 건너뜁니다:", e.message);
    return false;
  }

  // 예전에는 이 함수 전체가 try/catch 없이 storage 콜백 안에서 돌았고 resolve가 한 곳뿐이었다.
  // 중간에 예외가 나면 프라미스가 영구히 pending 상태가 되어, 이걸 await하는 옵션 페이지가
  // 아무것도 그리지 못한 채 멈췄다.
  try {
    const existing = allData.appSettings || {};
    const currentVersion = existing.schemaVersion || 1;
    if (currentVersion >= SETTINGS_TARGET_SCHEMA_VERSION) return false;

    console.log(`[Migration] v${currentVersion} -> v${SETTINGS_TARGET_SCHEMA_VERSION} 마이그레이션 시작`);

    const delta = { schemaVersion: SETTINGS_TARGET_SCHEMA_VERSION };
    const set = (path, value) => migrationSetPath(delta, path, value);
    const setIfString = (path, value) => {
      if (typeof value === "string" && value) set(path, value);
    };
    const setIfBool = (path, value) => {
      if (typeof value === "boolean") set(path, value);
    };
    const setIfNumber = (path, value) => {
      const num = Number(value);
      if (value !== undefined && value !== null && Number.isFinite(num)) set(path, num);
    };
    const setIfArray = (path, value) => {
      if (Array.isArray(value)) set(path, value);
    };

    // 1. 일반 / 테마 / 언어
    setIfString("general.themeMode", existing.general?.themeMode || allData.themeMode || allData.dashboardTheme);
    set("general.language", migrationResolveLanguage(existing, allData));

    // 2. Google OAuth
    setIfString("google.oauth.clientId", existing.google?.oauth?.clientId || allData.oauthClientId);
    setIfString("google.oauth.clientSecret", existing.google?.oauth?.clientSecret || allData.oauthClientSecret);

    // 3. AI 자격 증명
    // 이미 v3 형태의 credentials가 있으면 절대 건드리지 않는다.
    // 예전 구현은 무조건 ai.credentials = [] 로 초기화한 뒤 옛 키에서만 채웠기 때문에,
    // schemaVersion만 낮고 내용은 v3인 상태(설정 초기화 직후 등)에서 키가 전부 삭제됐다.
    const existingCredentials = sanitizeCredentialList(existing.ai?.credentials);

    if (existingCredentials.length) {
      set("ai.credentials", existingCredentials);
    } else {
      const migrated = migrationCollectLegacyCredentials(existing, allData);
      if (migrated.length) set("ai.credentials", migrated);
    }

    if (existing.ai?.requestPolicy && typeof existing.ai.requestPolicy === "object") {
      set("ai.requestPolicy", existing.ai.requestPolicy);
    }
    if (existing.ai?.processing && typeof existing.ai.processing === "object") {
      set("ai.processing", existing.ai.processing);
    }

    // 4. Gmail
    setIfBool("automation.autoClassify.enabled", allData.autoClassifyEnabled);
    setIfNumber("automation.autoClassify.threshold", allData.autoClassifyThreshold);

    // 옛 categoryDefinitions는 [{name, description}], labelCategories는 문자열 배열이다.
    if (Array.isArray(allData.categoryDefinitions) && allData.categoryDefinitions.length) {
      set(
        "gmail.categories",
        allData.categoryDefinitions
          .filter((c) => c && (typeof c === "string" || typeof c.name === "string"))
          .map((c) =>
            typeof c === "string"
              ? { name: c, description: "" }
              : { name: c.name, description: c.description || "", autoLearned: !!c.autoLearned }
          )
      );
    } else if (Array.isArray(allData.labelCategories) && allData.labelCategories.length) {
      set(
        "gmail.categories",
        allData.labelCategories
          .filter((name) => typeof name === "string" && name)
          .map((name) => ({ name, description: "" }))
      );
    }

    if (allData.importanceCriteria && typeof allData.importanceCriteria === "object") {
      setIfString("gmail.importance.high", allData.importanceCriteria.high);
      setIfString("gmail.importance.medium", allData.importanceCriteria.medium);
      setIfString("gmail.importance.low", allData.importanceCriteria.low);
    }

    setIfString("gmail.personalization.identityHints", allData.personalIdentityHints);
    setIfString("gmail.personalization.exclusionRules", allData.personalExclusionRules);
    setIfArray("gmail.filters", allData.filterRules);
    setIfBool("gmail.fetching.lightweight", allData.lightMailFetchEnabled);
    setIfBool("gmail.correctionLearning.enabled", allData.correctionLearningEnabled);

    // 5. 자동 요약
    setIfBool("automation.autoSummary.enabled", allData.autoSummaryEnabled);
    setIfString("automation.autoSummary.label", allData.autoSummaryLabel);
    setIfNumber("automation.autoSummary.maxCount", allData.autoSummaryMaxCount);
    setIfString("automation.autoSummary.criteria", allData.autoSummaryCriteria);
    setIfBool("automation.autoSummary.sendToDiscord", allData.autoSummarySendDiscord);

    // 6. Discord
    setIfString("notifications.discord.defaultWebhook", allData.discordWebhookUrl);
    setIfString("notifications.discord.highWebhook", allData.discordWebhookUrlHigh);
    setIfString("notifications.discord.mediumWebhook", allData.discordWebhookUrlMedium);
    setIfString("notifications.discord.lowWebhook", allData.discordWebhookUrlLow);
    setIfBool("notifications.discord.sendPerEmail", allData.discordSendPerEmail);
    setIfArray("notifications.customWebhooks", allData.customDiscordWebhooks);

    // 7. 캘린더
    setIfArray("calendar.filters", allData.calendarFilterRules);

    // 8. 데이터
    setIfString("data.backup.lastBackupAt", allData.lastDriveBackupAt);

    await SettingsStore.setSettings(delta);
    console.log("[Migration] 완료");
    return true;
  } catch (e) {
    // 마이그레이션 실패가 UI를 막아서는 안 된다. 기존 설정은 그대로 남는다.
    console.error("[Migration] 실패 - 기존 설정을 유지합니다:", e);
    return false;
  }
}

export { migrateToLatestSettings, SETTINGS_TARGET_SCHEMA_VERSION };
