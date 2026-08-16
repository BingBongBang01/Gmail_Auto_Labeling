// bg/features/learning/index.js
// 정정 학습 기능의 등록부.
//
// 분류 엔진(bg/pipeline/classification.js)은 이 파일도, learning.js도 import 하지 않는다.
// 두 이벤트 구독만으로 연결된다. 그래서 background.js에서 이 기능의 import 한 줄을 지우면
// 학습만 사라지고 분류는 힌트 없이 그대로 동작한다.

import { on } from "../../core/events.js";
import { CLASSIFY_CORRECTION_HINT_REQUESTED, CLASSIFY_FLUSH_LEARNING } from "../../core/topics.js";
import {
  buildCorrectionHintText,
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

function register() {
  on(CLASSIFY_CORRECTION_HINT_REQUESTED, provideCorrectionHint);
  // 반환한 숫자가 분류의 requestsUsed 집계에 더해진다.
  on(CLASSIFY_FLUSH_LEARNING, () => flushDeferredCategoryLearning());
}

export { register };
