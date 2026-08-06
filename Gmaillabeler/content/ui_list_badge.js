// content/ui_list_badge.js
function injectListBadges(aiDataList) {
  const emailRows = document.querySelectorAll(".zA");

  emailRows.forEach((row) => {
    if (row.querySelector(".ai-custom-badge")) return;

    const subjectContainer = row.querySelector(".y6");
    if (!subjectContainer) return;

    const rowSubjectText = subjectContainer.innerText.trim();
    if (!rowSubjectText) return;

    // Gmail 목록의 제목이 잘려 표시되는 경우가 있어 부분 일치로 대응
    const match = aiDataList.find((item) => {
      if (!item.subject || item.error) return false;
      const stored = item.subject.trim();
      return (
        rowSubjectText.startsWith(stored) ||
        stored.startsWith(rowSubjectText) ||
        rowSubjectText.includes(stored) ||
        stored.includes(rowSubjectText)
      );
    });

    if (!match) return;

    const badge = document.createElement("span");
    badge.className = "ai-custom-badge";
    badge.innerText = match.labelName;

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
