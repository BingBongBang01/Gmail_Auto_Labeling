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
// 파일 바이트는 메시지에 싣지 못하므로(JSON 직렬화) IndexedDB를 공유 버퍼로 쓴다.

import { getPdfDoc, putPdfOutput, prunePdfOutputs, newId } from "../shared/pdf_db.js";

const PORT_NAME = "pdf-engine";

// mupdf.js는 top-level await로 WASM을 초기화하는 ESM이다(그래서 서비스워커에서 쓸 수 없다).
// 로드 실패(경로/CSP 문제)를 조용히 삼키지 않도록 동적 import로 감싸 오류를 그대로 올린다.
let enginePromise = null;
function loadEngine() {
  if (!enginePromise) enginePromise = import("../pdf/engine/mupdf_engine.js");
  return enginePromise;
}

let port = null;
function emit(evt, data) {
  try {
    port?.postMessage({ evt, ...data });
  } catch (e) {
    // 포트가 이미 끊겼으면 진행 보고는 포기한다. 작업 자체를 실패시키면 안 된다.
  }
}

// ---------------------------------------------------------------------------
// 공통 유틸
// ---------------------------------------------------------------------------

// mupdf 버전에 따라 asJSON()의 표현이 조금씩 다르다. 어느 쪽이든 받아준다.
function lineText(line) {
  if (!line) return "";
  if (typeof line.text === "string") return line.text;
  const chars = line.chars || line.spans;
  if (Array.isArray(chars)) {
    return chars.map((c) => (typeof c === "string" ? c : c.c || c.text || "")).join("");
  }
  return "";
}

function bboxToRect(bbox) {
  if (!bbox) return null;
  if (Array.isArray(bbox) && bbox.length === 4) return bbox.slice();
  if (typeof bbox.x === "number") return [bbox.x, bbox.y, bbox.x + bbox.w, bbox.y + bbox.h];
  if (typeof bbox.x0 === "number") return [bbox.x0, bbox.y0, bbox.x1, bbox.y1];
  return null;
}

// 번역할 가치가 있는 블록인지. 원본 extractor.py의 needs_translation과 같은 취지다.
// 숫자/기호만 있는 블록(쪽번호, 표의 수치 등)은 번역해봐야 원문과 같고 API만 쓴다.
function needsTranslation(text) {
  const t = String(text || "").trim();
  if (t.length < 2) return false;
  // 글자(letter)가 하나도 없으면 번역 대상이 아니다.
  return /[^\W\d_]/u.test(t);
}

function parsePageFilter(spec, pageCount) {
  const t = String(spec || "").trim();
  if (!t) return null; // 전체
  const pages = new Set();
  for (const part of t.split(",")) {
    const chunk = part.trim();
    if (!chunk) continue;
    const m = chunk.match(/^(\d+)\s*-\s*(\d*)$/);
    if (m) {
      const from = parseInt(m[1], 10);
      const to = m[2] ? parseInt(m[2], 10) : pageCount;
      for (let p = from; p <= Math.min(to, pageCount); p += 1) pages.add(p - 1);
    } else if (/^\d+$/.test(chunk)) {
      const p = parseInt(chunk, 10);
      if (p >= 1 && p <= pageCount) pages.add(p - 1);
    }
  }
  return pages.size ? pages : null;
}

async function docBytes(docId) {
  const rec = await getPdfDoc(docId);
  if (!rec) throw new Error("문서를 찾을 수 없습니다. 파일을 다시 선택해 주세요.");
  const buf = await rec.blob.arrayBuffer();
  return { bytes: new Uint8Array(buf), name: rec.name };
}

// ---------------------------------------------------------------------------
// 명령
// ---------------------------------------------------------------------------

