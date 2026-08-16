// bg/domain/limits.js
// 배치 크기와 1회 실행 상한. Gemini 무료 티어 한도를 기준으로 계산한 값이라 이름에 GEMINI가 남아 있다.
// 공급자별 실제 rate limit은 ai/ai_request_router.js의 AIPacer가 따로 지킨다.

const GEMINI_RPM_LIMIT = 15;
const GEMINI_TPM_LIMIT = 250000;
const GEMINI_RPD_LIMIT = 500;

const AVG_TOKENS_PER_EMAIL_ESTIMATE = 220; // Gmail 자동 snippet(약100자) 대신 실제 본문 최대 350자를 사용하므로 상향
const TOKEN_BUDGET_PER_REQUEST = Math.floor((GEMINI_TPM_LIMIT / GEMINI_RPM_LIMIT) * 0.5);
const MAX_BATCH_SIZE_FOR_ACCURACY = 40;
const BATCH_SIZE = Math.max(
  1,
  Math.min(MAX_BATCH_SIZE_FOR_ACCURACY, Math.floor(TOKEN_BUDGET_PER_REQUEST / AVG_TOKENS_PER_EMAIL_ESTIMATE))
);

const MIN_CALL_INTERVAL_MS = Math.ceil(60000 / GEMINI_RPM_LIMIT) + 200;
// (예전에 선언되어 있던 GEMINI_REQUEST_TIMEOUT_MS는 실제로 어떤 fetch에도 연결되어 있지 않던
// 죽은 상수였다. AI Provider들의 fetch() 호출에는 여전히 명시적 timeout/AbortController가 없어서,
// 네트워크가 응답을 영영 안 주는 경우 요청이 무기한 대기할 수 있다 - 알려진 제한 사항으로 남긴다.)
const MAX_BATCH_COUNT_PER_RUN = 50; // UI 상 설정 가능한 상한. 실제 안전 제한은 computeSafeEmailCount()가 그날 남은 RPD 추정치로 별도 수행
const MAX_EMAIL_COUNT_PER_RUN = BATCH_SIZE * MAX_BATCH_COUNT_PER_RUN;
const MAX_MESSAGES_PER_LABEL_FETCH = 1000; // 라벨 하나에서 메일을 조회할 때 한 번에 가져올 상한 (전체 재작업/라벨 정리용)


// Gmail 요청을 하나씩 순서대로 기다리면 메일 수백~수천 건 처리 시 왕복 지연이 그대로 누적된다.
// 사용자당 초당 할당량(250 quota units/s, messages.get = 5 units) 안에서 안전한 수준으로만 동시에 보낸다.
const GMAIL_FETCH_CONCURRENCY = 8;

// AI 분류 배치를 몇 개까지 겹쳐서 진행할지.
// RPM 상한은 AIRequestRouter/AIQuotaManager가 오류 발생 시 반응적으로 관리하므로, 이 값은
// "응답 대기 시간을 얼마나 겹쳐서 감출지"만 결정한다.
// 분당 요청 수 상한은 AIPacer(ai/ai_request_router.js)가 따로 지키므로, 이 값은
// "응답 대기 시간을 얼마나 겹쳐서 감출지"만 결정한다(값을 올려도 RPM을 더 쓰지는 않는다).
const GEMINI_BATCH_CONCURRENCY = 3;


export {
  AVG_TOKENS_PER_EMAIL_ESTIMATE,
  BATCH_SIZE,
  GEMINI_BATCH_CONCURRENCY,
  GEMINI_RPD_LIMIT,
  GEMINI_RPM_LIMIT,
  GEMINI_TPM_LIMIT,
  GMAIL_FETCH_CONCURRENCY,
  MAX_BATCH_COUNT_PER_RUN,
  MAX_BATCH_SIZE_FOR_ACCURACY,
  MAX_EMAIL_COUNT_PER_RUN,
  MAX_MESSAGES_PER_LABEL_FETCH,
  MIN_CALL_INTERVAL_MS,
  TOKEN_BUDGET_PER_REQUEST,
};
