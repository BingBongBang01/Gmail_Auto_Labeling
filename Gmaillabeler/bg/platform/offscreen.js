// bg/platform/offscreen.js
// 오프스크린 문서 수명 관리. 확장 전체에 오프스크린 문서는 "동시에 하나"만 존재할 수 있어서,
// 기능별로 createDocument를 직접 부르면 두 번째 기능이 예외로 죽는다. 그래서 플랫폼 층에 둔다.
//
// 주의: hasDocument()가 false인 걸 두 호출이 동시에 보면 둘 다 createDocument를 부르고
// 두 번째가 거부된다. log_db.js가 연결 promise를 캐시하는 것과 같은 방식으로 생성 중인
// promise를 잡아둔다.

let creating = null;

async function hasOffscreenDocument() {
  if (chrome.offscreen && chrome.offscreen.hasDocument) {
    return await chrome.offscreen.hasDocument();
  }
  // 구버전 크롬 폴백: 실제로 떠 있는 오프스크린 컨텍스트를 조회한다.
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  return contexts.length > 0;
}

async function ensureOffscreenDocument({ url, reasons, justification }) {
  if (await hasOffscreenDocument()) return;

  if (creating) {
    await creating;
    return;
  }

  creating = chrome.offscreen.createDocument({ url, reasons, justification });
  try {
    await creating;
  } catch (e) {
    // 경합으로 이미 만들어진 경우는 성공으로 취급한다.
    if (!(await hasOffscreenDocument())) throw e;
  } finally {
    creating = null;
  }
}

async function closeOffscreenDocument() {
  if (!(await hasOffscreenDocument())) return;
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // 이미 닫혔으면 무시한다.
  }
}

export { ensureOffscreenDocument, closeOffscreenDocument, hasOffscreenDocument };
