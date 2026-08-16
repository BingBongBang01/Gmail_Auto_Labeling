// bg/core/message_router.js
// chrome.runtime.onMessage 리스너는 확장 전체에 딱 하나, 이 파일에만 있다.
//
// 예전에는 background.js 하나에 `if (request.action === "...")` 분기가 31개 늘어서 있었다.
// 기능 하나를 고치려면 그 긴 사슬 어디쯤에 자기 분기가 있는지 찾아야 했고, 실수로 앞 분기가
// 뒤 분기를 가로채는 버그(gmail_classify가 정의되지 않은 함수를 부르던 문제)도 거기서 나왔다.
//
// 이제 각 기능은 자기 파일에서 registerAction("내액션", handler)만 부른다.
// 기능을 지우면 그 액션도 함께 사라지고, 다른 액션은 영향을 받지 않는다.

const handlers = new Map();

/**
 * 액션 핸들러를 등록한다.
 *
 * handler(request, sender, respond) 의 반환값이 곧 응답이다.
 * 오래 걸리는 작업을 시작하되 UI에는 즉시 답해야 하는 경우(OAuth 로그인 창 등)에는
 * handler 안에서 respond(...)를 직접 부르면 된다. 그 뒤 반환값은 무시된다.
 */
function registerAction(action, handler) {
  if (handlers.has(action)) {
    console.warn(`[router] "${action}" 액션이 중복 등록되었습니다. 나중 등록이 이깁니다.`);
  }
  handlers.set(action, handler);
}

function hasAction(action) {
  return handlers.has(action);
}

function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const handler = request && handlers.get(request.action);
    if (!handler) {
      // 등록되지 않은 액션에도 반드시 응답한다. 응답 없이 리스너를 빠져나가면 포트가 닫히면서
      // 호출한 팝업은 "시작됐다"고 착각한 채 그냥 닫힌다.
      sendResponse({ ok: false, error: `지원하지 않는 요청입니다: ${request?.action}` });
      return false;
    }

    // 응답은 한 번만 보낸다. 핸들러가 직접 respond를 불렀는지 여기서 기억한다.
    let responded = false;
    const respond = (value) => {
      if (responded) return;
      responded = true;
      sendResponse(value);
    };

    Promise.resolve()
      .then(() => handler(request, sender, respond))
      .then((result) => respond(result))
      .catch((e) => respond({ ok: false, error: String(e?.message || e) }));

    return true; // 비동기 응답을 쓰겠다는 신호
  });
}

export { registerAction, hasAction, registerMessageRouter };
