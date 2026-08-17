// bg/features/pdf/engine_port.js
// 서비스워커 <-> 오프스크린 엔진 사이의 유일한 통로.
// 요청/응답을 requestId로 짝지어 await 가능한 형태로 바꿔준다.

import { ensureOffscreenDocument, closeOffscreenDocument } from "../../platform/offscreen.js";

const OFFSCREEN_URL = "offscreen/pdf_host.html";
const PORT_NAME = "pdf-engine";

let enginePort = null;
let readyResolve = null;
let readyPromise = null;
let nextRequestId = 1;
const pending = new Map(); // requestId -> {resolve, reject}

// 엔진이 보내오는 진행 이벤트(extractProgress/renderProgress) 구독자.
// 긴 추출/재구성 동안 화면이 멈춘 것처럼 보이지 않게 하려는 것이고,
// 이 트래픽 자체가 서비스워커의 유휴 타이머를 리셋해주는 효과도 있다.
const eventListeners = new Set();

function onEngineEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

// 오프스크린 쪽에서 connect해 오면 여기로 들어온다.
// 리스너 등록은 register() 안에서 동기적으로 이뤄져야 한다(background.js 헤더의 제약).
function attachEnginePort(port) {
  enginePort = port;

  port.onMessage.addListener((msg) => {
    if (!msg) return;

    if (msg.evt === "ready") {
      if (readyResolve) readyResolve();
      return;
    }

    if (msg.evt) {
      for (const fn of eventListeners) {
        try {
          fn(msg);
        } catch (e) {
          // 구독자 하나가 터져도 엔진 통신은 계속돼야 한다.
        }
      }
      return;
    }

    const entry = pending.get(msg.requestId);
    if (!entry) return;
    pending.delete(msg.requestId);
    if (msg.ok === false) {
      const err = new Error(msg.error || "엔진 오류");
      if (msg.stack) err.engineStack = msg.stack;
      entry.reject(err);
    } else {
      entry.resolve(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    enginePort = null;
    readyPromise = null;
    readyResolve = null;
    // 응답을 기다리던 요청은 영원히 안 온다. 조용히 매달아두면 작업이 멈춘 것처럼 보인다.
    const err = new Error("PDF 엔진(오프스크린 문서)이 종료되었습니다.");
    for (const [, entry] of pending) entry.reject(err);
    pending.clear();
  });
}

async function ensureEngine() {
  if (enginePort) return;

  if (!readyPromise) {
    readyPromise = new Promise((resolve) => {
      readyResolve = resolve;
    });
  }

  await ensureOffscreenDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS", "BLOBS"],
    justification:
      "PDF 문서를 파싱하고 재구성하기 위해 WebAssembly 엔진을 실행하고 결과를 Blob으로 다룬다. " +
      "서비스워커에는 DOM과 Worker가 없어 이 작업을 수행할 수 없다.",
  });

  // connect가 도착할 때까지 기다린다. 무한정 매달리지 않도록 상한을 둔다.
  await Promise.race([
    readyPromise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("PDF 엔진이 시간 안에 준비되지 않았습니다.")), 30000)
    ),
  ]);
}

async function callEngine(cmd, payload = {}) {
  await ensureEngine();
  const requestId = nextRequestId++;
  return await new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    try {
      enginePort.postMessage({ cmd, requestId, ...payload });
    } catch (e) {
      pending.delete(requestId);
      reject(e);
    }
  });
}

async function shutdownEngine() {
  await closeOffscreenDocument();
  enginePort = null;
  readyPromise = null;
  readyResolve = null;
}

export { attachEnginePort, callEngine, ensureEngine, shutdownEngine, onEngineEvent, PORT_NAME };
