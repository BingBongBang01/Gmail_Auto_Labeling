// 이 페이지는 확장 프로그램 안에서 열리므로 chrome.runtime.id로 확장 ID를 바로 읽을 수 있다.
// 이 값으로 리디렉션 URI를 자동 계산해서 보여주면, 사용자가 chrome://extensions에 따로 갈 필요가 없어진다.
async function main() {
  await i18nInit();
  i18nApplyToDom(document);
  document.title = t("guideTitle");

  try {
    const extId = chrome.runtime.id;
    const redirectUri = `https://${extId}.chromiumapp.org/`;
    const el = document.getElementById("redirectUriText");
    if (el) el.textContent = redirectUri;

    const copyBtn = document.getElementById("copyRedirectBtn");
    if (copyBtn) {
      copyBtn.addEventListener("click", (e) => {
        navigator.clipboard.writeText(redirectUri).then(() => {
          const btn = e.target;
          const prev = btn.textContent;
          btn.textContent = "✓";
          setTimeout(() => (btn.textContent = prev), 1500);
        });
      });
    }
  } catch (e) {
    // 확장 프로그램 컨텍스트가 아니면(직접 파일로 열었을 경우) 조용히 무시 - 안내 문구는 그대로 남음
  }
}

main();
