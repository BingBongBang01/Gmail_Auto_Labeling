// dashboard/panels/filters.js
// 개인 필터 규칙 편집.

// ---------------- 개인 필터 규칙 ----------------
// AI 분류 전에 먼저 확인해서, 매칭되면 AI 호출 없이 바로 그 라벨을 붙인다.
// 필드 이름은 background.js의 matchesFilterRule()이 읽는 것과 같아야 한다.
//
// 이 네 함수(dashFilterRules / loadDashFilterRules / renderDashFilterRules /
// collectDashFilterRules)는 참조만 있고 정의가 없었다. main()이 loadDashFilterRules()를
// 부르는 지점에서 ReferenceError가 나서 그 뒤의 모든 초기화(스크래치패드 복원,
// getConfig 조회, 마지막 요약 리포트 렌더링, pollStatus)가 실행되지 않았다.

import { getCategoryDefs } from "./labels.js";
import { $, escapeHtml } from "../ui/dom.js";
import { t } from "../../i18n.js";
import { SettingsStore } from "../../settings/settings_store.js";

let dashFilterRules = [];

const FILTER_MATCH_TYPES = ["from", "subject"];

function normalizeDashFilterRule(rule) {
  return {
    matchType: FILTER_MATCH_TYPES.includes(rule && rule.matchType) ? rule.matchType : "from",
    matchValue: typeof (rule && rule.matchValue) === "string" ? rule.matchValue : "",
    targetLabel: typeof (rule && rule.targetLabel) === "string" ? rule.targetLabel : "",
  };
}

async function loadDashFilterRules() {
  const settings = await SettingsStore.getSettings();
  const stored = Array.isArray(settings.gmail && settings.gmail.filters) ? settings.gmail.filters : [];
  dashFilterRules = stored.map(normalizeDashFilterRule);
  renderDashFilterRules();
}

function renderDashFilterRules() {
  const wrap = $("dashFilterRulesList");
  if (!wrap) return;

  if (!dashFilterRules.length) {
    wrap.innerHTML = `<p class="dash-desc">${escapeHtml(t("dashFilterRulesEmpty"))}</p>`;
    return;
  }

  const labelOptions = (getCategoryDefs() || []).map((c) => c.name).filter(Boolean);

  wrap.innerHTML =
    dashFilterRules
      .map(
        (rule, idx) => `
      <div class="dash-filter-rule-row" data-idx="${idx}" style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
        <select class="dash-input filter-match-type" style="flex:0 0 120px;">
          <option value="from" ${rule.matchType === "from" ? "selected" : ""}>${escapeHtml(t("dashFilterMatchFrom"))}</option>
          <option value="subject" ${rule.matchType === "subject" ? "selected" : ""}>${escapeHtml(t("dashFilterMatchSubject"))}</option>
        </select>
        <input type="text" class="dash-input filter-match-value" style="flex:1;"
               value="${escapeHtml(rule.matchValue)}" placeholder="${escapeHtml(t("dashFilterValuePlaceholder"))}">
        <input type="text" class="dash-input filter-target-label" style="flex:1;" list="dashFilterLabelOptions"
               value="${escapeHtml(rule.targetLabel)}" placeholder="${escapeHtml(t("dashFilterLabelPlaceholder"))}">
        <button class="dash-btn dash-btn-secondary filter-rule-remove" data-idx="${idx}" title="✕">✕</button>
      </div>`
      )
      .join("") +
    `<datalist id="dashFilterLabelOptions">${labelOptions
      .map((name) => `<option value="${escapeHtml(name)}"></option>`)
      .join("")}</datalist>`;

  wrap.querySelectorAll(".filter-rule-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectDashFilterRules();
      dashFilterRules.splice(parseInt(btn.getAttribute("data-idx"), 10), 1);
      renderDashFilterRules();
    });
  });
}

// 화면에 입력된 값을 dashFilterRules에 다시 담는다(행 추가/삭제/저장 직전에 호출).
function collectDashFilterRules() {
  const wrap = $("dashFilterRulesList");
  if (!wrap) return;
  const rows = wrap.querySelectorAll(".dash-filter-rule-row");
  if (!rows.length) return;

  dashFilterRules = Array.from(rows).map((row) => ({
    matchType: row.querySelector(".filter-match-type")?.value === "subject" ? "subject" : "from",
    matchValue: (row.querySelector(".filter-match-value")?.value || "").trim(),
    targetLabel: (row.querySelector(".filter-target-label")?.value || "").trim(),
  }));
}

// 설정이 자동 저장됐음을 알리는 표시. storage.set 콜백으로 넘겨 쓴다.
function showSettingsAutoSaveMark() {
  const box = $("dashSettingsAutoSaveMark") || $("dashFilterRulesResultBox");
  if (!box) return;
  box.textContent = t("msgSettingsAutoSaved");
}


// 규칙 목록은 이 모듈이 소유한다. 저장 후 확정된 목록으로 갈아끼울 때 밖에서 이 함수를 쓴다.
function getDashFilterRules() {
  return dashFilterRules;
}

// 빈 행 하나를 끝에 붙인다(추가 버튼용).
function addEmptyDashFilterRule() {
  dashFilterRules.push({ matchType: "from", matchValue: "", targetLabel: "" });
}

function setDashFilterRules(rules) {
  dashFilterRules = Array.isArray(rules) ? rules : [];
}

export {
  getDashFilterRules,
  addEmptyDashFilterRule,
  setDashFilterRules,
  FILTER_MATCH_TYPES,
  collectDashFilterRules,
  dashFilterRules,
  loadDashFilterRules,
  normalizeDashFilterRule,
  renderDashFilterRules,
  showSettingsAutoSaveMark,
};
