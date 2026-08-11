// sidepanel/sidepanel.js
const $ = (id) => document.getElementById(id);

async function initSidePanel() {
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }
  
  initTheme();
  initActionButtons();
  
  // Listen for context updates from background/content script
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "context.update") {
      updateContextUI(msg.context);
    }
  });

  // Query current tab to get initial context
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length > 0) {
      const activeTab = tabs[0];
      if (activeTab.url && activeTab.url.includes("mail.google.com")) {
        updateContextUI({ service: "Gmail", title: "Inbox", desc: "Ready to assist" });
      } else if (activeTab.url && activeTab.url.includes("calendar.google.com")) {
        updateContextUI({ service: "Calendar", title: "Schedule", desc: "Ready to assist" });
      } else {
        updateContextUI({ service: "Web", title: activeTab.title, desc: "No specific AI actions available for this page." });
      }
    }
  });
}

function initTheme() {
  chrome.storage.local.get("dashboardTheme", (data) => {
    const theme = data.dashboardTheme || "system";
    if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  });
}

function updateContextUI(context) {
  $("contextService").textContent = context.service || "Web";
  $("contextTitle").textContent = context.title || "Page";
  $("contextDesc").textContent = context.desc || "";

  const actionsContainer = $("dynamicActions");
  actionsContainer.innerHTML = "";

  if (context.service === "Gmail") {
    actionsContainer.innerHTML = `
      <button class="btn btn-primary action-btn">Classify Current Page</button>
      <button class="btn btn-secondary action-btn">Summarize</button>
    `;
  } else if (context.service === "Calendar") {
    actionsContainer.innerHTML = `
      <button class="btn btn-primary action-btn">Classify Schedule</button>
      <button class="btn btn-secondary action-btn">Apply Colors</button>
    `;
  } else {
    actionsContainer.innerHTML = `
      <button class="btn btn-outlined action-btn">Analyze Page</button>
    `;
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
