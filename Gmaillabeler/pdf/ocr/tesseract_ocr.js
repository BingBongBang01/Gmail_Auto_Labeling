// pdf/ocr/tesseract_ocr.js
// tesseract.js 위에 얹은 얇은 층. chrome.* 를 쓰지 않는다 - 경로는 전부 인자로 받는다
// (mupdf_engine.js와 같은 이유: 오프스크린에서 쓰든 Worker로 옮기든 그대로 동작해야 한다).
//
// 왜 tesseract.js인가: 크롬 확장에서 쓸 수 있는 OCR은 (1) 로컬 WASM, (2) 클라우드 OCR API,
// (3) 멀티모달 LLM에 페이지 이미지를 던지는 것 셋이다. (2)는 키를 하나 더 요구하고,
// (3)은 쪽마다 이미지 토큰을 태워 스캔본 100쪽이면 번역 비용보다 OCR 비용이 커진다.
// 로컬 WASM은 공짜고 원문이 밖으로 나가지 않는다.
//
// 바이너리는 저장소에 넣지 않는다(vendor/README.md). 없으면 여기서 사람이 읽을 수 있는
// 오류를 던지고, 파이프라인은 그 오류를 로그에 남긴 뒤 텍스트 레이어만으로 계속 간다.

// 원문 언어 -> traineddata 이름. 사용자가 직접 적어 넣으면(ocrLangs) 그 값이 이깁니다.
const LANG_BY_SOURCE = {
  english: "eng",
  english_us: "eng",
  "한국어": "kor",
  korean: "kor",
  "日本語": "jpn",
  japanese: "jpn",
  "中文(简体)": "chi_sim",
  "中文(繁體)": "chi_tra",
  chinese: "chi_sim",
  "español": "spa",
  spanish: "spa",
  "français": "fra",
  french: "fra",
  deutsch: "deu",
  german: "deu",
};

// 자동 인식일 때. 스캔본은 대부분 라틴 문자 문서이고, 여러 언어를 함께 얹으면
// 정확도는 조금 오르지만 속도가 배로 떨어진다. 확실히 아는 경우에만 사용자가 지정한다.
const DEFAULT_LANGS = "eng";

function resolveOcrLangs(explicit, sourceLang) {
  const manual = String(explicit || "").trim();
  if (manual) return manual;
  const key = String(sourceLang || "").trim().toLowerCase();
  return LANG_BY_SOURCE[key] || LANG_BY_SOURCE[String(sourceLang || "").trim()] || DEFAULT_LANGS;
}

// ---------------------------------------------------------------------------
// 스크립트 로드
// ---------------------------------------------------------------------------
// tesseract.min.js는 UMD 번들이라 모듈이 아니다. <script> 태그로 먼저 시도한다:
// 동적 import()는 파일을 ES 모듈로 평가해 strict mode가 걸리는데, 번들이 sloppy mode를
// 전제한 코드(선언 없는 대입 등)를 담고 있으면 그때 터진다. 태그로 넣으면 sloppy mode다.
// document가 없는 컨텍스트(워커)에서는 import()로 물러난다.
function loadViaScriptTag(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`스크립트를 불러오지 못했습니다: ${url}`));
    document.head.appendChild(script);
  });
}

async function loadTesseract(scriptUrl) {
  if (globalThis.Tesseract) return globalThis.Tesseract;

  const errors = [];
  if (typeof document !== "undefined" && document.head) {
    try {
      await loadViaScriptTag(scriptUrl);
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }
  }
  if (!globalThis.Tesseract) {
    try {
      await import(/* @vite-ignore */ scriptUrl);
    } catch (e) {
      errors.push(String((e && e.message) || e));
    }
  }

  if (!globalThis.Tesseract) {
    throw new Error(
      `tesseract.js를 불러오지 못했습니다(${scriptUrl}). ` +
      `vendor/tesseract 에 파일을 넣었는지 확인하세요(vendor/README.md).` +
      (errors.length ? ` [${errors.join(" | ")}]` : "")
    );
  }
  return globalThis.Tesseract;
}

// ---------------------------------------------------------------------------
// 결과 정리
// ---------------------------------------------------------------------------
// tesseract.js는 버전마다 결과 모양이 달랐다(v4는 data.paragraphs/lines를 위에 두고,
// v5는 data.blocks 밑으로 넣었다). 어느 쪽이든 받아준다.

function unionBox(boxes) {
  const valid = boxes.filter(Boolean);
  if (!valid.length) return null;
  return {
    x0: Math.min(...valid.map((b) => b.x0)),
    y0: Math.min(...valid.map((b) => b.y0)),
    x1: Math.max(...valid.map((b) => b.x1)),
    y1: Math.max(...valid.map((b) => b.y1)),
  };
}

function normalizeBox(bbox) {
  if (!bbox) return null;
  if (typeof bbox.x0 === "number") return { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 };
  if (Array.isArray(bbox) && bbox.length === 4) return { x0: bbox[0], y0: bbox[1], x1: bbox[2], y1: bbox[3] };
  return null;
}

