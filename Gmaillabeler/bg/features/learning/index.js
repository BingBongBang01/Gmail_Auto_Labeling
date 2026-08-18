// bg/features/learning/index.js
// 정정 학습 기능의 등록부.
//
// 분류 엔진(bg/pipeline/classification.js)은 이 파일도, learning.js도 import 하지 않는다.
// 두 이벤트 구독만으로 연결된다. 그래서 background.js에서 이 기능의 import 한 줄을 지우면
// 학습만 사라지고 분류는 힌트 없이 그대로 동작한다.

import { on } from "../../core/events.js";
import { registerAction } from "../../core/message_router.js";
import { CLASSIFY_CORRECTION_HINT_REQUESTED, CLASSIFY_FLUSH_LEARNING } from "../../core/topics.js";
import { getAllCorrectionPatterns, getAllLabelHistory, getCorrectionPattern, saveCorrectionPattern } from "../../core/history_db.js";
import {
  applyLearnedCategoryDescription,
  buildCorrectionHintText,
  CORRECTION_PATTERN_THRESHOLD,
  flushDeferredCategoryLearning,
  getCorrectionExamples,
  markCorrectionHistoryScanned,
  setDeferInlineCategoryLearning,
  shouldScanCorrectionHistory,
} from "./learning.js";

// 분류가 프롬프트에 넣을 힌트를 요청했을 때.
// 힌트를 만드는 동안에는 인라인 자동 학습을 미뤄둔다(분류 예산 밖의 AI 호출을 막기 위해).
async function provideCorrectionHint({ labelCache, categories }) {
  try {
    const learningSetting = await new Promise((resolve) =>
      chrome.storage.local.get(["correctionLearningEnabled"], resolve)
    );
    if (learningSetting.correctionLearningEnabled === false) return null; // 기본값 켜짐
    if (!(await shouldScanCorrectionHistory())) return null;

    setDeferInlineCategoryLearning(true);
    try {
      const examples = await getCorrectionExamples(labelCache, categories);
      await markCorrectionHistoryScanned();
      if (!examples.length) return null;
      return { hint: buildCorrectionHintText(examples), examplesUsed: examples.length };
    } finally {
      setDeferInlineCategoryLearning(false);
    }
  } catch (e) {
    // 학습 예시 조회 실패는 치명적이지 않다. 분류는 힌트 없이 계속 진행되어야 한다.
    setDeferInlineCategoryLearning(false);
    return null;
  }
}

// 화면이 "무엇을 배웠는지" 보여주기 위한 조회. 여기서 판단은 하지 않고 있는 그대로 넘긴다.
// 예시 본문은 화면에 두 개까지만 쓰므로 잘라서 보낸다 - 저장소에는 12개까지 쌓여 있어서
// 패턴이 수십 종이면 메시지가 불필요하게 커진다.
async function getLearningOverview(limit) {
  const [patterns, history] = await Promise.all([getAllCorrectionPatterns(), getAllLabelHistory()]);
  const recent = [...history].sort((a, b) => (b.appliedAt || 0) - (a.appliedAt || 0)).slice(0, limit || 20);

  return {
    ok: true,
    threshold: CORRECTION_PATTERN_THRESHOLD,
    historyCount: history.length,
    patterns: patterns
      .map((p) => ({
        key: p.key,
        fromLabel: p.fromLabel,
        toLabel: p.toLabel,
        count: p.count || 0,
        totalCount: p.totalCount || p.count || 0,
        updatedAt: p.updatedAt || 0,
        examples: (p.examples || []).slice(-2).map((e) => ({
          subject: (e.subject || "").slice(0, 80),
          from: (e.from || "").slice(0, 60),
        })),
      }))
      .sort((a, b) => b.totalCount - a.totalCount || b.updatedAt - a.updatedAt),
    recent: recent.map((h) => ({
      subject: h.subject || "",
      from: h.from || "",
      labelName: h.labelName || "",
      appliedAt: h.appliedAt || 0,
    })),
  };
}

function register() {
  on(CLASSIFY_CORRECTION_HINT_REQUESTED, provideCorrectionHint);
  // 반환한 숫자가 분류의 requestsUsed 집계에 더해진다.
  on(CLASSIFY_FLUSH_LEARNING, () => flushDeferredCategoryLearning());

  registerAction("learning.overview", (request) => getLearningOverview(request.limit));

  // 사용자가 화면에서 "이 패턴을 기준에 반영"을 누른 경우.
  // 자동 학습은 같은 정정이 threshold번 쌓여야 돌지만, 사람이 직접 시키면 지금 바로 돌린다 -
  // 반복 횟수는 "이 정정이 우연이 아니다"를 추정하려는 장치일 뿐이고, 사용자는 그걸 이미 안다.
  registerAction("learning.applyPattern", async (request) => {
    const pattern = await getCorrectionPattern(String(request.key || ""));
    if (!pattern) return { ok: false, error: "그 정정 패턴을 찾을 수 없습니다." };

    const applied = await applyLearnedCategoryDescription(pattern);
    if (!applied) {
      return { ok: false, error: "분류 기준을 갱신하지 못했습니다. AI 키와 카테고리 설정을 확인하세요." };
    }

    // 자동 학습과 같은 뒤처리: 다음 반영까지 다시 세도록 count만 초기화한다(누적치는 남긴다).
    pattern.count = 0;
    await saveCorrectionPattern(pattern);
    return { ok: true, label: pattern.toLabel };
  });
}

export { register };
