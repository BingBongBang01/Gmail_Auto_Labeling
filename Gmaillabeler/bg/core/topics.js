// bg/core/topics.js
// 기능 사이에 오가는 이벤트 이름을 한 곳에 모은다.
//
// 토픽 이름은 발행자와 구독자가 공유하는 유일한 계약이다. 문자열을 양쪽에 직접 적으면
// 오타 하나로 구독이 조용히 끊기고 아무 오류도 나지 않는다. 그래서 상수로만 쓴다.
//
// 새 토픽을 추가할 때는 payload 모양도 여기 주석으로 함께 적는다.

/** 작업 실행 상태가 바뀌었다. payload: { running: boolean } */
const JOB_RUNNING_CHANGED = "job.runningChanged";

/**
 * 라벨 요약이 끝났다.
 * payload: { summaryReport, source: "auto" | "manual", labelName }
 * source가 "auto"인 경우만 자동 Discord 전송 대상이다(수동 요약은 대시보드가 직접 전송을 요청한다).
 */
const SUMMARY_COMPLETED = "summary.completed";

/**
 * 분류 엔진이 프롬프트에 넣을 "과거 정정 사례" 힌트를 요청한다.
 * payload: { labelCache, categories }
 * 구독자는 { hint: string, examplesUsed: number } 를 돌려주거나, 줄 게 없으면 null을 돌려준다.
 * 구독자가 아무도 없으면 힌트 없이 분류가 진행된다(학습 기능을 빼도 분류는 그대로 동작한다).
 */
const CLASSIFY_CORRECTION_HINT_REQUESTED = "classify.correctionHintRequested";

/**
 * 분류가 끝났다. 분류 도중 미뤄둔 학습이 있으면 지금 처리한다.
 * 구독자는 소비한 AI 요청 수(number)를 돌려주고, 분류는 그 값을 집계에 합산한다.
 * payload: {}
 */
const CLASSIFY_FLUSH_LEARNING = "classify.flushLearning";

export {
  JOB_RUNNING_CHANGED,
  SUMMARY_COMPLETED,
  CLASSIFY_CORRECTION_HINT_REQUESTED,
  CLASSIFY_FLUSH_LEARNING,
};
