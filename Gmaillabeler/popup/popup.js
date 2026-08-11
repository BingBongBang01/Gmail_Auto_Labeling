// popup/popup.js
const $ = (id) => document.getElementById(id);

async function initPopup() {
  // Initialize i18n
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }
  
  initTheme();
  initStatus();
  initActionButtons();
}

function initTheme() {
  chrome.storage.local.get("dashboardTheme", (data) => {
    const theme = data.dashboardTheme || "system";
    if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  });
}

function initStatus() {
  chrome.storage.local.get(["oauthClientId", "geminiApiKeys", "geminiApiKey"], (stored) => {
    chrome.runtime.sendMessage({ action: "getOAuthStatus" }, (oauth) => {
      const hasCredentials = !!stored.oauthClientId;
      const connected = oauth && oauth.connected;
      const hasApiKey = (Array.isArray(stored.geminiApiKeys) && stored.geminiApiKeys.some(k => k.key)) || !!stored.geminiApiKey;
      
      const googleStatus = $("googleStatusText");
      if (googleStatus) {
        if (connected) {
          googleStatus.textContent = "● Connected";
          googleStatus.className = "status-value success";
        } else {
          googleStatus.textContent = "● Not Connected";
          googleStatus.className = "status-value error";
        }
      }
      
      const geminiStatus = $("geminiStatusText");
      if (geminiStatus) {
        if (hasApiKey) {
          geminiStatus.textContent = "● Ready";
          geminiStatus.className = "status-value success";
        } else {
          geminiStatus.textContent = "● Missing Key";
          geminiStatus.className = "status-value error";
        }
      }

      const globalStatus = $("globalStatusText");
      if (globalStatus) {
        if (connected && hasApiKey) {
          globalStatus.textContent = "Ready";
          globalStatus.parentElement.className = "status-pill connected";
        } else {
          globalStatus.textContent = "Setup Required";
          globalStatus.parentElement.className = "status-pill error";
        }
      }
    });
  });
}

function initActionButtons() {
  $("btnOpenOptions")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  $("btnOpenDashboard")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url: dashboardUrl });
  });
  
  $("btnOpenSidePanel")?.addEventListener("click", () => {
    chrome.windows.getCurrent((window) => {
      // Use chrome.sidePanel API to open it
      chrome.sidePanel.open({ windowId: window.id }).then(() => {
        window.close(); // close popup after opening side panel
      }).catch(err => {
        console.error("Failed to open side panel:", err);
      });
    });
  });

  // Placeholder actions for classify/summarize (will use messaging API in Phase 6)
  $("btnClassifyGmail")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html#classify");
    chrome.tabs.create({ url: dashboardUrl });
  });
  
  $("btnSummarizeMail")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html#summary");
    chrome.tabs.create({ url: dashboardUrl });
  });

  $("btnClassifyCalendar")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html#calendar");
    chrome.tabs.create({ url: dashboardUrl });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}