// bg/features/pdf/index.js
// PDF 번역 기능의 등록부. bg/features/youtube/index.js 와 같은 모양이다.
//
// 현재 단계(M0): 엔진이 실제로 뜨고 추출/지우기/삽입/저장이 한 바퀴 도는지 확인하는
// 진단 액션만 등록한다. 번역 잡(registerJob)은 엔진이 검증된 뒤에 붙인다.

import { registerAction } from "../../core/message_router.js";
import { attachEnginePort, callEngine, shutdownEngine, PORT_NAME } from "./engine_port.js";

function register() {
  // 오프스크린 문서가 connect해 오는 지점. 반드시 동기 등록해야 한다.
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_NAME) attachEnginePort(port);
  });

  registerAction("pdf.selftest", async () => {
    try {
      const result = await callEngine("selftest");
      return result;
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), stack: String((e && e.engineStack) || "") };
    }
  });

  registerAction("pdf.shutdownEngine", async () => {
    await shutdownEngine();
    return { ok: true };
  });
}

export { register };
