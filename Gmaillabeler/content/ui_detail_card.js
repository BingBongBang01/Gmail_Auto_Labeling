// content/ui_detail_card.js
async function injectDetailCard(aiDataList) {
  const headerArea = document.querySelector(".hP");
  if (!headerArea || document.querySelector(".ai-detail-card")) return;

  // Gmail 탭 제목 형식: "{제목} - {계정} - Gmail"
  const titleParts = document.title.split(" - ");
  const pageSubject = titleParts.length > 2 ? titleParts.slice(0, -2).join(" - ").trim() : titleParts[0].trim();

  const match = aiDataList.find((item) => {
    if (!item.subject || item.error) return false;
    const stored = item.subject.trim();
    return pageSubject.includes(stored) || stored.includes(pageSubject);
  });

  if (!match) return;

  await i18nInit();

  const card = document.createElement("div");
  card.className = "ai-detail-card";

  card.innerHTML = `
    <span style="font-size: 14px;">
      ${t("detailCardText", [match.labelName])}
    </span>
  `;

  card.style.cssText = `
    background-color: ${match.bgColor};
    border-left: 4px solid ${match.textColor};
    color: #202124;
    padding: 12px 16px;
    margin: 15px 0;
    border-radius: 4px 8px 8px 4px;
    font-family: Roboto, sans-serif;
  `;

  headerArea.parentNode.insertBefore(card, headerArea.nextSibling);
}
