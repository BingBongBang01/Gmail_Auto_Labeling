// log/log.js
const logBox = document.getElementById("logBox");
const progressBar = document.getElementById("progressBar");
const progressText = document.getElementById("progressText");
const statusBadge = document.getElementById("statusBadge");
const cancelBtn = document.getElementById("cancelBtn");
const clearBtn = document.getElementById("clearBtn");
const expandBtn = document.getElementById("expandBtn");
const exportBtn = document.getElementById("exportBtn");
const titleText = document.getElementById("titleText");
const logCountHint = document.getElementById("logCountHint");

// 화면에는 최근 N개만 그려서 가볍게 유지한다(수만 줄을 DOM에 전부 그리면 브라우저가 느려짐).
// 전체 기록은 IndexedDB에 다 남아있고, "전체 로그 txt로 저장" 버튼으로 언제든 통째로 꺼낼 수 있다.
const LIVE_VIEW_LIMIT = 500;

const LOG_DB_NAME = "gmailLabelerLogs";
const LOG_STORE_NAME = "logs";

let expanded = false; // 기본값: 요약 로그만 표시 (detail=true 항목은 숨김)
let allLogsCache = [];

// 버전을 지정하지 않고 연다 - 이 창은 읽기 전용 소비자라 스토어를 만들 필요가 없고, 버전을 하드코딩해두면
// background.js가 나중에 새 스토어 추가로 버전을 올릴 때마다(예: v1 -> v3) "낮은 버전으로 열려고 함" 오류
// (VersionError DOMException)가 나서 로그 자체를 못 읽게 되는 문제가 있었다. 버전 미지정 시 브라우저가
// 현재 존재하는 버전 그대로 열어주므로 이 문제가 근본적으로 재발하지 않는다.
function openLogDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOG_DB_NAME);
    req.onsuccess = () => {
      const db = req.result;
      // 백그라운드가 아직 한 번도 로그를 쓰지 않았으면 스토어가 없는 빈 DB일 수 있다.
      // 이 창은 스토어를 만들지 않으므로, 이 경우엔 "읽을 게 없음"으로 처리한다(NotFoundError 방지).
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        db.close();
        const err = new Error("log store not created yet");
        err.isStoreMissing = true;
        reject(err);
        return;
      }
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function readAllLogs() {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readonly");
      const req = tx.objectStore(LOG_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    if (!e || !e.isStoreMissing) console.error("로그 읽기 실패:", e);
    return [];
  }
}

function applyThemeFromStorage() {
  chrome.storage.local.get(["themeMode"], (result) => {
    const mode = result.themeMode || "system";
    const effective = mode === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : mode;
    document.documentElement.setAttribute("data-theme", effective);
  });
}
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  chrome.storage.local.get(["themeMode"], (result) => {
    if ((result.themeMode || "system") === "system") applyThemeFromStorage();
  });
});

function levelClass(level) {
  if (level === "error") return "log-error";
  if (level === "warn") return "log-warn";
  return "log-info";
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function formatDateTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, { hour12: false });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderLogs() {
  const wasAtBottom = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 20;

  const filtered = expanded ? allLogsCache : allLogsCache.filter((e) => !e.detail);
  const visible = filtered.slice(-LIVE_VIEW_LIMIT);

  logBox.innerHTML = visible
    .map(
      (entry) =>
        `<div class="log-line ${levelClass(entry.level)}"><span class="log-time">[${formatTime(entry.t)}]</span>${escapeHtml(entry.message)}</div>`
    )
    .join("");

  if (wasAtBottom) {
    logBox.scrollTop = logBox.scrollHeight;
  }

  logCountHint.textContent = t("logCountHint", [filtered.length, allLogsCache.length]);
}

async function refreshLogs() {
  allLogsCache = await readAllLogs();
  renderLogs();
}

