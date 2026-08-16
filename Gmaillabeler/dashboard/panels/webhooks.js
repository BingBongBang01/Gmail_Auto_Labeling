// dashboard/panels/webhooks.js
// 사용자 정의 Discord 웹훅 규칙 편집.

// ---------------- 설정 탭 ----------------

import { showSettingsAutoSaveMark } from "./filters.js";
import { getCategoryDefs } from "./labels.js";
import { $, escapeHtml } from "../ui/dom.js";
import { t } from "../../i18n.js";
import { SettingsStore } from "../../settings/settings_store.js";

// API 키 관리 UI는 옵션 페이지(설정 > AI 공급자)로 옮겨졌다.
// 여기 남아 있던 dashApiKeys / dashAddApiKeyBtn / dashSaveKeyBtn 코드는 대응하는 DOM이
// dashboard.html에서 이미 제거돼 실행되지 않았고, 저장 대상도 아무도 읽지 않는
// 평면 키 geminiApiKeys였다.

// 사용자가 원하는 만큼 추가하는 커스텀 Discord 웹훅.
// background.js의 matchesCustomWebhookRule()이 읽는 필드 이름과 반드시 같아야 한다.
let dashCustomWebhooks = [];

const CUSTOM_WEBHOOK_IMPORTANCES = ["상", "중", "하"];
const CUSTOM_WEBHOOK_CATEGORIES = ["긴급/조치필요", "공지/일정", "일반/리포트"];

function emptyCustomWebhook() {
  return {
    name: "",
    url: "",
    enabled: true,
    labels: [],
    importance: [],
    categories: [],
    onlyPersonal: false,
    onlyActionRequired: false,
    senderKeywords: "",
    subjectKeywords: "",
    excludeKeywords: "",
  };
}

function renderCustomWebhooks() {
  const wrap = $("dashCustomWebhookList");
  if (!wrap) return;

  wrap.dataset.rendered = "1";

  if (!dashCustomWebhooks.length) {
    wrap.innerHTML = `<p class="dash-desc">${escapeHtml(t("dashCustomWebhookEmpty"))}</p>`;
    return;
  }

  wrap.innerHTML = dashCustomWebhooks
    .map((hook, idx) => {
      const imps = Array.isArray(hook.importance) ? hook.importance : [];
      const cats = Array.isArray(hook.categories) ? hook.categories : [];
      const labels = Array.isArray(hook.labels) ? hook.labels : [];
      // 분류(라벨) 조건은 현재 등록된 카테고리 목록에서 고른다.
      // 이미 지워진 라벨이 규칙에 남아 있을 수 있으므로 그것도 함께 보여준다(모르는 사이에 조건이 사라지지 않게).
      const labelChoices = getCategoryDefs()
        .map((c) => c.name)
        .concat(labels.filter((name) => !getCategoryDefs().some((c) => c.name === name)));
      const labelBoxes = labelChoices.length
        ? labelChoices
            .map(
              (name) =>
                `<label class="dash-inline-check"><input type="checkbox" data-field="labels" value="${escapeHtml(name)}"${labels.includes(name) ? " checked" : ""}> ${escapeHtml(name)}</label>`
            )
            .join("")
        : `<span class="dash-desc" style="margin:0;">${escapeHtml(t("dashRuleNoLabels"))}</span>`;
      const impBoxes = CUSTOM_WEBHOOK_IMPORTANCES.map(
        (v) =>
          `<label class="dash-inline-check"><input type="checkbox" data-field="importance" value="${escapeHtml(v)}"${imps.includes(v) ? " checked" : ""}> ${escapeHtml(v)}</label>`
      ).join("");
      const catBoxes = CUSTOM_WEBHOOK_CATEGORIES.map(
        (v) =>
          `<label class="dash-inline-check"><input type="checkbox" data-field="categories" value="${escapeHtml(v)}"${cats.includes(v) ? " checked" : ""}> ${escapeHtml(v)}</label>`
      ).join("");

      return `
      <div class="dash-custom-webhook" data-idx="${idx}">
        <div class="dash-custom-webhook-head">
          <input type="text" class="dash-input-text" data-field="name" value="${escapeHtml(hook.name || "")}" placeholder="${escapeHtml(t("dashPlaceholderCustomWebhookName"))}">
          <label class="dash-inline-check"><input type="checkbox" data-field="enabled"${hook.enabled === false ? "" : " checked"}> ${escapeHtml(t("dashCustomWebhookEnabled"))}</label>
          <button class="dash-btn dash-btn-secondary dash-del-webhook-btn" data-idx="${idx}">✕</button>
        </div>
        <input type="text" class="dash-input-text" data-field="url" value="${escapeHtml(hook.url || "")}" placeholder="https://discord.com/api/webhooks/...">
        <div class="dash-custom-webhook-rules">
          <div class="dash-rule-line"><span class="dash-rule-label">${escapeHtml(t("dashRuleLabels"))}</span>${labelBoxes}</div>
          <div class="dash-rule-line"><span class="dash-rule-label">${escapeHtml(t("dashRuleImportance"))}</span>${impBoxes}</div>
          <div class="dash-rule-line"><span class="dash-rule-label">${escapeHtml(t("dashRuleCategory"))}</span>${catBoxes}</div>
          <div class="dash-rule-line">
            <label class="dash-inline-check"><input type="checkbox" data-field="onlyPersonal"${hook.onlyPersonal ? " checked" : ""}> ${escapeHtml(t("dashRuleOnlyPersonal"))}</label>
            <label class="dash-inline-check"><input type="checkbox" data-field="onlyActionRequired"${hook.onlyActionRequired ? " checked" : ""}> ${escapeHtml(t("dashRuleOnlyAction"))}</label>
          </div>
          <input type="text" class="dash-input-text" data-field="senderKeywords" value="${escapeHtml(hook.senderKeywords || "")}" placeholder="${escapeHtml(t("dashPlaceholderRuleSender"))}">
          <input type="text" class="dash-input-text" data-field="subjectKeywords" value="${escapeHtml(hook.subjectKeywords || "")}" placeholder="${escapeHtml(t("dashPlaceholderRuleSubject"))}">
          <input type="text" class="dash-input-text" data-field="excludeKeywords" value="${escapeHtml(hook.excludeKeywords || "")}" placeholder="${escapeHtml(t("dashPlaceholderRuleExclude"))}">
        </div>
      </div>`;
    })
    .join("");

  wrap.querySelectorAll(".dash-del-webhook-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectCustomWebhooksFromDom();
      dashCustomWebhooks.splice(parseInt(btn.getAttribute("data-idx"), 10), 1);
      renderCustomWebhooks();
      // 버튼 클릭은 input/change 이벤트가 아니라서 자동 저장이 걸리지 않는다.
      // 여기서 직접 저장하지 않으면 이미 저장돼 있던 웹훅은 탭을 다시 열 때 되살아난다.
      persistCustomWebhooks();
    });
  });
}

