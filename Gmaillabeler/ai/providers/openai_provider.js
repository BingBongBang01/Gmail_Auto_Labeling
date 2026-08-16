// ai/providers/openai_provider.js

import { AIProviderBase } from "../ai_provider_base.js";
import { AIProviderRegistry } from "../ai_provider_registry.js";
import { AISchema } from "../ai_schema.js";

class OpenAIProvider extends AIProviderBase {
  id = "openai";
  name = "OpenAI";

  async generateStructured(apiKey, model, prompt, schema) {
    // 호출부는 Gemini 방언 스키마를 넘긴다. strict json_schema는 소문자 타입 +
    // 모든 object에 additionalProperties:false + 전체 required를 요구하고, 루트가 object여야 한다.
    // 예전 코드는 변환 없이 그대로 보내서 항상 400이 났다.
    const jsonSchema = AISchema.toJsonSchema(schema, { strict: true });
    const { schema: rootSchema, wrapped } = AISchema.wrapRoot(jsonSchema);

    const data = await this.postJson(
      "https://api.openai.com/v1/chat/completions",
      { Authorization: `Bearer ${apiKey}` },
      {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: {
          type: "json_schema",
          json_schema: { name: "structured_output", schema: rootSchema, strict: true },
        },
      }
    );

    const choice = data.choices?.[0];
    if (!choice) {
      throw { status: 200, raw: null, isBadResponse: true };
    }

    // 거부되면 content가 null이고 refusal에 이유가 담긴다.
    // JSON.parse(null)은 예외를 안 던지고 null을 돌려주므로, 그냥 두면 성공으로 위장된다.
    if (choice.message?.refusal) {
      throw {
        status: 400,
        raw: { error: { message: `OpenAI refused the request: ${choice.message.refusal}` } },
      };
    }

    const parsed = this.parseModelJson(choice.message?.content);
    return AISchema.unwrapRoot(parsed, wrapped);
  }

  normalizeError(error) {
    const message = this.extractMessage(error).toLowerCase();
    const code = error?.raw?.error?.code;
    const status = error?.status;

    if (status === 429) {
      // OpenAI는 크레딧 소진도 429로 주는데 code가 insufficient_quota로 구분된다.
      if (code === "insufficient_quota" || message.includes("exceeded your current quota")) {
        return { type: "quota", retryable: false, message: this.extractMessage(error) };
      }
      return {
        type: "rate_limit",
        retryable: true,
        waitMs: error.retryAfterMs || 10000,
        message: this.extractMessage(error),
      };
    }

    if (status === 401 || code === "invalid_api_key") {
      return { type: "invalid_key", retryable: false, message: this.extractMessage(error) };
    }

    if (status === 403) {
      // 조직/프로젝트 권한이나 지역 제한. 키 자체가 틀린 건 아니다.
      return { type: "invalid_request", retryable: false, message: this.extractMessage(error) };
    }

    return this.normalizeCommonError(error);
  }
}

AIProviderRegistry.register(new OpenAIProvider());
export { OpenAIProvider };
