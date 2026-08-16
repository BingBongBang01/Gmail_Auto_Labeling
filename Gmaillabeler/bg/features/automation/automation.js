// bg/features/automation/automation.js
// 알람 기반 자동 실행. 실제 작업은 잡 레지스트리를 통해 시작하므로
// 이 파일은 분류/요약 구현이 어디에 있는지 알지 못한다.

import { startJob } from "../../core/job_registry.js";
import { isJobRunning } from "../../core/job_runner.js";
import { getCategoryDefinitions, getCategoryNames } from "../../domain/categories.js";
import { BATCH_SIZE } from "../../domain/limits.js";
import { getActiveAiCredentials, hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { getMessagesByLabelName, getRecentMessages } from "../../platform/gmail_api.js";
import { initGmailOnlyContext } from "../../platform/gmail_labels.js";
import { SettingsStore } from "../../../settings/settings_store.js";

const AUTO_CLASSIFY_CHECK_ALARM = "gmailLabelerAutoClassifyCheck";
const AUTO_CLASSIFY_STARTUP_DELAY_MS = 10000;
const AUTO_CLASSIFY_BLOCKED_UNTIL_KEY = "autoClassifyBlockedUntil";
const AUTO_CLASSIFY_CHECK_PERIOD_MIN = 5; // 새 메일 도착 여부를 이 주기(분)마다 확인

function registerAutoClassifyAlarm() {
  chrome.alarms.create(AUTO_CLASSIFY_CHECK_ALARM, { periodInMinutes: AUTO_CLASSIFY_CHECK_PERIOD_MIN });
}

// Give storage and OAuth initialization time to settle before the first
// automatic-mail check after Chrome or the extension starts.
async function delayInitialAutoClassifyCheck() {
  const blockedUntil = Date.now() + AUTO_CLASSIFY_STARTUP_DELAY_MS;
  await chrome.storage.local.set({ [AUTO_CLASSIFY_BLOCKED_UNTIL_KEY]: blockedUntil });
  setTimeout(async () => {
    const stored = await chrome.storage.local.get([AUTO_CLASSIFY_BLOCKED_UNTIL_KEY]);
    if (stored[AUTO_CLASSIFY_BLOCKED_UNTIL_KEY] !== blockedUntil) return;
    await chrome.storage.local.remove([AUTO_CLASSIFY_BLOCKED_UNTIL_KEY]);
    checkAutoClassifyTrigger();
  }, AUTO_CLASSIFY_STARTUP_DELAY_MS);
}

// 새 메일 자동 분류: 라벨 없는 메일이 설정한 임계값(1~배치크기) 이상 쌓이면 자동으로 1배치 분류를 시작한다.
async function checkAutoClassifyTrigger() {
  const settings = await SettingsStore.getSettings();
  const stored = await new Promise((resolve) =>
    chrome.storage.local.get([AUTO_CLASSIFY_BLOCKED_UNTIL_KEY], resolve)
  );
  if ((stored[AUTO_CLASSIFY_BLOCKED_UNTIL_KEY] || 0) > Date.now()) return;
  // 기본값: 켜짐 / 1개 (사용자가 명시적으로 끈 적이 없다면 새 기본값을 적용)
  const autoClassifyEnabled = settings.automation.autoClassify.enabled !== false;
  if (!autoClassifyEnabled) return;

  const running = await isJobRunning();
  if (running) return; // 다른 작업이 이미 진행 중이면 이번 주기는 건너뜀

  const threshold = Math.max(1, Math.min(BATCH_SIZE, parseInt(settings.automation.autoClassify.threshold, 10) || 1));

  try {
    const apiKeys = await getActiveAiCredentials();
    if (!apiKeys.length) return; // API 키 없으면 자동 실행 안 함
    if (!(await hasUsableAiCredential())) return; // API 키 없으면 자동 실행 안 함

    const categories = getCategoryNames(await getCategoryDefinitions());
    const { token } = await initGmailOnlyContext();
    const messages = await getRecentMessages(token, threshold, categories);

    if (messages.length >= threshold) {
      // 잡 레지스트리를 통해 시작한다. 자동화는 분류 구현이 어디 있는지 알 필요가 없고,
      // "이미 실행 중인지" 검사와 상태 기록도 레지스트리가 일관되게 처리한다.
      await startJob("gmail_classify", { count: threshold });
    }
  } catch (e) {
    console.error("[GmailLabeler] 자동 분류 확인 실패:", e);
  }
}

// 자동 요약: 지정한 라벨에 새 메일이 붙으면 그 새 메일들만 요약하고, 원하면 Discord로 바로 보낸다.
//
// "새 메일"은 라벨 메일 목록(최신순)의 맨 위 ID를 기억해두고 비교하는 방식으로 찾는다.
// 목록 조회 1회면 되므로 주기적으로 돌려도 API 부담이 거의 없다.
async function checkAutoSummaryTrigger() {
  const settings = await SettingsStore.getSettings();
  const storedRuntime = await new Promise((resolve) =>
    chrome.storage.local.get(
      [
        "autoSummaryLastTopId",
        "autoSummaryLastLabel",
      ],
      resolve
    )
  );

  if (settings.automation.autoSummary.enabled !== true) return;
  const labelName = (settings.automation.autoSummary.label || "").trim();
  if (!labelName) return;

  const running = await isJobRunning();
  if (running) return;

  try {
    const apiKeys = await getActiveAiCredentials();
    if (!apiKeys.length) return;
    if (!(await hasUsableAiCredential())) return;

    const { token } = await initGmailOnlyContext();
    const maxCount = Math.max(1, Math.min(100, parseInt(settings.automation.autoSummary.maxCount, 10) || 20));
    const messages = await getMessagesByLabelName(token, labelName, maxCount);
    if (!messages || !messages.length) return;

    const topId = messages[0].id;
    // 대상 라벨이 바뀌었거나 처음 켠 직후에는, 이미 쌓여 있던 메일을 통째로 요약하지 않고 기준점만 잡는다.
    if (storedRuntime.autoSummaryLastLabel !== labelName || !storedRuntime.autoSummaryLastTopId) {
      await chrome.storage.local.set({ autoSummaryLastTopId: topId, autoSummaryLastLabel: labelName });
      return;
    }
    if (topId === storedRuntime.autoSummaryLastTopId) return;

    // 기억해둔 ID가 목록에서 사라졌다면(그 사이에 maxCount보다 많이 들어옴) 목록 전체를 새 메일로 본다.
    const seenIdx = messages.findIndex((m) => m.id === storedRuntime.autoSummaryLastTopId);
    const newCount = seenIdx === -1 ? messages.length : seenIdx;
    if (newCount <= 0) return;

    // 같은 메일로 반복 실행되지 않도록 기준점을 먼저 갱신한다.
    await chrome.storage.local.set({ autoSummaryLastTopId: topId, autoSummaryLastLabel: labelName });

    const filterCriteria = settings.automation.autoSummary.criteria || "";

    // source: "auto"를 넘기면 요약 완료 시 summary.completed 이벤트가 그 표시와 함께 발행되고,
    // Discord 기능이 그걸 구독해 자동 전송 여부를 스스로 판단한다.
    // 여기서 Discord를 직접 부르지 않으므로, Discord 기능을 빼도 자동 요약은 그대로 동작한다.
    await startJob("gmail_summarize", {
      labelName,
      count: newCount,
      filterCriteria,
      source: "auto",
    });
  } catch (e) {
    console.error("[GmailLabeler] 자동 요약 확인 실패:", e);
  }
}



export {
  AUTO_CLASSIFY_BLOCKED_UNTIL_KEY,
  AUTO_CLASSIFY_CHECK_ALARM,
  AUTO_CLASSIFY_CHECK_PERIOD_MIN,
  AUTO_CLASSIFY_STARTUP_DELAY_MS,
  checkAutoClassifyTrigger,
  checkAutoSummaryTrigger,
  delayInitialAutoClassifyCheck,
  registerAutoClassifyAlarm,
};
