// ai/providers/openai_provider.js

// Gemini 스타일 schema(대문자 type enum)를 표준 JSON Schema(소문자 type)로 재귀 변환한다.
// OpenAI strict json_schema 모드는 "additionalProperties: false"와 모든 속성이 required일 것을 요구한다.
function normalizeSchemaForOpenAI(schema) {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(normalizeSchemaForOpenAI);

  const out = { ...schema };
  if (typeof out.type === "string") out.type = out.type.toLowerCase();

  if (out.properties && typeof out.properties === "object") {
    const props = {};
    for (const key of Object.keys(out.properties)) {
      props[key] = normalizeSchemaForOpenAI(out.properties[key]);
    }
    out.properties = props;
    out.additionalProperties = false;
    out.required = Object.keys(props);
  }

  if (out.items) out.items = normalizeSchemaForOpenAI(out.items);

  return out;
}

class OpenAIProvider {
class OpenAIProvider extends AIProviderBase {
  id = "openai";
  name = "OpenAI";

  async generateStructured(apiKey, model, prompt, schema) {
    const url = "https://api.openai.com/v1/chat/completions";

    // 이 저장소의 공통 schema 계약은 Gemini 방식(대문자 "OBJECT"/"STRING"/"ARRAY" 등)을 쓰는데,
    // OpenAI strict json_schema는 표준 JSON Schema(소문자 "object"/"string"/"array")를 요구한다.
    // Router/호출부는 하나의 schema만 만들고, 이 provider가 자신에게 맞는 형태로 변환한다.
    const payload = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: normalizeSchemaForOpenAI(schema),
          strict: true
        }
      }
    };
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

if (typeof self !== "undefined") {
  self.OpenAIProvider = OpenAIProvider;
  if (self.AIProviderRegistry) {
    self.AIProviderRegistry.register(new OpenAIProvider());
    return this.normalizeCommonError(error);
  }
}

AIProviderRegistry.register(new OpenAIProvider());
globalThis.OpenAIProvider = OpenAIProvider;
