// bg/features/discord/discord.js
// Discord webhook 전송. 요약 기능은 이 파일을 import 하지 않는다.
// summary.completed 이벤트 구독으로만 연결된다(bg/features/discord/index.js 참고).

// Discord embed 제약: 필드 25개, name 256자, value 1024자, embed 전체 6000자.
// 선별 메일이 많으면 이 제한을 넘겨 전송이 통째로 실패하므로, 여러 메시지로 쪼개 보낸다.

import { SettingsStore } from "../../../settings/settings_store.js";

import { sleep } from "../../core/util.js";
import { t } from "../../../i18n.js";

const DISCORD_MAX_FIELDS_PER_EMBED = 25;
const DISCORD_MAX_EMBED_CHARS = 5800; // 6000에서 약간 여유를 둔 값

function normalizeDiscordFields(fields) {
  return (fields || []).map((f) => ({
    name: String(f.name || "-").slice(0, 256),
    value: String(f.value || "-").slice(0, 1024),
    inline: !!f.inline,
  }));
}

// 필드를 embed 문자 총량과 필드 개수 제한에 맞춰 여러 묶음으로 나눈다.
function chunkDiscordFields(fields, baseChars) {
  const chunks = [];
  let current = [];
  let currentChars = baseChars;

  for (const field of fields) {
    const fieldChars = field.name.length + field.value.length;
    const wouldOverflow =
      current.length >= DISCORD_MAX_FIELDS_PER_EMBED || currentChars + fieldChars > DISCORD_MAX_EMBED_CHARS;
    if (wouldOverflow && current.length) {
      chunks.push(current);
      current = [];
      currentChars = baseChars;
    }
    current.push(field);
    currentChars += fieldChars;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

async function postDiscordEmbed(url, embed) {
  const payload = {
    username: "Gmail AI Labeler",
    avatar_url: "https://mail.google.com/favicon.ico",
    embeds: [embed],
  };
  // 메일 단위로 보내면 짧은 시간에 요청이 몰려 429(rate limit)를 맞는다.
  // Discord가 알려주는 대기 시간만큼 기다렸다가 다시 시도한다.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return;

    const errText = await response.text();
    if (response.status === 429 && attempt < 3) {
      let waitMs = 1000;
      try {
        const parsed = JSON.parse(errText);
        if (parsed && typeof parsed.retry_after === "number") waitMs = Math.ceil(parsed.retry_after * 1000);
      } catch (e) {
        const header = parseFloat(response.headers.get("Retry-After") || "");
        if (!Number.isNaN(header)) waitMs = Math.ceil(header * 1000);
      }
      await sleep(Math.min(Math.max(waitMs, 500), 10000));
      continue;
    }
    throw new Error(`Discord Webhook (${embed.title}) 전송 실패: ${errText.slice(0, 100)}`);
  }
}

async function sendSingleDiscordEmbed(url, title, description, color, fields) {
  if (!url || !url.startsWith("http")) return;

  const safeTitle = String(title || "").slice(0, 256);
  const safeDescription = String(description || "").slice(0, 4096);
  const normalized = normalizeDiscordFields(fields);
  const baseChars = safeTitle.length + safeDescription.length + 80; // footer 등 고정 문자 여유
  const chunks = chunkDiscordFields(normalized, baseChars);

  for (let i = 0; i < chunks.length; i += 1) {
    const pageSuffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
    await postDiscordEmbed(url, {
      title: `${safeTitle}${pageSuffix}`.slice(0, 256),
      // 종합 브리핑은 첫 메시지에만 넣어서 뒤 페이지가 불필요하게 길어지지 않게 한다
      description: i === 0 ? safeDescription : "",
      color,
      fields: chunks[i],
      footer: { text: "Gmail AI Labeler • Discord Routing Sync" },
      timestamp: new Date().toISOString(),
    });
  }
}

// 중요도별 웹훅 중 일부만 설정된 경우, 나머지 등급 메일이 아무 곳에도 안 가고 조용히 사라지지 않도록
// 기본 웹훅으로 흘려보낸다.
function resolveDiscordTargetUrl(webhooks, tier) {
  const specific = webhooks[`${tier}Url`];
  if (specific && specific.startsWith("http")) return specific;
  if (webhooks.defaultUrl && webhooks.defaultUrl.startsWith("http")) return webhooks.defaultUrl;
  return null;
}

// ---- 사용자 정의(커스텀) 웹훅 라우팅 ----
// 사용자가 원하는 만큼 웹훅을 추가하고, 각 웹훅이 받을 메일 조건을 규칙으로 직접 정할 수 있다.
// 규칙은 AI를 추가로 호출하지 않고 요약 결과(중요도/카테고리/발신자/제목/개인 관련성)만으로 판정한다.

function isValidWebhookUrl(url) {
  return typeof url === "string" && url.startsWith("http");
}

function splitWebhookKeywords(text) {
  return String(text || "")
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// 조건 종류끼리는 AND, 같은 종류 안의 값끼리는 OR로 판정한다. 비워둔 조건은 "제한 없음"이다.
function matchesCustomWebhookRule(rule, item, reportLabelName) {
  // 분류(라벨) 조건: 메일이 실제로 달고 있는 라벨 중 하나라도 지정 목록에 있으면 통과.
  // 예전 버전이 만든 리포트에는 labelNames가 없으므로, 그때는 요약 대상 라벨명으로 판정한다.
  const labels = (Array.isArray(rule.labels) ? rule.labels : []).filter(Boolean);
  if (labels.length) {
    const mailLabels = Array.isArray(item.labelNames) && item.labelNames.length ? item.labelNames : [reportLabelName];
    if (!mailLabels.some((name) => labels.includes(name))) return false;
  }

  const importances = (Array.isArray(rule.importance) ? rule.importance : []).filter(Boolean);
  if (importances.length && !importances.includes(item.importance)) return false;

  const categories = (Array.isArray(rule.categories) ? rule.categories : []).filter(Boolean);
  if (categories.length && !categories.includes(item.discordCategory)) return false;

  if (rule.onlyPersonal && item.personallyRelevant !== true) return false;
  if (rule.onlyActionRequired && (!item.actionRequired || item.actionRequired === "없음")) return false;

  const senderKeys = splitWebhookKeywords(rule.senderKeywords);
  if (senderKeys.length) {
    const sender = String(item.sender || "").toLowerCase();
    if (!senderKeys.some((k) => sender.includes(k))) return false;
  }

  const subjectKeys = splitWebhookKeywords(rule.subjectKeywords);
  const contentHaystack = `${item.subject || ""} ${(item.summaryPoints || []).join(" ")} ${item.discordSummaryText || ""}`.toLowerCase();
  if (subjectKeys.length && !subjectKeys.some((k) => contentHaystack.includes(k))) return false;

  const excludeKeys = splitWebhookKeywords(rule.excludeKeywords);
  if (excludeKeys.length) {
    const full = `${String(item.sender || "").toLowerCase()} ${contentHaystack}`;
    if (excludeKeys.some((k) => full.includes(k))) return false;
  }

  return true;
}

// 중요도별 채널 전송과 같은 형식의 embed 필드를 만든다.
function buildDiscordEmailFields(list, options = {}) {
  return list.map((item, idx) => {
    const imp = item.importance || "중";
    const impIcon = imp === "상" ? "🔴" : imp === "중" ? "🟡" : "🟢";
    let value = "";
    if (options.showPersonalReason && item.personalRelevanceReason) {
      value += `🙋 **나와의 관련성**: ${item.personalRelevanceReason}\n`;
    }
    if (item.discordSummaryText) value += `💬 **AI 브리핑**: ${item.discordSummaryText}\n`;
    value += `**발신자**: ${item.sender || "정보 없음"}\n`;
    value += (item.summaryPoints || []).map((p) => `• ${p}`).join("\n");
    if (item.actionRequired && item.actionRequired !== "없음") {
      value += `\n⚡ **조치**: ${item.actionRequired}`;
    }
    if (item.id) {
      value += `\n🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})`;
    }
    return {
      name: `${idx + 1}. ${impIcon} [${item.discordCategory || imp}] ${String(item.subject || "").slice(0, 200)}`,
      value: value.slice(0, 1024),
      inline: false,
    };
  });
}

const DISCORD_PER_EMAIL_GAP_MS = 400; // 연속 전송 사이 간격(429를 애초에 덜 맞게)

function discordColorForImportance(importance) {
  if (importance === "상") return 0xf43f5e;
  if (importance === "중") return 0xf59e0b;
  return 0x10b981;
}

// 메일 한 통을 embed 하나로 보낸다. 목록이 길어도 Discord에서 메일별로 따로 읽힌다.
async function sendPerEmailDiscordEmbeds(url, summaryReport, list, options = {}) {
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const imp = item.importance || "중";
    const impIcon = imp === "상" ? "🔴" : imp === "중" ? "🟡" : "🟢";

    let description = "";
    if (options.showPersonalReason && item.personalRelevanceReason) {
      description += `🙋 **나와의 관련성**: ${item.personalRelevanceReason}\n`;
    }
    if (item.discordSummaryText) description += `💬 **AI 브리핑**: ${item.discordSummaryText}\n`;
    if (description) description += "\n";
    description += (item.summaryPoints || []).map((p) => `• ${p}`).join("\n");
    if (item.actionRequired && item.actionRequired !== "없음") {
      description += `\n\n⚡ **조치**: ${item.actionRequired}`;
    }
    if (item.id) {
      description += `\n\n🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})`;
    }

    const fields = [
      { name: "발신자", value: String(item.sender || "정보 없음").slice(0, 1024), inline: true },
      { name: "중요도", value: `${impIcon} ${imp}`, inline: true },
      { name: "분류", value: String(item.discordCategory || summaryReport.labelName || "-").slice(0, 1024), inline: true },
    ];

    await postDiscordEmbed(url, {
      title: `${impIcon} ${String(item.subject || "(제목 없음)").slice(0, 240)}`,
      description: description.slice(0, 4096),
      color: discordColorForImportance(imp),
      fields,
      footer: { text: `Gmail AI Labeler • ${summaryReport.labelName || ""} • ${i + 1}/${list.length}` },
      timestamp: new Date().toISOString(),
    });

    if (i < list.length - 1) await sleep(DISCORD_PER_EMAIL_GAP_MS);
  }
}

// 메일 묶음을 한 채널로 보낸다. 설정에 따라 '메일 단위 개별 전송'과 '한 번에 묶어서'를 고른다.
async function deliverDiscordEmails(url, summaryReport, list, groupTitle, groupColor, options = {}) {
  if (!isValidWebhookUrl(url) || !list.length) return;

  if (options.perEmail) {
    await sendPerEmailDiscordEmbeds(url, summaryReport, list, options);
    return;
  }
  await sendSingleDiscordEmbed(
    url,
    groupTitle,
    summaryReport.overallSummary || "",
    groupColor,
    buildDiscordEmailFields(list, options)
  );
}

async function isDiscordPerEmailEnabled() {
  const stored = await new Promise((resolve) => chrome.storage.local.get(["discordSendPerEmail"], resolve));
  // 사용자가 명시적으로 끄기 전에는 메일 단위 전송을 기본으로 쓴다.
  return stored.discordSendPerEmail !== false;
}

// 사용자 정의 웹훅으로 전송한다. 중요도별/기본 채널 전송과는 별개로 추가 동작한다.
// ('나와 관련된 메일만' 보내고 싶으면 커스텀 웹훅 규칙의 onlyPersonal 조건을 쓰면 된다)
async function sendExtraDiscordWebhooks(webhooks, summaryReport, perEmail) {
  const selected = summaryReport.selectedEmails || [];
  let sentCount = 0;

  const customs = (Array.isArray(webhooks.custom) ? webhooks.custom : []).filter(
    (w) => w && w.enabled !== false && isValidWebhookUrl(w.url)
  );
  for (const rule of customs) {
    const matched = selected.filter((item) => matchesCustomWebhookRule(rule, item, summaryReport.labelName));
    if (!matched.length) continue;
    await deliverDiscordEmails(
      rule.url,
      summaryReport,
      matched,
      `${rule.name ? `📨 ${rule.name}` : "📨 사용자 지정 웹훅"} · [${summaryReport.labelName}] (${matched.length}건)`,
      0x2563eb,
      { showPersonalReason: !!rule.onlyPersonal, perEmail }
    );
    sentCount += 1;
  }

  return sentCount;
}

// 요약 리포트를 지정한 Discord Webhook URL(또는 중요도별 분리 채널 / 사용자 정의 웹훅)로 전송한다.
async function sendSummaryToDiscord(webhookInput, summaryReport) {
  if (!summaryReport) throw new Error("전송할 요약 리포트 데이터가 없습니다.");

  let webhooks = {};
  if (typeof webhookInput === "string") {
    webhooks = { defaultUrl: webhookInput };
  } else if (webhookInput && typeof webhookInput === "object") {
    webhooks = webhookInput;
  }

  const hasSpecificChannel = webhooks.highUrl || webhooks.mediumUrl || webhooks.lowUrl;
  const hasExtraChannel =
    Array.isArray(webhooks.custom) && webhooks.custom.some((w) => w && w.enabled !== false && isValidWebhookUrl(w.url));

  if (!hasSpecificChannel && !hasExtraChannel && !isValidWebhookUrl(webhooks.defaultUrl)) {
    throw new Error(t("errDiscordWebhookMissing"));
  }

  const perEmail = await isDiscordPerEmailEnabled();

  // 커스텀 웹훅은 기본·중요도 채널과 독립적으로 항상 먼저 처리한다.
  const extraSent = await sendExtraDiscordWebhooks(webhooks, summaryReport, perEmail);

  // 중요도별/AI카테고리별 웹훅이 설정되어 있으면 해당 디스코드 채널로 자동 분기 전송!
  if (hasSpecificChannel) {
    const highEmails = (summaryReport.selectedEmails || []).filter((e) => e.importance === "상" || e.discordCategory === "긴급/조치필요");
    const medEmails = (summaryReport.selectedEmails || []).filter((e) => (e.importance === "중" || e.discordCategory === "공지/일정") && e.importance !== "상");
    const lowEmails = (summaryReport.selectedEmails || []).filter((e) => (e.importance === "하" || e.discordCategory === "일반/리포트") && e.importance !== "상" && e.importance !== "중");

    let sentCount = 0;

    if (resolveDiscordTargetUrl(webhooks, "high") && highEmails.length) {
      await deliverDiscordEmails(
        resolveDiscordTargetUrl(webhooks, "high"),
        summaryReport,
        highEmails,
        `🚨 [${summaryReport.labelName}] 긴급/상 메일 알림 (${highEmails.length}건)`,
        0xf43f5e,
        { perEmail }
      );
      sentCount += 1;
    }

    if (resolveDiscordTargetUrl(webhooks, "medium") && medEmails.length) {
      await deliverDiscordEmails(
        resolveDiscordTargetUrl(webhooks, "medium"),
        summaryReport,
        medEmails,
        `📢 [${summaryReport.labelName}] 공지/일정(중) 메일 리포트 (${medEmails.length}건)`,
        0xf59e0b,
        { perEmail }
      );
      sentCount += 1;
    }

    if (resolveDiscordTargetUrl(webhooks, "low") && lowEmails.length) {
      await deliverDiscordEmails(
        resolveDiscordTargetUrl(webhooks, "low"),
        summaryReport,
        lowEmails,
        `ℹ️ [${summaryReport.labelName}] 정보성(하) 메일 요약 (${lowEmails.length}건)`,
        0x10b981,
        { perEmail }
      );
      sentCount += 1;
    }

    // 중요도 채널로 아무것도 못 보냈을 때만 기본 채널로 흘려보낸다.
    // (문자열을 넘기므로 커스텀/개인 웹훅이 두 번 전송되지 않는다)
    if (sentCount === 0 && isValidWebhookUrl(webhooks.defaultUrl)) {
      return await sendSummaryToDiscord(webhooks.defaultUrl, summaryReport);
    }

    return { ok: true, sent: sentCount + extraSent };
  }

  // 커스텀/개인 웹훅만 설정한 경우엔 기본 채널 전송 없이 끝낸다.
  if (!isValidWebhookUrl(webhooks.defaultUrl)) {
    return { ok: true, sent: extraSent };
  }

  // 기본 단일 채널 전송
  // 메일 단위 모드에서는 종합 브리핑을 머리말 메시지로 한 번만 보내고, 그 뒤에 메일을 하나씩 보낸다.
  if (perEmail) {
    if (summaryReport.overallSummary) {
      await postDiscordEmbed(webhooks.defaultUrl, {
        title: `📋 [${summaryReport.labelName}] 라벨 메일 요약`,
        description: `총 ${summaryReport.totalAnalyzed || 0}개 중 ${summaryReport.selectedCount || 0}개 선별\n\n💡 **AI 종합 브리핑**\n${summaryReport.overallSummary}`.slice(0, 4096),
        color: 0x2563eb,
        footer: { text: "Gmail AI Labeler" },
        timestamp: new Date().toISOString(),
      });
      await sleep(DISCORD_PER_EMAIL_GAP_MS);
    }
    await sendPerEmailDiscordEmbeds(webhooks.defaultUrl, summaryReport, summaryReport.selectedEmails || []);
    return { ok: true, sent: 1 + extraSent };
  }

  const fields = [];
  if (summaryReport.overallSummary) {
    fields.push({ name: "💡 AI 종합 브리핑", value: summaryReport.overallSummary.slice(0, 1024), inline: false });
  }

  const hasHigh = (summaryReport.selectedEmails || []).some((e) => e.importance === "상");
  const hasMedium = (summaryReport.selectedEmails || []).some((e) => e.importance === "중");
  const embedColor = hasHigh ? 0xf43f5e : hasMedium ? 0xf59e0b : 0x10b981;

  if (Array.isArray(summaryReport.selectedEmails) && summaryReport.selectedEmails.length) {
    // embed 제한은 sendSingleDiscordEmbed가 여러 메시지로 쪼개 처리하므로 선별 메일을 잘라내지 않는다
    const list = summaryReport.selectedEmails;
    list.forEach((item, idx) => {
      const imp = item.importance || "중";
      const impIcon = imp === "상" ? "🔴" : imp === "중" ? "🟡" : "🟢";

      // 디스코드 문법 코드블록을 활용한 색상 박스 및 AI 한줄 브리핑 연출
      const colorBox = imp === "상"
        ? "```diff\n- 🔴 [AI 판단: 긴급 조치 필요]\n```"
        : imp === "중"
        ? "```yaml\n🟡 [AI 판단: 주요 공지 및 일정]\n```"
        : "```bash\n🟢 [AI 판단: 일반 참고 알림]\n```";

      let val = `${colorBox}\n${item.discordSummaryText ? `💬 **AI 요약**: ${item.discordSummaryText}\n` : ""}**발신자**: ${item.sender || "정보 없음"}\n`;
      if (Array.isArray(item.summaryPoints)) {
        item.summaryPoints.forEach((pt) => { val += `• ${pt}\n`; });
      }
      if (item.actionRequired && item.actionRequired !== "없음") {
        val += `⚡ **조치 사항**: ${item.actionRequired}\n`;
      }
      if (item.id) {
        val += `🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})`;
      }
      fields.push({
        name: `${idx + 1}. ${impIcon} [AI분류: ${item.discordCategory || imp}] ${item.subject.slice(0, 200)}`,
        value: val.slice(0, 1024),
        inline: false,
      });
    });
  }

  await sendSingleDiscordEmbed(
    webhooks.defaultUrl,
    `📋 [${summaryReport.labelName}] 라벨 메일 요약 리포트`,
    `총 ${summaryReport.totalAnalyzed || 0}개 메일 중 ${summaryReport.selectedCount || 0}개 주요 메일 선별`,
    embedColor,
    fields
  );

  return { ok: true, sent: 1 + extraSent };
}


// categories: 마스터 최상위 카테고리 목록(고정 - 이 파이프라인에서는 새 최상위 카테고리를 만들지 않음)
// excludeLabel: 지정하면 이 라벨은 1단계 분류 후보에서 제외(분할 모드) - 그래도 라벨 배타 제거 대상에는 포함됨
//
// 동작 방식(2단계):
//  1단계: 메일을 가볍게 한 번 훑어서 고정된 최상위 카테고리 중 하나로만 분류(신뢰도 낮으면 자동으로 '기타').
//  2단계: 1단계에서 같은 카테고리로 모인 메일들끼리 다시 모아, 그 안에서 하위 라벨이 필요한지 판단해서
//         있으면 짧은 한 단어 하위 라벨로 재분류(기존 하위 라벨 우선 재사용). 최상위 카테고리는 추가로 생기지 않는다.
// categoryDefs: [{name, description}] 형태의 사용자 정의 카테고리 목록 (하위 라벨 없이 전부 평평한 구조)
// excludeLabel: 지정하면 이 라벨은 분류 후보에서 제외(분할 모드) - 그래도 라벨 배타 제거 대상에는 포함됨
//
// 동작 방식(단일 단계, 하위 라벨 없음):
//  메일 상세 조회 -> 개인 필터 규칙 우선 적용(매칭되면 AI 호출 없이 즉시 확정) -> 남은 메일은 사용자 정의
//  카테고리(이름 + 설명)를 기준으로 AI가 하나씩 배정(신뢰도 낮으면 자동으로 '기타') -> 라벨 실제 적용.
//  세 단계(상세조회/분류/적용) 모두 진행률에 반영해서 "적용" 단계 도중에 100%로 잘못 표시되는 일이 없게 한다.


// 저장된 Discord 웹훅 설정을 sendSummaryToDiscord()가 받는 형태로 모아준다.
async function loadDiscordWebhookConfig() {
  const settings = await SettingsStore.getSettings();
  const notifSettings = settings.notifications.discord || {};
  const custom = settings.notifications.customWebhooks || [];
  return {
    defaultUrl: notifSettings.defaultWebhook || "",
    highUrl: notifSettings.highWebhook || "",
    mediumUrl: notifSettings.mediumWebhook || "",
    lowUrl: notifSettings.lowWebhook || "",
    custom: Array.isArray(custom) ? custom : [],
  };
}

export {
  loadDiscordWebhookConfig,
  DISCORD_MAX_EMBED_CHARS,
  DISCORD_MAX_FIELDS_PER_EMBED,
  DISCORD_PER_EMAIL_GAP_MS,
  buildDiscordEmailFields,
  chunkDiscordFields,
  deliverDiscordEmails,
  discordColorForImportance,
  isDiscordPerEmailEnabled,
  isValidWebhookUrl,
  matchesCustomWebhookRule,
  normalizeDiscordFields,
  postDiscordEmbed,
  resolveDiscordTargetUrl,
  sendExtraDiscordWebhooks,
  sendPerEmailDiscordEmbeds,
  sendSingleDiscordEmbed,
  sendSummaryToDiscord,
  splitWebhookKeywords,
};
