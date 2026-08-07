// dashboard/dashboard.js
// Gmail AI Labeler Dashboard - Copyright (c) 2026 김태형 (thk7410@gmail.com)

let currentCategoryDefs = [];
let selectedLabelName = "";
let lastReportData = null;
let dashBatchSize = 37; // getConfig로 실제 값을 받아 갱신한다(반복 분류 힌트 계산용)
let selectedPriorityFilter = "all"; // 리포트를 다시 그려도 유지되도록 모듈 스코프에 둔다
let pollTimer = null;
let statusChangeListenerAdded = false;

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

const darkModeMql = window.matchMedia("(prefers-color-scheme: dark)");

// ---------------- 공용 헬퍼 ----------------
function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML.replace(/"/g, "&quot;");
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function show(id, visible, displayValue) {
  const el = $(id);
  if (el) el.style.display = visible ? displayValue || "block" : "none";
}

// ---------------- 테마 ----------------
function applyTheme(mode) {
  const effective = mode === "system" ? (darkModeMql.matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", effective);
}

function initTheme() {
  chrome.storage.local.get(["themeMode"], (result) => {
    applyTheme(result.themeMode || "system");
  });

  const themeToggleBtn = $("dashThemeToggleBtn");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      chrome.storage.local.get(["themeMode"], (result) => {
        const current = result.themeMode || "system";
        const next = current === "dark" ? "light" : "dark";
        chrome.storage.local.set({ themeMode: next });
        applyTheme(next);
      });
    });
  }

  darkModeMql.addEventListener("change", () => {
    chrome.storage.local.get(["themeMode"], (result) => {
      if ((result.themeMode || "system") === "system") applyTheme("system");
    });
  });
}

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

// ---------------- 카테고리 / 사이드바 ----------------
// 기본 카테고리는 로케일별 목록(defaultCategoriesList)에서 가져온다.
// 예전에는 한국어 이름을 이 파일에 직접 박아둬서, 다른 언어 사용자가 "기본 라벨 세트 복원"을 누르면
// 한국어 라벨이 설치되고 팝업/백그라운드의 기본값과도 어긋났다.
const DEFAULT_CATEGORIES_FALLBACK = ["보안", "광고", "쇼핑", "공지", "뉴스레터", "업무", "개인", "기타"];

function getLocalizedDefaultCategoryDefs() {
  const raw = t("defaultCategoriesList");
  const names =
    !raw || raw === "defaultCategoriesList"
      ? DEFAULT_CATEGORIES_FALLBACK
      : raw.split(",").map((x) => x.trim()).filter(Boolean);
  return names.map((name) => ({ name, description: "" }));
}

function loadCategories() {
  chrome.storage.local.get(["categoryDefinitions", "labelCategories", "lastSummaryLabel", "lastSummaryCriteria"], (result) => {
    if (Array.isArray(result.categoryDefinitions) && result.categoryDefinitions.length) {
      currentCategoryDefs = result.categoryDefinitions.map((c) => ({
        name: c.name,
        description: c.description || "",
        autoLearned: !!c.autoLearned,
      }));
    } else if (Array.isArray(result.labelCategories) && result.labelCategories.length) {
      currentCategoryDefs = result.labelCategories.map((name) => ({ name, description: "" }));
    } else {
      currentCategoryDefs = getLocalizedDefaultCategoryDefs();
    }

    // 저장된 목록에서 사라진 라벨을 선택 중이었다면 선택을 초기화
    if (selectedLabelName && !currentCategoryDefs.some((c) => c.name === selectedLabelName)) {
      selectedLabelName = "";
    }
    // 마지막으로 요약했던 라벨이 아직 살아 있으면 그것부터 다시 선택해준다.
    if (!selectedLabelName && result.lastSummaryLabel && currentCategoryDefs.some((c) => c.name === result.lastSummaryLabel)) {
      selectedLabelName = result.lastSummaryLabel;
    }
    if (!selectedLabelName && currentCategoryDefs.length) {
      selectedLabelName = currentCategoryDefs[0].name;
    }

    const criteriaInput = $("dashSummaryCriteriaInput");
    if (criteriaInput && !criteriaInput.value && result.lastSummaryCriteria) {
      criteriaInput.value = result.lastSummaryCriteria;
    }

    renderSidebarLabels();
    renderSummaryLabelSelect();
    updateSelectedLabelHeader();
  });
}

function renderSidebarLabels() {
  const sidebarLabelList = $("sidebarLabelList");
  if (!sidebarLabelList) return;

  sidebarLabelList.innerHTML = currentCategoryDefs
    .map((c) => {
      const activeCls = c.name === selectedLabelName ? " active" : "";
      return `<button class="label-item-btn${activeCls}" data-label="${escapeHtml(c.name)}">
        <span>📁 ${escapeHtml(c.name)}</span>
      </button>`;
    })
    .join("");

  sidebarLabelList.querySelectorAll(".label-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectLabel(btn.dataset.label);
    });
  });
}

function renderSummaryLabelSelect() {
  const select = $("dashSummaryLabelSelect");
  if (!select) return;
  select.innerHTML = currentCategoryDefs
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
    .join("");
  if (selectedLabelName) select.value = selectedLabelName;
}

function selectLabel(name) {
  selectedLabelName = name || "";
  // 다음에 대시보드를 다시 열었을 때도 같은 라벨이 선택돼 있게 기억해둔다(팝업과 같은 값을 공유).
  if (selectedLabelName) chrome.storage.local.set({ lastSummaryLabel: selectedLabelName });
  renderSidebarLabels();
  renderDashAnalysisChecklist();
  const select = $("dashSummaryLabelSelect");
  if (select && selectedLabelName) select.value = selectedLabelName;
  updateSelectedLabelHeader();
}

function updateSelectedLabelHeader() {
  setText(
    "dashSelectedLabelTitle",
    selectedLabelName ? t("dashSummaryTitleForLabel", [selectedLabelName]) : t("dashSummaryNeedLabel")
  );
}

// 중요도 값은 AI 응답 스키마상 "상"/"중"/"하" 문자열로 저장된다(백그라운드/디스코드 라우팅도 이 값을 씀).
// 데이터는 그대로 두고 화면에 보여줄 때만 현재 언어로 바꾼다.
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

// ---------------- 요약 피드백 (라벨은 건드리지 않고 판정만 기억) ----------------
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
        if (lastReportData) renderReport(lastReportData);
      });
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

