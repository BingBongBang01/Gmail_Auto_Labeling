// ai/providers/anthropic_provider.js

const ANTHROPIC_RESULT_TOOL = "emit_structured_result";

class AnthropicProvider extends AIProviderBase {
  id = "anthropic";
  name = "Anthropic Claude";

  async generateStructured(apiKey, model, prompt, schema) {
    // 예전 구현은 "마크다운 없이 JSON만 출력해"라는 시스템 프롬프트에 의존하고
    // 응답에서 ``` 펜스를 문자열로 벗겨냈다. 스키마가 지켜질지는 확률에 맡기는 방식이었다.
    // Anthropic은 tool_choice로 특정 도구를 강제하면 input_schema에 맞는 JSON을 보장해주므로
    // 그쪽으로 바꾼다.
    const jsonSchema = AISchema.toJsonSchema(schema);
    const { schema: rootSchema, wrapped } = AISchema.wrapRoot(jsonSchema);

    const data = await this.postJson(
      "https://api.anthropic.com/v1/messages",
      {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        // 옵션 페이지의 연결 테스트는 chrome-extension:// Origin을 붙여서 요청한다.
        // 그 경우 Anthropic이 브라우저 직접 호출로 보고 막으므로 이 헤더가 필요하다.
        // 서비스워커에서는 없어도 되지만 붙여도 무해하다.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      {
        model,
        max_tokens: 8192,
        temperature: 0,
        tools: [
          {
            name: ANTHROPIC_RESULT_TOOL,
            description: "Return the structured result. Always call this tool exactly once.",
            input_schema: rootSchema,
          },
        ],
        tool_choice: { type: "tool", name: ANTHROPIC_RESULT_TOOL },
        messages: [{ role: "user", content: prompt }],
      }
    );

    // 출력이 max_tokens에서 잘리면 tool input이 불완전해진다. 조용히 통과시키면 안 된다.
    if (data.stop_reason === "max_tokens") {
      throw { status: 200, raw: null, isBadResponse: true };
    }

    // content 배열의 첫 블록이 항상 tool_use라는 보장이 없다(사고 과정 블록 등이 앞에 올 수 있다).
    const toolUse = (data.content || []).find(
      (block) => block.type === "tool_use" && block.name === ANTHROPIC_RESULT_TOOL
    );
    if (!toolUse || !toolUse.input) {
      throw { status: 200, raw: null, isBadResponse: true };
    }

    // tool input은 이미 파싱된 객체로 온다. 문자열 파싱이 필요 없다.
    return AISchema.unwrapRoot(toolUse.input, wrapped);
  }

  normalizeError(error) {
    const message = this.extractMessage(error).toLowerCase();
    const type = error?.raw?.error?.type;
    const status = error?.status;

    // 크레딧 소진은 429가 아니라 400 invalid_request_error로 온다.
    // 예전 코드는 OpenAI 코드인 insufficient_quota를 429 안에서 찾고 있어서 절대 안 걸렸다.
    if (message.includes("credit balance is too low") || message.includes("insufficient credit")) {
      return { type: "quota", retryable: false, message: this.extractMessage(error) };
    }

    if (status === 429 || type === "rate_limit_error") {
      return {
        type: "rate_limit",
        retryable: true,
        waitMs: error.retryAfterMs || 10000,
        message: this.extractMessage(error),
      };
    }

    if (status === 401 || type === "authentication_error") {
      return { type: "invalid_key", retryable: false, message: this.extractMessage(error) };
    }

    if (status === 403 || type === "permission_error") {
      return { type: "invalid_request", retryable: false, message: this.extractMessage(error) };
    }

    // 529 overloaded_error는 5xx가 아니라 잠시 뒤 재시도 대상이다.
    if (status === 529 || type === "overloaded_error") {
      return {
        type: "server_error",
        retryable: true,
        waitMs: error.retryAfterMs || 5000,
        message: this.extractMessage(error),
      };
    }

    return this.normalizeCommonError(error);
  }
}

AIProviderRegistry.register(new AnthropicProvider());
globalThis.AnthropicProvider = AnthropicProvider;
