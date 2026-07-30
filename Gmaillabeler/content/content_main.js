// content/content_main.js

// 확장 프로그램이 업데이트/리로드되면, 이미 열려있던 탭의 content script는
// 예전 컨텍스트로 남아 chrome.* 호출 시 "Extension context invalidated" 오류를 던진다.
// 이를 감지해서 조용히 감시를 멈춘다 (콘솔 오류 스팸 방지). 실제 해결은 탭 새로고침.
function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

let observerRef = null;

function stopObservingIfInvalid() {
  if (!isExtensionContextValid() && observerRef) {
    observerRef.disconnect();
    observerRef = null;
    return true;
  }
  return false;
}

function observeGmailNavigation() {
  let lastUrl = location.href;
  observerRef = new MutationObserver(() => {
    if (stopObservingIfInvalid()) return;
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      handleRouteChange(url);
    }
  });
  observerRef.observe(document, { subtree: true, childList: true });
}

function handleRouteChange(url) {
  if (!isExtensionContextValid()) return;

  try {
    chrome.storage.local.get(["latestAiData"], (result) => {
      if (chrome.runtime.lastError) return; // 컨텍스트 무효화 등으로 인한 조용한 실패 처리
      const aiDataList = result && result.latestAiData;
      if (!aiDataList || !aiDataList.length) return;

      if (url.includes("/#inbox/") || /#(inbox|all|sent)\/[^/]+$/.test(url)) {
        setTimeout(() => injectDetailCard(aiDataList), 1000);
      } else {
        setTimeout(() => injectListBadges(aiDataList), 1000);
      }
    });
  } catch (e) {
    // "Extension context invalidated" 등 - 탭을 새로고침하기 전까지는 무시하고 넘어감
  }
}

// 백그라운드에서 분류가 끝나 storage가 갱신되면, 이미 열려 있는 Gmail 탭에도 바로 반영
try {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (!isExtensionContextValid()) return;
    if (areaName !== "local" || !changes.latestAiData) return;
    handleRouteChange(location.href);
  });
} catch (e) {
  // 컨텍스트가 이미 무효화된 상태로 스크립트가 실행된 경우
}

window.onload = () => {
  if (!isExtensionContextValid()) return;
  observeGmailNavigation();
  handleRouteChange(location.href);
};