// ---------------- 탭 전환 ----------------
const TAB_PANEL_MAP = {
  summary: "dashPanelSummary",
  classify: "dashPanelClassify",
  labels: "dashPanelLabels",
  relabel: "dashPanelRelabel",
  settings: "dashPanelSettings",
  logs: "dashPanelLogs",
};

function initDashTabSwitching() {
  const navBtns = document.querySelectorAll(".dash-nav-btn");
  const subControls = $("summarySubcontrols");

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-dash-tab");
      navBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const panelId = TAB_PANEL_MAP[tab];
      Object.values(TAB_PANEL_MAP).forEach((pId) => {
        const p = $(pId);
        if (!p) return;
        const isTarget = pId === panelId;
        p.classList.toggle("active", isTarget);
        p.style.display = isTarget ? "block" : "none";
      });

      if (subControls) subControls.style.display = tab === "summary" ? "flex" : "none";

      if (tab === "labels") {
        renderDashboardCategories();
        renderDashAnalysisChecklist();
      }
      if (tab === "relabel") loadDashboardRelabelOptions();
      if (tab === "settings") loadDashboardSettingsData();
      if (tab === "logs") loadDashboardLogs();
    });
  });
}

// ---------------- 라벨 관리 탭 ----------------
function renderDashboardCategories() {
  const list = $("dashCategoriesList");
  if (!list) return;

  list.innerHTML = currentCategoryDefs
    .map(
      (cat, idx) => `
      <div class="form-row cat-row" data-idx="${idx}">
        <input type="text" class="cat-name-input" value="${escapeHtml(cat.name)}" placeholder=t("placeholderCategoryName")>
        <input type="text" class="cat-desc-input" value="${escapeHtml(cat.description || "")}" placeholder=t("placeholderCategoryDesc")>
        <button class="dash-btn dash-btn-secondary del-cat-btn" data-idx="${idx}">✕</button>
      </div>`
    )
    .join("") +
    `<div class="btn-row" style="margin-top:12px;">
      <button class="dash-btn dash-btn-secondary" id="dashAddCategoryBtn">➕ ${escapeHtml(t("dashBtnAddCategory"))}</button>
      <button class="dash-btn dash-btn-primary" id="dashSaveCategoriesBtn">💾 ${escapeHtml(t("dashBtnSaveCategories"))}</button>
    </div>`;

  list.querySelectorAll(".del-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectCategoriesFromDom();
      currentCategoryDefs.splice(parseInt(btn.getAttribute("data-idx"), 10), 1);
      renderDashboardCategories();
    });
  });

  const addBtn = $("dashAddCategoryBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      collectCategoriesFromDom();
      currentCategoryDefs.push({ name: "", description: "" });
      renderDashboardCategories();
    });
  }

  const saveBtn = $("dashSaveCategoriesBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      collectCategoriesFromDom();
      const validDefs = currentCategoryDefs.filter((c) => c.name);
      if (!validDefs.length) {
        alert(t("msgCategoriesMin"));
        return;
      }
      chrome.storage.local.set({ categoryDefinitions: validDefs }, () => {
        currentCategoryDefs = validDefs;
        renderDashboardCategories();
        renderSidebarLabels();
        renderSummaryLabelSelect();
        alert(t("msgCategoriesSaved", [validDefs.length]));
      });
    });
  }
}

function collectCategoriesFromDom() {
  const list = $("dashCategoriesList");
  if (!list) return;
  const rows = list.querySelectorAll(".cat-row");
  if (!rows.length) return;
  currentCategoryDefs = Array.from(rows).map((row, i) => {
    const prev = currentCategoryDefs[i] || {};
    return {
      name: row.querySelector(".cat-name-input").value.trim(),
      description: row.querySelector(".cat-desc-input").value.trim(),
      autoLearned: !!prev.autoLearned,
    };
  });
}

// ---------------- 재적용 탭 ----------------
function loadDashboardRelabelOptions() {
  const select = $("dashRelabelSelect");
  if (!select) return;
  const prev = select.value;
  select.innerHTML =
    `<option value="">${escapeHtml(t("dashOptionSelectLabel"))}</option>` +
    currentCategoryDefs
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
      .join("");
  if (prev) select.value = prev;
}

// ---------------- 설정 탭 ----------------
let dashApiKeys = []; // [{label, key}] - background.js가 기대하는 형식과 동일하게 유지

// 사용자가 원하는 만큼 추가하는 커스텀 Discord 웹훅.
// background.js의 matchesCustomWebhookRule()이 읽는 필드 이름과 반드시 같아야 한다.
let dashCustomWebhooks = [];

const CUSTOM_WEBHOOK_IMPORTANCES = ["상", "중", "하"];
const CUSTOM_WEBHOOK_CATEGORIES = ["긴급/조치필요", "공지/일정", "일반/리포트"];

function emptyCustomWebhook() {
  return {
    name: "",
    url: "",
    enabled: true,
    labels: [],
    importance: [],
    categories: [],
    onlyPersonal: false,
    onlyActionRequired: false,
    senderKeywords: "",
    subjectKeywords: "",
    excludeKeywords: "",
  };
}

