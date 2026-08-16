// bg/core/job_runner.js
// 모든 배치 작업의 공통 실행 껍데기: 상태 저장, 로그, 알림, 최근 활동 기록, 정리.
// 개별 기능은 "무엇을 하는지"(jobFn)만 알면 되고, 진행 상태를 어떻게 저장하고 알리는지는 몰라도 된다.

import { t, i18nInit } from "../../i18n.js";
import { addLog, flushLogs } from "./logger.js";
import { clearProgressBadge } from "./progress.js";
import { isCancelled, isCancellationError, resetCancellation } from "./cancellation.js";
import { startKeepAlive, stopKeepAlive } from "./keep_alive.js";
import { notifyCompletion, notifyError, summaryMessage } from "./notifications.js";
import { emit } from "./events.js";
// 작업 아이콘 전환은 features/appearance가 이 토픽을 구독해서 처리한다.
// core가 아이콘 드로잉 코드를 직접 부르면 core -> feature 방향 의존이 생긴다.
import { JOB_RUNNING_CHANGED } from "./topics.js";

const MAX_RECENT_JOBS = 10;

function isJobRunning() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["jobStatus"], (result) => resolve(result.jobStatus === "running"));
  });
}

async function markJobRunning(jobKind) {
  resetCancellation();
  startKeepAlive();
  await emit(JOB_RUNNING_CHANGED, { running: true });
  // 로그는 작업마다 지우지 않고 누적 보존한다(사용자가 로그 창에서 직접 "초기화"할 때만 삭제).
  await chrome.storage.local.set({
    jobStatus: "running",
    jobKind: jobKind || "unknown",
    jobStartedAt: Date.now(),
    jobCancelRequested: false,
    jobProgress: { processed: 0, total: 0, batchIndex: 0, batchTotal: 0 },
  });
}

// 팝업의 "최근 활동" 카드가 읽는 목록.
// 예전에는 팝업이 recentJobs를 읽기만 하고 쓰는 코드가 아예 없어서
// 항상 "No recent activity"만 표시됐다.
async function recordRecentJob(name, status, resultText) {
  try {
    const stored = await new Promise((resolve) => chrome.storage.local.get(["recentJobs"], resolve));
    const jobs = Array.isArray(stored.recentJobs) ? stored.recentJobs : [];
    jobs.unshift({ name, status, result: resultText || "", at: Date.now() });
    await chrome.storage.local.set({ recentJobs: jobs.slice(0, MAX_RECENT_JOBS) });
  } catch (e) {
    // 기록 실패가 작업 결과에 영향을 주면 안 된다.
  }
}

async function runJob(jobFn, notifyTitleKey, notifyTitleParams) {
  await i18nInit();
  const notifyTitle = t(notifyTitleKey, notifyTitleParams);
  await addLog(t("logJobStarted", [notifyTitle]));

  try {
    let summary = await jobFn();
    // 강제 중지는 UI 상태를 먼저 종료시키므로, 이미 진행 중이던 비동기 작업이
    // 뒤늦게 반환해도 완료 상태로 되돌아가지 않게 한다.
    if (isCancelled() && !summary.cancelled) summary = { ...summary, cancelled: true };
    const finalStatus = summary.quotaExhausted ? "quota_exceeded" : summary.cancelled ? "cancelled" : "done";
    await chrome.storage.local.set({ jobStatus: finalStatus, jobResult: summary, jobFinishedAt: Date.now() });
    await chrome.storage.local.remove(["lastApiError"]);
    await addLog(
      summary.quotaExhausted ? t("logJobQuotaExceeded") : summary.cancelled ? t("logJobCancelled") : t("logJobDone")
    );
    await notifyCompletion(notifyTitle, summary);
    await recordRecentJob(notifyTitle, finalStatus === "done" ? "done" : finalStatus, summaryMessage(summary));
  } catch (err) {
    const errMsg = String(err.message || err);
    const apiService = /gemini/i.test(errMsg)
      ? "Gemini API"
      : /oauth|google sign-in/i.test(errMsg)
      ? "Google OAuth"
      : /gmail/i.test(errMsg)
      ? "Gmail API"
      : "";
    if (apiService) {
      await chrome.storage.local.set({
        lastApiError: { service: apiService, message: errMsg.slice(0, 400), at: Date.now() },
      });
    }
    if (isCancelled() || isCancellationError(err)) {
      const summary = { total: 0, success: 0, failMessages: [], requestsUsed: 0, cancelled: true, quotaExhausted: false };
      await chrome.storage.local.set({ jobStatus: "cancelled", jobResult: summary, jobFinishedAt: Date.now() });
      await addLog(t("logJobCancelled"));
      await notifyCompletion(notifyTitle, summary);
      await recordRecentJob(notifyTitle, "cancelled", t("logJobCancelled"));
    } else {
      await chrome.storage.local.set({ jobStatus: "error", jobError: errMsg, jobFinishedAt: Date.now() });
      await addLog(t("logJobError", [errMsg]), "error");
      await notifyError(t("notifyTitleErrorSuffix", [notifyTitle]), errMsg);
      await recordRecentJob(notifyTitle, "error", errMsg.slice(0, 200));
    }
  } finally {
    stopKeepAlive();
    await emit(JOB_RUNNING_CHANGED, { running: false });
    clearProgressBadge(); // 작업이 끝난 뒤 "100%" 배지가 계속 남지 않게 지운다
    await flushLogs(); // 버퍼에 남은 로그를 확실히 기록(서비스 워커가 곧 중단될 수 있음)
  }
}

export { isJobRunning, markJobRunning, recordRecentJob, runJob };