function lineTextOf(line) {
  if (!line) return "";
  if (typeof line.text === "string" && line.text.trim()) return line.text.trim();
  const words = line.words || [];
  return words
    .map((w) => (w && typeof w.text === "string" ? w.text : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
}

// 문단 안의 줄은 공백으로 잇는다. 원문의 줄바꿈 위치는 원문 글자 폭에서 나온 것이라
// 번역문에는 맞지 않는다(재구성 단계에서 상자 폭에 맞춰 다시 접는다).
// 라틴 문자에서 줄 끝 하이픈은 단어가 잘린 표시이므로 붙여준다.
function joinLines(lines) {
  let out = "";
  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    if (!out) {
      out = text;
      continue;
    }
    if (/[A-Za-z]-$/.test(out)) out = `${out.slice(0, -1)}${text}`;
    else out = `${out} ${text}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

function paragraphFrom(node) {
  const lines = Array.isArray(node.lines) ? node.lines : [];
  const lineTexts = lines.map(lineTextOf).filter(Boolean);
  const text = lineTexts.length ? joinLines(lineTexts) : String(node.text || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const box = normalizeBox(node.bbox) || unionBox(lines.map((l) => normalizeBox(l.bbox)));
  if (!box || box.x1 <= box.x0 || box.y1 <= box.y0) return null;

  const confidences = lines.map((l) => Number(l.confidence)).filter((n) => Number.isFinite(n));
  const confidence = Number.isFinite(Number(node.confidence))
    ? Number(node.confidence)
    : confidences.length
      ? confidences.reduce((a, b) => a + b, 0) / confidences.length
      : 0;

  // 글자 크기는 줄 높이에서 짐작한다. 줄 정보가 없으면 상자 높이를 줄 수로 나눈다.
  const lineBoxes = lines.map((l) => normalizeBox(l.bbox)).filter(Boolean);
  const lineHeights = lineBoxes.map((b) => b.y1 - b.y0).filter((h) => h > 0);
  const lineHeight = lineHeights.length
    ? lineHeights.slice().sort((a, b) => a - b)[lineHeights.length >> 1]
    : (box.y1 - box.y0) / Math.max(1, lineTexts.length);

  return { text, box, confidence, lineHeight, lineCount: Math.max(1, lineTexts.length) };
}

function collectParagraphs(data) {
  if (!data) return [];
  const out = [];
  const push = (node) => {
    const para = node && paragraphFrom(node);
    if (para) out.push(para);
  };

  if (Array.isArray(data.blocks) && data.blocks.length) {
    for (const block of data.blocks) {
      if (Array.isArray(block.paragraphs) && block.paragraphs.length) block.paragraphs.forEach(push);
      else push(block);
    }
    if (out.length) return out;
  }
  if (Array.isArray(data.paragraphs) && data.paragraphs.length) {
    data.paragraphs.forEach(push);
    if (out.length) return out;
  }
  if (Array.isArray(data.lines) && data.lines.length) {
    // 문단 정보가 없으면 줄을 그대로 세그먼트로 쓴다. 문맥은 짧아지지만 좌표는 정확하다.
    data.lines.forEach((line) => push({ lines: [line], bbox: line.bbox, confidence: line.confidence }));
    if (out.length) return out;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 엔진
// ---------------------------------------------------------------------------

class OcrEngine {
  /**
   * @param {object} paths  { script, worker, core, lang } 모두 절대 URL
   * @param {string} langs  "kor+eng" 처럼 tesseract 언어 표기
   */
  constructor(paths, langs) {
    this.paths = paths;
    this.langs = langs || DEFAULT_LANGS;
    this.worker = null;
  }

  async init() {
    if (this.worker) return;
    const Tesseract = await loadTesseract(this.paths.script);

    // workerBlobURL:false 가 중요하다. 기본값(true)은 워커 스크립트를 blob: URL로 감싸 띄우는데
    // 확장의 CSP(script-src 'self')가 blob: 워커를 막는다.
    // cacheMethod:"none" - traineddata를 이미 로컬에서 읽으므로 별도 IndexedDB 캐시를 둘 이유가 없고,
    // 그 캐시가 언어 파일을 바꿔 넣어도 옛것을 계속 쓰는 원인이 된다.
    this.worker = await Tesseract.createWorker(this.langs, 1 /* OEM_LSTM_ONLY: core의 lstm 빌드와 짝 */, {
      workerPath: this.paths.worker,
      corePath: this.paths.core,
      langPath: this.paths.lang,
      workerBlobURL: false,
      cacheMethod: "none",
      gzip: true,
    });

    // 공백을 살려두면 표/들여쓰기가 있는 스캔본에서 단어가 붙어버리는 일이 줄어든다.
    try {
      await this.worker.setParameters({ preserve_interword_spaces: "1" });
    } catch (e) {
      // 파라미터 이름은 버전에 따라 없을 수도 있다. 인식 자체를 막을 이유는 없다.
    }
  }

  /**
   * 페이지 이미지 하나를 읽는다.
   * @param {Blob} imageBlob PNG 블롭 (tesseract.js가 확실히 받는 형식)
   * @returns {Promise<Array>} 문단 목록. 좌표는 이미지 픽셀 기준이다.
   */
  async recognize(imageBlob) {
    await this.init();
    // 출력 종류를 명시한다. hocr/tsv는 쓰지 않는데 버전에 따라 기본으로 만들어 왕복 비용만 든다.
    const result = await this.worker.recognize(imageBlob, {}, { blocks: true, text: true });
    return collectParagraphs(result && result.data);
  }

  async destroy() {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    try {
      await worker.terminate();
    } catch (e) {
      // 이미 죽은 워커를 다시 죽이려 한 것뿐이다.
    }
  }
}

export { OcrEngine, resolveOcrLangs, collectParagraphs, joinLines, DEFAULT_LANGS, LANG_BY_SOURCE };
