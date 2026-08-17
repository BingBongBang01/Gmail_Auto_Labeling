// pdf/engine/mupdf_engine.js
// MuPDF WASM 위에 얹은 얇은 층. 여기에는 chrome.* 호출이 하나도 없다 -
// 오프스크린 문서에서 직접 쓰든 Web Worker 안으로 옮기든 그대로 동작해야 하기 때문이다.
//
// Python 원본(pdf_engine/postprocess/renderer.py)과의 가장 큰 차이:
// PyMuPDF의 insert_htmlbox()/insert_textbox()는 PyMuPDF가 파이썬으로 얹은 편의 계층이고,
// 그 밑의 mupdf Story는 WASM 빌드에 아예 바인딩되어 있지 않다(platform/wasm/lib/mupdf.c에
// "TODO: Story"로 남아 있다). mupdf.js의 PDFPage가 노출하는 것도 주석 조작과 applyRedactions뿐
// - 기존 페이지에 그리는 device가 없다. 그래서 번역문 삽입은 저수준으로 직접 구성한다.
//   폰트  -> doc.addFont()  (임베드 CID 폰트) 를 페이지 /Resources /Font 에 등록
//   본문  -> 콘텐츠 스트림(BT ... Tj ... ET)을 만들어 페이지 /Contents 배열에 덧붙임

import * as mupdf from "../../vendor/mupdf/mupdf.js";

// ---------------------------------------------------------------------------
// 좌표계
// ---------------------------------------------------------------------------
// toStructuredText가 주는 좌표는 "페이지 공간"이다: y가 아래로 증가하고, 원점은
// CropBox 좌상단이며, /Rotate가 이미 반영되어 있다.
// 반면 콘텐츠 스트림은 "PDF 사용자 공간"이다: y가 위로 증가하고 원점은 MediaBox 기준.
//
// 순진하게 `pageHeight - y`로 뒤집으면 /Rotate가 걸린 페이지나 CropBox 원점이 (0,0)이
// 아닌 페이지에서 글자가 엉뚱한 곳에 박힌다. page.getTransform()의 역행렬이 이 변환을
// 정확히 담고 있으므로 그것만 쓴다.
function pageToUserMatrix(page) {
  return mupdf.Matrix.invert(page.getTransform());
}

