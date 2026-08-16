// dashboard/panels/report.js
// 요약 리포트 렌더링과 요약 실행 버튼.

import { startJob } from "../job_client.js";
import { feedbackVerdictFor, recordSummaryFeedback } from "./feedback.js";
import { getSelectedLabelName } from "./labels.js";
import { $, escapeHtml, show } from "../ui/dom.js";
import { t } from "../../i18n.js";

let lastReportData = null;
let selectedPriorityFilter = "all"; // 리포트를 다시 그려도 유지되도록 모듈 스코프에 둔다

function importanceLabel(value) {
  if (value === "상") return t("dashImportanceHigh");
  if (value === "중") return t("dashImportanceMedium");
  if (value === "하") return t("dashImportanceLow");
  return value || "";
}


// ---------------- 요약 리포트 렌더링 ----------------
function renderReport(report) {
  const resultBox = $("dashSummaryResultBox");
  if (!report || !resultBox) return;

  lastReportData = report;
  show("dashSummaryActionRow", true, "flex");

  const emailsAll = Array.isArray(report.selectedEmails) ? report.selectedEmails : [];
  const emailsToDisplay =
    selectedPriorityFilter === "all"
      ? emailsAll
      : emailsAll.filter((e) => e.importance === selectedPriorityFilter);

  let html = "";

  html += `<div class="dash-action-bar">
    <span class="badge-sub">${escapeHtml(t("dashSelectedCountLine", [report.totalAnalyzed || 0, report.selectedCount || 0]))}</span>
    <span class="quick-chip-wrap">
      ${["all", "상", "중", "하"]
        .map(
          (imp) =>
            `<button class="priority-chip${selectedPriorityFilter === imp ? " active" : ""}" data-imp="${escapeHtml(imp)}">${
              imp === "all" ? escapeHtml(t("dashFilterAll")) : escapeHtml(t("dashFilterImportance", [importanceLabel(imp)]))
            }</button>`
        )
        .join("")}
    </span>
  </div>`;

  if (report.overallSummary) {
    html += `<div class="summary-brief-card">
      <div class="brief-title">${escapeHtml(t("dashBriefTitle", [report.labelName || ""]))}</div>
      <div class="brief-text">${escapeHtml(report.overallSummary)}</div>
    </div>`;
  }

  html += `<div class="email-cards-list">`;

  if (emailsToDisplay.length) {
    emailsToDisplay.forEach((item, idx) => {
      const imp = item.importance || "중";
      const impClass = imp === "상" ? "imp-high" : imp === "중" ? "imp-medium" : "imp-low";
      const mailUrl = item.id ? `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(item.id)}` : null;

      html += `<div class="email-card ${impClass}">
        <div class="email-card-header">
          <div>
            <span class="email-card-title">${idx + 1}. ${escapeHtml(item.subject)}</span>
            <span class="accordion-icon">▼</span>
          </div>
          <span class="imp-tag ${impClass}">${escapeHtml(t("dashCardImportance", [importanceLabel(imp)]))}</span>
        </div>
        <div class="email-card-body">
          <div class="email-card-sender">${escapeHtml(t("dashCardSender"))}: ${escapeHtml(item.sender || t("dashSenderUnknown"))}</div>`;

      if (Array.isArray(item.summaryPoints) && item.summaryPoints.length) {
        html += `<ul class="email-card-bullets">`;
        item.summaryPoints.forEach((pt) => {
          html += `<li>${escapeHtml(pt)}</li>`;
        });
        html += `</ul>`;
      }

      if (item.actionRequired && item.actionRequired !== "없음") {
        html += `<div class="email-card-action">⚡ ${escapeHtml(t("dashCardAction"))}: ${escapeHtml(item.actionRequired)}</div>`;
      }

      // 피드백 버튼: Gmail 라벨은 그대로 두고, 판정만 기억해서 나중에 판단 기준 학습에 쓴다.
      const verdict = feedbackVerdictFor(item.id);
      html += `<div class="email-card-feedback" data-mail-id="${escapeHtml(item.id || "")}">
        <span class="feedback-label">${escapeHtml(t("dashFeedbackPrompt"))}</span>
        ${[
          ["notMine", t("dashFeedbackNotMine")],
          ["mine", t("dashFeedbackMine")],
          ["notImportant", t("dashFeedbackNotImportant")],
          ["important", t("dashFeedbackImportant")],
        ]
          .map(
            ([key, text]) =>
              `<button class="feedback-chip${verdict === key ? " active" : ""}" data-verdict="${key}">${escapeHtml(text)}</button>`
          )
          .join("")}
      </div>`;

      if (mailUrl) {
        html += `<div class="email-card-footer">
          <a href="${escapeHtml(mailUrl)}" target="_blank" rel="noreferrer" class="email-card-link">${escapeHtml(t("dashOpenInGmail"))}</a>
        </div>`;
      }

      html += `</div></div>`;
    });
  } else {
    html += `<div class="dash-empty-state">${escapeHtml(t("dashNoSelectedMail"))}</div>`;
  }

  html += `</div>`;

  resultBox.innerHTML = html;

  resultBox.querySelectorAll(".priority-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      selectedPriorityFilter = chip.dataset.imp || "all";
      renderReport(report);
    });
  });

  resultBox.querySelectorAll(".email-card-header").forEach((header) => {
    header.addEventListener("click", () => {
      const card = header.closest(".email-card");
      if (card) card.classList.toggle("collapsed");
    });
  });

  resultBox.querySelectorAll(".email-card-feedback .feedback-chip").forEach((chip) => {
    chip.addEventListener("click", (event) => {
      event.stopPropagation(); // 카드 접힘 토글과 겹치지 않게
      const row = chip.closest(".email-card-feedback");
      const mailId = row ? row.getAttribute("data-mail-id") : "";
      const mail = emailsAll.find((e) => e.id === mailId);
      if (!mail) return;
      // 같은 버튼을 다시 누르면 판정 취소
      const next = feedbackVerdictFor(mailId) === chip.dataset.verdict ? null : chip.dataset.verdict;
      recordSummaryFeedback(mail, report.labelName, next, () => renderReport(report));
    });
  });
}


