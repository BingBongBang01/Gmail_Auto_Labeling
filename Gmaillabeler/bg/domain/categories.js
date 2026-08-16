// bg/domain/categories.js
// 카테고리 정의, 라벨 색상 팔레트, 개인 필터 규칙.
// 분류와 라벨 관리가 함께 쓰는 도메인 데이터라 어느 한 기능에 두지 않는다.

import { simpleHash } from "../core/util.js";
import { i18nInit, t } from "../../i18n.js";
import { SettingsStore } from "../../settings/settings_store.js";

const DEFAULT_CATEGORIES = ["보안", "광고", "쇼핑", "공지", "뉴스레터", "업무", "개인", "기타"];

// Gmail 자체 라벨 칩 색상 (콘텐츠 스크립트가 그리는 임시 배지와는 별개, Gmail API로 실제 라벨에 저장됨)
// Gmail API는 backgroundColor/textColor 각각 정해진 팔레트 값만 허용하므로 그 안에서만 골라야 함
const GMAIL_LABEL_COLOR_PALETTE = [
  { backgroundColor: "#f6c5be", textColor: "#ac2b16" }, // red
  { backgroundColor: "#ffdeb5", textColor: "#7a4706" }, // orange
  { backgroundColor: "#fef1d1", textColor: "#684e07" }, // yellow
  { backgroundColor: "#b9e4d0", textColor: "#0b804b" }, // green
  { backgroundColor: "#a0eac9", textColor: "#04502e" }, // teal
  { backgroundColor: "#c9daf8", textColor: "#285bac" }, // blue
  { backgroundColor: "#e4d7f5", textColor: "#653e9b" }, // purple
  { backgroundColor: "#fbd3e0", textColor: "#711a36" }, // pink
];

function getGmailLabelColor(labelName, categories) {
  const topLevel = String(labelName).split("/")[0];
  const idx = categories.findIndex((c) => c.split("/")[0] === topLevel);
  const paletteIndex = idx >= 0 ? idx % GMAIL_LABEL_COLOR_PALETTE.length : simpleHash(topLevel) % GMAIL_LABEL_COLOR_PALETTE.length;
  return GMAIL_LABEL_COLOR_PALETTE[paletteIndex];
}

// 콘텐츠 스크립트가 그리는 오버레이 배지 색상도 실제 Gmail 라벨 색상과 통일
function getCategoryColor(labelName, categories) {
  const c = getGmailLabelColor(labelName, categories);
  return { bgColor: c.backgroundColor, textColor: c.textColor };
}


function getLocalizedDefaultCategories() {
  const raw = t("defaultCategoriesList");
  if (!raw || raw === "defaultCategoriesList") return DEFAULT_CATEGORIES; // 메시지 로딩 실패 시 최종 안전망
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function getLocalizedDefaultCategoryDefs() {
  return getLocalizedDefaultCategories().map((name) => ({ name, description: "" }));
}

// 카테고리를 "이름 + 분류 기준 설명" 객체 배열로 관리한다(하위 라벨 대신, 사용자가 직접 설명 텍스트로 분류 기준을 지정).
// 예전 버전(문자열 배열)으로 저장된 데이터가 있으면 자동으로 {name, description:""} 형태로 변환해서 반환한다.
async function getCategoryDefinitions() {
  await i18nInit();
  const settings = await SettingsStore.getSettings();
  if (settings.gmail.categories && settings.gmail.categories.length) {
    return settings.gmail.categories.map((c) => ({ name: c.name, description: c.description || "", autoLearned: !!c.autoLearned }));
  }
  return getLocalizedDefaultCategoryDefs();
}

async function saveCategoryDefinitions(categoryDefs) {
  await SettingsStore.setSetting("gmail.categories", categoryDefs);
}

// 이름만 필요한 곳(라벨 배타 처리, 색상 계산, enum 등)에서 쓰는 헬퍼
function getCategoryNames(categoryDefs) {
  return categoryDefs.map((c) => c.name);
}

// ---------------- 개인 필터 규칙 ----------------
// rule: { id, matchType: "from" | "subject", matchValue, targetLabel }
// AI 분류보다 먼저 확인해서, 매칭되면 AI 호출 없이 바로 그 라벨을 붙인다.
async function getFilterRules() {
  const settings = await SettingsStore.getSettings();
  return settings.gmail.filters || [];
}

function matchesFilterRule(detail, rule) {
  if (!rule || !rule.matchValue) return false;
  const haystack = rule.matchType === "subject" ? detail.subject : detail.from;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(String(rule.matchValue).toLowerCase());
}

// 설치 시점(최초 1회)에 감지된 브라우저 언어로 라벨 카테고리 기본값을 고정 저장.
// 이후 사용자가 설정에서 언어를 바꾸더라도, 이미 만들어둔 라벨 이름까지 자동으로 바뀌진 않는다(의도된 동작).


export {
  DEFAULT_CATEGORIES,
  GMAIL_LABEL_COLOR_PALETTE,
  getCategoryColor,
  getCategoryDefinitions,
  getCategoryNames,
  getFilterRules,
  getGmailLabelColor,
  getLocalizedDefaultCategories,
  getLocalizedDefaultCategoryDefs,
  matchesFilterRule,
  saveCategoryDefinitions,
};
