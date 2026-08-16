// dashboard/ui/status.js
// 작업 상태 표시: 상단 상태 배지, 결과 카드, 진행률, 상태 폴링.
// 백그라운드가 storage에 쓰는 상태를 읽어 화면에 옮기는 일만 한다.

import { renderReport } from "../panels/report.js";
import { $, escapeHtml, show } from "./dom.js";
import { t } from "../../i18n.js";

let pollTimer = null;
let statusChangeListenerAdded = false;

// ---------------- 상태 표시 ----------------
const STATUS_LABEL_KEYS = {
  idle: "statusIdle",
  running: "statusRunning",
  done: "statusDone",
  error: "statusError",
  cancelled: "statusCancelled",
  quota_exceeded: "statusQuotaExceeded",
};

function updateStatusPill(status) {
  const pill = $("statusPill");
  const pillText = $("statusPillText");
  if (!pill || !pillText) return;
  pill.className = "status-pill " + (status || "idle");
  pillText.textContent = t(STATUS_LABEL_KEYS[status] || STATUS_LABEL_KEYS.idle);
}


// ---------------- 상태 폴링 ----------------
// ---------------- 결과 요약 카드 ----------------
// 한 줄 텍스트로는 실패가 몇 건인지, AI 요청을 얼마나 썼는지 알기 어려웠다.
function buildResultCardHtml(jobStatus, jobResult, jobError, finishedAt) {
  const statusKey =
    jobStatus === "done" ? "statusDone"
    : jobStatus === "cancelled" ? "statusCancelled"
    : jobStatus === "quota_exceeded" ? "statusQuotaExceeded"
    : "statusError";
  const icon =
    jobStatus === "done" ? "✅" : jobStatus === "cancelled" ? "🛑" : jobStatus === "quota_exceeded" ? "⏳" : "⚠️";

  const r = jobResult || {};
  const total = Number(r.total || 0);
  const success = Number(r.success || 0);
  // 실패는 실제로 실패 메시지가 남은 건수만 센다.
  // (중지/할당량 초과로 손대지 못한 나머지는 실패가 아니라 미처리이므로 total - success로 추정하지 않는다)
  const failed = r.failMessages ? r.failMessages.length : 0;
  const requests = r.requestsUsed;

  let html = `<div class="result-card">`;
  html += `<div class="result-card-head ${escapeHtml(jobStatus)}">${icon} ${escapeHtml(t(statusKey))}</div>`;

  if (jobStatus !== "error") {
    html += `<div class="result-card-stats">
      <div class="result-stat ok"><div class="result-stat-label">${escapeHtml(t("resultCardSuccess"))}</div><div class="result-stat-value">${success}</div></div>
      <div class="result-stat ${failed ? "fail" : ""}"><div class="result-stat-label">${escapeHtml(t("resultCardFailed"))}</div><div class="result-stat-value">${failed}</div></div>
      <div class="result-stat"><div class="result-stat-label">${escapeHtml(t("resultCardTotal"))}</div><div class="result-stat-value">${total}</div></div>
      <div class="result-stat"><div class="result-stat-label">${escapeHtml(t("resultCardRequests"))}</div><div class="result-stat-value">${requests === undefined ? "-" : requests}</div></div>
    </div>`;
  }

  const reason = jobStatus === "error" ? jobError : (r.failMessages && r.failMessages[0]);
  if (reason) {
    html += `<div class="result-card-reason">${escapeHtml(t("resultCardFailReason"))}: ${escapeHtml(String(reason))}</div>`;
  }
  if (jobStatus === "quota_exceeded") {
    html += `<div class="result-card-reason">${escapeHtml(t("dashResultQuota", [total, success]))}</div>`;
  }
  if (finishedAt) {
    html += `<div class="result-card-time">${escapeHtml(t("resultCardFinishedAt"))}: ${escapeHtml(new Date(finishedAt).toLocaleString())}</div>`;
  }
  html += `</div>`;
  return html;
}

function showResultCard(boxId, jobStatus, jobResult, jobError, finishedAt) {
  const box = $(boxId);
  if (!box) return;
  box.innerHTML = buildResultCardHtml(jobStatus, jobResult, jobError, finishedAt);
}