function renderCustomWebhooks() {
  const wrap = $("dashCustomWebhookList");
  if (!wrap) return;

  wrap.dataset.rendered = "1";

  if (!dashCustomWebhooks.length) {
    wrap.innerHTML = `<p class="dash-desc">${escapeHtml(t("dashCustomWebhookEmpty"))}</p>`;
    return;
  }

  wrap.innerHTML = dashCustomWebhooks
    .map((hook, idx) => {
      const imps = Array.isArray(hook.importance) ? hook.importance : [];
      const cats = Array.isArray(hook.categories) ? hook.categories : [];
      const labels = Array.isArray(hook.labels) ? hook.labels : [];
      // 분류(라벨) 조건은 현재 등록된 카테고리 목록에서 고른다.
      // 이미 지워진 라벨이 규칙에 남아 있을 수 있으므로 그것도 함께 보여준다(모르는 사이에 조건이 사라지지 않게).
      const labelChoices = currentCategoryDefs
        .map((c) => c.name)
        .concat(labels.filter((name) => !currentCategoryDefs.some((c) => c.name === name)));
      const labelBoxes = labelChoices.length
        ? labelChoices
            .map(
              (name) =>
                `<label class="dash-inline-check"><input type="checkbox" data-field="labels" value="${escapeHtml(name)}"${labels.includes(name) ? " checked" : ""}> ${escapeHtml(name)}</label>`
            )
            .join("")
        : `<span class="dash-desc" style="margin:0;">${escapeHtml(t("dashRuleNoLabels"))}</span>`;
      const impBoxes = CUSTOM_WEBHOOK_IMPORTANCES.map(
        (v) =>
          `<label class="dash-inline-check"><input type="checkbox" data-field="importance" value="${escapeHtml(v)}"${imps.includes(v) ? " checked" : ""}> ${escapeHtml(v)}</label>`
      ).join("");
      const catBoxes = CUSTOM_WEBHOOK_CATEGORIES.map(
        (v) =>
          `<label class="dash-inline-check"><input type="checkbox" data-field="categories" value="${escapeHtml(v)}"${cats.includes(v) ? " checked" : ""}> ${escapeHtml(v)}</label>`
      ).join("");

      return `
      <div class="dash-custom-webhook" data-idx="${idx}">
        <div class="dash-custom-webhook-head">
          <input type="text" class="dash-input-text" data-field="name" value="${escapeHtml(hook.name || "")}" placeholder="${escapeHtml(t("dashPlaceholderCustomWebhookName"))}">
          <label class="dash-inline-check"><input type="checkbox" data-field="enabled"${hook.enabled === false ? "" : " checked"}> ${escapeHtml(t("dashCustomWebhookEnabled"))}</label>
          <button class="dash-btn dash-btn-secondary dash-del-webhook-btn" data-idx="${idx}">✕</button>
        </div>
        <input type="text" class="dash-input-text" data-field="url" value="${escapeHtml(hook.url || "")}" placeholder="https://discord.com/api/webhooks/...">
        <div class="dash-custom-webhook-rules">
          <div class="dash-rule-line"><span class="dash-rule-label">${escapeHtml(t("dashRuleLabels"))}</span>${labelBoxes}</div>
          <div class="dash-rule-line"><span class="dash-rule-label">${escapeHtml(t("dashRuleImportance"))}</span>${impBoxes}</div>
          <div class="dash-rule-line"><span class="dash-rule-label">${escapeHtml(t("dashRuleCategory"))}</span>${catBoxes}</div>
          <div class="dash-rule-line">
            <label class="dash-inline-check"><input type="checkbox" data-field="onlyPersonal"${hook.onlyPersonal ? " checked" : ""}> ${escapeHtml(t("dashRuleOnlyPersonal"))}</label>
            <label class="dash-inline-check"><input type="checkbox" data-field="onlyActionRequired"${hook.onlyActionRequired ? " checked" : ""}> ${escapeHtml(t("dashRuleOnlyAction"))}</label>
          </div>
          <input type="text" class="dash-input-text" data-field="senderKeywords" value="${escapeHtml(hook.senderKeywords || "")}" placeholder="${escapeHtml(t("dashPlaceholderRuleSender"))}">
          <input type="text" class="dash-input-text" data-field="subjectKeywords" value="${escapeHtml(hook.subjectKeywords || "")}" placeholder="${escapeHtml(t("dashPlaceholderRuleSubject"))}">
          <input type="text" class="dash-input-text" data-field="excludeKeywords" value="${escapeHtml(hook.excludeKeywords || "")}" placeholder="${escapeHtml(t("dashPlaceholderRuleExclude"))}">
        </div>
      </div>`;
    })
    .join("");

  wrap.querySelectorAll(".dash-del-webhook-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectCustomWebhooksFromDom();
      dashCustomWebhooks.splice(parseInt(btn.getAttribute("data-idx"), 10), 1);
      renderCustomWebhooks();
      // 버튼 클릭은 input/change 이벤트가 아니라서 자동 저장이 걸리지 않는다.
      // 여기서 직접 저장하지 않으면 이미 저장돼 있던 웹훅은 탭을 다시 열 때 되살아난다.
      persistCustomWebhooks();
    });
  });
}

// 목록 자체가 바뀌는 조작(추가/삭제)은 자동 저장을 기다리지 않고 즉시 반영한다.
function persistCustomWebhooks() {
  chrome.storage.local.set({ customDiscordWebhooks: dashCustomWebhooks }, showSettingsAutoSaveMark);
}

// 화면에 입력된 값을 dashCustomWebhooks에 다시 담는다(행 추가/삭제/저장 직전에 호출).
function collectCustomWebhooksFromDom() {
  const wrap = $("dashCustomWebhookList");
  if (!wrap) return;
  // 아직 한 번도 그리지 않았다면 화면에 값이 없는 게 정상이므로 메모리 값을 덮어쓰지 않는다.
  // (반대로 그린 뒤 행이 0개인 것은 "전부 지웠다"는 뜻이라 빈 목록으로 반영해야 한다)
  if (wrap.dataset.rendered !== "1") return;

  const rows = wrap.querySelectorAll(".dash-custom-webhook");
  dashCustomWebhooks = Array.from(rows).map((row) => {
    const text = (field) => {
      const el = row.querySelector(`[data-field="${field}"]`);
      return el ? el.value.trim() : "";
    };
    const checked = (field) => {
      const el = row.querySelector(`input[type="checkbox"][data-field="${field}"]`);
      return !!(el && el.checked);
    };
    const checkedValues = (field) =>
      Array.from(row.querySelectorAll(`input[type="checkbox"][data-field="${field}"]:checked`)).map((el) => el.value);

    return {
      name: text("name"),
      url: text("url"),
      enabled: checked("enabled"),
      labels: checkedValues("labels"),
      importance: checkedValues("importance"),
      categories: checkedValues("categories"),
      onlyPersonal: checked("onlyPersonal"),
      onlyActionRequired: checked("onlyActionRequired"),
      senderKeywords: text("senderKeywords"),
      subjectKeywords: text("subjectKeywords"),
      excludeKeywords: text("excludeKeywords"),
    };
  });
}

