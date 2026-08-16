// dashboard/panels/logs.js
// 로그 탭.

// ---------------- 로그 탭 ----------------

import { $, escapeHtml } from "../ui/dom.js";
import { t } from "../../i18n.js";

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

// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.
function initLogsEvents() {
  const clearLogsBtn = $("dashClearLogsBtn");
  if (clearLogsBtn) {
    clearLogsBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "clearLogs" }, () => loadDashboardLogs());
    });
  }
}


export {
  initLogsEvents,
  loadDashboardLogs,
};
