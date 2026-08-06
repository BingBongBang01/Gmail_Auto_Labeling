// dashboard/dashboard.js
// Gmail AI Labeler Dashboard - Copyright (c) 2026 김태형 (thk7410@gmail.com)

let currentCategoryDefs = [];
let selectedLabelName = "";
let lastReportData = null;
let selectedPriorityFilter = "all"; // 리포트를 다시 그려도 유지되도록 모듈 스코프에 둔다
let pollTimer = null;

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
const STATUS_LABEL = {
  idle: "대기",
  running: "진행 중",
  done: "완료",
  error: "오류",
  cancelled: "중지됨",
  quota_exceeded: "할당량 초과",
};

function updateStatusPill(status) {
  const pill = $("statusPill");
  const pillText = $("statusPillText");
  if (!pill || !pillText) return;
  pill.className = "status-pill " + (status || "idle");
  pillText.textContent = STATUS_LABEL[status] || STATUS_LABEL.idle;
}

// ---------------- 카테고리 / 사이드바 ----------------
const DEFAULT_CATEGORY_DEFS = [
  { name: "보안", description: "계정 보안, 비밀번호 변경, 로그인 알림" },
  { name: "광고", description: "마케팅, 프로모션, 할인 혜택 알림" },
  { name: "쇼핑", description: "주문 내역, 배송 추적, 영수증" },
  { name: "공지", description: "서비스 공지사항, 약관 변경 안내" },
  { name: "뉴스레터", description: "정기 구독 뉴스, 아티클" },
  { name: "업무", description: "업무 관련 미팅, 일정, 프로젝트 요청" },
  { name: "개인", description: "개인적 친목, 지인 이메일" },
  { name: "기타", description: "기타 알림" },
];

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
      currentCategoryDefs = DEFAULT_CATEGORY_DEFS.map((c) => ({ ...c }));
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
    selectedLabelName ? `📋 [${selectedLabelName}] 메일 요약` : "📋 라벨 선택 필요"
  );
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
    <span class="badge-sub">총 ${report.totalAnalyzed || 0}개 중 ${report.selectedCount || 0}개 메일 선별됨</span>
    <span class="quick-chip-wrap">
      ${["all", "상", "중", "하"]
        .map(
          (imp) =>
            `<button class="priority-chip${selectedPriorityFilter === imp ? " active" : ""}" data-imp="${escapeHtml(imp)}">${
              imp === "all" ? "전체" : `중요도 ${escapeHtml(imp)}`
            }</button>`
        )
        .join("")}
    </span>
  </div>`;

  if (report.overallSummary) {
    html += `<div class="summary-brief-card">
      <div class="brief-title">💡 '${escapeHtml(report.labelName)}' AI 종합 브리핑</div>
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
          <span class="imp-tag ${impClass}">중요도: ${escapeHtml(imp)}</span>
        </div>
        <div class="email-card-body">
          <div class="email-card-sender">발신자: ${escapeHtml(item.sender || "정보 없음")}</div>`;

      if (Array.isArray(item.summaryPoints) && item.summaryPoints.length) {
        html += `<ul class="email-card-bullets">`;
        item.summaryPoints.forEach((pt) => {
          html += `<li>${escapeHtml(pt)}</li>`;
        });
        html += `</ul>`;
      }

      if (item.actionRequired && item.actionRequired !== "없음") {
        html += `<div class="email-card-action">⚡ 조치 사항: ${escapeHtml(item.actionRequired)}</div>`;
      }

      if (mailUrl) {
        html += `<div class="email-card-footer">
          <a href="${escapeHtml(mailUrl)}" target="_blank" rel="noreferrer" class="email-card-link">Gmail에서 이메일 열기 ↗</a>
        </div>`;
      }

      html += `</div></div>`;
    });
  } else {
    html += `<div class="dash-empty-state">선별된 중요 이메일이 없습니다.</div>`;
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
  let text = `[📋 ${report.labelName} 라벨 AI 요약 리포트]\n\n● 종합 요약:\n${report.overallSummary || ""}\n\n● 주요 선별 메일 목록 (${report.selectedCount || 0}/${report.totalAnalyzed || 0}):\n`;
  (report.selectedEmails || []).forEach((e, idx) => {
    text += `\n${idx + 1}. [중요도: ${e.importance || "중"}] ${e.subject}\n   - 발신자: ${e.sender || ""}\n`;
    if (Array.isArray(e.summaryPoints)) {
      e.summaryPoints.forEach((pt) => {
        text += `   - ${pt}\n`;
      });
    }
    if (e.actionRequired && e.actionRequired !== "없음") {
      text += `   - ⚡ 조치 사항: ${e.actionRequired}\n`;
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
      renderJobProgress("dashSummary", result, "이메일 수집 및 요약 중");
      if (result.jobStatus === "done") {
        chrome.storage.local.get(["lastLabelSummary"], (stored) => {
          if (stored.lastLabelSummary) renderReport(stored.lastLabelSummary);
        });
      } else if (result.jobStatus === "error") {
        const box = $("dashSummaryResultBox");
        if (box) box.textContent = `오류: ${result.jobError || ""}`;
      }
    }

    if (result.jobKind === "classify" || result.jobKind === "repeat" || result.jobKind === "relabel" || result.jobKind === "dedupe") {
      renderJobProgress("dashClassify", result, "메일 분류 중");
      const box = $("dashClassifyResultBox");
      if (box) {
        if (isRunning) {
          box.textContent = "작업이 진행 중입니다...";
        } else if (result.jobStatus === "done" && result.jobResult) {
          box.textContent = `완료: 전체 ${result.jobResult.total || 0}개 중 ${result.jobResult.success || 0}개 처리`;
        } else if (result.jobStatus === "cancelled" && result.jobResult) {
          box.textContent = `중지됨: ${result.jobResult.success || 0}/${result.jobResult.total || 0}개 처리`;
        } else if (result.jobStatus === "quota_exceeded" && result.jobResult) {
          box.textContent = `할당량 초과로 중단: ${result.jobResult.success || 0}/${result.jobResult.total || 0}개 처리`;
        } else if (result.jobStatus === "error") {
          box.textContent = `오류: ${result.jobError || ""}`;
        }
      }
    }

    if (isRunning) {
      if (!pollTimer) pollTimer = setInterval(pollStatus, 2000);
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
        <input type="text" class="cat-name-input" value="${escapeHtml(cat.name)}" placeholder="카테고리명">
        <input type="text" class="cat-desc-input" value="${escapeHtml(cat.description || "")}" placeholder="분류 기준 설명">
        <button class="dash-btn dash-btn-secondary del-cat-btn" data-idx="${idx}">✕</button>
      </div>`
    )
    .join("") +
    `<div class="btn-row" style="margin-top:12px;">
      <button class="dash-btn dash-btn-secondary" id="dashAddCategoryBtn">➕ 카테고리 추가</button>
      <button class="dash-btn dash-btn-primary" id="dashSaveCategoriesBtn">💾 카테고리 저장</button>
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
        alert("카테고리를 최소 1개 이상 입력해 주세요.");
        return;
      }
      chrome.storage.local.set({ categoryDefinitions: validDefs }, () => {
        currentCategoryDefs = validDefs;
        renderDashboardCategories();
        renderSidebarLabels();
        renderSummaryLabelSelect();
        alert("카테고리가 저장되었습니다!");
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
    `<option value="">라벨을 선택하세요</option>` +
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
        <input type="text" class="dash-api-label-input" value="${escapeHtml(entry.label || "")}" placeholder="키 별칭(선택)">
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
      box.innerHTML = `<div class="log-item">기록된 로그가 없습니다.</div>`;
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
      alert(`오류: ${chrome.runtime.lastError.message}`);
      return;
    }
    if (res && res.ok === false) {
      alert(res.messageKey === "errorAlreadyRunning" ? "다른 작업이 이미 진행 중입니다." : "요청을 시작할 수 없습니다.");
      return;
    }
    if (okMessage) alert(okMessage);
    if (!pollTimer) pollTimer = setInterval(pollStatus, 2000);
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
        alert("요약할 라벨을 선택해주세요.");
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
        copySummaryBtn.textContent = "✅ 복사되었습니다!";
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
        alert("전송할 요약 리포트가 없습니다.");
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
            alert("디스코드 Webhook URL을 먼저 설정 탭에서 입력해 주세요.");
            return;
          }
          chrome.runtime.sendMessage(
            { action: "sendDiscordNotification", webhookUrl: webhookInput, summaryReport: lastReportData },
            (res) => {
              if (chrome.runtime.lastError || (res && !res.ok)) {
                alert(`전송 실패: ${(res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message)}`);
                return;
              }
              const orig = sendDiscordBtn.textContent;
              sendDiscordBtn.textContent = "✅ 디스코드 전송 완료!";
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
      if (!confirm("기본 라벨 카테고리로 초기화할까요? 현재 카테고리 설정이 대체됩니다.")) return;
      const defs = DEFAULT_CATEGORY_DEFS.map((c) => ({ ...c }));
      chrome.storage.local.set({ categoryDefinitions: defs }, () => {
        currentCategoryDefs = defs;
        renderDashboardCategories();
        renderSidebarLabels();
        renderSummaryLabelSelect();
        alert("기본 라벨 카테고리로 초기화되었습니다!");
      });
    });
  }

  const deleteAllLabelsBtn = $("dashDeleteAllLabelsBtn");
  if (deleteAllLabelsBtn) {
    deleteAllLabelsBtn.addEventListener("click", () => {
      if (!confirm("이 확장이 관리하는 모든 Gmail 라벨을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?")) return;
      startJob({ action: "startDeleteAllLabels" }, "라벨 삭제 작업을 시작했습니다.");
    });
  }

  // --- 재적용 탭 ---
  const startRelabelBtn = $("dashStartRelabelBtn");
  if (startRelabelBtn) {
    startRelabelBtn.addEventListener("click", () => {
      const select = $("dashRelabelSelect");
      const label = select ? select.value : "";
      if (!label) {
        alert("재분류할 라벨을 선택해주세요.");
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
        alert("Gemini API 키를 1개 이상 입력해 주세요.");
        return;
      }
      // background.js의 getGeminiApiKeys()가 기대하는 [{key, label}] 형식으로 저장
      chrome.storage.local.set({ geminiApiKeys: validKeys, geminiApiKey: null }, () => {
        dashApiKeys = validKeys;
        renderApiKeyInputs();
        alert(`Gemini API 키 ${validKeys.length}개가 저장되었습니다!`);
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
        () => alert("디스코드 및 중요도 설정이 저장되었습니다!")
      );
    });
  }

  const backupDriveBtn = $("dashBackupDriveBtn");
  if (backupDriveBtn) {
    backupDriveBtn.addEventListener("click", () => {
      startJob({ action: "backupToDrive" }, "Google Drive 백업을 시작했습니다.");
    });
  }

  const restoreDriveBtn = $("dashRestoreDriveBtn");
  if (restoreDriveBtn) {
    restoreDriveBtn.addEventListener("click", () => {
      if (!confirm("Drive 백업으로 현재 설정을 덮어씁니다. 계속할까요?")) return;
      startJob({ action: "startRestoreFromDrive", passphrase: "" }, "Google Drive 복원을 시작했습니다.");
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
function main() {
  initTheme();
  loadCategories();
  initEvents();
  initDashTabSwitching();

  chrome.storage.local.get(["lastLabelSummary"], (stored) => {
    if (stored.lastLabelSummary) renderReport(stored.lastLabelSummary);
  });

  pollStatus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
