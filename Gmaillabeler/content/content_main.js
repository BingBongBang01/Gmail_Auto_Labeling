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

// Gmail은 화면 조작마다 DOM을 대량으로 갈아치우기 때문에, 이 콜백은 초당 수백 번까지 불린다.
// 실제로 필요한 일은 "주소가 바뀌었는지" 확인하는 것뿐이므로, 짧은 시간 동안 몰려 들어오는
// 변경들은 한 번으로 합쳐서 처리한다.
const ROUTE_CHECK_DEBOUNCE_MS = 250;

function observeGmailNavigation() {
  let lastUrl = location.href;
  let debounceTimer = null;

  const checkRoute = () => {
    debounceTimer = null;
    if (stopObservingIfInvalid()) return;
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      handleRouteChange(url);
    }
  };

  observerRef = new MutationObserver(() => {
    if (debounceTimer) return;
    debounceTimer = setTimeout(checkRoute, ROUTE_CHECK_DEBOUNCE_MS);
  });
  observerRef.observe(document, { subtree: true, childList: true });

  // 주소 변경은 popstate/hashchange로도 알 수 있어서, 이쪽은 즉시 반응한다
  window.addEventListener("popstate", checkRoute);
  window.addEventListener("hashchange", checkRoute);
}

function handleRouteChange(url) {
  if (!isExtensionContextValid()) return;
  broadcastContext(url);

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

function broadcastContext(url) {
  let context = { service: "Gmail", title: "Inbox", desc: "" };
  if (url.includes("/#inbox/") || /#(inbox|all|sent)\/[^/]+$/.test(url)) {
    context.title = "Message View";
    context.desc = "Reading a specific email";
  } else {
    context.title = "Inbox List";
    context.desc = "Browsing emails";
  }
  
  try {
    chrome.runtime.sendMessage({
      type: "context.update",
      context: context
    }).catch(() => {});
  } catch (e) {}
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

// 콘텐츠 스크립트는 기본적으로 document_idle(=load 이후) 시점에 주입되므로, window.onload에 등록하면
// 이미 지나간 이벤트라 콜백이 절대 실행되지 않는다(배지/카드가 전혀 표시되지 않던 원인).
// 이미 로드가 끝난 경우엔 즉시 시작하고, 아직이면 load를 기다린다.
function startContentScript() {
  if (!isExtensionContextValid()) return;
  observeGmailNavigation();
  handleRouteChange(location.href);
}

if (document.readyState === "complete") {
  startContentScript();
} else {
  window.addEventListener("load", startContentScript, { once: true });
}
