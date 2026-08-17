// pdf/text/batching.js
// 세그먼트를 배치로 묶고 LLM에 보낼 프롬프트를 만든다.
// pdf_engine/placeholder/batching.py 와 providers_cloud.py의 응답 정합 로직을 옮긴 것.
// 순수 문자열 처리라 chrome.* 도 mupdf 도 쓰지 않는다.

// "JAMES:", "EMMA:" 같은 화자 라벨/짧은 표제어인지 판정.
//
// 원본이 기록한 실제 문제: 이런 짧은 라벨을 수십~수백자 문단과 같은 배치에 넣으면
// 모델이 둘을 혼동해 라벨에 옆 문단의 번역문을, 문단에 라벨 텍스트를 배정하는 일이
// 반복 관찰됐다(같은 문서를 다시 돌려도 같은 지점에서 재현 - 캐시 문제가 아니라
// 모델이 실제로 헷갈리는 것). 라벨류를 따로 묶어 혼동의 소지 자체를 없앤다.
function isLabelLike(text) {
  const t = String(text || "").trim();
  if (!t || t.includes("\n") || t.length > 30) return false;
  return t.endsWith(":") || t.endsWith("：");
}

function makeBatches(segments, maxChars, maxSegs) {
  const batches = [];
  let batch = [];
  let size = 0;
  let batchKind = null;

  for (const s of segments) {
    if (!s.needsTranslation) continue;
    const kind = isLabelLike(s.text) ? "label" : "para";
    if (batch.length && (size + s.text.length > maxChars || batch.length >= maxSegs || kind !== batchKind)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(s);
    size += s.text.length;
    batchKind = kind;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

function renderSegmentsBlock(batch) {
  return batch.map((s) => `SEGMENT_ID: ${s.segId}\nTEXT:\n${s.text}`).join("\n\n-----\n\n");
}

// 직전 번역 (원문, 번역) 쌍. 용어 일관성 유지용.
function renderPrevContext(pairs, limitChars = 1500) {
  if (!pairs || !pairs.length) return "(none)";
  const chunks = [];
  let total = 0;
  for (let i = pairs.length - 1; i >= 0; i -= 1) {
    const [src, dst] = pairs[i];
    const chunk = `SOURCE: ${src}\nTRANSLATION: ${dst}`;
    if (total + chunk.length > limitChars && chunks.length) break;
    chunks.push(chunk);
    total += chunk.length;
  }
  return chunks.reverse().join("\n---\n");
}

const AUTO_DETECT_TOKENS = new Set(["auto", "auto-detect", "autodetect", "자동", "자동 인식", "자동인식"]);

// '자동 인식' 선택을 모델이 이해할 자연어 지시문으로 바꾼다.
function resolveSourceLang(raw) {
  if (AUTO_DETECT_TOKENS.has(String(raw || "").trim().toLowerCase())) {
    return "the original language of the text (detect it automatically per segment)";
  }
  return raw;
}

function buildUserPrompt(template, options, glossaryText, prevContext, batch) {
  const repl = {
    "{{source_language}}": resolveSourceLang(options.sourceLang),
    "{{target_language}}": options.targetLang,
    "{{document_type}}": options.docType,
    "{{translation_style}}": options.style,
    "{{terminology_policy}}": options.terminologyPolicy,
    "{{glossary_data}}": glossaryText || "(no glossary provided)",
    "{{document_title}}": options.title || "(unknown)",
    "{{document_domain}}": options.domain || "general",
    "{{document_instructions}}": options.instructions || "(none)",
    "{{prev_context}}": prevContext,
    "{{text_segments}}": renderSegmentsBlock(batch),
  };
  let out = template;
  for (const [key, value] of Object.entries(repl)) {
    out = out.split(key).join(String(value ?? ""));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 응답 정합
// ---------------------------------------------------------------------------
// 스키마 강제(Anthropic tool_choice / OpenAI strict / Gemini responseSchema) 덕분에
// 원본의 4단 JSON 수리 코드는 필요 없다. 하지만 아래 둘은 여전히 필요하다.

// 대상 언어 문자가 하나도 없으면 모델이 원문을 그대로 돌려준 것으로 본다.
const SCRIPT_TESTS = {
  ko: /[가-힣ᄀ-ᇿ]/,
  ja: /[぀-ヿ㐀-鿿]/,
  zh: /[㐀-鿿]/,
};

function targetScriptTest(targetLang) {
  const t = String(targetLang || "");
  if (/한국|korean/i.test(t)) return SCRIPT_TESTS.ko;
  if (/일본|japanese/i.test(t)) return SCRIPT_TESTS.ja;
  if (/중국|chinese/i.test(t)) return SCRIPT_TESTS.zh;
  return null; // 라틴 계열 등은 판정하지 않는다
}

function isUntranslatedEcho(source, translated, targetLang) {
  const test = targetScriptTest(targetLang);
  if (!test) return false;
  if (!translated) return true;
  // 원문과 완전히 같고 대상 문자가 없으면 그대로 돌려준 것이다.
  if (translated.trim() === String(source || "").trim() && !test.test(translated)) return true;
  // 번역할 글자가 있는데도 대상 언어 문자가 전혀 없으면 의심스럽다.
  const hasLetters = /[^\W\d_]/u.test(source || "");
  return hasLetters && !test.test(translated);
}

// 라벨(짧은 표제)과 문단이 뒤바뀌지 않았는지 대략 확인한다.
function looksPlausible(source, translated) {
  if (!translated) return false;
  const srcIsLabel = isLabelLike(source);
  const dstIsLabel = isLabelLike(translated);
  if (srcIsLabel !== dstIsLabel) return false;
  // 번역문이 원문의 10배를 넘으면 모델이 설명을 붙인 것이다.
  if (source && translated.length > Math.max(80, source.length * 10)) return false;
  return true;
}

// 모델 응답을 배치 세그먼트에 매핑한다.
//
// 원본의 핵심 방어: 개수는 맞는데 ID가 어긋나면 ID를 버리고 "순서대로" 배정한다.
// 이게 없으면 번역문이 엉뚱한 bbox에 박힌다.
function reconcileTranslations(batch, translations, targetLang) {
  const list = Array.isArray(translations) ? translations : [];
  const byId = new Map();
  for (const item of list) {
    if (item && typeof item.segment_id === "string") byId.set(item.segment_id, item.translated_text);
  }

  const allIdsMatch = batch.every((s) => byId.has(s.segId));
  const results = [];

  for (let i = 0; i < batch.length; i += 1) {
    const seg = batch[i];
    let text = allIdsMatch ? byId.get(seg.segId) : undefined;

    if (text === undefined && list.length === batch.length) {
      // 개수가 맞으면 위치로 배정한다.
      text = list[i] && list[i].translated_text;
    }

    if (typeof text !== "string" || !text.trim()) {
      results.push({ seg, text: null, reason: "응답 누락" });
      continue;
    }
    if (isUntranslatedEcho(seg.text, text, targetLang)) {
      results.push({ seg, text: null, reason: "원문 반복(미번역)" });
      continue;
    }
    if (!looksPlausible(seg.text, text)) {
      results.push({ seg, text: null, reason: "라벨/문단 불일치" });
      continue;
    }
    results.push({ seg, text, reason: null });
  }

  return results;
}

export {
  isLabelLike,
  makeBatches,
  renderSegmentsBlock,
  renderPrevContext,
  resolveSourceLang,
  buildUserPrompt,
  reconcileTranslations,
  isUntranslatedEcho,
  looksPlausible,
};
