// sidepanel/ui/bus.js
// 사이드패널 안에서 모듈끼리 통신하는 이벤트 버스.
//
// 서비스워커의 bg/core/events.js와 같은 구현을 쓰지만 인스턴스는 별개다.
// (사이드패널과 서비스워커는 서로 다른 실행 환경이라 모듈 인스턴스를 공유하지 않는다)
//
// 여기 쓰인 이유는 하나다: 서비스 타일 내비가 "무엇이 선택됐다"만 알리고,
// 그 다음에 무슨 화면을 그릴지는 모르게 하는 것. 그래야 워크스페이스를 고쳐도 내비가 안 깨진다.

import { createEventBus } from "../../shared/event_bus.js";

const { on, off, emit } = createEventBus("sidepanel");

/** 사용자가 상단 서비스 타일을 골랐다. payload: { serviceId } */
const SERVICE_SELECTED = "service.selected";

export { on, off, emit, SERVICE_SELECTED };
