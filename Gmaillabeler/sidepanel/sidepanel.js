// sidepanel/sidepanel.js
const $ = (id) => document.getElementById(id);

async function initSidePanel() {
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }
  
  if (typeof SettingsStore !== 'undefined') {
    SettingsStore.getSettings(settings => {
      initTheme(settings);
    });
  } else {
    initTheme();
  }
  
  initActionButtons();
  
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "context.update") {
      updateContextUI(msg.context);
    }
  });

  detectInitialContext();
}

const CONTEXT_FRESHNESS_MS = 10 * 60 * 1000;

function detectInitialContext() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    const url = (activeTab && activeTab.url) || "";

    if (url.includes("mail.google.com")) {
      // 콘텐츠 스크립트가 저장해둔 실제 화면 정보를 쓴다.
      // 예전에는 여기서 pageType을 "inbox"로 고정해버려서, 메일을 열어둔 상태로
      // 사이드패널을 열면 스레드 전용 동작이 절대 나타나지 않았다.
      chrome.storage.local.get(["gmailPageContext"], (stored) => {
        const context = stored && stored.gmailPageContext;
        const isFresh = context && context.at && Date.now() - context.at < CONTEXT_FRESHNESS_MS;
        updateContextUI(
          isFresh
            ? context
            : { service: "Gmail", pageType: "inbox", title: "Inbox", desc: "Ready to assist" }
        );
      });
      return;
    }

    if (url.includes("calendar.google.com")) {
      updateContextUI({ service: "Calendar", pageType: "schedule", title: "Schedule", desc: "Ready to assist" });
      return;
    }

    updateContextUI({
      service: "Web",
      pageType: "other",
      // tab.title은 host_permissions가 있어야 채워진다. 없으면 빈 값으로 온다.
      title: (activeTab && activeTab.title) || "Page",
      desc: "No specific AI actions available for this page.",
    });
  });
}

function initTheme(settings) {
  const theme = settings?.general?.themeMode || "system";
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

// 지금 표시 중인 컨텍스트. 스레드 단위 작업이 대상 메일 ID를 함께 보내야 한다.
let currentContext = {};

function startJob(jobType, payload) {
  chrome.runtime.sendMessage({ action: "job.start", jobType, payload: payload || {} }, (response) => {
    if (chrome.runtime.lastError) {
      setActionFeedback(chrome.runtime.lastError.message);
      return;
    }
    if (!response || response.ok === false) {
      const reason =
        (response && (response.error || (response.messageKey && t(response.messageKey)))) ||
        "작업을 시작할 수 없습니다.";
      setActionFeedback(reason);
      return;
    }
    setActionFeedback("작업을 시작했습니다.");
  });
}

function setActionFeedback(message) {
  const target = $("contextDesc");
  if (target) target.textContent = message;
}

// Action Registry
const ACTION_REGISTRY = {
  "gmail.inbox": [
    { id: "action_classify_visible", label: "sidepanelClassifyVisible", cls: "btn-primary", handler: () => startJob("gmail_classify") },
    { id: "action_summarize_all", label: "sidepanelSummarizeAll", cls: "btn-secondary", handler: () => startJob("gmail_summarize") }
  ],
  "gmail.thread": [
    { id: "action_classify_thread", label: "sidepanelClassifyThread", cls: "btn-primary", handler: () => startJob("gmail_classify_thread", { messageIds: currentContext.messageIds }) },
    { id: "action_summarize_thread", label: "sidepanelSummarizeThread", cls: "btn-secondary", handler: () => startJob("gmail_summarize_thread", { messageIds: currentContext.messageIds }) }
  ],
  "calendar.schedule": [
    { id: "action_classify_schedule", label: "sidepanelClassifySchedule", cls: "btn-primary", handler: () => startJob("calendar_classify") },
    { id: "action_apply_colors", label: "sidepanelApplyColors", cls: "btn-secondary", handler: () => startJob("calendar_apply_colors") }
  ]
};

function translate(key, fallback) {
  // t()는 키를 못 찾으면 키 문자열 자체를 돌려주므로 `t(x) || fallback`은 절대 fallback을 쓰지 않는다.
  if (typeof t !== "function") return fallback || key;
  const value = t(key);
  return value && value !== key ? value : fallback || key;
}

function updateContextUI(context) {
  currentContext = context || {};

  $("contextService").textContent = currentContext.service || "Web";
  $("contextTitle").textContent = currentContext.title || "Page";
  $("contextDesc").textContent = currentContext.desc || "";

  const actionsContainer = $("dynamicActions");
  if (!actionsContainer) return;
  actionsContainer.innerHTML = "";

  const registryKey = `${(currentContext.service || "Web").toLowerCase()}.${currentContext.pageType || "other"}`;
  const actions = ACTION_REGISTRY[registryKey] || [];

  if (actions.length === 0) {
    // 예전에는 여기서 innerHTML로 버튼을 그렸는데 id도 핸들러도 없어서 아무 동작이 없었다.
    // 눌러도 아무 일이 없는 버튼을 두는 대신 안내 문구만 남긴다.
    const note = document.createElement("p");
    note.className = "label-small";
    note.style.cssText = "opacity:0.7; text-align:center; padding:12px;";
    note.textContent = translate("sidepanelAnalyzePage", "이 페이지에서 사용할 수 있는 작업이 없습니다.");
    actionsContainer.appendChild(note);
    return;
  }

  actions.forEach((act) => {
    const btn = document.createElement("button");
    btn.className = `btn action-btn ${act.cls}`;
    btn.id = act.id;
    btn.textContent = translate(act.label, act.label);
    btn.addEventListener("click", act.handler);
    actionsContainer.appendChild(btn);
  });
}

function initActionButtons() {
  $("btnSettings")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  $("btnDashboard")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url: dashboardUrl });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidePanel);
} else {
  initSidePanel();
}
