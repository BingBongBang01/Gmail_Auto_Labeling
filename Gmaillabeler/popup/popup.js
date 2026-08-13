// popup/popup.js
const $ = (id) => document.getElementById(id);

// 저장된 작업 기록을 innerHTML로 그리므로 이스케이프가 필요하다.
// 작업 결과 문자열에는 AI 출력과 메일에서 온 오류 메시지가 섞여 들어온다.
function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
    const credentials = (settings && settings.ai && settings.ai.credentials) || [];
    const activeCredentials = credentials.filter((c) => c && c.enabled && c.apiKey);
    const readyCredentials = activeCredentials.filter((c) => c.status !== "invalid" && c.status !== "rate_limited" && c.status !== "quota_exhausted" && c.status !== "unavailable");
    const hasApiKey = activeCredentials.length > 0;

    // API 키는 ai.credentials에 저장된다.
    // 예전에는 settings.ai.geminiApiKeys를 봤는데 그 경로는 스키마에 없어서
    // 키를 몇 개 등록해도 항상 "Missing Key / Setup Required"로 표시됐다.
    const credentials = Array.isArray(settings?.ai?.credentials) ? settings.ai.credentials : [];
    const hasApiKey = credentials.some((c) => c && c.enabled && c.apiKey);
    
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
      if (!hasApiKey) {
        geminiStatus.textContent = "● Missing Key";
        geminiStatus.className = "status-value error";
      } else if (readyCredentials.length === 0) {
        geminiStatus.textContent = `● ${activeCredentials.length} credential(s), all unavailable`;
        geminiStatus.className = "status-value error";
      } else {
        const top = [...readyCredentials].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
        geminiStatus.textContent = `● Ready (${top.provider}/${top.model}, ${activeCredentials.length} active)`;
        geminiStatus.className = "status-value success";
      }
    }

    const globalStatus = $("globalStatusText");
    if (globalStatus) {
      if (connected && readyCredentials.length > 0) {
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
          <div class="job-name">${escapeHtml(job.name || 'Unknown Job')}</div>
          <div class="job-status ${statusClass}">${escapeHtml(job.result || job.status || '')}</div>
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
    // 콜백 인자를 window로 받으면 전역 window가 가려져서, 팝업을 닫으려던
    // window.close()가 chrome.windows.Window 객체의 없는 메서드를 부르며 TypeError를 냈다.
    // (사이드패널은 열리는데 콘솔에는 "실패"로 찍히고 팝업은 닫히지 않았다)
    chrome.windows.getCurrent((currentWindow) => {
      chrome.sidePanel
        .open({ windowId: currentWindow.id })
        .then(() => window.close())
        .catch((err) => console.error("Failed to open side panel:", err));
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