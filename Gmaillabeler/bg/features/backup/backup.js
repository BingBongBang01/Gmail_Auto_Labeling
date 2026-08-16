// bg/features/backup/backup.js
// ---------------- Google Drive 설정 백업/복원 ----------------

// ---------------- Google Drive 설정 백업/복원 ----------------
// drive.file 스코프라 우리가 직접 만든 파일에만 접근 가능(사용자의 다른 드라이브 파일은 전혀 못 봄).
// 백업 파일은 사용자 드라이브 최상위에 평범한 보이는 파일로 저장돼서, 사용자가 직접 열어보거나 지울 수도 있다.

import { addLog } from "../../core/logger.js";
import { gmailFetch } from "../../platform/gmail_api.js";
import { decryptWithPassphrase, encryptWithPassphrase } from "../../../crypto-helper.js";
import { t } from "../../../i18n.js";
import { SETTINGS_DEFAULTS } from "../../../settings/settings_defaults.js";
import { migrateToLatestSettings } from "../../../settings/settings_migration.js";
import { sanitizeCredentialList, validateSettingsAgainstSchema } from "../../../settings/settings_schema.js";
import { SettingsStore } from "../../../settings/settings_store.js";

const DRIVE_BACKUP_FILENAME = "gmail-ai-labeler-backup.json";

// 설정 본체는 appSettings 하나로 백업한다. 예전에 여기 있던 평면 키 목록
// (categoryDefinitions, filterRules, discordWebhookUrl* 등)은 v3에서 더 이상
// 쓰이지 않는 저장 위치라서, 그것만 백업하면 실제 설정이 하나도 담기지 않았다.

// v2 백업 파일을 복원할 때만 쓰는 옛 평면 키 목록(하위 호환).
const BACKUP_LEGACY_CREDENTIAL_KEYS = ["geminiApiKeys", "oauthClientId", "oauthClientSecret"];

// appSettings에 들어가지 않는, 순수 런타임/작업 데이터. 이건 평면 키 그대로 백업한다.
const BACKUP_RUNTIME_KEYS = [
  "summaryFeedback",
  "lastSummaryLabel",
  "lastSummaryCriteria",
  "lastLabelSummary",
  "criteriaScratchpad",
];
// v1/v2 시절의 평면 storage key. v3 마이그레이션 이후에는 실제로 존재하지 않지만, 마이그레이션을
// 아직 거치지 않은 아주 오래된 설치본을 위해 하위호환으로만 남겨둔다. 새 credential은
// appSettings.ai.credentials / appSettings.google.oauth에 저장되며, 아래 processBackupToDrive에서
// 이 값들을 직접 백업/복원한다.
const BACKUP_CREDENTIAL_KEYS = ["geminiApiKeys", "oauthClientId", "oauthClientSecret"];

// 설정 blob에서 자격 증명을 떼어낸다.
// API 키와 OAuth 시크릿이 평문으로 드라이브에 올라가지 않게 하기 위한 분리다.
function splitSettingsAndCredentials(settings) {
  const clone = JSON.parse(JSON.stringify(settings || {}));
  const credentials = {
    aiCredentials: clone.ai?.credentials || [],
    oauth: clone.google?.oauth || {},
  };
  if (clone.ai) clone.ai.credentials = [];
  if (clone.google) clone.google.oauth = { clientId: "", clientSecret: "" };
  return { safeSettings: clone, credentials };
}

