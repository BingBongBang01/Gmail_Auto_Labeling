// background.js
// Gmail AI Labeler - Copyright (c) 2026 김태형 (thk7410@gmail.com). All rights reserved.
// See LICENSE file at the extension root for terms. Unauthorized redistribution or resale is prohibited.
//
// 서비스워커 진입점. 하는 일은 세 가지뿐이다.
//   1. 기능 모듈을 불러와 register()를 부른다
//   2. 확장 전체에 걸치는 액션(설정 조회, 로그, 중지)을 등록한다
//   3. 메시지 라우터를 켠다
//
// 실제 동작은 전부 아래 계층에 있다.
//   bg/core/      - 로그, 진행률, 중지, 잡 실행, 이벤트 버스, 메시지 라우터
//   bg/domain/    - 카테고리·한도 같은 여러 기능이 공유하는 도메인 데이터
//   bg/platform/  - Gmail / Google OAuth / AI 라우터 어댑터
//   bg/pipeline/  - 여러 기능이 공유하는 처리 파이프라인(분류 엔진)
//   bg/features/  - 기능. 서로를 import 하지 않고 이벤트 버스와 잡 레지스트리로만 연결된다
//
// 기능 하나를 빼려면 아래 import와 register() 호출 한 쌍만 지우면 된다.
// 다른 기능은 그 기능이 있었는지도 모르므로 영향을 받지 않는다.
//
// 주의: 서비스워커는 ES 모듈이지만(manifest의 background.type = "module"),
// 이벤트 리스너는 여전히 이 파일이 평가되는 동안 동기적으로 등록되어야 한다.
// 이 파일 최상위에 top-level await를 넣으면 그 아래 addListener가 늦게 걸려 이벤트를 놓친다.

import { SettingsStore } from "./settings/settings_store.js";
import { migrateToLatestSettings } from "./settings/settings_migration.js";
import { t, i18nInit } from "./i18n.js";

import { registerAction, registerMessageRouter } from "./bg/core/message_router.js";
import { startJob, getKnownJobTypes } from "./bg/core/job_registry.js";
import { requestCancellation } from "./bg/core/cancellation.js";
import { addLog, clearLogs, getRecentLogs } from "./bg/core/logger.js";
import { stopKeepAlive } from "./bg/core/keep_alive.js";
import { emit } from "./bg/core/events.js";
import { JOB_RUNNING_CHANGED } from "./bg/core/topics.js";
import { getLocalizedDefaultCategoryDefs } from "./bg/domain/categories.js";
import {
  BATCH_SIZE,
  GEMINI_RPD_LIMIT,
  GEMINI_RPM_LIMIT,
  GEMINI_TPM_LIMIT,
  MAX_BATCH_COUNT_PER_RUN,
  MAX_EMAIL_COUNT_PER_RUN,
} from "./bg/domain/limits.js";
import { getQuotaUsage } from "./bg/platform/ai_gateway.js";

// ---------------- 기능 등록 ----------------
// 여기서 한 줄을 지우면 그 기능만 사라진다.
import * as appearanceFeature from "./bg/features/appearance/index.js";
import * as oauthFeature from "./bg/features/oauth/index.js";
import * as classifyFeature from "./bg/features/classify/index.js";
import * as summarizeFeature from "./bg/features/summarize/index.js";
import * as labelAdminFeature from "./bg/features/label_admin/index.js";
import * as backupFeature from "./bg/features/backup/index.js";
import * as calendarFeature from "./bg/features/calendar/index.js";
import * as discordFeature from "./bg/features/discord/index.js";
import * as learningFeature from "./bg/features/learning/index.js";
import * as automationFeature from "./bg/features/automation/index.js";
import * as youtubeFeature from "./bg/features/youtube/index.js";
import * as pdfFeature from "./bg/features/pdf/index.js";
import * as aiFeature from "./bg/features/ai/index.js";

appearanceFeature.register();
oauthFeature.register();
classifyFeature.register();
summarizeFeature.register();
labelAdminFeature.register();
backupFeature.register();
calendarFeature.register();
discordFeature.register();
learningFeature.register();
automationFeature.register();
youtubeFeature.register();
pdfFeature.register();
aiFeature.register();

// ---------------- 설치 / 업데이트 ----------------
chrome.runtime.onInstalled.addListener(async (details) => {
  // 업데이트 시점에도 마이그레이션을 돌린다. 예전에는 옵션 페이지를 열 때만 실행돼서,
  // 옵션 화면에 한 번도 들어가지 않은 사용자는 v2 데이터가 영구히 옮겨지지 않았다.
  try {
    await migrateToLatestSettings();
  } catch (e) {
    console.warn("[GmailLabeler] 설정 마이그레이션 실패:", e);
  }

  // 전용 '나와 관련된 메일 웹훅'은 없어졌다(커스텀 웹훅의 onlyPersonal 조건으로 대체).
  // 쓰이지 않는 웹훅 URL이 저장소에 남아 있지 않게 지운다.
  await chrome.storage.local.remove(["discordWebhookUrlPersonal"]);

  if (details.reason !== "install") return;
  await i18nInit(true);
  // 설치 직후 기본 카테고리는 새 설정 구조에 넣는다.
  // 예전에는 평면 키 categoryDefinitions에 썼는데, 정작 읽는 쪽은 settings.gmail.categories라서
  // 기본 카테고리가 전달되지 않았다.
  await SettingsStore.setSettings({
    gmail: { categories: getLocalizedDefaultCategoryDefs() },
    automation: { autoClassify: { enabled: true, threshold: 1 } },
    data: { backup: { autoBackupToDrive: true } },
  });
});

