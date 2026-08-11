// ai/providers/google_provider.js

// Gemini의 responseSchema는 이 저장소가 쓰는 대문자 타입 방언을 그대로 받으므로 변환하지 않는다.
class GoogleProvider extends AIProviderBase {
  id = "google";
  name = "Google Gemini";

  async generateStructured(apiKey, model, prompt, schema) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const data = await this.postJson(url, {}, {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
        temperature: 0,
      },
    });

    // 안전 필터에 막히면 candidates가 비어서 온다. 이건 키 문제가 아니라 요청 내용 문제이므로
    // 남은 키를 전부 태우지 않도록 따로 표시해서 올린다.
    if (data.promptFeedback?.blockReason) {
      throw {
        status: 400,
        isContentBlocked: true,
        raw: { error: { message: `Gemini blocked the prompt (${data.promptFeedback.blockReason})` } },
      };
    }

    const candidate = data.candidates?.[0];
    if (!candidate) {
      throw { status: 200, raw: null, isBadResponse: true };
    }
    if (candidate.finishReason && candidate.finishReason !== "STOP" && !candidate.content) {
      throw {
        status: 400,
        isContentBlocked: true,
        raw: { error: { message: `Gemini stopped early (${candidate.finishReason})` } },
      };
    }

    // MAX_TOKENS 등으로 parts가 여러 조각으로 나뉠 수 있어서 전부 이어붙인다.
    const text = (candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("");

    return this.parseModelJson(text);
  }

  normalizeError(error) {
    const message = this.extractMessage(error).toLowerCase();
    const status = error?.status;

    if (error?.isContentBlocked) {
      return { type: "invalid_request", retryable: false, message: this.extractMessage(error) };
    }

    // 키가 틀린 경우는 400/403 어느 쪽으로도 오므로 상태 코드보다 먼저 본문으로 판별한다.
    if (
      message.includes("api key not valid") ||
      message.includes("api_key_invalid") ||
      message.includes("api key expired")
    ) {
      return { type: "invalid_key", retryable: false, message: this.extractMessage(error) };
    }

    if (status === 429) {
      // Gemini는 일일 할당량 소진도 429(RESOURCE_EXHAUSTED)로 준다.
      // 분당 한도와 구분해야 하는데, 예전 코드는 429를 무조건 rate_limit으로 처리해서
      // 하루치가 끝났는데도 15초마다 계속 재시도했다.
      const isDaily =
        /per\s*day|per\s*minute\s*per\s*day|daily|requests_per_day|generate_requests_per_model_per_day/.test(
          message
        );
      if (isDaily) {
        return { type: "quota", retryable: false, resetsDaily: true, message: this.extractMessage(error) };
      }
      return {
        type: "rate_limit",
        retryable: true,
        waitMs: error.retryAfterMs || 15000,
        message: this.extractMessage(error),
      };
    }

    if (status === 401) {
      return { type: "invalid_key", retryable: false, message: this.extractMessage(error) };
    }

    if (status === 403) {
      // 키는 맞는데 프로젝트에서 Generative Language API가 꺼져 있는 경우 등.
      // 키를 영구 비활성화하면 사용자가 원인을 못 찾으므로 요청 오류로 둔다.
      return { type: "invalid_request", retryable: false, message: this.extractMessage(error) };
    }

    return this.normalizeCommonError(error);
  }
}

AIProviderRegistry.register(new GoogleProvider());
globalThis.GoogleProvider = GoogleProvider;
