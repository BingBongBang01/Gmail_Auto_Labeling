// sidepanel/ui/context.js
// 지금 보고 있는 페이지(Gmail 받은편지함, 캘린더 등)를 판별해 상단 컨텍스트 영역과
// 빠른 실행 버튼을 갱신한다.

import { startJob } from "../job_client.js";
import { t } from "../../i18n.js";
import { SERVICE_REGISTRY } from "../nav/registry.js";
import { syncActiveServiceTile } from "../nav/service_nav.js";
import { $ } from "./dom.js";

const CONTEXT_FRESHNESS_MS = 10 * 60 * 1000;

function detectInitialContext() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    const url = (activeTab && activeTab.url) || "";

    if (url.includes("mail.google.com")) {
      chrome.storage.local.get(["gmailPageContext"], (stored) => {
        const context = stored && stored.gmailPageContext;
        const isFresh = context && context.at && Date.now() - context.at < CONTEXT_FRESHNESS_MS;
        updateContextUI(
          isFresh
            ? context
            : { service: "Gmail", pageType: "inbox", title: "Inbox", desc: "Ready to assist" }
        );
      });
      return;
    }

    if (url.includes("calendar.google.com")) {
      updateContextUI({ service: "Calendar", pageType: "schedule", title: "Schedule", desc: "Ready to assist" });
      return;
    }

    updateContextUI({
      service: "Web",
      pageType: "other",
      title: (activeTab && activeTab.title) || "Page",
      desc: "No specific AI actions available for this page.",
    });
  });
}


// 지금 표시 중인 컨텍스트
let currentContext = {};

// Action Registry
const ACTION_REGISTRY = {
  "gmail.inbox": [
    { id: "action_classify_visible", label: "sidepanelClassifyVisible", cls: "btn-primary", handler: () => startJob("gmail_classify") },
    { id: "action_summarize_all", label: "sidepanelSummarizeAll", cls: "btn-secondary", handler: () => startJob("gmail_summarize") }
  ],
  "gmail.thread": [
    { id: "action_classify_thread", label: "sidepanelClassifyThread", cls: "btn-primary", handler: () => startJob("gmail_classify_thread", { messageIds: currentContext.messageIds }) },
    { id: "action_summarize_thread", label: "sidepanelSummarizeThread", cls: "btn-secondary", handler: () => startJob("gmail_summarize_thread", { messageIds: currentContext.messageIds }) }
  ],
  "calendar.schedule": [
    { id: "action_classify_schedule", label: "sidepanelClassifySchedule", cls: "btn-primary", handler: () => startJob("calendar_classify") },
    { id: "action_apply_colors", label: "sidepanelApplyColors", cls: "btn-secondary", handler: () => startJob("calendar_apply_colors") }
  ]
};

function translate(key, fallback) {
  // t()는 키를 못 찾으면 키 문자열 자체를 돌려주므로 `t(x) || fallback`은 절대 fallback을 쓰지 않는다.
  if (typeof t !== "function") return fallback || key;
  const value = t(key);
  return value && value !== key ? value : fallback || key;
}

function updateContextUI(context) {
  currentContext = context || {};

  const sEl = $("contextService");
  if (sEl) sEl.textContent = currentContext.service || "Web";
  const tEl = $("contextTitle");
  if (tEl) tEl.textContent = currentContext.title || "Page";
  const dEl = $("contextDesc");
  if (dEl) dEl.textContent = currentContext.desc || "";

  // Update active status in service nav if service matches
  if (currentContext.service) {
    const matched = SERVICE_REGISTRY.find(
      s => s.id.toLowerCase() === currentContext.service.toLowerCase() ||
        s.label.toLowerCase() === currentContext.service.toLowerCase()
    );
    if (matched) {
      // 상단 타일 상태는 service_nav가 소유한다. 여기서는 "이 서비스로 맞춰라"라고만 한다.
      syncActiveServiceTile(matched.id);
    }
  }

  const actionsContainer = $("dynamicActions");
  if (actionsContainer) {
    actionsContainer.innerHTML = "";
    const registryKey = `${(currentContext.service || "Web").toLowerCase()}.${currentContext.pageType || "other"}`;
    const actions = ACTION_REGISTRY[registryKey] || [];

    actions.forEach((act) => {
      const btn = document.createElement("button");
      btn.className = `btn action-btn ${act.cls}`;
      btn.id = act.id;
      btn.textContent = translate(act.label, act.label);
      btn.addEventListener("click", act.handler);
      actionsContainer.appendChild(btn);
    });
  }
}

function initActionButtons() {
  $("btnSettings")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  $("btnDashboard")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url: dashboardUrl });
  });
}


export {
  ACTION_REGISTRY,
  CONTEXT_FRESHNESS_MS,
  currentContext,
  detectInitialContext,
  initActionButtons,
  translate,
  updateContextUI,
};