// ---------------- 확장 전체에 걸치는 액션 ----------------
// 특정 기능에 속하지 않는 것만 여기 남는다. 기능별 액션은 각 기능의 index.js에 있다.

registerAction("job.start", (request) => startJob(request.jobType, request.payload || {}));

// UI가 아직 보내는 옛 액션 이름들. 전부 같은 잡 레지스트리로 흘려보낸다.
// 이렇게 하면 "실행 중인지 검사"와 "작업 시작" 로직이 한 벌만 존재한다.
// UI를 job.start 하나로 정리하고 나면 이 표는 통째로 지울 수 있다.
const LEGACY_ACTION_TO_JOB = {
  startClassification: (r) => ["gmail_classify", { count: parseInt(r.count, 10) || 5 }],
  startRepeatClassification: (r) => [
    "gmail_repeat_classify",
    { batchesPerRound: r.batchesPerRound, repeatCount: r.repeatCount },
  ],
  startLabelSummary: (r) => [
    "gmail_summarize",
    { labelName: r.labelName, count: r.count, filterCriteria: r.filterCriteria },
  ],
  startRelabel: (r) => ["gmail_relabel", { label: r.label, excludeSelf: r.excludeSelf }],
  relabelExistingEmails: (r) => ["gmail_relabel", { label: r.targetLabel, excludeSelf: r.excludeSelf }],
  startDedupeRelabel: () => ["gmail_dedupe_relabel", {}],
  dedupeAndRelabel: () => ["gmail_dedupe_relabel", {}],
  startDeleteAllLabels: () => ["gmail_delete_all_labels", {}],
  applyLabelColors: () => ["gmail_apply_label_colors", {}],
  startAnalyzeLabelCriteria: (r) => ["gmail_analyze_label_criteria", { labelName: r.labelName }],
  startAnalyzeMultipleLabels: (r) => ["gmail_analyze_multiple_labels", { labelNames: r.labelNames }],
  startTranslateCategories: (r) => ["gmail_translate_categories", { targetLocale: r.targetLocale }],
  startBackupToDrive: (r) => [
    "drive_backup",
    { includeCredentials: r.includeCredentials, passphrase: r.passphrase },
  ],
  backupToDrive: (r) => ["drive_backup", { includeCredentials: r.includeCredentials, passphrase: r.passphrase }],
  startRestoreFromDrive: (r) => ["drive_restore", { passphrase: r.passphrase }],
};

for (const [action, toJob] of Object.entries(LEGACY_ACTION_TO_JOB)) {
  registerAction(action, (request) => {
    const [jobType, payload] = toJob(request);
    return startJob(jobType, payload);
  });
}

// ----- 조회 -----
registerAction("getConfig", () => ({
  batchSize: BATCH_SIZE,
  maxBatchCountPerRun: MAX_BATCH_COUNT_PER_RUN,
  maxEmailCountPerRun: MAX_EMAIL_COUNT_PER_RUN,
  rpm: GEMINI_RPM_LIMIT,
  tpm: GEMINI_TPM_LIMIT,
  rpd: GEMINI_RPD_LIMIT,
}));

registerAction("getQuotaUsage", () => getQuotaUsage());

// 사이드패널이 부팅할 때 한 번 물어본다. 타일이 가리키는 작업이 실제로 등록돼 있는지
// 화면 쪽에서 확인해, 눌러도 아무 일이 없는 타일을 애초에 비활성으로 그리기 위한 것이다.
registerAction("job.listTypes", () => ({ ok: true, types: getKnownJobTypes() }));

registerAction("getJobStatus", () =>
  chrome.storage.local.get([
    "jobStatus",
    "jobResult",
    "jobError",
    "jobProgress",
    "jobKind",
    "jobFinishedAt",
    "lastApiError",
  ])
);

registerAction("getLogs", (request) => getRecentLogs(request.limit || 100));

registerAction("clearLogs", async () => {
  await clearLogs();
  return { ok: true };
});

// ----- 중지 -----
registerAction("cancelJob", async () => {
  requestCancellation();
  await chrome.storage.local.set({ jobCancelRequested: true });
  await addLog(t("logUserRequestedStop"), "warn");
  return { ok: true };
});

registerAction("forceCancelJob", async () => {
  requestCancellation();
  const stored = await chrome.storage.local.get(["jobResult"]);
  const previous = stored.jobResult || {};
  const summary = {
    total: previous.total || 0,
    success: previous.success || 0,
    failMessages: previous.failMessages || [],
    requestsUsed: previous.requestsUsed || 0,
    cancelled: true,
    quotaExhausted: false,
  };
  await chrome.storage.local.set({
    jobStatus: "cancelled",
    jobCancelRequested: true,
    jobResult: summary,
    jobFinishedAt: Date.now(),
  });
  stopKeepAlive();
  await emit(JOB_RUNNING_CHANGED, { running: false });
  await addLog(t("logUserRequestedStop"), "warn");
  return { ok: true };
});

// 모든 액션 등록이 끝난 뒤 리스너를 단다.
registerMessageRouter();
