// bg/platform/ai_gateway.js
// ai/ 라우터 위에 얹은 얇은 층. 기능 코드는 AIRequestRouter를 직접 부르지 않고 여기를 거친다.

// API 키는 ai.credentials 한 곳에만 저장한다(공급자/모델/우선순위를 함께 들고 있는 형태).
// 예전 이 함수는 settings.ai.geminiApiKeys를 읽었는데, 그 경로는 v3 스키마에도 기본값에도 없고
// 어디서도 쓰지 않았다. 그래서 항상 빈 배열을 돌려줬고, 이 값을 "키가 있는지" 판단에 쓰던
// initGeminiAndGmailContext()가 사용자가 키를 몇 개 등록했든 무조건 errNoApiKey로 실패했다.
// 여러 키를 등록해두면 한 키의 일일 할당량이 다 찼을 때 라우터가 다음 키로 넘어간다.

import { AIKeyManager } from "../../ai/ai_key_manager.js";
import { AIQuotaManager } from "../../ai/ai_quota_manager.js";
import { AIRequestRouter } from "../../ai/ai_request_router.js";
import { GEMINI_RPM_LIMIT } from "../domain/limits.js";
import { SettingsStore } from "../../settings/settings_store.js";

async function getActiveAiCredentials() {
  return await AIKeyManager.getActiveCredentials();
}

// 사용 가능한 AI 키가 하나라도 있는지. 작업 시작 전 사전 점검용.
async function hasUsableAiCredential() {
  const creds = await getActiveAiCredentials();
  return creds.length > 0;
}


// Gmail API 호출 공용 래퍼. 401(토큰 만료/무효)이 오면 토큰을 강제로 새로 받아 한 번 재시도한다.
// 6000개 넘는 메일을 처리하는 등 오래 걸리는 작업 중간에 액세스 토큰(보통 1시간 유효)이 만료돼서
// 이후 모든 요청이 401로 실패하던 문제를 이 래퍼로 근본적으로 해결한다.


// ---------------- AI 호출 어댑터 ----------------
// 요청 간격 조절(분당 상한)과 할당량 추적은 ai/ai_request_router.js의 AIPacer와
// ai/ai_quota_manager.js가 담당한다. 예전에 이 자리에 있던 lastGeminiCallAt /
// currentCallIntervalMs / MAX_CALL_INTERVAL_MS / INTERVAL_*_MULTIPLIER /
// DAILY_QUOTA_TEXT_PATTERN은 라우터 도입 때 소비하는 함수가 삭제되면서
// 선언만 남은 채 아무도 읽지 않는 상태였다.

// Gemini 무료 티어의 키당 하루 요청 상한(추정치). 유료 티어는 훨씬 크지만,
// 확장 프로그램이 사용자의 결제 등급을 알 방법이 없어서 보수적인 무료 티어 값을 쓴다.
const GEMINI_FREE_RPD_PER_KEY = 1500;

// 실제 사용량을 보고한다. 예전에는 requestsToday를 0으로, exhausted를 false로 하드코딩해서
// 화면의 할당량 표시가 장식에 불과했고(요청 수를 세는 코드가 아예 없었다),
// 게다가 존재하지 않는 AIKeyManager.getKeysForProvider를 불러서 매번 TypeError로 죽었다.
async function getQuotaUsage() {
  await AIQuotaManager.load();
  const allCredentials = await AIKeyManager.getAllCredentials();
  const enabled = allCredentials.filter((c) => c && c.enabled && c.apiKey);

  const perKey = enabled.map((cred) => {
    const state = AIQuotaManager.getState(cred.id);
    return {
      id: cred.id,
      label: cred.name || cred.provider,
      provider: cred.provider,
      model: cred.model || "",
      requestsToday: AIQuotaManager.getRequestCount(cred.id),
      rpd: cred.provider === "google" ? GEMINI_FREE_RPD_PER_KEY : null,
      exhausted: !!state && state.status === "quota_exhausted",
      cooldownUntil: state ? state.until : null,
      cooldownReason: state ? state.status : null,
    };
  });

  // 일일 한도 개념이 뚜렷한 건 Gemini 무료 티어뿐이다.
  // Google 키가 없으면(OpenAI/Anthropic만 등록) 하루 상한을 추정하지 않는다(null).
  const googleKeyCount = perKey.filter((k) => k.provider === "google" && !k.exhausted).length;
  const rpd = googleKeyCount > 0 ? GEMINI_FREE_RPD_PER_KEY * googleKeyCount : null;

  const settings = await SettingsStore.getSettings();
  const rpmLimit = Number(settings.ai?.requestPolicy?.rpmLimit) > 0
    ? Number(settings.ai.requestPolicy.rpmLimit)
    : GEMINI_RPM_LIMIT;

  return {
    date: AIQuotaManager.pacificDateString(),
    requestsToday: AIQuotaManager.getTotalRequestCount(),
    rpd,
    rpm: rpmLimit,
    keyCount: enabled.length,
    usableKeyCount: perKey.filter((k) => !k.exhausted).length,
    perKey,
  };
}

async function callAiForJson(requestBody) {
  const prompt = requestBody.contents[0].parts[0].text;
  const schema = requestBody.generationConfig?.responseSchema;
  return await AIRequestRouter.generateStructured(prompt, schema);
}


export {
  GEMINI_FREE_RPD_PER_KEY,
  callAiForJson,
  getActiveAiCredentials,
  getQuotaUsage,
  hasUsableAiCredential,
};
