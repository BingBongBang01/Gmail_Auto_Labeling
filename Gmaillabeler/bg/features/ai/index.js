// bg/features/ai/index.js
// AI 공급자 상태 조회와 자유 프롬프트 실행.
//
// 사이드패널의 'AI' 화면이 쓰는 기능이다. 예전 Gemini 타일 세 개(대화시작/프롬프트/대화기록)는
// 등록된 적 없는 작업을 가리키고 있어서 눌러도 아무 일이 없었고, 화면의 프롬프트 칩도
// 문구만 바꿀 뿐 실제로 AI를 부르지 않았다.
//
// 여기서 직접 ai/ 를 import 하지 않는다. 다른 기능과 마찬가지로 bg/platform/ai_gateway.js를
// 거쳐야 요청 간격(AIPacer) · 할당량 · 키 순회 · 페일오버가 한 벌로 적용된다.

import { registerAction } from "../../core/message_router.js";
import { callAiForJson, getQuotaUsage, hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { addLog } from "../../core/logger.js";

// 자유 프롬프트도 구조화 출력으로 받는다. 공급자마다 평문 응답 형식이 제각각인데
// (코드펜스, 설명 덧붙임 등) 스키마를 강제하면 세 공급자가 같은 모양으로 답한다.
const ANSWER_SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" } },
  required: ["answer"],
};

const MAX_PROMPT_CHARS = 4000;

function register() {
  // 사이드패널 AI 화면이 여는 즉시 부른다. 옵션 페이지를 열지 않고도
  // 어떤 키가 살아 있고 무엇이 쿨다운 중인지 보이게 하는 것이 목적이다.
  registerAction("ai.status", async () => {
    const usage = await getQuotaUsage();
    return { ok: true, ...usage };
  });

  registerAction("ai.runPrompt", async (request) => {
    const prompt = String(request.prompt || "").trim();
    if (!prompt) return { ok: false, error: "보낼 내용을 입력하세요." };
    if (prompt.length > MAX_PROMPT_CHARS) {
      return { ok: false, error: `프롬프트가 너무 깁니다(${prompt.length}자). ${MAX_PROMPT_CHARS}자 이내로 줄여주세요.` };
    }
    if (!(await hasUsableAiCredential())) {
      return { ok: false, error: "쓸 수 있는 AI 키가 없습니다. 설정 > AI 공급자에서 키를 추가하세요." };
    }

    const startedAt = Date.now();
    try {
      const parsed = await callAiForJson({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: ANSWER_SCHEMA },
      });
      const answer = (parsed && typeof parsed.answer === "string" && parsed.answer.trim()) || "";
      if (!answer) return { ok: false, error: "AI가 빈 응답을 돌려주었습니다. 다시 시도해 보세요." };

      await addLog(`[AI] 프롬프트 실행 (${prompt.length}자 → ${answer.length}자)`);
      return { ok: true, answer, elapsedMs: Date.now() - startedAt };
    } catch (e) {
      const message = String((e && e.message) || e);
      await addLog(`[AI] 프롬프트 실행 실패: ${message}`, "error");
      return { ok: false, error: message };
    }
  });
}

export { register };
