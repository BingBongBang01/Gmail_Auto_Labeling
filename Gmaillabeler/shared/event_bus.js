// shared/event_bus.js
// 서비스워커와 UI 페이지가 함께 쓰는 이벤트 버스 구현.
//
// 확장의 각 실행 컨텍스트(서비스워커, 사이드패널, 대시보드, 옵션)는 서로 다른 JS 실행 환경이라
// 모듈 인스턴스를 공유하지 않는다. 그래서 "전역 버스 하나"가 아니라 컨텍스트마다 자기 버스를
// 만들어 쓰는 팩토리 형태로 둔다. 컨텍스트를 넘나드는 통신은 chrome.runtime 메시지가 담당한다.

/**
 * 독립된 이벤트 버스를 하나 만든다.
 *
 * 쓰는 이유는 한 가지다: 발행하는 쪽이 구독하는 쪽을 몰라도 되게 하는 것.
 * 그래야 구독자 파일을 통째로 지워도 발행자가 그대로 동작한다.
 */
function createEventBus(label = "events") {
  const subscribers = new Map(); // topic -> Set<handler>

  /** 토픽을 구독한다. 구독을 해제하는 함수를 돌려준다. */
  function on(topic, handler) {
    if (!subscribers.has(topic)) subscribers.set(topic, new Set());
    subscribers.get(topic).add(handler);
    return () => off(topic, handler);
  }

  function off(topic, handler) {
    subscribers.get(topic)?.delete(handler);
  }

  /**
   * 구독자를 모두 실행하고 반환값 배열을 돌려준다.
   *
   * 구독자 하나가 던진 예외는 삼키고 로그만 남긴다. 부가 기능(알림 전송 등)의 실패가
   * 그걸 발행한 본 작업을 실패시키면 안 되기 때문이다. 실패한 구독자 자리에는 undefined가 들어간다.
   */
  async function emit(topic, payload) {
    const handlers = subscribers.get(topic);
    if (!handlers || !handlers.size) return [];

    return await Promise.all(
      Array.from(handlers).map(async (handler) => {
        try {
          return await handler(payload);
        } catch (e) {
          console.error(`[${label}] "${topic}" 구독자 실행 실패:`, e);
          return undefined;
        }
      })
    );
  }

  return { on, off, emit };
}

export { createEventBus };
