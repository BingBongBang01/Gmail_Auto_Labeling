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

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const activeTab = tabs[0];
      if (activeTab.url && activeTab.url.includes("mail.google.com")) {
        // We might need the content script to tell us if it's an inbox or a thread
        updateContextUI({ service: "Gmail", pageType: "inbox", title: "Inbox", desc: "Ready to assist" });
      } else if (activeTab.url && activeTab.url.includes("calendar.google.com")) {
        updateContextUI({ service: "Calendar", pageType: "schedule", title: "Schedule", desc: "Ready to assist" });
      } else {
        updateContextUI({ service: "Web", pageType: "other", title: activeTab.title, desc: "No specific AI actions available for this page." });
      }
    }
  });
}

function initTheme(settings) {
  const theme = settings?.general?.themeMode || "system";
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

// Action Registry
const ACTION_REGISTRY = {
  "gmail.inbox": [
    { id: "action_classify_visible", label: "sidepanelClassifyVisible", cls: "btn-primary", handler: () => chrome.runtime.sendMessage({ action: "job.start", jobType: "gmail_classify" }) },
    { id: "action_summarize_all", label: "sidepanelSummarizeAll", cls: "btn-secondary", handler: () => chrome.runtime.sendMessage({ action: "job.start", jobType: "gmail_summarize" }) }
  ],
  "gmail.thread": [
    { id: "action_classify_thread", label: "sidepanelClassifyThread", cls: "btn-primary", handler: () => chrome.runtime.sendMessage({ action: "job.start", jobType: "gmail_classify_thread" }) },
    { id: "action_summarize_thread", label: "sidepanelSummarizeThread", cls: "btn-secondary", handler: () => chrome.runtime.sendMessage({ action: "job.start", jobType: "gmail_summarize_thread" }) }
  ],
  "calendar.schedule": [
    { id: "action_classify_schedule", label: "sidepanelClassifySchedule", cls: "btn-primary", handler: () => chrome.runtime.sendMessage({ action: "job.start", jobType: "calendar_classify" }) },
    { id: "action_apply_colors", label: "sidepanelApplyColors", cls: "btn-secondary", handler: () => chrome.runtime.sendMessage({ action: "job.start", jobType: "calendar_apply_colors" }) }
  ]
};

function updateContextUI(context) {
  $("contextService").textContent = context.service || "Web";
  $("contextTitle").textContent = context.title || "Page";
  $("contextDesc").textContent = context.desc || "";

  const actionsContainer = $("dynamicActions");
  actionsContainer.innerHTML = "";

  const registryKey = `${(context.service || "Web").toLowerCase()}.${context.pageType || "other"}`;
  const actions = ACTION_REGISTRY[registryKey] || [];

  if (actions.length === 0) {
    actionsContainer.innerHTML = `<button class="btn btn-outlined action-btn" data-i18n="sidepanelAnalyzePage">${t("sidepanelAnalyzePage")}</button>`;
  } else {
    actions.forEach(act => {
      const btn = document.createElement("button");
      btn.className = `btn action-btn ${act.cls}`;
      btn.id = act.id;
      btn.textContent = typeof t === "function" ? t(act.label) : act.label;
      btn.addEventListener("click", act.handler);
      actionsContainer.appendChild(btn);
    });
  }
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
