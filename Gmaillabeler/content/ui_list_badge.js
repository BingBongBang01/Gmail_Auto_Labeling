// content/ui_list_badge.js

// Gmail DOM은 메일/스레드의 실제 ID를 data-legacy-* 속성으로 노출한다.
// 제목 부분일치로 찾으면 "Re:" 같은 짧은 제목이 아무 메일에나 걸려버리므로 ID로 매칭한다.
const LEGACY_ID_ATTRS = [
  "data-legacy-message-id",
  "data-legacy-last-message-id",
  "data-legacy-thread-id",
];

const LEGACY_ID_SELECTOR = LEGACY_ID_ATTRS.map((attr) => `[${attr}]`).join(",");

function collectLegacyIds(rootEl) {
  const ids = new Set();
  if (rootEl.hasAttribute) {
    for (const attr of LEGACY_ID_ATTRS) {
      if (rootEl.hasAttribute(attr)) ids.add(rootEl.getAttribute(attr));
    }
  }
  // 속성별로 따로 훑지 않고 한 번의 셀렉터로 모은다
  rootEl.querySelectorAll(LEGACY_ID_SELECTOR).forEach((el) => {
    for (const attr of LEGACY_ID_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) ids.add(value);
    }
  });
  return ids;
}

// aiDataList를 매 행마다 선형 탐색하지 않도록 ID -> 항목 색인을 만들어 재사용한다.
// (Gmail 목록은 한 화면에 50개 이상 행이 있고, DOM 변경마다 다시 훑기 때문에 누적 비용이 크다)
let aiDataIndexCache = null;
let aiDataIndexSource = null;

function buildAiDataIndex(aiDataList) {
  if (aiDataIndexCache && aiDataIndexSource === aiDataList) return aiDataIndexCache;
  const index = new Map();
  for (const item of aiDataList) {
    if (!item || item.error || !item.labelName) continue;
    if (item.id) index.set(item.id, item);
    if (item.threadId && !index.has(item.threadId)) index.set(item.threadId, item);
  }
  aiDataIndexCache = index;
  aiDataIndexSource = aiDataList;
  return index;
}

function findAiDataByIds(aiDataList, ids) {
  if (!ids.size) return null;
  const index = buildAiDataIndex(aiDataList);
  for (const id of ids) {
    const found = index.get(id);
    if (found) return found;
  }
  return null;
}

function injectListBadges(aiDataList) {
  const emailRows = document.querySelectorAll(".zA");

  emailRows.forEach((row) => {
    if (row.querySelector(".ai-custom-badge")) return;

    const subjectContainer = row.querySelector(".y6");
    if (!subjectContainer) return;

    const match = findAiDataByIds(aiDataList, collectLegacyIds(row));
    if (!match) return;

    const badge = document.createElement("span");
    badge.className = "ai-custom-badge";
    badge.textContent = match.labelName;

    badge.style.cssText = `
      background-color: ${match.bgColor};
      color: ${match.textColor};
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: bold;
      margin-left: 10px;
      border: 1px solid ${match.bgColor};
    `;

    subjectContainer.appendChild(badge);
  });
}
