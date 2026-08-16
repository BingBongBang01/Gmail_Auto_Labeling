// dashboard/job_client.js
// 백그라운드에 작업 시작을 요청하는 유일한 통로.

// ---------------- 작업 시작 공용 처리 ----------------

import { ensureStatusWatch } from "./ui/status.js";

import { pollStatus } from "./ui/status.js";
import { t } from "../i18n.js";

function startJob(message, okMessage) {
  chrome.runtime.sendMessage(message, (res) => {
    if (chrome.runtime.lastError) {
      alert(t("errorGenericPrefix", [chrome.runtime.lastError.message]));
      return;
    }
    if (res && res.ok === false) {
      alert(res.messageKey === "errorAlreadyRunning" ? t("errorAlreadyRunning") : t("dashMsgCannotStart"));
      return;
    }
    if (okMessage) alert(okMessage);
    ensureStatusWatch();
    pollStatus();
  });
}


export {
  startJob,
};
