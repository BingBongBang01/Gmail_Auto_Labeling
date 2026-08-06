// content/ui_list_badge.js

// Gmail DOM은 메일/스레드의 실제 ID를 data-legacy-* 속성으로 노출한다.
// 제목 부분일치로 찾으면 "Re:" 같은 짧은 제목이 아무 메일에나 걸려버리므로 ID로 매칭한다.
const LEGACY_ID_ATTRS = [
  "data-legacy-message-id",
  "data-legacy-last-message-id",
  "data-legacy-thread-id",
];

function collectLegacyIds(rootEl) {
  const ids = new Set();
  for (const attr of LEGACY_ID_ATTRS) {
    if (rootEl.hasAttribute && rootEl.hasAttribute(attr)) {
      ids.add(rootEl.getAttribute(attr));
    }
    rootEl.querySelectorAll(`[${attr}]`).forEach((el) => {
      const value = el.getAttribute(attr);
      if (value) ids.add(value);
    });
  }
  return ids;
}

function findAiDataByIds(aiDataList, ids) {
  if (!ids.size) return null;
  return (
    aiDataList.find((item) => {
      if (item.error || !item.labelName) return false;
      return (item.id && ids.has(item.id)) || (item.threadId && ids.has(item.threadId));
    }) || null
  );
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
