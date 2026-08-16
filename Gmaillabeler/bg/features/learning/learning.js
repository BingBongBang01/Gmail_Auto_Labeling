// bg/features/learning/learning.js
// ---------------- 수동 정정 학습 / 정정 패턴 누적 학습 ----------------
// 우리가 붙인 라벨을 사용자가 직접 바꾼 사례를 모아 프롬프트 힌트와 카테고리 설명에 반영한다.

// ---------------- 수동 정정 학습 ----------------
// 우리가 라벨을 붙일 때마다 "이 메일엔 이 라벨을 붙였다"를 기록해두고, 다음 실행 때 그중 일부를 다시 확인해서
// 사용자가 그 사이 직접 다른 라벨로 바꿔놓았으면("정정") 그 사례를 모아 프롬프트에 참고 예시로 넣는다.
// 히스토리 샘플 확인은 메일 상세를 샘플 수만큼 Gmail에 조회하므로, 매 실행마다 돌리면 낭비가 크다.
// 마지막 확인 후 이 간격이 지났을 때만 다시 확인한다.

import { isCancelled } from "../../core/cancellation.js";
import { getAllLabelHistory, getCorrectionPattern, saveCorrectionPattern, updateLabelHistoryEntry } from "../../core/history_db.js";
import { addLog } from "../../core/logger.js";
import { mapWithConcurrency } from "../../core/util.js";
import { getCategoryDefinitions, saveCategoryDefinitions } from "../../domain/categories.js";
import { GMAIL_FETCH_CONCURRENCY } from "../../domain/limits.js";
import { LANGUAGE_NAME_BY_LOCALE } from "../../domain/prompt_language.js";
import { callAiForJson, getActiveAiCredentials, hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { gmailFetch } from "../../platform/gmail_api.js";
import { i18nCurrentLocale } from "../../../i18n.js";

const CORRECTION_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function shouldScanCorrectionHistory() {
  const stored = await chrome.storage.local.get(["lastCorrectionScanAt"]);
  const last = Number(stored.lastCorrectionScanAt) || 0;
  return Date.now() - last >= CORRECTION_SCAN_INTERVAL_MS;
}

async function markCorrectionHistoryScanned() {
  await chrome.storage.local.set({ lastCorrectionScanAt: Date.now() });
}

const MAX_HISTORY_SAMPLE_PER_RUN = 40; // 매 실행마다 확인할 과거 기록 샘플 수 (너무 많으면 API 호출이 늘어남)
const MAX_CORRECTION_EXAMPLES = 15; // 프롬프트에 넣을 정정 사례 최대 개수

// 메일 하나의 현재 라벨 목록만 가볍게 조회 (본문/제목 없이 labelIds만)
async function getMessageLabelIdsLight(messageId) {
  const response = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=minimal`
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.labelIds || [];
}

// 최근 기록 중 일부를 다시 확인해서, 사용자가 직접 다른 라벨로 바꿔놓은 사례("정정")를 찾아 프롬프트용 예시로 만든다.
// 스크린샷에서 확인된 패턴처럼, 사용자가 Gmail에서 새 라벨만 "추가"하고 기존 라벨을 안 지운 경우(둘 다 붙어있음)도
// 정확히 잡아내기 위해, 메일에 붙은 "우리가 관리하는 카테고리" 라벨을 전부 모은 뒤 기존 기록과 다른 것을 정정으로 본다.
async function getCorrectionExamples(labelCache, categories) {
  const history = await getAllLabelHistory();
  if (!history.length) return [];

  const idToName = new Map();
  for (const [name, id] of labelCache.exact.entries()) idToName.set(id, name);

  const topLevelSet = new Set(categories.map((c) => c.split("/")[0]));

  // 최근 것 위주로 샘플링 (오래된 것보다 최근 정정이 더 의미 있음)
  const sample = [...history].sort((a, b) => b.appliedAt - a.appliedAt).slice(0, MAX_HISTORY_SAMPLE_PER_RUN);

  // 라벨 ID 조회(읽기 전용)는 병렬로 먼저 끝내고, 기록 갱신은 아래에서 순서대로 처리한다.
  const labelIdsBySampleIndex = await mapWithConcurrency(sample, GMAIL_FETCH_CONCURRENCY, async (entry) => {
    try {
      return await getMessageLabelIdsLight(entry.messageId);
    } catch (e) {
      return null; // 삭제된 메일 등 - 무시
    }
  });

  const examples = [];
  for (let i = 0; i < sample.length; i += 1) {
    const entry = sample[i];
    if (examples.length >= MAX_CORRECTION_EXAMPLES) break;
    const labelIds = labelIdsBySampleIndex[i];
    if (!labelIds) continue;

    // 이 메일에 지금 붙어있는 "우리가 관리하는 카테고리" 라벨을 전부 모은다(기존 라벨을 안 지우고 새 라벨만 추가한 경우 대비)
    const currentManagedLabels = [];
    for (const id of labelIds) {
      const name = idToName.get(id);
      if (name && topLevelSet.has(name.split("/")[0])) currentManagedLabels.push(name);
    }

    // 기록된 라벨 말고 "다른" 관리 라벨이 붙어있으면 그게 사용자가 직접 고른 라벨
    const correctedLabel = currentManagedLabels.find((name) => name !== entry.labelName);

    if (correctedLabel) {
      examples.push({ subject: entry.subject, from: entry.from, correctedLabel });
      await recordCorrectionPattern(entry.labelName, correctedLabel, entry.subject, entry.from);
      // 다음부터는 이미 "학습"한 걸로 보고, 우리 기록도 사용자가 정한 라벨로 갱신(같은 정정을 매번 다시 알려주지 않기 위함)
      await updateLabelHistoryEntry({ ...entry, labelName: correctedLabel, appliedAt: Date.now() });
    }
  }

  return examples;
}

function buildCorrectionHintText(examples) {
  if (!examples.length) return "";
  const lines = examples.map((e) => `- 보낸사람: ${e.from} / 제목: ${e.subject} → 사용자가 "${e.correctedLabel}"로 직접 수정함`);
  return (
    "\n\n참고: 사용자가 예전에 AI 분류 결과를 직접 아래처럼 고친 사례들이 있다. 비슷한 성격의 메일이 있으면 이 사례를 우선 참고해라:\n" +
    lines.join("\n")
  );
}

// ---------------- 정정 패턴 누적 학습 ----------------
// "A 라벨로 분류했는데 사용자가 B로 바꿈"이 반복되는 패턴을 모아뒀다가, 충분히 반복되면(신뢰도 확보)
// B 카테고리의 "분류 기준 설명"을 AI가 요약해서 자동으로 채워넣는다. 우연한 예외 한두 건으로는 반응하지 않는다.
// 분류 파이프라인 도중에는 예산 밖 Gemini 호출이 생기지 않도록 자동 학습을 미뤄둔다.
// 예전에는 분류 엔진이 이 변수를 직접 true/false로 뒤집었다. 이제는 이 파일 안에서만 만진다
// (ES 모듈에서는 다른 모듈의 바인딩에 대입할 수 없기도 하다).
let deferInlineCategoryLearning = false;
const deferredLearningPatternKeys = new Set();

// 이 플래그를 뒤집는 곳은 index.js의 힌트 제공 구독자 하나뿐이다.
function setDeferInlineCategoryLearning(value) {
  deferInlineCategoryLearning = !!value;
}

const CORRECTION_PATTERN_THRESHOLD = 5; // 같은 패턴이 이만큼 쌓이면 자동 학습을 실행
const MAX_PATTERN_EXAMPLES_STORED = 12;

async function recordCorrectionPattern(fromLabel, toLabel, subject, from) {
  const key = `${fromLabel}=>${toLabel}`;
  const existing = (await getCorrectionPattern(key)) || { key, fromLabel, toLabel, count: 0, examples: [] };
  existing.count += 1;
  existing.examples.push({ subject, from });
  if (existing.examples.length > MAX_PATTERN_EXAMPLES_STORED) {
    existing.examples.splice(0, existing.examples.length - MAX_PATTERN_EXAMPLES_STORED);
  }
  existing.updatedAt = Date.now();
  await saveCorrectionPattern(existing);

  if (existing.count >= CORRECTION_PATTERN_THRESHOLD) {
    if (deferInlineCategoryLearning) {
      // 분류 파이프라인 도중에는 Gemini를 추가로 호출하지 않는다.
      // (예산 계산 밖의 호출이라 그대로 두면 일일 할당량을 넘길 수 있음) -> 분류가 끝난 뒤 한 번에 처리
      deferredLearningPatternKeys.add(key);
      return;
    }
    await applyLearnedCategoryDescription(existing);
    // 학습 반영 후 카운트를 초기화(예시는 남겨둠) - 같은 패턴이 더 쌓이면 다시 한번 다듬을 수 있게
    existing.count = 0;
    await saveCorrectionPattern(existing);
  }
}

// 분류 도중에 밀어둔 자동 학습을 분류가 끝난 뒤 실행하고, 실제로 쓴 Gemini 요청 수를 돌려준다.
// 이렇게 해야 requestsUsed 집계에 빠짐없이 반영된다.
async function flushDeferredCategoryLearning() {
  const keys = [...deferredLearningPatternKeys];
  deferredLearningPatternKeys.clear();
  let requestsUsed = 0;

  for (const key of keys) {
    if (isCancelled()) break;
    const pattern = await getCorrectionPattern(key);
    if (!pattern || pattern.count < CORRECTION_PATTERN_THRESHOLD) continue;
    const applied = await applyLearnedCategoryDescription(pattern);
    if (applied) requestsUsed += 1;
    pattern.count = 0;
    await saveCorrectionPattern(pattern);
  }

  return requestsUsed;
}

// 반복된 정정 패턴을 근거로, toLabel 카테고리의 분류 기준 설명을 Gemini로 요약해서 자동 채워넣는다.
// Gemini 요청을 실제로 소비했으면 true를 돌려준다(호출자가 requestsUsed에 합산).
async function applyLearnedCategoryDescription(pattern) {
  let requestConsumed = false;
  try {
    const apiKeys = await getActiveAiCredentials();
    if (!apiKeys.length) return false;
    if (!(await hasUsableAiCredential())) return false;

    const exampleText = pattern.examples
      .slice(-CORRECTION_PATTERN_THRESHOLD)
      .map((e) => `- 보낸사람: ${e.from} / 제목: ${e.subject}`)
      .join("\n");

    const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
    const prompt =
      `사용자가 "${pattern.fromLabel}" 카테고리로 분류된 메일들을 반복적으로 "${pattern.toLabel}" 카테고리로 직접 옮겼다. ` +
      "아래는 그 메일 예시들이다. 이 예시들의 공통점을 근거로, 앞으로 비슷한 메일을 '" +
      pattern.toLabel +
      `' 카테고리로 분류하기 위한 아주 짧은 분류 기준 설명을 1문장으로 ${langName}로 작성해라(메일 하나만을 위한 설명이 아니라 일반화된 기준으로).\n\n` +
      exampleText;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { description: { type: "STRING" } },
          required: ["description"],
        },
      },
    };

    const result = await callAiForJson(requestBody);
    requestConsumed = true;
    const newNote = (result && result.description && result.description.trim()) || "";
    if (!newNote) return requestConsumed;

    const categoryDefs = await getCategoryDefinitions();
    const existingIdx = categoryDefs.findIndex((c) => c.name === pattern.toLabel);

    if (existingIdx >= 0) {
      const current = categoryDefs[existingIdx];
      const alreadyHasNote = (current.description || "").includes(newNote);
      if (!alreadyHasNote) {
        const combined = current.description ? `${current.description} / ${newNote}` : newNote;
        categoryDefs[existingIdx] = { ...current, description: combined, autoLearned: true };
      }
    } else {
      categoryDefs.push({ name: pattern.toLabel, description: newNote, autoLearned: true });
    }

    await saveCategoryDefinitions(categoryDefs);
    await addLog(
      `AI 자동 학습: "${pattern.fromLabel}" → "${pattern.toLabel}" 정정이 ${CORRECTION_PATTERN_THRESHOLD}건 이상 반복되어, "${pattern.toLabel}" 카테고리 분류 기준을 자동으로 업데이트함 ("${newNote}")`
    );
  } catch (e) {
    console.error("정정 패턴 자동 학습 실패:", e);
  }
  return requestConsumed;
}


export {
  CORRECTION_PATTERN_THRESHOLD,
  CORRECTION_SCAN_INTERVAL_MS,
  MAX_CORRECTION_EXAMPLES,
  MAX_HISTORY_SAMPLE_PER_RUN,
  MAX_PATTERN_EXAMPLES_STORED,
  applyLearnedCategoryDescription,
  buildCorrectionHintText,
  flushDeferredCategoryLearning,
  getCorrectionExamples,
  getMessageLabelIdsLight,
  markCorrectionHistoryScanned,
  recordCorrectionPattern,
  setDeferInlineCategoryLearning,
  shouldScanCorrectionHistory,
};
