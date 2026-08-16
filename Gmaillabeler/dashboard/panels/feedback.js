// dashboard/panels/feedback.js
// 요약 결과에 대한 사용자 판정(중요/안중요)을 기억하고 집계한다.
// 라벨은 건드리지 않는다.

// ---------------- 요약 피드백 (라벨은 건드리지 않고 판정만 기억) ----------------

import { getLastReportData, renderReport } from "./report.js";
import { $, escapeHtml } from "../ui/dom.js";
import { t } from "../../i18n.js";

let summaryFeedbackList = [];

function feedbackVerdictFor(mailId) {
  if (!mailId) return null;
  const found = summaryFeedbackList.find((f) => f.id === mailId);
  return found ? found.verdict : null;
}

const MAX_SUMMARY_FEEDBACK = 200; // 오래된 판정은 밀어내서 저장소가 무한히 커지지 않게 한다

function recordSummaryFeedback(mail, labelName, verdict, done) {
  summaryFeedbackList = summaryFeedbackList.filter((f) => f.id !== mail.id);
  if (verdict) {
    summaryFeedbackList.push({
      id: mail.id,
      subject: mail.subject || "",
      sender: mail.sender || "",
      summary: (mail.summaryPoints || []).join(" ").slice(0, 300),
      labelName: labelName || "",
      verdict,
      at: Date.now(),
    });
  }
  if (summaryFeedbackList.length > MAX_SUMMARY_FEEDBACK) {
    summaryFeedbackList = summaryFeedbackList.slice(-MAX_SUMMARY_FEEDBACK);
  }
  chrome.storage.local.set({ summaryFeedback: summaryFeedbackList }, () => {
    renderFeedbackSummary();
    if (done) done();
  });
}

function loadSummaryFeedback(done) {
  chrome.storage.local.get(["summaryFeedback"], (stored) => {
    summaryFeedbackList = Array.isArray(stored.summaryFeedback) ? stored.summaryFeedback : [];
    renderFeedbackSummary();
    if (done) done();
  });
}

function renderFeedbackSummary() {
  const box = $("dashFeedbackList");
  if (!box) return;

  if (!summaryFeedbackList.length) {
    box.innerHTML = `<p class="dash-desc">${escapeHtml(t("dashFeedbackEmpty"))}</p>`;
    return;
  }

  const recent = summaryFeedbackList.slice().reverse().slice(0, 20);
  box.innerHTML =
    `<p class="dash-desc">${escapeHtml(t("dashFeedbackCount", [String(summaryFeedbackList.length)]))}</p>` +
    recent
      .map(
        (f) =>
          `<div class="feedback-row">
            <span class="feedback-verdict ${escapeHtml(f.verdict)}">${escapeHtml(t("dashFeedbackVerdict_" + f.verdict))}</span>
            <span class="feedback-subject">${escapeHtml(f.subject || "-")}</span>
            <span class="feedback-sender">${escapeHtml(f.sender || "")}</span>
            <button class="dash-btn dash-btn-secondary feedback-del-btn" data-id="${escapeHtml(f.id || "")}">✕</button>
          </div>`
      )
      .join("");

  box.querySelectorAll(".feedback-del-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      summaryFeedbackList = summaryFeedbackList.filter((f) => f.id !== btn.getAttribute("data-id"));
      chrome.storage.local.set({ summaryFeedback: summaryFeedbackList }, () => {
        renderFeedbackSummary();
        if (getLastReportData()) renderReport(getLastReportData());
      });
    });
  });
}


// 판정 목록은 이 모듈이 소유한다. 밖에서는 아래 두 함수로만 만진다
// (ES 모듈에서는 다른 모듈의 let 바인딩에 직접 대입할 수 없다).
function hasSummaryFeedback() {
  return summaryFeedbackList.length > 0;
}

function clearSummaryFeedback() {
  summaryFeedbackList = [];
}

export {
  hasSummaryFeedback,
  clearSummaryFeedback,
  MAX_SUMMARY_FEEDBACK,
  feedbackVerdictFor,
  loadSummaryFeedback,
  recordSummaryFeedback,
  renderFeedbackSummary,
  summaryFeedbackList,
};
