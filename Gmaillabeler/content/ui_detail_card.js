// content/ui_detail_card.js
async function injectDetailCard(aiDataList) {
  const headerArea = document.querySelector(".hP");
  if (!headerArea || document.querySelector(".ai-detail-card")) return;

  // 열려 있는 메일/스레드의 실제 ID로 매칭한다.
  // (탭 제목의 부분일치로 찾으면 "Re:" 같은 짧은 제목이 엉뚱한 메일에 걸린다)
  const threadContainer = headerArea.closest(".nH") || document.body;
  const match = findAiDataByIds(aiDataList, collectLegacyIds(threadContainer));

  if (!match) return;

  await i18nInit();

  const card = document.createElement("div");
  card.className = "ai-detail-card";

  // 라벨 이름은 AI/사용자가 만든 값이라 innerHTML로 넣으면 HTML이 주입될 수 있다 - textContent로 안전하게 삽입
  const cardText = document.createElement("span");
  cardText.style.fontSize = "14px";
  cardText.textContent = t("detailCardText", [match.labelName]);
  card.appendChild(cardText);

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