function renderStatus(jobStatus) {
  statusBadge.className = "status-badge";
  if (jobStatus === "running") {
    statusBadge.textContent = t("statusRunning");
    statusBadge.classList.add("status-running");
  } else if (jobStatus === "done") {
    statusBadge.textContent = t("statusDone");
    statusBadge.classList.add("status-done");
  } else if (jobStatus === "error") {
    statusBadge.textContent = t("statusError");
    statusBadge.classList.add("status-error");
  } else if (jobStatus === "cancelled") {
    statusBadge.textContent = t("statusCancelled");
    statusBadge.classList.add("status-cancelled");
  } else if (jobStatus === "quota_exceeded") {
    statusBadge.textContent = t("statusQuotaExceeded");
    statusBadge.classList.add("status-error");
  } else {
    statusBadge.textContent = t("statusIdle");
  }
}

function renderProgress(progress) {
  if (!progress || !progress.total) {
    progressBar.style.width = "0%";
    progressText.textContent = t("logProgressNoInfo");
    return;
  }
  const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
  progressBar.style.width = `${pct}%`;
  progressText.textContent = t("logProgressTemplate", [progress.processed, progress.total, progress.batchIndex, progress.batchTotal, pct]);
}

function refreshStatusAndProgress() {
  chrome.storage.local.get(["jobStatus", "jobProgress"], (result) => {
    renderStatus(result.jobStatus);
    renderProgress(result.jobProgress);
  });
}

async function exportLogsAsTxt() {
  exportBtn.disabled = true;
  const prevText = exportBtn.textContent;
  exportBtn.textContent = t("logBtnExporting");
  try {
    const logs = await readAllLogs();
    const lines = logs.map((entry) => `[${formatDateTime(entry.t)}] [${entry.level.toUpperCase()}] ${entry.message}`);
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const a = document.createElement("a");
    a.href = url;
    a.download = `gmail-ai-labeler-log-${stamp}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } finally {
    exportBtn.disabled = false;
    exportBtn.textContent = prevText;
  }
}

async function main() {
  await i18nInit();
  applyThemeFromStorage();
  document.title = t("logWindowTitle");
  titleText.childNodes[0].textContent = `${t("logWindowTitle")} `;
  expandBtn.textContent = t("logBtnExpandAll");
  exportBtn.textContent = t("logBtnExportTxt");
  cancelBtn.textContent = t("logBtnCancel");
  clearBtn.textContent = t("logBtnClear");

  await refreshLogs();
  refreshStatusAndProgress();

  // 로그는 IndexedDB라 storage.onChanged로 실시간 감지가 안 되니, 가벼운 타임스탬프 변경을 신호로 주기적으로 다시 읽는다.
  let lastSeenUpdate = 0;
  setInterval(async () => {
    const result = await new Promise((resolve) => chrome.storage.local.get(["jobLogsUpdatedAt"], resolve));
    if ((result.jobLogsUpdatedAt || 0) !== lastSeenUpdate) {
      lastSeenUpdate = result.jobLogsUpdatedAt || 0;
      await refreshLogs();
    }
  }, 1000);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.jobStatus || changes.jobProgress) refreshStatusAndProgress();
    if (changes.themeMode) applyThemeFromStorage();
  });

  expandBtn.addEventListener("click", () => {
    expanded = !expanded;
    expandBtn.textContent = expanded ? t("logBtnCollapse") : t("logBtnExpandAll");
    renderLogs();
  });

  exportBtn.addEventListener("click", exportLogsAsTxt);

  cancelBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "cancelJob" }, (response) => {
      if (response) {
        cancelBtn.disabled = true;
        cancelBtn.textContent = t("logBtnCancelRequested");
      }
    });
  });

  clearBtn.addEventListener("click", () => {
    // DOM만 비우면 새로고침 시 로그가 다시 나타난다 - 실제 저장소(IndexedDB)까지 지운다.
    clearBtn.disabled = true;
    chrome.runtime.sendMessage({ action: "clearLogs" }, () => {
      allLogsCache = [];
      logBox.innerHTML = "";
      clearBtn.disabled = false;
      renderLogs();
    });
  });
}

main();
