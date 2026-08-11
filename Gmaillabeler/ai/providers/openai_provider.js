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

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch(e) {}
      throw { status: res.status, raw: errBody };
    }

    const data = await res.json();
    if (!data.choices || data.choices.length === 0) {
      throw new Error("No choices returned from OpenAI");
    }

    const text = data.choices[0].message.content;
    return JSON.parse(text);
  }

  normalizeError(error) {
    if (error.status === 429) {
      // Differentiate rate limit from quota based on raw error message if possible
      if (error.raw?.error?.message?.toLowerCase().includes("quota") || error.raw?.error?.code === "insufficient_quota") {
        return { type: "quota", retryable: false };
      }
      return { type: "rate_limit", waitMs: 10000, retryable: true };
    }
    if (error.status === 401 || error.status === 403) {
      return { type: "invalid_key", retryable: false };
    }
    if (error.status >= 500) {
      return { type: "server_error", retryable: true };
    }
    return { type: "unknown", retryable: false };
  }
}

if (typeof self !== "undefined") {
  self.OpenAIProvider = OpenAIProvider;
  if (self.AIProviderRegistry) {
    self.AIProviderRegistry.register(new OpenAIProvider());
  }
}