async function findOrCreateDriveBackupFileId() {
  const cached = await new Promise((resolve) => chrome.storage.local.get(["driveBackupFileId"], resolve));
  if (cached.driveBackupFileId) {
    // 캐시된 파일 ID가 여전히 유효한지(사용자가 드라이브에서 직접 지웠을 수도 있음) 확인
    const check = await gmailFetch(
      `https://www.googleapis.com/drive/v3/files/${cached.driveBackupFileId}?fields=id,trashed`
    );
    if (check.ok) {
      const data = await check.json();
      if (!data.trashed) return cached.driveBackupFileId;
    }
  }

  const searchResp = await gmailFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${DRIVE_BACKUP_FILENAME}' and trashed=false`
    )}&fields=files(id,name)`
  );
  if (searchResp.ok) {
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length) {
      const fileId = searchData.files[0].id;
      await chrome.storage.local.set({ driveBackupFileId: fileId });
      return fileId;
    }
  }

  // 없으면 새로 생성 (내용은 비워두고, 바로 이어서 업로드함)
  const createResp = await gmailFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_BACKUP_FILENAME, mimeType: "application/json" }),
  });
  if (!createResp.ok) throw new Error(t("errDriveCreateFailed", [createResp.status]));
  const created = await createResp.json();
  await chrome.storage.local.set({ driveBackupFileId: created.id });
  return created.id;
}

async function processBackupToDrive(includeCredentials, passphrase) {
  await addLog(t("logDriveBackupStart"));

  // 설정 본체는 appSettings 하나다. 예전에는 이 키가 백업 목록에 아예 없어서
  // v3 설정(카테고리, 필터, 웹훅, ai.credentials 전체)이 백업되지 않았고,
  // 대신 이미 쓰이지 않는 옛 평면 키만 올라가고 있었다.
  // v3 중앙 설정에는 ai.credentials(API Key 포함)와 google.oauth(clientSecret 포함)처럼
  // 민감한 정보가 함께 들어있다. 항상 백업되는 safeSettings에는 민감 정보를 제거한 사본을 넣고,
  // 실제 값은 includeCredentials가 켜졌을 때만 credentials 쪽(암호화 대상)에 담는다.
  const allSettings = await SettingsStore.getSettings();
  const { safeSettings, credentials } = splitSettingsAndCredentials(allSettings);

  const storedRuntime = await new Promise((resolve) =>
    chrome.storage.local.get(BACKUP_RUNTIME_KEYS, resolve)
  );
  const runtime = {};
  for (const key of BACKUP_RUNTIME_KEYS) if (key in storedRuntime) runtime[key] = storedRuntime[key];

  const hasCredentials =
    (credentials.aiCredentials && credentials.aiCredentials.length) ||
    credentials.oauth?.clientId ||
    credentials.oauth?.clientSecret;

  const payload = {
    backupVersion: 3,
    createdAt: new Date().toISOString(),
    includesCredentials: false,
    appSettings: safeSettings,
    runtime,
  };

  if (includeCredentials && hasCredentials) {
    if (passphrase) {
      payload.encryptedCredentials = await encryptWithPassphrase(passphrase, credentials);
      payload.includesCredentials = true;
    } else {
      // 예전에는 암호가 없으면 자격 증명을 평문으로 그대로 넣었다(그리고 UI에는 암호를
      // 입력할 경로가 없어서 사실상 항상 평문이었다). API 키와 OAuth 시크릿을
      // 드라이브에 평문으로 올리는 건 위험하므로, 암호가 없으면 아예 제외한다.
      await addLog(
        "[백업] 암호를 입력하지 않아 API 키와 OAuth 정보는 백업에서 제외했습니다(평문 저장 방지).",
        "warn"
      );
    }
  }

  const fileId = await findOrCreateDriveBackupFileId();
  const uploadResp = await gmailFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload, null, 2),
    }
  );
  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(t("errDriveUploadFailed", [uploadResp.status, errText.slice(0, 200)]));
  }

  await chrome.storage.local.set({ lastDriveBackupAt: Date.now() });
  await SettingsStore.setSetting("data.backup.lastBackupAt", new Date().toISOString());
  await addLog(
    t(payload.encryptedCredentials ? "logDriveBackupDoneEncrypted" : "logDriveBackupDone", [
      Object.keys(payload.appSettings || {}).length,
    ])
  );
  return { total: 1, success: 1, failMessages: [], requestsUsed: 0, batchSize: 1, cancelled: false, quotaExhausted: false };
}

async function processRestoreFromDrive(passphrase) {
  await addLog(t("logDriveRestoreStart"));
  const fileId = await findOrCreateDriveBackupFileId();
  const downloadResp = await gmailFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!downloadResp.ok) {
    throw new Error(t("errDriveDownloadFailed", [downloadResp.status]));
  }
  const text = await downloadResp.text();
  if (!text.trim()) {
    throw new Error(t("errDriveBackupEmpty"));
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error(t("errDriveBackupInvalid"));
  }

  // 자격 증명을 먼저 복호화한다(암호가 틀리면 아무것도 덮어쓰지 않고 중단해야 한다).
  let credentials = null;
  if (payload.encryptedCredentials) {
    if (!passphrase) {
      throw new Error(t("errBackupPassphraseNeeded"));
    }
    try {
      credentials = await decryptWithPassphrase(passphrase, payload.encryptedCredentials);
    } catch (e) {
      throw new Error(t("errBackupPassphraseWrong"));
    }
  }

  let restoredCount = 0;

  if (payload.appSettings) {
    // v3 백업. 스키마로 걸러서 병합한다.
    const { value } = validateSettingsAgainstSchema(payload.appSettings);
    if (credentials) {
      if (Array.isArray(credentials.aiCredentials) && credentials.aiCredentials.length) {
        value.ai = { ...(value.ai || {}), credentials: sanitizeCredentialList(credentials.aiCredentials) };
      }
      if (credentials.oauth && (credentials.oauth.clientId || credentials.oauth.clientSecret)) {
        value.google = { oauth: { ...credentials.oauth } };
      }
    }
    value.schemaVersion = SETTINGS_DEFAULTS.schemaVersion;
    await SettingsStore.setSettings(value);
    restoredCount += Object.keys(value).length;

    if (payload.runtime && typeof payload.runtime === "object") {
      const runtime = {};
      for (const key of BACKUP_RUNTIME_KEYS) {
        if (key in payload.runtime) runtime[key] = payload.runtime[key];
      }
      if (Object.keys(runtime).length) {
        await chrome.storage.local.set(runtime);
        restoredCount += Object.keys(runtime).length;
      }
    }
  } else {
    // v2 이하 백업(평면 키). 그대로 되돌려놓고 마이그레이션이 새 구조로 옮기게 한다.
    const flat = { ...(payload.settings || {}) };
    if (credentials) {
      for (const key of BACKUP_LEGACY_CREDENTIAL_KEYS) {
        if (key in credentials) flat[key] = credentials[key];
      }
    }
    restoredCount = Object.keys(flat).length;
    if (restoredCount) await chrome.storage.local.set(flat);
    // schemaVersion을 내려서 마이그레이션이 다시 돌도록 한 뒤 즉시 실행한다.
    await SettingsStore.setSetting("schemaVersion", 1);
    await migrateToLatestSettings();
  }
  await addLog(t("logDriveRestoreDone", [payload.createdAt || t("logUnknownTime"), restoredCount]));
  return {
    total: 1,
    success: 1,
    failMessages: [],
    requestsUsed: 0,
    batchSize: 1,
    cancelled: false,
    quotaExhausted: false,
    restoredCount,
    backedUpAt: payload.createdAt || null,
  };
}

// Gmail messages.list는 maxResults 상한이 500이라, 그보다 많이 요청해도 500개만 돌아온다.
// 따라서 요청 수량을 500 단위로 쪼개고 nextPageToken을 따라가며 원하는 개수만큼 채운다.


export {
  BACKUP_CREDENTIAL_KEYS,
  BACKUP_LEGACY_CREDENTIAL_KEYS,
  BACKUP_RUNTIME_KEYS,
  DRIVE_BACKUP_FILENAME,
  findOrCreateDriveBackupFileId,
  processBackupToDrive,
  processRestoreFromDrive,
  splitSettingsAndCredentials,
};