function generateSummaryText(report) {
  if (!report) return "";
  let text = `${t("dashCopyHeader", [report.labelName || ""])}\n\n● ${t("dashCopyOverall")}:\n${report.overallSummary || ""}\n\n● ${t("dashCopySelectedList", [report.selectedCount || 0, report.totalAnalyzed || 0])}:\n`;
  (report.selectedEmails || []).forEach((e, idx) => {
    text += `\n${idx + 1}. [${t("dashCopyImportanceLabel")}: ${importanceLabel(e.importance || "중")}] ${e.subject}\n   - ${t("dashCardSender")}: ${e.sender || ""}\n`;
    if (Array.isArray(e.summaryPoints)) {
      e.summaryPoints.forEach((pt) => {
        text += `   - ${pt}\n`;
      });
    }
    if (e.actionRequired && e.actionRequired !== "없음") {
      text += `   - ⚡ ${t("dashCardAction")}: ${e.actionRequired}\n`;
    }
  });
  return text;
}



// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.
function initReportEvents() {
  // --- 요약 실행 ---
  const startSummaryBtn = $("dashStartSummaryBtn");
  if (startSummaryBtn) {
    startSummaryBtn.addEventListener("click", () => {
      if (!getSelectedLabelName()) {
        alert(t("dashMsgNeedSummaryLabel"));
        return;
      }
      const countInput = $("dashSummaryCountInput");
      const criteriaInput = $("dashSummaryCriteriaInput");
      const count = parseInt(countInput ? countInput.value : "20", 10) || 20;
      chrome.storage.local.set({
        lastSummaryLabel: getSelectedLabelName(),
        lastSummaryCriteria: criteriaInput ? criteriaInput.value.trim() : "",
      });
      startJob({
        action: "startLabelSummary",
        labelName: getSelectedLabelName(),
        count,
        filterCriteria: criteriaInput ? criteriaInput.value : "",
      });
    });
  }
}


// 마지막으로 그린 요약 리포트. 다시 그릴 때 쓴다.
// 밖에서는 이 함수로만 읽는다(import 바인딩에는 대입할 수 없으므로 읽기 경로도 하나로 둔다).
function getLastReportData() {
  return lastReportData;
}

export {
  generateSummaryText,
  importanceLabel,
  initReportEvents,
  getLastReportData,
  renderReport,
  selectedPriorityFilter,
};