function loadDashboardSettingsData() {
  chrome.storage.local.get(
    [
      "geminiApiKeys",
      "geminiApiKey",
      "discordWebhookUrl",
      "discordWebhookUrlHigh",
      "discordWebhookUrlMedium",
      "discordWebhookUrlLow",
      "customDiscordWebhooks",
      "personalIdentityHints",
      "personalExclusionRules",
      "importanceCriteria",
      "discordSendPerEmail",
      "autoSummaryEnabled",
      "autoSummaryLabel",
      "autoSummaryMaxCount",
      "autoSummaryCriteria",
      "autoSummarySendDiscord",
    ],
    (stored) => {
      if (Array.isArray(stored.geminiApiKeys) && stored.geminiApiKeys.length) {
        // 예전 버전이 문자열 배열로 저장했을 수 있으므로 둘 다 받아준다
        dashApiKeys = stored.geminiApiKeys.map((k) =>
          typeof k === "string" ? { label: "", key: k } : { label: k.label || "", key: k.key || "" }
        );
      } else if (stored.geminiApiKey) {
        dashApiKeys = [{ label: "", key: stored.geminiApiKey }];
      } else {
        dashApiKeys = [];
      }
      renderApiKeyInputs();

      const webhookFields = {
        dashDiscordWebhookUrl: stored.discordWebhookUrl,
        dashDiscordWebhookHigh: stored.discordWebhookUrlHigh,
        dashDiscordWebhookMedium: stored.discordWebhookUrlMedium,
        dashDiscordWebhookLow: stored.discordWebhookUrlLow,
        dashPersonalIdentityHints: stored.personalIdentityHints,
        dashPersonalExclusionRules: stored.personalExclusionRules,
      };
      Object.keys(webhookFields).forEach((id) => {
        const el = $(id);
        if (el) el.value = webhookFields[id] || "";
      });

      dashCustomWebhooks = Array.isArray(stored.customDiscordWebhooks) ? stored.customDiscordWebhooks : [];
      renderCustomWebhooks();

      // 자동 요약 설정
      const autoLabelSelect = $("dashAutoSummaryLabelSelect");
      if (autoLabelSelect) {
        autoLabelSelect.innerHTML =
          `<option value=""></option>` +
          currentCategoryDefs.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join("");
        autoLabelSelect.value = stored.autoSummaryLabel || "";
      }
      const perEmailBox = $("dashDiscordSendPerEmail");
      if (perEmailBox) perEmailBox.checked = stored.discordSendPerEmail !== false;

      const autoEnabled = $("dashAutoSummaryEnabled");
      if (autoEnabled) autoEnabled.checked = stored.autoSummaryEnabled === true;
      const autoMaxCount = $("dashAutoSummaryMaxCount");
      if (autoMaxCount) autoMaxCount.value = stored.autoSummaryMaxCount || 20;
      const autoCriteria = $("dashAutoSummaryCriteria");
      if (autoCriteria) autoCriteria.value = stored.autoSummaryCriteria || "";
      const autoSendDiscord = $("dashAutoSummarySendDiscord");
      if (autoSendDiscord) autoSendDiscord.checked = stored.autoSummarySendDiscord !== false;

      loadSummaryFeedback();
      setupSettingsAutoSave();

      const criteria = stored.importanceCriteria || {};
      const criteriaFields = {
        dashCriteriaHigh: criteria.high,
        dashCriteriaMedium: criteria.medium,
        dashCriteriaLow: criteria.low,
      };
      Object.keys(criteriaFields).forEach((id) => {
        const el = $(id);
        if (el) el.value = criteriaFields[id] || "";
      });
    }
  );
}

// 설정 탭의 Discord/자동요약/중요도 기준 값을 한 번에 저장한다.
// 자동 저장과 '저장' 버튼이 같은 경로를 쓰도록 함수로 뽑아 두었다.
// (API 키는 잘못 입력된 중간 상태가 저장되면 곤란하므로 여기서 건드리지 않고 전용 저장 버튼만 쓴다)
function collectDashboardSettings() {
  const val = (id) => {
    const el = $(id);
    return el ? el.value.trim() : "";
  };
  const checked = (id) => {
    const el = $(id);
    return !!(el && el.checked);
  };

  collectCustomWebhooksFromDom();

  return {
    discordWebhookUrl: val("dashDiscordWebhookUrl"),
    discordWebhookUrlHigh: val("dashDiscordWebhookHigh"),
    discordWebhookUrlMedium: val("dashDiscordWebhookMedium"),
    discordWebhookUrlLow: val("dashDiscordWebhookLow"),
    personalIdentityHints: val("dashPersonalIdentityHints"),
    personalExclusionRules: val("dashPersonalExclusionRules"),
    customDiscordWebhooks: dashCustomWebhooks,
    discordSendPerEmail: checked("dashDiscordSendPerEmail"),
    autoSummaryEnabled: checked("dashAutoSummaryEnabled"),
    autoSummaryLabel: val("dashAutoSummaryLabelSelect"),
    autoSummaryMaxCount: Math.max(1, Math.min(100, parseInt(val("dashAutoSummaryMaxCount"), 10) || 20)),
    autoSummaryCriteria: val("dashAutoSummaryCriteria"),
    autoSummarySendDiscord: checked("dashAutoSummarySendDiscord"),
    importanceCriteria: {
      high: val("dashCriteriaHigh"),
      medium: val("dashCriteriaMedium"),
      low: val("dashCriteriaLow"),
    },
  };
}

let settingsAutoSaveTimer = null;
let settingsAutoSaveBound = false;

function showSettingsAutoSaveMark() {
  const mark = $("dashSettingsSavedMark");
  if (!mark) return;
  mark.textContent = t("msgSettingsAutoSaved");
  mark.style.opacity = "1";
  clearTimeout(showSettingsAutoSaveMark._timer);
  showSettingsAutoSaveMark._timer = setTimeout(() => {
    mark.style.opacity = "0";
  }, 1600);
}

// 타이핑이 멈춘 뒤 저장한다. 매 글자마다 저장하면 반쯤 입력된 URL이 계속 기록된다.
function setupSettingsAutoSave() {
  if (settingsAutoSaveBound) return;
  const panel = $("dashPanelSettings");
  if (!panel) return;
  settingsAutoSaveBound = true;

  const scheduleSave = (event) => {
    // API 키 입력은 전용 저장 버튼으로만 반영한다.
    if (event.target && event.target.closest && event.target.closest(".apikey-row")) return;
    clearTimeout(settingsAutoSaveTimer);
    settingsAutoSaveTimer = setTimeout(() => {
      chrome.storage.local.set(collectDashboardSettings(), showSettingsAutoSaveMark);
    }, 700);
  };

  panel.addEventListener("input", scheduleSave);
  panel.addEventListener("change", scheduleSave);
}

function renderApiKeyInputs() {
  const wrap = $("dashApiKeyInputsWrap");
  if (!wrap) return;

  wrap.innerHTML = dashApiKeys
    .map(
      (entry, idx) => `
      <div class="form-row apikey-row" data-idx="${idx}">
        <input type="text" class="dash-api-label-input" value="${escapeHtml(entry.label || "")}" placeholder=t("dashPlaceholderKeyAlias")>
        <input type="password" class="dash-api-key-input" value="${escapeHtml(entry.key || "")}" placeholder="Gemini API Key (AIza...)">
        <button class="dash-btn dash-btn-secondary del-key-btn" data-idx="${idx}">✕</button>
      </div>`
    )
    .join("");

  wrap.querySelectorAll(".del-key-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectApiKeysFromDom();
      dashApiKeys.splice(parseInt(btn.getAttribute("data-idx"), 10), 1);
      renderApiKeyInputs();
    });
  });
}