const handlers = {
  // 엔진이 실제로 뜨는지, 추출/지우기/삽입/저장이 한 바퀴 도는지 확인하는 진단용 명령.
  async selftest() {
    const t0 = performance.now();
    const engine = await loadEngine();
    const wasmMs = Math.round(performance.now() - t0);

    const res = await fetch(chrome.runtime.getURL("pdf/testdata/sample_en.pdf"));
    const bytes = new Uint8Array(await res.arrayBuffer());

    const doc = engine.openPdf(bytes);
    const fonts = new engine.FontRegistry(doc, engine.resolveCjkLang("한국어"));
    try {
      const { bounds, blocks } = engine.extractPageBlocks(doc, 0);
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
        pageCount: doc.countPages(),
        pageBounds: bounds,
        blockCount: blocks.length,
        textItemCount: items.length,
        firstTexts: preview.slice(0, 3),
        redacted: stats.redacted,
        drawn: stats.drawn,
        overflowCount: stats.overflowCount,
        saveMode: saved.mode,
        outputBytes: saved.bytes.byteLength,
        outputBase64: bytesToBase64(saved.bytes),
      };
    } finally {
      fonts.destroy();
      doc.destroy();
    }
  },

  // 문서를 열어 페이지 수만 알려준다. 파일을 고른 직후 화면에 보여주기 위한 것.
  async probe({ docId }) {
    const engine = await loadEngine();
    const { bytes } = await docBytes(docId);
    const doc = engine.openPdf(bytes);
    try {
      return { ok: true, pageCount: doc.countPages() };
    } finally {
      doc.destroy();
    }
  },

  // 텍스트 세그먼트를 뽑는다. 바이트는 돌려주지 않고 텍스트만 돌려준다.
  async extract({ docId, pageRange }) {
    const engine = await loadEngine();
    const { bytes } = await docBytes(docId);
    const doc = engine.openPdf(bytes);

    try {
      const pageCount = doc.countPages();
      const filter = parsePageFilter(pageRange, pageCount);
      const segments = [];

      for (let pno = 0; pno < pageCount; pno += 1) {
        if (filter && !filter.has(pno)) continue;

        const { blocks } = engine.extractPageBlocks(doc, pno);
        let bno = 0;
        for (const block of blocks) {
          if (block.type !== "text" || !Array.isArray(block.lines)) continue;
          const text = block.lines.map(lineText).join("\n").replace(/[ \t]+/g, " ").trim();
          if (!text) continue;
          const rect = bboxToRect(block.bbox);
          if (!rect) continue;

          segments.push({
            segId: `p${String(pno + 1).padStart(3, "0")}_b${String(bno).padStart(3, "0")}`,
            page: pno,
            rect,
            text,
            fontSize: block.lines[0]?.font?.size || 11,
            color: "#000000",
            needsTranslation: needsTranslation(text),
          });
          bno += 1;
        }

        emit("extractProgress", { page: pno + 1, pageCount, segCount: segments.length });
      }

      return { ok: true, pageCount, segments };
    } finally {
      doc.destroy();
    }
  },

  // 번역문을 원본에 다시 심고 저장한다. 결과 바이트는 IndexedDB에 넣고 id만 돌려준다.
  async render({ docId, runId, segments, options }) {
    const engine = await loadEngine();
    const { bytes, name } = await docBytes(docId);
    const doc = engine.openPdf(bytes);
    const fonts = new engine.FontRegistry(doc, engine.resolveCjkLang(options?.targetLang));

    try {
      const byPage = new Map();
      for (const s of segments || []) {
        if (!s.translated || s.translated === s.text) continue;
        if (!byPage.has(s.page)) byPage.set(s.page, []);
        byPage.get(s.page).push({
          rect: s.rect,
          text: s.translated,
          fontSize: s.fontSize,
          color: s.color,
          isOcr: !!s.isOcr,
        });
      }

      const pages = [...byPage.keys()].sort((a, b) => a - b);
      let overflowCount = 0;
      let drawn = 0;

      for (let i = 0; i < pages.length; i += 1) {
        const pno = pages[i];
        const stats = engine.rebuildPage(doc, pno, byPage.get(pno), fonts, {
          fontScale: options?.fontScale || 1,
        });
        overflowCount += stats.overflowCount;
        drawn += stats.drawn;
        emit("renderProgress", { page: i + 1, pageCount: pages.length });
      }

      const saved = engine.savePdf(doc, { subsetFonts: true });
      const outId = newId("out");
      const outName = String(name || "document.pdf").replace(/\.pdf$/i, "") + "_translated.pdf";

      await putPdfOutput({
        outId,
        runId,
        name: outName,
        blob: new Blob([saved.bytes], { type: "application/pdf" }),
        createdAt: Date.now(),
      });
      await prunePdfOutputs(5);

      return {
        ok: true,
        outId,
        outName,
        pagesRendered: pages.length,
        drawn,
        overflowCount,
        saveMode: saved.mode,
        outputBytes: saved.bytes.byteLength,
      };
    } finally {
      fonts.destroy();
      doc.destroy();
    }
  },
};

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

port = chrome.runtime.connect({ name: PORT_NAME });

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
