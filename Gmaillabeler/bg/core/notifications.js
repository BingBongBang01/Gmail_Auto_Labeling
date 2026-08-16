// bg/core/notifications.js
// 브라우저 알림. 작업 결과를 사람이 읽을 문장으로 바꾸는 것도 여기서 담당한다.

import { SettingsStore } from "../../settings/settings_store.js";
import { t } from "../../i18n.js";

function summaryMessage(summary) {
  if (summary.total === 0) return t("msgNoMailToProcess");
  let base;
  if (summary.quotaExhausted) {
    base = t("msgQuotaExceededSummary", [summary.success, summary.total]);
  } else if (summary.cancelled) {
    base = t("msgCancelledSummary", [summary.success, summary.total]);
  } else {
    base = t("msgSuccessSummary", [summary.success, summary.total]);
  }
  if (summary.failMessages && summary.failMessages.length) {
    return base + t("msgFailSuffix", [summary.failMessages[0]]);
  }
  return base;
}

// 알림 설정(notifications.browser.*)은 스키마와 옵션 UI에 있었지만 아무도 읽지 않아서,
// 사용자가 브라우저 알림을 꺼도 계속 알림이 떴다.
async function isBrowserNotificationEnabled(kind) {
  try {
    const settings = await SettingsStore.getSettings();
    const browser = settings.notifications?.browser;
    if (!browser || browser.enabled !== true) return false;
    if (kind === "error") return browser.onClassifyError !== false;
    if (kind === "summary") return browser.onSummaryComplete !== false;
    return browser.onClassifyComplete !== false;
  } catch (e) {
    return false;
  }
}

async function notifyCompletion(title, summary) {
  if (!(await isBrowserNotificationEnabled("complete"))) return;
  chrome.notifications.create(`gmail-labeler-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title,
    message: summaryMessage(summary),
    priority: 1,
  });
}

async function notifyError(title, errMsg) {
  if (!(await isBrowserNotificationEnabled("error"))) return;
  chrome.notifications.create(`gmail-labeler-error-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title,
    message: errMsg,
    priority: 1,
  });
}

export { summaryMessage, isBrowserNotificationEnabled, notifyCompletion, notifyError };