function collectApiKeysFromDom() {
  const wrap = $("dashApiKeyInputsWrap");
  if (!wrap) return;
  const rows = wrap.querySelectorAll(".apikey-row");
  dashApiKeys = Array.from(rows).map((row) => ({
    label: row.querySelector(".dash-api-label-input").value.trim(),
    key: row.querySelector(".dash-api-key-input").value.trim(),
  }));
}

// ---------------- 로그 탭 ----------------
function loadDashboardLogs() {
  const box = $("dashLogBox");
  if (!box) return;
  chrome.runtime.sendMessage({ action: "getLogs", limit: 200 }, (logs) => {
    if (chrome.runtime.lastError || !logs) return;
    if (!logs.length) {
      box.innerHTML = `<div class="log-item">${escapeHtml(t("dashLogsEmpty"))}</div>`;
      return;
    }
    box.innerHTML = logs
      .map(
        (l) =>
          `<div class="log-item">[${escapeHtml(new Date(l.timestamp).toLocaleTimeString())}] ${escapeHtml(l.message)}</div>`
      )
      .join("");
    box.scrollTop = box.scrollHeight;
  });
}

// ---------------- 개인 필터 규칙 (예전에는 팝업에만 있어서 대시보드에서 볼 수 없었다) ----------------
let dashFilterRules = [];

function renderDashFilterRules() {
  const list = $("dashFilterRulesList");
  if (!list) return;
  list.innerHTML = dashFilterRules
    .map(
      (rule, idx) => `
      <div class="dash-rule-row" data-idx="${idx}">
        <select class="dash-select dash-rule-type">
          <option value="from"${rule.matchType !== "subject" ? " selected" : ""}>${escapeHtml(t("matchTypeFrom"))}</option>
          <option value="subject"${rule.matchType === "subject" ? " selected" : ""}>${escapeHtml(t("matchTypeSubject"))}</option>
        </select>
        <input type="text" class="dash-input-text dash-rule-value" value="${escapeHtml(rule.matchValue || "")}" placeholder="${escapeHtml(t("dashPlaceholderMatchValue"))}">
        <input type="text" class="dash-input-text dash-rule-target" value="${escapeHtml(rule.targetLabel || "")}" placeholder="${escapeHtml(t("dashPlaceholderTargetLabel"))}">
        <button class="dash-btn dash-btn-secondary dash-del-rule-btn">${escapeHtml(t("dashBtnDeleteRule"))}</button>
      </div>`
    )
    .join("");

  list.querySelectorAll(".dash-del-rule-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectDashFilterRules();
      const idx = parseInt(btn.closest(".dash-rule-row").getAttribute("data-idx"), 10);
      dashFilterRules.splice(idx, 1);
      renderDashFilterRules();
    });
  });
}

function collectDashFilterRules() {
  const list = $("dashFilterRulesList");
  if (!list) return;
  dashFilterRules = [...list.querySelectorAll(".dash-rule-row")].map((row) => ({
    matchType: row.querySelector(".dash-rule-type").value,
    matchValue: row.querySelector(".dash-rule-value").value.trim(),
    targetLabel: row.querySelector(".dash-rule-target").value.trim(),
  }));
}

function loadDashFilterRules() {
  chrome.storage.local.get(["filterRules"], (result) => {
    // 백그라운드가 기대하는 스키마({matchType, matchValue, targetLabel})를 그대로 읽고 쓴다
    dashFilterRules = Array.isArray(result.filterRules) ? result.filterRules.map((r) => ({ ...r })) : [];
    renderDashFilterRules();
  });
}

// ---------------- 라벨 분석 + 분류 기준 임시저장 ----------------
function renderDashAnalysisChecklist() {
  const box = $("dashLabelAnalysisChecklist");
  if (!box) return;
  const checked = new Set([...box.querySelectorAll("input:checked")].map((el) => el.value));
  box.innerHTML = currentCategoryDefs
    .map(
      (c) => `
      <label class="dash-check-row">
        <input type="checkbox" value="${escapeHtml(c.name)}"${checked.has(c.name) ? " checked" : ""}>
        <span>${escapeHtml(c.name)}</span>
      </label>`
    )
    .join("");
}

function loadDashScratchpad() {
  const pad = $("dashCriteriaScratchpad");
  if (!pad) return;
  chrome.storage.local.get(["criteriaScratchpad"], (result) => {
    pad.value = result.criteriaScratchpad || "";
  });
}

// 팝업과 같은 형식을 읽는다: 빈 줄로 구분된 블록에서 첫 줄이 카테고리명, 나머지가 기준 문장
function parseDashScratchpad(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return { labelName: (lines[0] || "").trim(), suggestion: lines.slice(1).join("\n").trim() };
    })
    .filter((e) => e.labelName && e.suggestion);
}

