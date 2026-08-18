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

// OCR은 스캔본에서만 쓰인다. 여기서 static import를 하면 텍스트 PDF를 번역할 때도
// tesseract 모듈을 매번 평가하게 되므로 필요할 때만 불러온다.
let ocrModulePromise = null;
function loadOcrModule() {
  if (!ocrModulePromise) {
    ocrModulePromise = Promise.all([
      import("../pdf/ocr/tesseract_ocr.js"),
      import("../pdf/ocr/image_utils.js"),
    ]).then(([ocr, image]) => ({ ...ocr, ...image }));
  }
  return ocrModulePromise;
}

// vendor 경로는 여기서만 만든다. pdf/ocr/* 는 chrome.* 를 모르는 순수 모듈로 남긴다.
function ocrPaths() {
  return {
    script: chrome.runtime.getURL("vendor/tesseract/tesseract.min.js"),
    worker: chrome.runtime.getURL("vendor/tesseract/worker.min.js"),
    core: chrome.runtime.getURL("vendor/tesseract/core/"),
    lang: chrome.runtime.getURL("vendor/tesseract/lang"),
  };
}

// 사용자가 "중지"를 누르면 서비스워커가 abort 명령을 보낸다.
// 100쪽짜리 스캔본의 OCR은 몇 분씩 걸리므로 쪽 경계마다 이 플래그를 본다.
let aborted = false;

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
// OCR
// ---------------------------------------------------------------------------
// 신뢰도가 이보다 낮은 문단은 버린다. 스캔 잡티를 글자로 읽은 것들이 여기서 걸리는데,
// 그런 문단을 남기면 번역 비용을 쓰면서 원본 그림 위에 헛소리 상자를 그린다.
const OCR_MIN_CONFIDENCE = 45;

// 문단 높이 대비 글자 크기. OCR 줄 상자는 글자의 위아래 여백까지 포함하므로 줄 높이보다 작다.
const OCR_FONT_RATIO = 0.72;

/**
 * 지정한 쪽들을 이미지로 렌더해 OCR한다.
 * OCR을 쓸 수 없으면(vendor 파일 없음 등) 예외를 위로 던지지 않고 error에 담아 돌려준다 -
 * 텍스트 레이어가 있는 나머지 쪽은 그대로 번역해야 하기 때문이다.
 */