// 목록 자체가 바뀌는 조작(추가/삭제)은 자동 저장을 기다리지 않고 즉시 반영한다.
function persistCustomWebhooks() {
  // background.js는 settings.notifications.customWebhooks를 읽는다.
  SettingsStore.setSetting("notifications.customWebhooks", dashCustomWebhooks).then(
    showSettingsAutoSaveMark
  );
}

// 화면에 입력된 값을 dashCustomWebhooks에 다시 담는다(행 추가/삭제/저장 직전에 호출).
function collectCustomWebhooksFromDom() {
  const wrap = $("dashCustomWebhookList");
  if (!wrap) return;
  // 아직 한 번도 그리지 않았다면 화면에 값이 없는 게 정상이므로 메모리 값을 덮어쓰지 않는다.
  // (반대로 그린 뒤 행이 0개인 것은 "전부 지웠다"는 뜻이라 빈 목록으로 반영해야 한다)
  if (wrap.dataset.rendered !== "1") return;

  const rows = wrap.querySelectorAll(".dash-custom-webhook");
  dashCustomWebhooks = Array.from(rows).map((row) => {
    const text = (field) => {
      const el = row.querySelector(`[data-field="${field}"]`);
      return el ? el.value.trim() : "";
    };
    const checked = (field) => {
      const el = row.querySelector(`input[type="checkbox"][data-field="${field}"]`);
      return !!(el && el.checked);
    };
    const checkedValues = (field) =>
      Array.from(row.querySelectorAll(`input[type="checkbox"][data-field="${field}"]:checked`)).map((el) => el.value);

    return {
      name: text("name"),
      url: text("url"),
      enabled: checked("enabled"),
      labels: checkedValues("labels"),
      importance: checkedValues("importance"),
      categories: checkedValues("categories"),
      onlyPersonal: checked("onlyPersonal"),
      onlyActionRequired: checked("onlyActionRequired"),
      senderKeywords: text("senderKeywords"),
      subjectKeywords: text("subjectKeywords"),
      excludeKeywords: text("excludeKeywords"),
    };
  });
}


export {
  CUSTOM_WEBHOOK_CATEGORIES,
  CUSTOM_WEBHOOK_IMPORTANCES,
  collectCustomWebhooksFromDom,
  dashCustomWebhooks,
  emptyCustomWebhook,
  persistCustomWebhooks,
  renderCustomWebhooks,
};
