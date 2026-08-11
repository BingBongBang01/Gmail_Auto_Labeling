// popup/popup.js
const $ = (id) => document.getElementById(id);

async function initPopup() {
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }
  
  if (typeof SettingsStore !== 'undefined') {
    SettingsStore.getSettings(settings => {
      initTheme(settings);
      initStatus(settings);
      initAutomationStatus(settings);
    });
  } else {
    // Fallback if settings store didn't load properly
    initStatus();
  }
  
  initActionButtons();
  initRecentJobs();
}

function initTheme(settings) {
  const theme = settings?.general?.themeMode || "system";
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

function initStatus(settings) {
  chrome.runtime.sendMessage({ action: "getOAuthStatus" }, (oauth) => {
    const connected = oauth && oauth.connected;
    const hasApiKey = settings && settings.ai && settings.ai.geminiApiKeys && settings.ai.geminiApiKeys.length > 0;
    
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
}

function initAutomationStatus(settings) {
  const badgeGmail = $("badgeGmailAuto");
  if (badgeGmail) {
    badgeGmail.textContent = settings.automation.autoClassify.enabled ? "ON" : "OFF";
    badgeGmail.className = "badge " + (settings.automation.autoClassify.enabled ? "success" : "neutral");
  }
  const badgeCalendar = $("badgeCalendarAuto");
  if (badgeCalendar) {
    badgeCalendar.textContent = settings.calendar.classification.enabled ? "ON" : "OFF";
    badgeCalendar.className = "badge " + (settings.calendar.classification.enabled ? "success" : "neutral");
  }
}

function initRecentJobs() {
  chrome.storage.local.get("recentJobs", (data) => {
    const jobs = data.recentJobs || [];
    const container = $("recentJobsList");
    if (!container) return;
    
    if (jobs.length === 0) {
      container.innerHTML = `<div class="label-small" style="text-align:center; color:var(--md-sys-color-on-surface-variant); padding:12px;">No recent activity</div>`;
      return;
    }
    
    container.innerHTML = jobs.slice(0, 3).map(job => {
      let statusClass = "success";
      if (job.status === "error") statusClass = "error";
      else if (job.status === "running") statusClass = "warning";
      
      return `
        <div class="job-item">
          <div class="job-name">${job.name || 'Unknown Job'}</div>
          <div class="job-status ${statusClass}">${job.result || job.status || ''}</div>
        </div>
      `;
    }).join("");
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
      chrome.sidePanel.open({ windowId: window.id }).then(() => {
        window.close(); 
      }).catch(err => console.error("Failed to open side panel:", err));
    });
  });

  $("btnClassifyGmail")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "job.start", jobType: "gmail_classify" }, () => window.close());
  });
  
  $("btnSummarizeMail")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "job.start", jobType: "gmail_summarize" }, () => window.close());
  });

  $("btnClassifyCalendar")?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "job.start", jobType: "calendar_classify" }, () => window.close());
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPopup);
} else {
  initPopup();
}