function renderJobProgress(prefix, result, runningText) {
  const wrap = $(`${prefix}ProgressWrap`);
  const bar = $(`${prefix}ProgressBar`);
  const text = $(`${prefix}ProgressText`);
  if (!wrap || !bar) return;

  if (result.jobStatus === "running") {
    wrap.style.display = "block";
    if (result.jobProgress && result.jobProgress.total) {
      const pct = Math.min(
        100,
        Math.round((result.jobProgress.processed / result.jobProgress.total) * 100)
      );
      bar.style.width = `${pct}%`;
      if (text) {
        text.textContent = `${runningText} (${result.jobProgress.processed}/${result.jobProgress.total}, ${pct}%)`;
      }
    } else if (text) {
      text.textContent = runningText;
    }
  } else {
    wrap.style.display = "none";
  }
}

function pollStatus() {
  chrome.runtime.sendMessage({ action: "getJobStatus" }, (result) => {
    if (chrome.runtime.lastError || !result) return;

    updateStatusPill(result.jobStatus);

    const isRunning = result.jobStatus === "running";
    const startSummaryBtn = $("dashStartSummaryBtn");
    const startClassifyBtn = $("dashStartClassifyBtn");
    if (startSummaryBtn) startSummaryBtn.disabled = isRunning;
    if (startClassifyBtn) startClassifyBtn.disabled = isRunning;
    show("dashStopClassifyBtn", isRunning, "inline-block");

    if (result.jobKind === "labelSummary") {
      renderJobProgress("dashSummary", result, t("dashJobSummarizing"));
      if (result.jobStatus === "done") {
        chrome.storage.local.get(["lastLabelSummary"], (stored) => {
          if (stored.lastLabelSummary) renderReport(stored.lastLabelSummary);
        });
      } else if (result.jobStatus === "error") {
        const box = $("dashSummaryResultBox");
        if (box) box.textContent = t("errorGenericPrefix", [result.jobError || ""]);
      }
    }

    if (result.jobKind === "classify" || result.jobKind === "repeat" || result.jobKind === "relabel" || result.jobKind === "dedupe") {
      renderJobProgress("dashClassify", result, t("dashJobClassifying"));
      // 반복 분류는 전용 결과 칸이 있으면 거기에도 같은 카드를 그린다
      const resultBoxId = result.jobKind === "repeat" && $("dashRepeatResultBox") ? "dashRepeatResultBox" : "dashClassifyResultBox";
      const box = $(resultBoxId);
      if (box) {
        if (isRunning) {
          box.textContent = t("dashJobRunningGeneric");
        } else if (["done", "cancelled", "quota_exceeded"].includes(result.jobStatus) && result.jobResult) {
          showResultCard(resultBoxId, result.jobStatus, result.jobResult, null, result.jobFinishedAt);
        } else if (result.jobStatus === "error") {
          showResultCard(resultBoxId, "error", null, result.jobError, result.jobFinishedAt);
        }
      }
    }

    if (isRunning) {
      ensureStatusWatch();
    } else if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });
}


// 백그라운드가 진행률/상태를 storage에 쓰므로 변경 이벤트로 반응하고,
// 폴링은 이벤트를 놓쳤을 때를 위한 백업으로만 느리게 돌린다.
const STATUS_POLL_BACKUP_MS = 3000;

function ensureStatusWatch() {
  if (!pollTimer) pollTimer = setInterval(pollStatus, STATUS_POLL_BACKUP_MS);
  if (statusChangeListenerAdded) return;
  statusChangeListenerAdded = true;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.jobProgress || changes.jobStatus || changes.jobResult || changes.jobError) {
      pollStatus();
    }
  });
}

export {
  ensureStatusWatch,
  STATUS_POLL_BACKUP_MS,
  STATUS_LABEL_KEYS,
  buildResultCardHtml,
  pollStatus,
  pollTimer,
  renderJobProgress,
  showResultCard,
  statusChangeListenerAdded,
  updateStatusPill,
};