// mupdf.Rect.transform이 버전마다 있거나 없어서 직접 계산한다.
// 네 꼭짓점을 모두 옮긴 뒤 최소/최대를 잡는다 - /Rotate가 걸린 페이지에서는 행렬이 회전을
// 담고 있으므로 두 점만 옮기면 상자가 뒤집힌다.
function transformPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function transformRect(m, rect) {
  const corners = [
    transformPoint(m, rect[0], rect[1]),
    transformPoint(m, rect[2], rect[1]),
    transformPoint(m, rect[2], rect[3]),
    transformPoint(m, rect[0], rect[3]),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// ---------------------------------------------------------------------------
// 문서 열기
// ---------------------------------------------------------------------------
function openPdf(bytes) {
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  if (!(doc instanceof mupdf.PDFDocument)) {
    doc.destroy();
    throw new Error("PDF 문서가 아닙니다.");
  }
  if (doc.needsPassword()) {
    doc.destroy();
    throw new Error("암호가 걸린 PDF는 처리할 수 없습니다.");
  }
  return doc;
}

// ---------------------------------------------------------------------------
// 추출
// ---------------------------------------------------------------------------
// asJSON()은 bbox를 {x,y,w,h}로 주고 줄의 방향 벡터(dir)와 색을 담지 않는다.
// 원본 extractor.py의 세로쓰기 판정이 dir에 의존하므로 결국 walk()로 가야 하지만,
// 지금 단계(엔진 타당성 확인)에서는 블록 단위 텍스트와 bbox만 있으면 충분하다.
function extractPageBlocks(doc, pageNo) {
  const page = doc.loadPage(pageNo);
  try {
    const bounds = page.getBounds();
    const stext = page.toStructuredText("preserve-whitespace,preserve-spans");
    try {
      const raw = JSON.parse(stext.asJSON());
      return { bounds, blocks: raw.blocks || [] };
    } finally {
      stext.destroy();
    }
  } finally {
    page.destroy();
  }
}

// 한 쪽에서 뽑은 텍스트가 몇 글자인지 센다. 스캔본 판정용이다 -
// 스캔된 쪽은 보통 0글자이고, 쪽번호만 텍스트로 얹힌 쪽은 한두 글자가 나온다.
function countBlockChars(blocks) {
  let total = 0;
  for (const block of blocks || []) {
    if (block.type !== "text" || !Array.isArray(block.lines)) continue;
    for (const line of block.lines) {
      if (typeof line.text === "string") {
        total += line.text.trim().length;
        continue;
      }
      const chars = line.chars || line.spans;
      if (Array.isArray(chars)) total += chars.length;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// 페이지 래스터화 (OCR 입력)
// ---------------------------------------------------------------------------
// PNG 바이트로 돌려준다. tesseract.js가 확실히 받는 형식이고, 배경색 표본을 뽑을 때도
// 같은 바이트를 그대로 다시 디코드하면 되므로 픽스맵의 stride/컴포넌트 배치에 의존하지 않는다.
//
// 해상도는 상한을 둔다. 300DPI는 본문 10pt를 읽는 데 필요한 최소선이지만, A0 도면 같은
// 큰 페이지에서 그대로 곱하면 픽스맵 하나가 수백 MB가 되어 WASM 힙이 먼저 죽는다.
function renderPageImage(doc, pageNo, options = {}) {
  const dpi = Math.max(72, Number(options.dpi) || 300);
  const maxPixels = Number(options.maxPixels) || 40e6;

  const page = doc.loadPage(pageNo);
  try {
    const bounds = page.getBounds();
    const widthPt = Math.max(1, bounds[2] - bounds[0]);
    const heightPt = Math.max(1, bounds[3] - bounds[1]);

    let zoom = dpi / 72;
    if (widthPt * heightPt * zoom * zoom > maxPixels) {
      zoom = Math.sqrt(maxPixels / (widthPt * heightPt));
    }

    const pix = page.toPixmap(mupdf.Matrix.scale(zoom, zoom), mupdf.ColorSpace.DeviceRGB, false);
    try {
      return {
        png: pixmapToPng(pix),
        width: pix.getWidth(),
        height: pix.getHeight(),
        zoom,
        // 픽스맵 원점. 대부분 (0,0)이지만 CropBox 원점이 (0,0)이 아닌 문서에서는 어긋난다.
        originX: pix.getX ? pix.getX() : 0,
        originY: pix.getY ? pix.getY() : 0,
        bounds,
      };
    } finally {
      pix.destroy();
    }
  } finally {
    page.destroy();
  }
}

// asPNG()가 버전에 따라 Uint8Array를 주기도 하고 Buffer 객체를 주기도 한다.
// Buffer로 오면 asUint8Array()는 WASM 힙을 직접 가리키는 뷰라 반드시 복사해서 나가야 한다.
function pixmapToPng(pix) {
  const out = pix.asPNG();
  if (out instanceof Uint8Array) return out.slice();
  if (out && typeof out.asUint8Array === "function") {
    try {
      return out.asUint8Array().slice();
    } finally {
      if (typeof out.destroy === "function") out.destroy();
    }
  }
  throw new Error("페이지 이미지를 PNG로 만들지 못했습니다.");
}

// 픽셀 좌표 -> 페이지 공간 좌표. renderPageImage가 돌려준 값을 그대로 넘긴다.
function pixelBoxToPageRect(box, image) {
  const zoom = image.zoom || 1;
  return [
    (image.originX + box.x0) / zoom,
    (image.originY + box.y0) / zoom,
    (image.originX + box.x1) / zoom,
    (image.originY + box.y1) / zoom,
  ];
}

// ---------------------------------------------------------------------------
// 폰트
// ---------------------------------------------------------------------------
// 폰트 파일을 번들할 필요가 없다: mupdf.js의 Font 생성자는 이름이 "ko"/"ja"/
// "zh-Hans"/"zh-Hant"면 WASM에 내장된 CJK 폰트(DroidSansFallback)를 쓴다.
// PyMuPDF의 Font("china-s")와 같은 폰트다.
//
// 임베드 방식이 중요하다. addCJKFont()는 BaseFont를 "Dotum"/"Batang" 같은 이름으로만
// 적고 폰트를 임베드하지 않는다 - 이건 원본 renderer.py가 주석으로 남긴 바로 그 버그다
// (개발 PC에서는 보이지만 그 폰트가 없는 뷰어에서는 글자가 통째로 사라짐).
// addFont()는 pdf_add_cid_font로 가서 FontFile2를 실제로 임베드하고 ToUnicode까지
// 만들어준다(결과 PDF에서 텍스트 검색/복사도 된다). 반드시 addFont()를 쓴다.
const CJK_LANG_BY_TARGET = {
  한국어: "ko",
  Korean: "ko",
  일본어: "ja",
  Japanese: "ja",
  중국어: "zh-Hans",
  "중국어(간체)": "zh-Hans",
  "중국어(번체)": "zh-Hant",
  Chinese: "zh-Hans",
};

function resolveCjkLang(targetLang) {
  return CJK_LANG_BY_TARGET[targetLang] || "ko";
}

class FontRegistry {
  constructor(doc, lang) {
    this.doc = doc;
    this.lang = lang;
    this.resName = "GLT0";
    this._font = null;
    this._ref = null;
    this._glyphs = new Map(); // codepoint -> {gid, adv}
  }

  font() {
    if (!this._font) this._font = new mupdf.Font(this.lang);
    return this._font;
  }

  // 문서에 폰트를 임베드하고 그 참조를 돌려준다.
  // pdf_add_cid_font가 내부적으로 캐시하므로 여러 번 불러도 중복 임베드되지 않지만,
  // WASM 왕복을 줄이려고 여기서도 캐시한다.
  ref() {
    if (!this._ref) this._ref = this.doc.addFont(this.font());
    return this._ref;
  }

  // addFont()는 Identity-H 인코딩이라 Tj 피연산자가 UTF-16이 아니라 "글리프 ID"다.
  glyph(codePoint) {
    let entry = this._glyphs.get(codePoint);
    if (!entry) {
      const gid = this.font().encodeCharacter(codePoint);
      entry = { gid, adv: this.font().advanceGlyph(gid, 0) };
      this._glyphs.set(codePoint, entry);
    }
    return entry;
  }

  // 문자열 -> 글리프 ID 16진 문자열. 서로게이트 쌍을 올바르게 처리하려면
  // for...of로 코드포인트 단위 순회를 해야 한다.
  toGlyphHex(text) {
    let out = "";
    for (const ch of text) {
      out += this.glyph(ch.codePointAt(0)).gid.toString(16).padStart(4, "0");
    }
    return out;
  }

  // 폭은 em 단위로 나오므로 폰트 크기를 곱하면 실제 pt가 된다.
  measure(text, fontSize) {
    let width = 0;
    for (const ch of text) width += this.glyph(ch.codePointAt(0)).adv;
    return width * fontSize;
  }

  destroy() {
    if (this._font) {
      this._font.destroy();
      this._font = null;
    }
  }
}

// ---------------------------------------------------------------------------
// 콘텐츠 스트림
// ---------------------------------------------------------------------------
function pdfNum(n) {
  // PDF는 지수 표기(1e-7)를 허용하지 않는다. 고정소수점으로만 쓴다.
  const s = Number(n).toFixed(3);
  return s.replace(/\.?0+$/, "") || "0";
}

// 페이지 /Resources /Font 에 폰트 참조를 등록한다.
// Resources는 페이지에 없고 부모 노드에서 상속되는 경우가 있다.
function ensureFontResource(doc, pageObj, resName, fontRef) {
  let resources = pageObj.get("Resources");
  if (!resources || !resources.isDictionary()) {
    const inherited = pageObj.getInheritable("Resources");
    if (inherited && inherited.isDictionary()) {
      // 상속된 사전을 직접 고치면 같은 부모를 쓰는 형제 페이지까지 바뀐다.
      // 이 페이지 전용으로 얕게 복사한 뒤 그쪽에만 폰트를 추가한다.
      resources = doc.newDictionary();
      inherited.forEach((val, key) => resources.put(key, val));
    } else {
      resources = doc.newDictionary();
    }
    pageObj.put("Resources", resources);
  }

  let fonts = resources.get("Font");
  if (!fonts || !fonts.isDictionary()) {
    fonts = doc.newDictionary();
    resources.put("Font", fonts);
  }
  fonts.put(resName, fontRef);
}

// 만든 콘텐츠 스트림을 페이지에 덧붙인다.
//
// 핵심: /Contents 배열의 스트림들은 "이어붙여서 하나의 스트림"으로 해석된다.
// 그래서 기존 콘텐츠가 q/Q 짝을 안 맞추거나 클립 경로를 열어둔 채 끝나면 우리 스트림이
// 그 상태를 그대로 물려받는다(실제로 그런 PDF가 있다). 우리 것만 q/Q로 감싸는 걸로는
// 부족하고, 기존 콘텐츠 전체를 q ... Q로 감싸야 한다. PyMuPDF의 page.wrap_contents()와
// 같은 처리다.
function appendContentStream(doc, pageObj, body) {
  const arr = doc.newArray();
  arr.push(doc.addStream("q\n", {}));

  const old = pageObj.get("Contents");
  if (old && old.isArray()) old.forEach((o) => arr.push(o));
  else if (old && !old.isNull()) arr.push(old);

  arr.push(doc.addStream("\nQ\n", {}));
  arr.push(doc.addStream(body + "\n", {}));
  pageObj.put("Contents", arr);
}

// ---------------------------------------------------------------------------
// 줄바꿈 + 자동 축소  (PyMuPDF insert_textbox()의 대체물)
// ---------------------------------------------------------------------------
// 원본과 같은 상수를 쓴다: 줄간 1.08, 축소 계수 0.92, 최소 배율 0.45.
//
// 원본에는 있지만 여기엔 필요 없는 것: _clear_rect_text().
// 그건 mupdf Story가 "실패"를 반환하면서도 들어간 만큼은 이미 그려버려서 생긴 뒷정리
// 코드다. 우리는 레이아웃을 전부 계산한 뒤에야 그리기 시작하므로 부분 렌더링 자체가 없다.
const LINE_HEIGHT = 1.08;
const SHRINK_STEP = 0.92;
const MIN_SCALE = 0.45;
const ASCENDER = 0.88; // DroidSansFallback 기준. WASM 바인딩에 fz_font_ascender가 없어 상수로 둔다.

// CJK는 단어 사이에 공백이 없어서 공백 단위로만 접으면 한 줄이 통째로 넘친다.
// 공백이 있으면 단어 단위로, 없으면 글자 단위로 접는다.
function wrapText(fonts, text, maxWidth, fontSize) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    const hasSpaces = /\s/.test(paragraph);
    const units = hasSpaces ? paragraph.split(/(\s+)/) : Array.from(paragraph);
    let current = "";
    for (const unit of units) {
      const candidate = current + unit;
      if (current && fonts.measure(candidate.trimEnd(), fontSize) > maxWidth) {
        lines.push(current.trimEnd());
        current = hasSpaces ? unit.replace(/^\s+/, "") : unit;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) lines.push(current.trimEnd());
  }
  return lines;
}

function layoutInRect(fonts, text, rect, baseFontSize) {
  const boxWidth = rect[2] - rect[0];
  const boxHeight = rect[3] - rect[1];
  const minSize = Math.max(3.5, baseFontSize * MIN_SCALE);

  for (let size = baseFontSize; size >= minSize; size *= SHRINK_STEP) {
    const lines = wrapText(fonts, text, boxWidth, size);
    // 쪼갤 수 없는 토큰 하나가 상자보다 넓으면 이 크기는 실패다.
    if (lines.some((l) => fonts.measure(l, size) > boxWidth + 0.01)) continue;
    if (lines.length * size * LINE_HEIGHT <= boxHeight + 0.01) {
      return { lines, size, overflow: false };
    }
  }

  const lines = wrapText(fonts, text, boxWidth, minSize);
  return { lines, size: minSize, overflow: true };
}

// ---------------------------------------------------------------------------
// 페이지 재구성
// ---------------------------------------------------------------------------
// items: [{ rect: [x0,y0,x1,y1] (페이지 공간), text, fontSize, color, isOcr, bgColor }]
//
// isOcr 항목은 원문이 이미지 픽셀이라 redaction으로 지울 수 없다. 대신 bgColor로 상자를
// 덮고 그 위에 번역문을 그린다(덮지 않으면 원문 글자와 번역문이 겹쳐 둘 다 못 읽는다).
function rebuildPage(doc, pageNo, items, fonts, options = {}) {
  const page = doc.loadPage(pageNo);
  try {
    // 1) 원문 지우기.
    //    텍스트만 지우고 이미지/벡터 그래픽은 보존한다(원본 그림·배경을 살리기 위한
    //    원본 파이프라인의 정책). 주석 rect는 mupdf가 페이지 변환을 알아서 처리하므로
    //    페이지 공간 좌표를 그대로 넘긴다.
    let redacted = 0;
    for (const item of items) {
      if (item.isOcr) continue; // OCR 세그먼트는 지울 텍스트 레이어 자체가 없다
      const annot = page.createAnnotation("Redact");
      annot.setRect(item.rect);
      redacted += 1;
    }
    if (redacted > 0) {
      page.applyRedactions(
        false,
        mupdf.PDFPage.REDACT_IMAGE_NONE,
        mupdf.PDFPage.REDACT_LINE_ART_NONE,
        mupdf.PDFPage.REDACT_TEXT_REMOVE
      );
    }

    // 2) 번역문 그리기.
    //    applyRedactions()가 페이지 콘텐츠 스트림을 새로 쓰므로 반드시 그 뒤에 해야 한다.
    //    순서를 바꾸면 방금 넣은 번역문이 redaction에 같이 지워진다.
    const pageObj = page.getObject();
    const toUser = pageToUserMatrix(page);
    // 덮기(사각형 채우기)를 전부 먼저 하고 글쓰기를 나중에 한다. 항목별로 번갈아 넣으면
    // 상자가 겹치는 경우 뒤 항목의 배경이 앞 항목의 번역문을 지운다.
    const fillOps = [];
    const ops = [];
    let overflowCount = 0;
    let drawn = 0;
    let covered = 0;

    for (const item of items) {
      const text = String(item.text || "").trim();
      if (!text) continue;

      const baseSize = (item.fontSize || 10) * (options.fontScale || 1);
      const { lines, size, overflow } = layoutInRect(fonts, text, item.rect, baseSize);
      if (overflow) overflowCount += 1;

      if (item.isOcr && item.bgColor) {
        // OCR 상자는 글자에 딱 붙어 있다. 조금 넓혀 덮지 않으면 원문 글자의 위아래 끝이 남는다.
        const pad = Math.max(1, size * 0.18);
        const box = [item.rect[0] - pad, item.rect[1] - pad, item.rect[2] + pad, item.rect[3] + pad];
        const user = transformRect(toUser, box);
        const [br, bg, bb] = hexToRgb01(item.bgColor);
        fillOps.push(
          `${pdfNum(br)} ${pdfNum(bg)} ${pdfNum(bb)} rg`,
          `${pdfNum(user[0])} ${pdfNum(user[1])} ${pdfNum(user[2] - user[0])} ${pdfNum(user[3] - user[1])} re`,
          "f"
        );
        covered += 1;
      }

      const [r, g, b] = hexToRgb01(item.color || "#000000");
      ops.push("BT");
      // 폰트 크기는 Tm에 접어 넣으므로 Tf 크기는 1로 둔다.
      ops.push(`/${fonts.resName} 1 Tf`);
      ops.push(`${pdfNum(r)} ${pdfNum(g)} ${pdfNum(b)} rg`);

      lines.forEach((line, idx) => {
        if (!line) return;
        // 페이지 공간에서의 베이스라인 위치
        const px = item.rect[0];
        const py = item.rect[1] + size * ASCENDER + idx * size * LINE_HEIGHT;
        // 글리프 공간 -> 페이지 공간. d가 음수인 건 글리프 외곽선이 y-up인데
        // 페이지 공간은 y-down이기 때문이다.
        const glyphToPage = [size, 0, 0, -size, px, py];
        const tm = mupdf.Matrix.concat(glyphToPage, toUser);
        ops.push(`${tm.map(pdfNum).join(" ")} Tm`);
        ops.push(`<${fonts.toGlyphHex(line)}> Tj`);
      });

      ops.push("ET");
      drawn += 1;
    }

    if (ops.length > 0) {
      ensureFontResource(doc, pageObj, fonts.resName, fonts.ref());
      // 채우기는 그래픽 상태(색)를 건드리므로 q/Q로 감싸 뒤따르는 텍스트에 새지 않게 한다.
      const body = fillOps.length ? `q\n${fillOps.join("\n")}\nQ\n${ops.join("\n")}` : ops.join("\n");
      appendContentStream(doc, pageObj, body);
    }

    return { redacted, drawn, overflowCount, covered };
  } finally {
    page.destroy();
  }
}

function hexToRgb01(hex) {
  const h = String(hex).replace("#", "");
  if (h.length !== 6) return [0, 0, 0];
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------
// 원본은 "원본 파일을 복사해 대상 페이지만 고치고 증분 저장"한다. 전체 재작성이
// 비표준 xref를 가진 큰 PDF를 깨뜨린 이력이 있어서다.
// mupdf의 증분 저장은 원본 바이트를 먼저 통째로 복사한 뒤 갱신분을 덧붙이므로
// 반환되는 버퍼 자체가 완전한 문서다 - 같은 전략이 그대로 성립한다.
// 다만 복구된(repaired) 문서에는 증분 저장을 쓸 수 없어 전체 저장으로 물러난다.
// 폰트 서브셋은 사실상 필수다. 내장 CJK 폰트(DroidSansFallback)는 통째로 임베드하면
// 3.9MB이고, 실제로 3KB짜리 표본 PDF가 3.57MB로 부푸는 것을 확인했다.
// subsetFonts()를 거치면 실제 쓴 글자만 남아 13.6KB가 된다(측정값).
//
// 다만 subsetFonts()는 기존 폰트 객체를 다시 쓰기 때문에 증분 저장과 충돌한다
// (갱신분이 오히려 커진다). 둘 중 하나만 고를 수 있어서 기본값을 서브셋으로 둔다.
function savePdf(doc, options = {}) {
  const subset = options.subsetFonts !== false;

  if (subset) {
    doc.subsetFonts();
    const buf = doc.saveToBuffer("compress");
    try {
      return { bytes: buf.asUint8Array().slice(), mode: "subset+compress" };
    } finally {
      buf.destroy();
    }
  }

  const canIncremental = doc.canBeSavedIncrementally() && !doc.wasRepaired();
  const mode = canIncremental ? "incremental" : "";
  const buf = doc.saveToBuffer(mode);
  try {
    // asUint8Array()는 WASM 힙을 직접 가리키는 뷰다. 이후 어떤 할당이든 힙을 늘리면
    // 이 뷰는 detach된다. 반드시 즉시 복사한다.
    return { bytes: buf.asUint8Array().slice(), mode: mode || "full" };
  } finally {
    buf.destroy();
  }
}

export {
  openPdf,
  extractPageBlocks,
  countBlockChars,
  renderPageImage,
  pixelBoxToPageRect,
  rebuildPage,
  savePdf,
  FontRegistry,
  resolveCjkLang,
  pageToUserMatrix,
  transformRect,
  layoutInRect,
  wrapText,
  hexToRgb01,
  pdfNum,
};
