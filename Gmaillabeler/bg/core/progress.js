// bg/core/progress.js
// 진행률도 항목마다 storage에 쓰면(=모든 확장 컨텍스트에 변경 이벤트 브로드캐스트) 비용이 크다.
// 팝업/대시보드가 1~2초 주기로 읽어가므로 그보다 잦게 쓸 이유가 없어 최소 간격을 둔다.

import { SettingsStore } from "../../settings/settings_store.js";

const PROGRESS_WRITE_INTERVAL_MS = 800;

let lastProgressWriteAt = 0;
let pendingProgressValue = null;
let progressFlushTimer = null;

async function writeProgress(progress) {
  lastProgressWriteAt = Date.now();
  await chrome.storage.local.set({ jobProgress: progress });

  try {
    if (progress && progress.total) {
      const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
      chrome.action.setBadgeText({ text: `${pct}%` });
      chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    } else if (progress && typeof progress.pct === "number") {
      chrome.action.setBadgeText({ text: `${progress.pct}%` });
      chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    }
  } catch (e) {
    // Ignore badge error
  }
}

async function updateProgress(progress, options) {
  const force = !!(options && options.force);
  const now = Date.now();

  if (!force && now - lastProgressWriteAt < PROGRESS_WRITE_INTERVAL_MS) {
    // 마지막 값은 반드시 반영되도록, 스킵한 값을 예약해둔다
    pendingProgressValue = progress;
    if (!progressFlushTimer) {
      progressFlushTimer = setTimeout(() => {
        progressFlushTimer = null;
        const queued = pendingProgressValue;
        pendingProgressValue = null;
        if (queued) writeProgress(queued);
      }, PROGRESS_WRITE_INTERVAL_MS - (now - lastProgressWriteAt));
    }
    return;
  }

  pendingProgressValue = null;
  await writeProgress(progress);
}

function clearProgressBadge() {
  try {
    SettingsStore.getSettings()
      .then((settings) => {
        if (settings && settings.general && settings.general.startupBehavior.showStatusOnGmail) {
          chrome.action.setBadgeText({ text: "●" });
          chrome.action.setBadgeBackgroundColor({ color: "#10b981" }); // green
        } else {
          chrome.action.setBadgeText({ text: "" });
        }
      })
      .catch(() => {
        chrome.action.setBadgeText({ text: "" });
      });
  } catch (e) {}
}

export { updateProgress, writeProgress, clearProgressBadge };