async function runOcrPass(engine, doc, pages, ocrOptions) {
  const out = { segments: [], error: null, pagesDone: 0 };
  let ocr = null;
  let mod = null;

  try {
    mod = await loadOcrModule();
    const langs = mod.resolveOcrLangs(ocrOptions && ocrOptions.langs, ocrOptions && ocrOptions.sourceLang);
    ocr = new mod.OcrEngine(ocrPaths(), langs);
    await ocr.init();
  } catch (e) {
    out.error = String((e && e.message) || e);
    if (ocr) await ocr.destroy();
    return out;
  }

  try {
    for (let i = 0; i < pages.length; i += 1) {
      if (aborted) break;
      const pno = pages[i];

      const image = engine.renderPageImage(doc, pno, { dpi: (ocrOptions && ocrOptions.dpi) || 300 });
      const blob = new Blob([image.png], { type: "image/png" });

      const paragraphs = await ocr.recognize(blob);
      // 배경색 표본은 문단이 하나라도 있을 때만 필요하다. 디코드가 공짜가 아니다.
      const pixels = paragraphs.length ? await mod.decodeImageData(blob) : null;

      let sno = 0;
      for (const para of paragraphs) {
        if (para.confidence < OCR_MIN_CONFIDENCE) continue;
        if (!needsTranslation(para.text)) continue;

        const rect = engine.pixelBoxToPageRect(para.box, image);
        const bgColor = mod.sampleBackgroundColor(pixels, para.box);
        out.segments.push({
          segId: `p${String(pno + 1).padStart(3, "0")}_o${String(sno).padStart(3, "0")}`,
          page: pno,
          rect,
          text: para.text,
          // 줄 높이는 픽셀 단위다. 페이지 공간(pt)으로 되돌린 뒤 글자 크기로 환산한다.
          fontSize: Math.max(4, ((para.lineHeight || 0) / (image.zoom || 1)) * OCR_FONT_RATIO) || 11,
          color: mod.pickReadableTextColor(bgColor),
          bgColor,
          isOcr: true,
          ocrConfidence: Math.round(para.confidence),
          needsTranslation: true,
        });
        sno += 1;
      }

      out.pagesDone += 1;
      emit("ocrProgress", { page: i + 1, pageCount: pages.length, segCount: out.segments.length });
    }
  } catch (e) {
    // 한 쪽에서 터져도 그때까지 읽은 문단은 살린다.
    out.error = String((e && e.message) || e);
  } finally {
    await ocr.destroy();
  }

  return out;
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

  // OCR 쪽 진단용. vendor/tesseract 를 제대로 넣었는지, 페이지 래스터화와 인식이
  // 한 바퀴 도는지 확인한다. 표본 PDF는 텍스트 PDF지만 이미지로 렌더해 OCR하므로
  // 스캔본과 같은 경로를 탄다.
  async ocrSelftest({ langs, dpi } = {}) {
    aborted = false;
    const t0 = performance.now();
    const engine = await loadEngine();
    const mod = await loadOcrModule();

    const res = await fetch(chrome.runtime.getURL("pdf/testdata/sample_en.pdf"));
    const doc = engine.openPdf(new Uint8Array(await res.arrayBuffer()));

    try {
      const image = engine.renderPageImage(doc, 0, { dpi: Number(dpi) || 200 });
      const rasterMs = Math.round(performance.now() - t0);
      const blob = new Blob([image.png], { type: "image/png" });

      const resolved = mod.resolveOcrLangs(langs, "English");
      const ocr = new mod.OcrEngine(ocrPaths(), resolved);
      const t1 = performance.now();
      try {
        const paragraphs = await ocr.recognize(blob);
        const pixels = await mod.decodeImageData(blob);
        const first = paragraphs[0];
        return {
          ok: paragraphs.length > 0,
          error: paragraphs.length ? null : "인식된 문단이 없습니다. 언어 데이터(traineddata)를 확인하세요.",
          ocrLangs: resolved,
          rasterMs,
          ocrMs: Math.round(performance.now() - t1),
          imageSize: `${image.width}x${image.height}`,
          paragraphCount: paragraphs.length,
          meanConfidence: paragraphs.length
            ? Math.round(paragraphs.reduce((a, p) => a + p.confidence, 0) / paragraphs.length)
            : 0,
          backgroundSampled: !!pixels,
          firstTexts: paragraphs.slice(0, 3).map((p) => p.text),
          firstRect: first ? engine.pixelBoxToPageRect(first.box, image).map((n) => Math.round(n)) : null,
          firstBgColor: first && pixels ? mod.sampleBackgroundColor(pixels, first.box) : null,
        };
      } finally {
        await ocr.destroy();
      }
    } finally {
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

  // 중지 요청. 다음 쪽 경계에서 멈춘다.
  // 여기까지 뽑은 세그먼트는 버리지 않고 그대로 돌려준다 - 그래야 진행분이 파일로 남는다.
  async abort() {
    aborted = true;
    return { ok: true };
  },

  // 텍스트 세그먼트를 뽑는다. 바이트는 돌려주지 않고 텍스트만 돌려준다.
  //
  // 두 번 훑는다. 먼저 텍스트 레이어를 뽑으면서 어느 쪽이 스캔본인지 표시해두고,
  // 그 다음에 표시된 쪽만 이미지로 렌더해 OCR한다. 순서를 이렇게 두는 이유:
  // OCR은 쪽당 1~3초가 들기 때문에 "정말 필요한 쪽"의 목록이 확정된 뒤에 시작해야 한다.
  async extract({ docId, pageRange, ocr }) {
    aborted = false;
    const engine = await loadEngine();
    const { bytes } = await docBytes(docId);
    const doc = engine.openPdf(bytes);

    const ocrMode = (ocr && ocr.mode) || "off";
    const minChars = Number(ocr && ocr.minChars) || 0;

    try {
      const pageCount = doc.countPages();
      const filter = parsePageFilter(pageRange, pageCount);
      let segments = [];
      const scannedPages = [];

      // ---- 1차: 텍스트 레이어 ----
      for (let pno = 0; pno < pageCount; pno += 1) {
        if (filter && !filter.has(pno)) continue;
        if (aborted) break;

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

        // 글자가 거의 없는 쪽은 스캔된 이미지일 가능성이 높다.
        if (engine.countBlockChars(blocks) < minChars) scannedPages.push(pno);

        emit("extractProgress", { page: pno + 1, pageCount, segCount: segments.length });
      }

      // ---- 2차: OCR ----
      const ocrTargets =
        ocrMode === "off"
          ? []
          : ocrMode === "force"
            ? [...(filter || Array.from({ length: pageCount }, (_, i) => i))].sort((a, b) => a - b)
            : scannedPages;

      let ocrError = null;
      let ocrSegments = 0;
      let ocrDone = 0;

      if (ocrTargets.length && !aborted) {
        const targetSet = new Set(ocrTargets);
        // OCR한 쪽의 텍스트 레이어 세그먼트는 버린다. force 모드에서 원문이 두 번(텍스트 레이어 +
        // OCR) 들어가 같은 자리에 번역문이 겹쳐 찍히는 것을 막는다.
        segments = segments.filter((s) => !targetSet.has(s.page));

        const result = await runOcrPass(engine, doc, ocrTargets, ocr);
        segments = segments.concat(result.segments);
        ocrSegments = result.segments.length;
        ocrError = result.error;
        ocrDone = result.pagesDone;
      }

      // 페이지 순서 -> 페이지 안에서는 위에서 아래로. 배치 묶기와 직전 문맥이 문서 순서를 전제한다.
      segments.sort((a, b) => a.page - b.page || a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);

      return {
        ok: true,
        pageCount,
        segments,
        scannedPages: scannedPages.length,
        ocrPages: ocrDone,
        ocrSegments,
        ocrError,
        aborted,
      };
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
          // OCR 세그먼트는 원문이 이미지라 지울 수 없다. 이 색으로 상자를 덮고 그 위에 쓴다.
          bgColor: s.bgColor || null,
        });
      }

      const pages = [...byPage.keys()].sort((a, b) => a - b);
      let overflowCount = 0;
      let drawn = 0;
      let covered = 0;

      for (let i = 0; i < pages.length; i += 1) {
        const pno = pages[i];
        const stats = engine.rebuildPage(doc, pno, byPage.get(pno), fonts, {
          fontScale: options?.fontScale || 1,
        });
        overflowCount += stats.overflowCount;
        drawn += stats.drawn;
        covered += stats.covered || 0;
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
        covered,
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
