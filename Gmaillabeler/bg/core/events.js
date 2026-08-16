// bg/core/events.js
// 서비스워커 안에서 기능(feature)끼리 통신하는 유일한 수단.
//
// 왜 필요한가: 예전에는 요약 기능이 Discord 전송 함수를 직접 불렀고, 분류 파이프라인이
// 학습 함수를 직접 불렀다. 그래서 Discord를 손대면 요약이 깨질 수 있었고, Discord를 빼면
// 요약 코드가 아예 동작하지 않았다.
//
// 규칙: features/ 아래의 모듈은 서로를 import 하지 않는다.
//   - "무슨 일이 일어났다"를 알릴 때  -> emit()
//   - 다른 기능의 일에 반응할 때      -> on()
// 발행자는 구독자가 있는지조차 모른다. 구독자 파일을 통째로 지워도 발행자는 그대로 돈다.
//
// emit()은 구독자들의 반환값 배열을 돌려준다. 분류가 학습에게 "이번에 AI 요청을 몇 번 썼냐"를
// 되돌려받아 집계에 합산하는 것 같은 경우에 필요하다.
//
// 토픽 이름은 bg/core/topics.js에 상수로 모아 둔다.

import { createEventBus } from "../../shared/event_bus.js";

const { on, off, emit } = createEventBus("bg/events");

export { on, off, emit };