function initDashboardExtraFeatureEvents() {
  // --- 반복 분류 ---
  const repeatBatches = $("dashRepeatBatchesInput");
  const repeatRounds = $("dashRepeatRoundsInput");

  function updateDashRepeatHint() {
    const hint = $("dashRepeatHint");
    if (!hint || !repeatBatches || !repeatRounds) return;
    const batches = Math.max(1, Math.min(5, parseInt(repeatBatches.value, 10) || 1));
    const rounds = Math.max(1, parseInt(repeatRounds.value, 10) || 1);
    const perRound = batches * dashBatchSize;
    hint.textContent = t("hintRepeatRounds", [perRound, rounds, perRound * rounds]);
  }

  if (repeatBatches) repeatBatches.addEventListener("input", updateDashRepeatHint);
  if (repeatRounds) repeatRounds.addEventListener("input", updateDashRepeatHint);
  updateDashRepeatHint();

  const startRepeatBtn = $("dashStartRepeatBtn");
  if (startRepeatBtn) {
    startRepeatBtn.addEventListener("click", () => {
      const batchesPerRound = Math.max(1, Math.min(5, parseInt(repeatBatches.value, 10) || 1));
      const repeatCount = Math.max(1, parseInt(repeatRounds.value, 10) || 1);
      startJob({ action: "startRepeatClassification", batchesPerRound, repeatCount });
    });
  }

  // --- 개인 필터 규칙 ---
  const addRuleBtn = $("dashAddFilterRuleBtn");
  if (addRuleBtn) {
    addRuleBtn.addEventListener("click", () => {
      collectDashFilterRules();
      dashFilterRules.push({ matchType: "from", matchValue: "", targetLabel: "" });
      renderDashFilterRules();
    });
  }

  const saveRulesBtn = $("dashSaveFilterRulesBtn");
  if (saveRulesBtn) {
    saveRulesBtn.addEventListener("click", () => {
      collectDashFilterRules();
      const valid = dashFilterRules.filter((r) => r.matchValue && r.targetLabel);
      chrome.storage.local.set({ filterRules: valid }, () => {
        dashFilterRules = valid;
        renderDashFilterRules();
        setText("dashFilterRulesResultBox", t("dashMsgFilterRulesSaved", [valid.length]));
      });
    });
  }

  // --- 라벨 분석 ---
  const selectAllBtn = $("dashAnalysisSelectAllBtn");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      document.querySelectorAll("#dashLabelAnalysisChecklist input").forEach((el) => (el.checked = true));
    });
  }
  const selectNoneBtn = $("dashAnalysisSelectNoneBtn");
  if (selectNoneBtn) {
    selectNoneBtn.addEventListener("click", () => {
      document.querySelectorAll("#dashLabelAnalysisChecklist input").forEach((el) => (el.checked = false));
    });
  }

  const startAnalysisBtn = $("dashStartAnalysisBtn");
  if (startAnalysisBtn) {
    startAnalysisBtn.addEventListener("click", () => {
      const labelNames = [...document.querySelectorAll("#dashLabelAnalysisChecklist input:checked")].map((el) => el.value);
      if (!labelNames.length) {
        setText("dashAnalysisResultBox", t("dashMsgNeedAnalysisLabel"));
        return;
      }
      startJob({ action: "startAnalyzeMultipleLabels", labelNames });
    });
  }

  // --- 임시저장 칸 ---
  const pad = $("dashCriteriaScratchpad");
  if (pad) {
    // 실수로 창을 닫아도 내용이 남도록 입력할 때마다 저장(팝업과 같은 키를 쓴다)
    pad.addEventListener("input", () => chrome.storage.local.set({ criteriaScratchpad: pad.value }));

    // 백그라운드가 분석 결과를 적재하면 바로 화면에 반영한다
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.criteriaScratchpad) return;
      if (document.activeElement === pad) return; // 입력 중이면 덮어쓰지 않는다
      pad.value = changes.criteriaScratchpad.newValue || "";
    });
  }

  const applyPadBtn = $("dashApplyScratchpadBtn");
  if (applyPadBtn) {
    applyPadBtn.addEventListener("click", () => {
      if (!pad || !pad.value.trim()) {
        setText("dashAnalysisResultBox", t("dashMsgScratchpadEmpty"));
        return;
      }
      const entries = parseDashScratchpad(pad.value);
      if (!entries.length) {
        setText("dashAnalysisResultBox", t("dashMsgScratchpadNotFound"));
        return;
      }
      let applied = 0;
      for (const entry of entries) {
        const idx = currentCategoryDefs.findIndex((c) => c.name === entry.labelName);
        if (idx < 0) continue;
        currentCategoryDefs[idx] = { ...currentCategoryDefs[idx], description: entry.suggestion, autoLearned: false };
        applied += 1;
      }
      if (!applied) {
        setText("dashAnalysisResultBox", t("dashMsgScratchpadNotFound"));
        return;
      }
      chrome.storage.local.set({ categoryDefinitions: currentCategoryDefs }, () => {
        renderDashboardCategories();
        setText("dashAnalysisResultBox", t("dashMsgScratchpadApplied", [applied]));
      });
    });
  }

  const clearPadBtn = $("dashClearScratchpadBtn");
  if (clearPadBtn) {
    clearPadBtn.addEventListener("click", () => {
      if (pad) pad.value = "";
      chrome.storage.local.set({ criteriaScratchpad: "" });
    });
  }
}

// ---------------- 작업 시작 공용 처리 ----------------
function startJob(message, okMessage) {
  chrome.runtime.sendMessage(message, (res) => {
    if (chrome.runtime.lastError) {
      alert(t("errorGenericPrefix", [chrome.runtime.lastError.message]));
      return;
    }
    if (res && res.ok === false) {
      alert(res.messageKey === "errorAlreadyRunning" ? t("errorAlreadyRunning") : t("dashMsgCannotStart"));
      return;
    }
    if (okMessage) alert(okMessage);
    ensureStatusWatch();
    pollStatus();
  });
}

