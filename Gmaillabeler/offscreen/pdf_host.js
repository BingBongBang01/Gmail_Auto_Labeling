// offscreen/pdf_host.js
// 오프스크린 문서 쪽 진입점. 서비스워커와는 롱리브드 Port 하나로만 이야기한다.
//
// sendMessage를 쓰지 않는 이유가 두 가지 있다.
//  1) sendMessage는 사이드패널/팝업/옵션 페이지까지 전부 브로드캐스트되어,
//     엔진끼리 주고받는 메시지가 매번 message_router의 "지원하지 않는 요청" 경로를 때린다.
//  2) Port는 onDisconnect로 크래시를 알려주고, 오가는 트래픽이 서비스워커의
//     유휴 타이머를 리셋해준다(긴 작업 중 워커가 죽는 걸 늦춰준다).
//
// 이 파일에는 PDF 로직이 없다. 실제 작업은 pdf/engine/* 이 하고 여기는 배선만 한다.

const PORT_NAME = "pdf-engine";

// mupdf.js는 top-level await로 WASM을 초기화하는 ESM이다(그래서 서비스워커에서 쓸 수 없다).
// 로드 실패(경로/CSP 문제)를 조용히 삼키지 않도록 동적 import로 감싸 오류를 그대로 올린다.
let enginePromise = null;
function loadEngine() {
  if (!enginePromise) {
    enginePromise = import("../pdf/engine/mupdf_engine.js");
  }
  return enginePromise;
}

const handlers = {
  // 엔진이 실제로 뜨는지, 추출/지우기/삽입/저장이 한 바퀴 도는지 확인하는 진단용 명령.
  // 이 한 가지가 통과하지 못하면 나머지 설계가 전부 무의미하므로 가장 먼저 만들었다.
  async selftest() {
    const t0 = performance.now();
    const engine = await loadEngine();
    const wasmMs = Math.round(performance.now() - t0);

    const res = await fetch(chrome.runtime.getURL("pdf/testdata/sample_en.pdf"));
    const bytes = new Uint8Array(await res.arrayBuffer());

    const doc = engine.openPdf(bytes);
    const fonts = new engine.FontRegistry(doc, engine.resolveCjkLang("한국어"));
    try {
      const pageCount = doc.countPages();
      const { bounds, blocks } = engine.extractPageBlocks(doc, 0);

      // 첫 페이지의 텍스트 블록을 모아 "원문 -> 고정 한국어 문자열"로 바꿔본다.
      // 번역 품질이 아니라 '지우고 그 자리에 한글을 심을 수 있는가'만 보는 단계다.
      const items = [];
      const preview = [];
      for (const block of blocks) {
        if (block.type !== "text" || !Array.isArray(block.lines)) continue;
        const text = block.lines.map(lineText).join(" ").replace(/\s+/g, " ").trim();
        if (!text) continue;
        preview.push(text);
        const rect = bboxToRect(block.bbox);
        if (!rect) continue;
        items.push({
          rect,
          text: "한글 삽입 확인 " + preview.length,
          fontSize: block.lines[0]?.font?.size || 11,
          color: "#c00000",
        });
      }

      const stats = engine.rebuildPage(doc, 0, items, fonts, { fontScale: 1 });
      const saved = engine.savePdf(doc);

      return {
        ok: true,
        wasmLoadMs: wasmMs,
        pageCount,
        pageBounds: bounds,
        blockCount: blocks.length,
        textItemCount: items.length,
        firstTexts: preview.slice(0, 3),
        redacted: stats.redacted,
        drawn: stats.drawn,
        overflowCount: stats.overflowCount,
        saveMode: saved.mode,
        outputBytes: saved.bytes.byteLength,
        // 눈으로 확인할 수 있게 결과 PDF를 통째로 돌려준다(진단용 경로에서만 한다.
        // 실제 작업 경로에서는 바이트를 메시지에 싣지 않고 IndexedDB를 거친다).
        outputBase64: bytesToBase64(saved.bytes),
      };
    } finally {
      fonts.destroy();
      doc.destroy();
    }
  },
};

// mupdf 버전에 따라 asJSON()의 줄 표현이 line.text 이기도 하고 문자 배열이기도 하다.
// 어느 쪽이든 동작하게 둔다(이 단계의 목적은 텍스트 품질이 아니라 배선 확인이다).
function lineText(line) {
  if (!line) return "";
  if (typeof line.text === "string") return line.text;
  const chars = line.chars || line.spans;
  if (Array.isArray(chars)) {
    return chars.map((c) => (typeof c === "string" ? c : c.c || c.text || "")).join("");
  }
  return "";
}

// bbox도 {x,y,w,h} 와 [x0,y0,x1,y1] 두 표현이 모두 관측된다.
function bboxToRect(bbox) {
  if (!bbox) return null;
  if (Array.isArray(bbox) && bbox.length === 4) return bbox.slice();
  if (typeof bbox.x === "number") return [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h];
  if (typeof bbox.x0 === "number") return [bbox.x0, bbox.y0, bbox.x1, bbox.y1];
  return null;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const port = chrome.runtime.connect({ name: PORT_NAME });

port.onMessage.addListener(async (msg) => {
  const { cmd, requestId } = msg || {};
  const handler = handlers[cmd];
  if (!handler) {
    port.postMessage({ requestId, ok: false, error: `알 수 없는 엔진 명령: ${cmd}` });
    return;
  }
  try {
    const result = await handler(msg);
    port.postMessage({ requestId, ...result });
  } catch (e) {
    port.postMessage({
      requestId,
      ok: false,
      error: String((e && e.message) || e),
      stack: String((e && e.stack) || ""),
    });
  }
});

port.postMessage({ evt: "ready" });
