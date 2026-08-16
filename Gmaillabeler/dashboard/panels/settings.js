// dashboard/panels/settings.js
// 설정 탭의 이벤트 바인딩.


// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.

import { startJob } from "../job_client.js";
import { clearSummaryFeedback, hasSummaryFeedback, renderFeedbackSummary } from "./feedback.js";
import { getLastReportData, renderReport } from "./report.js";
import { collectCustomWebhooksFromDom, dashCustomWebhooks, emptyCustomWebhook, persistCustomWebhooks, renderCustomWebhooks } from "./webhooks.js";
import { $ } from "../ui/dom.js";
import { t } from "../../i18n.js";

function initSettingsEvents() {
  // --- 설정 탭 ---
  // API 키 입력 UI는 옵션 페이지로 옮겨갔다(설정 > AI). 여기 남아 있던 추가/저장 핸들러는
  // 대응하는 버튼(dashAddApiKeyBtn / dashSaveKeyBtn)이 dashboard.html에 없어서 한 번도
  // 연결된 적이 없고, 이미 삭제된 collectApiKeysFromDom() / renderApiKeyInputs()를 부르고 있었다.
  // 지금은 옵션 페이지가 ai.credentials로 키를 관리한다.

  const addCustomWebhookBtn = $("dashAddCustomWebhookBtn");
  if (addCustomWebhookBtn) {
    addCustomWebhookBtn.addEventListener("click", () => {
      collectCustomWebhooksFromDom();
      dashCustomWebhooks.push(emptyCustomWebhook());
      renderCustomWebhooks();
      persistCustomWebhooks();
    });
  }

  const learnFeedbackBtn = $("dashLearnFeedbackBtn");
  if (learnFeedbackBtn) {
    learnFeedbackBtn.addEventListener("click", () => {
      if (!hasSummaryFeedback()) {
        alert(t("dashFeedbackEmpty"));
        return;
      }
      const orig = learnFeedbackBtn.textContent;
      learnFeedbackBtn.disabled = true;
      learnFeedbackBtn.textContent = t("dashMsgLearning");

      chrome.runtime.sendMessage({ action: "learnFromFeedback" }, (res) => {
        learnFeedbackBtn.disabled = false;
        learnFeedbackBtn.textContent = orig;

        if (chrome.runtime.lastError || !res || !res.ok) {
          const detail =
            (res && (res.error || (res.messageKey ? t(res.messageKey) : ""))) ||
            (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
            "";
          alert(t("errorGenericPrefix", [detail]));
          return;
        }

        // background가 이미 저장했으므로 화면만 새 값으로 맞춘다.
        const criteria = res.importanceCriteria || {};
        const fill = (id, value) => {
          const el = $(id);
          if (el) el.value = value || "";
        };
        fill("dashCriteriaHigh", criteria.high);
        fill("dashCriteriaMedium", criteria.medium);
        fill("dashCriteriaLow", criteria.low);
        fill("dashPersonalExclusionRules", res.personalExclusionRules);
        fill("dashSummaryCriteriaInput", res.lastSummaryCriteria);

        alert(t("dashMsgLearned", [String(res.feedbackCount || 0)]) + (res.changeSummary ? `\n\n${res.changeSummary}` : ""));
      });
    });
  }

  const clearFeedbackBtn = $("dashClearFeedbackBtn");
  if (clearFeedbackBtn) {
    clearFeedbackBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmClearFeedback"))) return;
      clearSummaryFeedback();
      chrome.storage.local.set({ summaryFeedback: [] }, () => {
        renderFeedbackSummary();
        if (getLastReportData()) renderReport(getLastReportData());
      });
    });
  }

  // Discord 설정 저장 버튼 핸들러는 제거했다. 대응하는 버튼이 dashboard.html에 없어서
  // 연결되지 않았고, 정의조차 없는 collectDashboardSettings()를 호출하고 있었다.
  // Discord 설정은 옵션 페이지(설정 > 알림)에서 관리한다.

  const backupDriveBtn = $("dashBackupDriveBtn");
  if (backupDriveBtn) {
    backupDriveBtn.addEventListener("click", () => {
      startJob({ action: "backupToDrive" }, t("dashMsgBackupStarted"));
    });
  }

  const restoreDriveBtn = $("dashRestoreDriveBtn");
  if (restoreDriveBtn) {
    restoreDriveBtn.addEventListener("click", () => {
              if (!confirm(t("dashConfirmRestoreDrive"))) return;
      startJob({ action: "startRestoreFromDrive", passphrase: "" }, t("dashMsgRestoreStarted"));
    });
  }
}


export {
  initSettingsEvents,
};