// ---------------- 이벤트 바인딩 ----------------
function initEvents() {
  const refreshBtn = $("dashRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadCategories();
      pollStatus();
      loadDashboardLogs();
    });
  }

  const summarySelect = $("dashSummaryLabelSelect");
  if (summarySelect) {
    summarySelect.addEventListener("change", () => selectLabel(summarySelect.value));
  }

  // --- 요약 실행 ---
  const startSummaryBtn = $("dashStartSummaryBtn");
  if (startSummaryBtn) {
    startSummaryBtn.addEventListener("click", () => {
      if (!selectedLabelName) {
        alert(t("dashMsgNeedSummaryLabel"));
        return;
      }
      const countInput = $("dashSummaryCountInput");
      const criteriaInput = $("dashSummaryCriteriaInput");
      const count = parseInt(countInput ? countInput.value : "20", 10) || 20;
      chrome.storage.local.set({
        lastSummaryLabel: selectedLabelName,
        lastSummaryCriteria: criteriaInput ? criteriaInput.value.trim() : "",
      });
      startJob({
        action: "startLabelSummary",
        labelName: selectedLabelName,
        count,
        filterCriteria: criteriaInput ? criteriaInput.value : "",
      });
    });
  }

  // --- 요약 판단 기준 AI 자동 생성 ---
  const generateCriteriaBtn = $("dashGenerateCriteriaBtn");
  if (generateCriteriaBtn) {
    generateCriteriaBtn.addEventListener("click", () => {
      const orig = generateCriteriaBtn.textContent;
      generateCriteriaBtn.disabled = true;
      generateCriteriaBtn.textContent = t("msgGeneratingCriteria");

      chrome.runtime.sendMessage(
        { action: "generateSummaryCriteria", labelName: selectedLabelName, sampleCount: 25 },
        (res) => {
          generateCriteriaBtn.disabled = false;
          generateCriteriaBtn.textContent = orig;

          if (chrome.runtime.lastError || !res || !res.ok) {
            const detail =
              (res && (res.error || (res.messageKey ? t(res.messageKey) : ""))) ||
              (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              "";
            alert(t("errorGenericPrefix", [detail]));
            return;
          }

          const criteriaInput = $("dashSummaryCriteriaInput");
          if (criteriaInput) {
            criteriaInput.value = res.filterCriteria || "";
            chrome.storage.local.set({ lastSummaryCriteria: criteriaInput.value });
          }
          // 설정 탭의 중요도 기준까지 같이 채워둔다(자동 저장이 걸려 있으면 그대로 반영됨).
          const criteria = res.importanceCriteria || {};
          const fill = (id, value) => {
            const el = $(id);
            if (el && value) el.value = value;
          };
          fill("dashCriteriaHigh", criteria.high);
          fill("dashCriteriaMedium", criteria.medium);
          fill("dashCriteriaLow", criteria.low);
          if ($("dashCriteriaHigh")) {
            chrome.storage.local.set({
              importanceCriteria: {
                high: criteria.high || "",
                medium: criteria.medium || "",
                low: criteria.low || "",
              },
            });
          }

          alert(t("msgCriteriaGenerated", [String(res.sampleSize || 0)]));
        }
      );
    });
  }

  const copySummaryBtn = $("dashCopySummaryBtn");
  if (copySummaryBtn) {
    copySummaryBtn.addEventListener("click", () => {
      if (!lastReportData) return;
      navigator.clipboard.writeText(generateSummaryText(lastReportData)).then(() => {
        const orig = copySummaryBtn.textContent;
        copySummaryBtn.textContent = t("dashMsgCopied");
        setTimeout(() => {
          copySummaryBtn.textContent = orig;
        }, 1800);
      });
    });
  }

  const sendDiscordBtn = $("dashSendDiscordBtn");
  if (sendDiscordBtn) {
    sendDiscordBtn.addEventListener("click", () => {
      if (!lastReportData) {
        alert(t("dashMsgNoReport"));
        return;
      }
      chrome.storage.local.get(
        [
          "discordWebhookUrl",
          "discordWebhookUrlHigh",
          "discordWebhookUrlMedium",
          "discordWebhookUrlLow",
          "customDiscordWebhooks",
        ],
        (stored) => {
          const customs = Array.isArray(stored.customDiscordWebhooks) ? stored.customDiscordWebhooks : [];
          const webhookInput = {
            defaultUrl: stored.discordWebhookUrl || "",
            highUrl: stored.discordWebhookUrlHigh || "",
            mediumUrl: stored.discordWebhookUrlMedium || "",
            lowUrl: stored.discordWebhookUrlLow || "",
            custom: customs,
          };
          const hasCustom = customs.some((w) => w && w.enabled !== false && w.url);
          if (
            !webhookInput.defaultUrl &&
            !webhookInput.highUrl &&
            !webhookInput.mediumUrl &&
            !webhookInput.lowUrl &&
            !hasCustom
          ) {
            alert(t("dashMsgNeedWebhook"));
            return;
          }
          chrome.runtime.sendMessage(
            { action: "sendDiscordNotification", webhookUrl: webhookInput, summaryReport: lastReportData },
            (res) => {
              if (chrome.runtime.lastError || (res && !res.ok)) {
                alert(t("dashMsgDiscordFailed", [(res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || ""]));
                return;
              }
              const orig = sendDiscordBtn.textContent;
              sendDiscordBtn.textContent = t("dashMsgDiscordSent");
              setTimeout(() => {
                sendDiscordBtn.textContent = orig;
              }, 1800);
            }
          );
        }
      );
    });
  }

  // --- 분류 탭 ---
  const startClassifyBtn = $("dashStartClassifyBtn");
  if (startClassifyBtn) {
    startClassifyBtn.addEventListener("click", () => {
      // background.js는 request.count를 읽는다(파라미터 이름을 반드시 맞춰야 함)
      chrome.runtime.sendMessage({ action: "getConfig" }, (config) => {
        const count = config && config.batchSize ? config.batchSize : 20;
        startJob({ action: "startClassification", count });
      });
    });
  }

  const stopClassifyBtn = $("dashStopClassifyBtn");
  if (stopClassifyBtn) {
    stopClassifyBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "cancelJob" }, () => pollStatus());
    });
  }

  // --- 라벨 관리 탭 ---
  const resetCategoriesBtn = $("dashResetCategoriesBtn");
  if (resetCategoriesBtn) {
    resetCategoriesBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmResetCategories"))) return;
      const defs = getLocalizedDefaultCategoryDefs();
      chrome.storage.local.set({ categoryDefinitions: defs }, () => {
        currentCategoryDefs = defs;
        renderDashboardCategories();
        renderSidebarLabels();
        renderSummaryLabelSelect();
        alert(t("msgCategoriesReset"));
      });
    });
  }

  const deleteAllLabelsBtn = $("dashDeleteAllLabelsBtn");
  if (deleteAllLabelsBtn) {
    deleteAllLabelsBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmDeleteAllLabels"))) return;
      startJob({ action: "startDeleteAllLabels" }, t("dashMsgDeleteLabelsStarted"));
    });
  }

  // --- 재적용 탭 ---
  const startRelabelBtn = $("dashStartRelabelBtn");
  if (startRelabelBtn) {
    startRelabelBtn.addEventListener("click", () => {
      const select = $("dashRelabelSelect");
      const label = select ? select.value : "";
      if (!label) {
        alert(t("dashMsgNeedRelabelLabel"));
        return;
      }
      const excludeSelfCheckbox = $("dashExcludeSelfCheckbox");
      // background.js는 request.label / request.excludeSelf를 읽는다
      startJob({
        action: "startRelabel",
        label,
        excludeSelf: excludeSelfCheckbox ? excludeSelfCheckbox.checked : false,
      });
    });
  }

  const startDedupeBtn = $("dashStartDedupeBtn");
  if (startDedupeBtn) {
    startDedupeBtn.addEventListener("click", () => {
      startJob({ action: "startDedupeRelabel" });
    });
  }

  // --- 설정 탭 ---
  const addApiKeyBtn = $("dashAddApiKeyBtn");
  if (addApiKeyBtn) {
    addApiKeyBtn.addEventListener("click", () => {
      collectApiKeysFromDom();
      dashApiKeys.push({ label: "", key: "" });
      renderApiKeyInputs();
    });
  }

  const saveKeyBtn = $("dashSaveKeyBtn");
  if (saveKeyBtn) {
    saveKeyBtn.addEventListener("click", () => {
      collectApiKeysFromDom();
      const validKeys = dashApiKeys.filter((k) => k.key);
      if (!validKeys.length) {
        alert(t("dashMsgNeedApiKey"));
        return;
      }
      // background.js의 getGeminiApiKeys()가 기대하는 [{key, label}] 형식으로 저장
      chrome.storage.local.set({ geminiApiKeys: validKeys, geminiApiKey: null }, () => {
        dashApiKeys = validKeys;
        renderApiKeyInputs();
        alert(t("dashMsgKeysSaved", [validKeys.length]));
      });
    });
  }

  const addCustomWebhookBtn = $("dashAddCustomWebhookBtn");
  if (addCustomWebhookBtn) {
    addCustomWebhookBtn.addEventListener("click", () => {
      collectCustomWebhooksFromDom();
      dashCustomWebhooks.push(emptyCustomWebhook());
      renderCustomWebhooks();
      persistCustomWebhooks();
    });
  }

  const learnFeedbackBtn = $("dashLearnFeedbackBtn");
  if (learnFeedbackBtn) {
    learnFeedbackBtn.addEventListener("click", () => {
      if (!summaryFeedbackList.length) {
        alert(t("dashFeedbackEmpty"));
        return;
      }
      const orig = learnFeedbackBtn.textContent;
      learnFeedbackBtn.disabled = true;
      learnFeedbackBtn.textContent = t("dashMsgLearning");

      chrome.runtime.sendMessage({ action: "learnFromFeedback" }, (res) => {
        learnFeedbackBtn.disabled = false;
        learnFeedbackBtn.textContent = orig;

        if (chrome.runtime.lastError || !res || !res.ok) {
          const detail =
            (res && (res.error || (res.messageKey ? t(res.messageKey) : ""))) ||
            (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
            "";
          alert(t("errorGenericPrefix", [detail]));
          return;
        }

        // background가 이미 저장했으므로 화면만 새 값으로 맞춘다.
        const criteria = res.importanceCriteria || {};
        const fill = (id, value) => {
          const el = $(id);
          if (el) el.value = value || "";
        };
        fill("dashCriteriaHigh", criteria.high);
        fill("dashCriteriaMedium", criteria.medium);
        fill("dashCriteriaLow", criteria.low);
        fill("dashPersonalExclusionRules", res.personalExclusionRules);
        fill("dashSummaryCriteriaInput", res.lastSummaryCriteria);

        alert(t("dashMsgLearned", [String(res.feedbackCount || 0)]) + (res.changeSummary ? `\n\n${res.changeSummary}` : ""));
      });
    });
  }

  const clearFeedbackBtn = $("dashClearFeedbackBtn");
  if (clearFeedbackBtn) {
    clearFeedbackBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmClearFeedback"))) return;
      summaryFeedbackList = [];
      chrome.storage.local.set({ summaryFeedback: [] }, () => {
        renderFeedbackSummary();
        if (lastReportData) renderReport(lastReportData);
      });
    });
  }

  const saveDiscordSettingsBtn = $("dashSaveDiscordSettingsBtn");
  if (saveDiscordSettingsBtn) {
    // 자동 저장이 있어도 "지금 저장됐다"는 확인이 필요할 때가 있어 버튼은 남겨둔다.
    saveDiscordSettingsBtn.addEventListener("click", () => {
      chrome.storage.local.set(collectDashboardSettings(), () => alert(t("dashMsgDiscordSettingsSaved")));
    });
  }

  const backupDriveBtn = $("dashBackupDriveBtn");
  if (backupDriveBtn) {
    backupDriveBtn.addEventListener("click", () => {
      startJob({ action: "backupToDrive" }, t("dashMsgBackupStarted"));
    });
  }

  const restoreDriveBtn = $("dashRestoreDriveBtn");
  if (restoreDriveBtn) {
    restoreDriveBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmRestoreDrive"))) return;
      startJob({ action: "startRestoreFromDrive", passphrase: "" }, t("dashMsgRestoreStarted"));
    });
  }

  // --- 로그 탭 ---
  const clearLogsBtn = $("dashClearLogsBtn");
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "clearLogs" }, () => loadDashboardLogs());
    });
  }
}

