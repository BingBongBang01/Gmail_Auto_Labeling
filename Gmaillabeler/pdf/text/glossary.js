// pdf/text/glossary.js
// 용어집 파싱과 프롬프트용 렌더링. 순수 문자열 처리라 chrome.* 도 저장소도 쓰지 않는다.
//
// 왜 표 편집기가 아니라 텍스트인가: 용어집은 보통 스프레드시트나 기존 문서에서 통째로
// 가져온다. 좁은 사이드패널에서 20쌍의 입력칸을 하나씩 채우게 하는 것보다,
// 붙여넣고 한 번에 고치는 편이 실제 작업 방식에 가깝다.
// 그래서 입력은 자유 텍스트로 받고, 무엇으로 읽혔는지를 화면에 즉시 보여준다.
//
// 받아들이는 줄 모양:
//   machine learning => 기계 학습        (=> 또는 ->)
//   throughput → 처리량                  (유니코드 화살표도)
//   API<TAB>API<TAB>번역하지 않음        (스프레드시트에서 붙여넣기)
//   API                                  (대상이 없으면 "번역하지 않음")
//   # 주석                               (무시)

const MAX_ENTRIES = 300;
const MAX_TERM_CHARS = 120;
const MAX_NOTE_CHARS = 120;

// 대상 자리에 이것이 적혀 있으면 "그대로 두라"는 뜻으로 본다.
const KEEP_TOKENS = new Set(["", "-", "=", "그대로", "원문유지", "유지", "keep", "asis", "as-is", "donottranslate"]);

const SEPARATOR = /\s*(?:=>|->|→|⇒)\s*/;

function isKeepToken(value) {
  return KEEP_TOKENS.has(String(value || "").trim().toLowerCase().replace(/\s+/g, ""));
}

/**
 * 자유 텍스트를 항목 배열로 읽는다.
 * @returns {{entries: Array<{source,target,note,keep}>, duplicates: string[], ignored: number}}
 */
function parseGlossaryText(text) {
  const seen = new Map(); // 소문자 원문 -> 항목 (나중 줄이 이긴다)
  const duplicates = [];
  let ignored = 0;

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    let source = "";
    let target = "";
    let note = "";

    if (line.includes("\t")) {
      // 스프레드시트에서 붙여넣은 줄. 탭이 열 구분자다.
      const cells = line.split("\t").map((c) => c.trim());
      [source, target = "", note = ""] = cells;
    } else if (SEPARATOR.test(line)) {
      const [left, ...rest] = line.split(SEPARATOR);
      source = (left || "").trim();
      const right = rest.join(" => ").trim();
      // 화살표 오른쪽 끝의 [비고]는 메모로 뗀다.
      const noteMatch = right.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
      if (noteMatch) {
        target = noteMatch[1].trim();
        note = noteMatch[2].trim();
      } else {
        target = right;
      }
    } else {
      // 대상 없이 낱말만 적은 줄 = 번역하지 않을 용어
      source = line;
    }

    source = source.slice(0, MAX_TERM_CHARS).trim();
    if (!source) {
      ignored += 1;
      continue;
    }

    const entry = {
      source,
      target: target.slice(0, MAX_TERM_CHARS).trim(),
      note: note.slice(0, MAX_NOTE_CHARS).trim(),
      keep: isKeepToken(target),
    };
    if (entry.keep) entry.target = "";

    const key = source.toLowerCase();
    if (seen.has(key)) duplicates.push(source);
    seen.set(key, entry);
  }

  const entries = [...seen.values()].slice(0, MAX_ENTRIES);
  return { entries, duplicates: [...new Set(duplicates)], ignored, truncated: seen.size > MAX_ENTRIES };
}

/** 항목 배열을 다시 편집용 텍스트로. "정리" 버튼이 쓴다(중복 제거·정렬된 결과를 되돌려준다). */
function formatGlossaryText(entries) {
  return (entries || [])
    .map((e) => {
      const target = e.keep ? "그대로" : e.target;
      const note = e.note ? ` [${e.note}]` : "";
      return `${e.source} => ${target}${note}`;
    })
    .join("\n");
}

/**
 * 프롬프트에 들어갈 용어집 본문.
 * 항목이 없으면 빈 문자열을 돌려준다 - buildUserPrompt가 그때 "(no glossary provided)"로 바꾼다.
 *
 * 형식을 짧게 유지하는 이유: 이 문자열은 배치마다 프롬프트에 통째로 다시 들어간다.
 * 300개 항목이면 배치 수만큼 곱해져 입력 토큰이 그만큼 늘어난다.
 */
function renderGlossaryForPrompt(entries) {
  const rows = (entries || []).filter((e) => e && e.source);
  if (!rows.length) return "";

  return rows
    .map((e) => {
      const target = e.keep || !e.target ? "(DO NOT TRANSLATE - keep the source term as-is)" : e.target;
      const note = e.note ? `  // ${e.note}` : "";
      return `${e.source} => ${target}${note}`;
    })
    .join("\n");
}

export {
  KEEP_TOKENS,
  MAX_ENTRIES,
  MAX_NOTE_CHARS,
  MAX_TERM_CHARS,
  formatGlossaryText,
  isKeepToken,
  parseGlossaryText,
  renderGlossaryForPrompt,
};
