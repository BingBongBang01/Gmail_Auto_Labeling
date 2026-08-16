// dashboard/panels/tabs.js
// 탭 전환.

// ---------------- 탭 전환 ----------------

import { renderDashAnalysisChecklist } from "./analysis.js";
import { renderDashboardCategories } from "./labels.js";
import { loadDashboardLogs } from "./logs.js";
import { loadDashboardRelabelOptions } from "./relabel.js";
import { $ } from "../ui/dom.js";

const TAB_PANEL_MAP = {
  summary: "dashPanelSummary",
  classify: "dashPanelClassify",
  labels: "dashPanelLabels",
  relabel: "dashPanelRelabel",
  calendar: "dashPanelCalendar",
  logs: "dashPanelLogs",
};

function initDashTabSwitching() {
  const navBtns = document.querySelectorAll(".dash-nav-btn[data-dash-tab]");
  const subControls = $("summarySubcontrols");

  $("btnOpenOptionsFromDash")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-dash-tab");
      navBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const panelId = TAB_PANEL_MAP[tab];
      Object.values(TAB_PANEL_MAP).forEach((pId) => {
        const p = $(pId);
        if (!p) return;
        const isTarget = pId === panelId;
        p.classList.toggle("active", isTarget);
        p.style.display = isTarget ? "block" : "none";
      });

      if (subControls) subControls.style.display = tab === "summary" ? "flex" : "none";

      if (tab === "labels") {
        renderDashboardCategories();
        renderDashAnalysisChecklist();
      }
      if (tab === "relabel") loadDashboardRelabelOptions();
      if (tab === "relabel") loadDashboardRelabelOptions();
      if (tab === "logs") loadDashboardLogs();
    });
  });
}


export {
  TAB_PANEL_MAP,
  initDashTabSwitching,
};