// ---------------- 진입점 ----------------
async function main() {
  // 대시보드는 예전에 i18n을 전혀 쓰지 않아서 화면 문자열이 전부 한국어로 고정돼 있었다.
  // 먼저 로케일을 로드하고 DOM에 적용한 뒤에 나머지를 그린다(t()를 쓰는 렌더 함수들이 뒤따르므로 순서가 중요).
  await i18nInit();
  i18nApplyToDom(document);

  initTheme();
  // 저장된 판정을 먼저 읽어야 요약 리포트의 피드백 버튼이 눌린 상태로 그려진다.
  loadSummaryFeedback();
  loadCategories();
  initEvents();
  initDashTabSwitching();
  initDashboardExtraFeatureEvents();
  loadDashFilterRules();
  loadDashScratchpad();

  // 반복 분류 힌트에 쓸 실제 배치 크기를 받아온다
  chrome.runtime.sendMessage({ action: "getConfig" }, (config) => {
    if (chrome.runtime.lastError || !config || !config.batchSize) return;
    dashBatchSize = config.batchSize;
    const hintEl = $("dashRepeatHint");
    const batchesEl = $("dashRepeatBatchesInput");
    const roundsEl = $("dashRepeatRoundsInput");
    if (!hintEl || !batchesEl || !roundsEl) return;
    const perRound = Math.max(1, Math.min(5, parseInt(batchesEl.value, 10) || 1)) * dashBatchSize;
    const rounds = Math.max(1, parseInt(roundsEl.value, 10) || 1);
    hintEl.textContent = t("hintRepeatRounds", [perRound, rounds, perRound * rounds]);
  });

  chrome.storage.local.get(["lastLabelSummary"], (stored) => {
    if (stored.lastLabelSummary) renderReport(stored.lastLabelSummary);
  });

  pollStatus();

  // 팝업에서 언어를 바꾸면 열려 있는 대시보드에도 반영한다
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local" || !changes.uiLanguage) return;
    await i18nInit(true);
    i18nApplyToDom(document);
    pollStatus(); // 상태 pill과 진행/결과 문구를 새 언어로 다시 채운다
    updateSelectedLabelHeader();
    renderSidebarLabels();
    renderDashboardCategories();
    renderDashFilterRules();
    renderDashAnalysisChecklist();
    if (lastReportData) renderReport(lastReportData);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
