// dashboard/panels/relabel.js
// 재적용 탭.

// ---------------- 재적용 탭 ----------------

import { startJob } from "../job_client.js";
import { getCategoryDefs } from "./labels.js";
import { $, escapeHtml } from "../ui/dom.js";
import { t } from "../../i18n.js";

function loadDashboardRelabelOptions() {
  const select = $("dashRelabelSelect");
  if (!select) return;
  const prev = select.value;
  select.innerHTML =
    `<option value="">${escapeHtml(t("dashOptionSelectLabel"))}</option>` +
    getCategoryDefs()
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
      .join("");
  if (prev) select.value = prev;
}



// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.
function initRelabelEvents() {
  // --- 재적용 탭 ---
  const startRelabelBtn = $("dashStartRelabelBtn");
  if (startRelabelBtn) {
    startRelabelBtn.addEventListener("click", () => {
      const select = $("dashRelabelSelect");
      const label = select ? select.value : "";
      if (!label) {
        alert(t("dashMsgNeedRelabelLabel"));
        return;
      }
      const excludeSelfCheckbox = $("dashExcludeSelfCheckbox");
      // background.js는 request.label / request.excludeSelf를 읽는다
      startJob({
        action: "startRelabel",
        label,
        excludeSelf: excludeSelfCheckbox ? excludeSelfCheckbox.checked : false,
      });
    });
  }

  const startDedupeBtn = $("dashStartDedupeBtn");
  if (startDedupeBtn) {
    startDedupeBtn.addEventListener("click", () => {
      startJob({ action: "startDedupeRelabel" });
    });
  }
}


export {
  initRelabelEvents,
  loadDashboardRelabelOptions,
};
