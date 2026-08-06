// dashboard/dashboard.js
// Gmail AI Labeler Dashboard - Copyright (c) 2026 김태형 (thk7410@gmail.com)

let currentCategoryDefs = [];
let selectedLabelName = "";
let lastReportData = null;
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
  chrome.storage.local.get(["categoryDefinitions", "labelCategories"], (result) => {
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
    if (!selectedLabelName && currentCategoryDefs.length) {
      selectedLabelName = currentCategoryDefs[0].name;
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
  renderSidebarLabels();
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
      const box = $("dashClassifyResultBox");
      if (box) {
        if (isRunning) {
          box.textContent = t("dashJobRunningGeneric");
        } else if (result.jobStatus === "done" && result.jobResult) {
          box.textContent = t("dashResultDone", [result.jobResult.total || 0, result.jobResult.success || 0]);
        } else if (result.jobStatus === "cancelled" && result.jobResult) {
          box.textContent = t("dashResultCancelled", [result.jobResult.total || 0, result.jobResult.success || 0]);
        } else if (result.jobStatus === "quota_exceeded" && result.jobResult) {
          box.textContent = t("dashResultQuota", [result.jobResult.total || 0, result.jobResult.success || 0]);
        } else if (result.jobStatus === "error") {
          box.textContent = t("errorGenericPrefix", [result.jobError || ""]);
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

      if (tab === "labels") renderDashboardCategories();
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

function loadDashboardSettingsData() {
  chrome.storage.local.get(
    [
      "geminiApiKeys",
      "geminiApiKey",
      "discordWebhookUrl",
      "discordWebhookUrlHigh",
      "discordWebhookUrlMedium",
      "discordWebhookUrlLow",
      "importanceCriteria",
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
      };
      Object.keys(webhookFields).forEach((id) => {
        const el = $(id);
        if (el) el.value = webhookFields[id] || "";
      });

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
      startJob({
        action: "startLabelSummary",
        labelName: selectedLabelName,
        count,
        filterCriteria: criteriaInput ? criteriaInput.value : "",
      });
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
        ["discordWebhookUrl", "discordWebhookUrlHigh", "discordWebhookUrlMedium", "discordWebhookUrlLow"],
        (stored) => {
          const webhookInput = {
            defaultUrl: stored.discordWebhookUrl || "",
            highUrl: stored.discordWebhookUrlHigh || "",
            mediumUrl: stored.discordWebhookUrlMedium || "",
            lowUrl: stored.discordWebhookUrlLow || "",
          };
          if (!webhookInput.defaultUrl && !webhookInput.highUrl && !webhookInput.mediumUrl && !webhookInput.lowUrl) {
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

  const saveDiscordSettingsBtn = $("dashSaveDiscordSettingsBtn");
  if (saveDiscordSettingsBtn) {
    saveDiscordSettingsBtn.addEventListener("click", () => {
      const val = (id) => {
        const el = $(id);
        return el ? el.value.trim() : "";
      };
      chrome.storage.local.set(
        {
          discordWebhookUrl: val("dashDiscordWebhookUrl"),
          discordWebhookUrlHigh: val("dashDiscordWebhookHigh"),
          discordWebhookUrlMedium: val("dashDiscordWebhookMedium"),
          discordWebhookUrlLow: val("dashDiscordWebhookLow"),
          importanceCriteria: {
            high: val("dashCriteriaHigh"),
            medium: val("dashCriteriaMedium"),
            low: val("dashCriteriaLow"),
          },
        },
        () => alert(t("dashMsgDiscordSettingsSaved"))
      );
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
  loadCategories();
  initEvents();
  initDashTabSwitching();

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
    if (lastReportData) renderReport(lastReportData);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
