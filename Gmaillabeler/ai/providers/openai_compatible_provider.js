// ai/providers/openai_compatible_provider.js
// DeepSeek, Groq, OpenRouter, Ollama, LM Studio 및 사용자 정의 OpenAI 호환 엔드포인트를 지원하는 공통 어댑터.

import { AIProviderBase } from "../ai_provider_base.js";
import { AIProviderRegistry } from "../ai_provider_registry.js";
import { AISchema } from "../ai_schema.js";

class OpenAICompatibleProvider extends AIProviderBase {
  constructor(id = "custom", name = "Custom OpenAI", defaultBaseUrl = "") {
    super();
    this.id = id;
    this.name = name;
    this.defaultBaseUrl = defaultBaseUrl || AIProviderRegistry.getDefaultBaseUrl(id);
  }

  resolveBaseUrl(baseUrlOverride) {
    let base = (baseUrlOverride || this.defaultBaseUrl || "").trim().replace(/\/+$/, "");
    if (!base) base = "https://api.openai.com/v1";
    if (!base.endsWith("/chat/completions")) {
      base = `${base}/chat/completions`;
    }
    return base;
  }

  async generateStructured(apiKey, model, prompt, schema, options = {}) {
    const url = this.resolveBaseUrl(options.baseUrl);

    const jsonSchema = AISchema.toJsonSchema(schema, { strict: false });
    const { schema: rootSchema, wrapped } = AISchema.wrapRoot(jsonSchema);

    const headers = {};
    if (apiKey && apiKey.trim()) {
      headers["Authorization"] = `Bearer ${apiKey.trim()}`;
    } else {
      // 로컬 Ollama 등은 키가 필요 없으나 빈 인증 헤더를 요구하는 프록시 대비
      headers["Authorization"] = `Bearer local`;
    }

    if (this.id === "openrouter") {
      headers["HTTP-Referer"] = "https://github.com/thk7410/Gmail_Auto_Labeling";
      headers["X-Title"] = "Gmail Auto Labeler";
    }

    const payload = {
      model: model || "default",
      messages: [
        {
          role: "system",
          content: "You are a structured data extractor. You MUST respond with a valid JSON object matching the requested schema. Return ONLY valid JSON, with no explanation, markdown code blocks, or extra text."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0,
      response_format: { type: "json_object" }
    };

    let data;
    try {
      data = await this.postJson(url, headers, payload);
    } catch (e) {
      // 일부 구형 엔드포인트/로컬 서버가 response_format을 400으로 거부하면 제거 후 1회 재시도
      if (e && (e.status === 400 || e.status === 422)) {
        delete payload.response_format;
        data = await this.postJson(url, headers, payload);
      } else {
        throw e;
      }
    }

    const choice = data.choices?.[0];
    if (!choice) {
      throw { status: 200, raw: null, isBadResponse: true };
    }

    if (choice.message?.refusal) {
      throw {
        status: 400,
        raw: { error: { message: `${this.name} refused the request: ${choice.message.refusal}` } },
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
      if (code === "insufficient_quota" || message.includes("quota") || message.includes("credit")) {
        return { type: "quota", retryable: false, message: this.extractMessage(error) };
      }
      return {
        type: "rate_limit",
        retryable: true,
        waitMs: error.retryAfterMs || 10000,
        message: this.extractMessage(error),
      };
    }

    if (status === 401 || code === "invalid_api_key" || message.includes("invalid api key") || message.includes("unauthorized")) {
      return { type: "invalid_key", retryable: false, message: this.extractMessage(error) };
    }

    if (status === 403) {
      return { type: "invalid_request", retryable: false, message: this.extractMessage(error) };
    }

    return this.normalizeCommonError(error);
  }
}

// 등록
AIProviderRegistry.register(new OpenAICompatibleProvider("deepseek", "DeepSeek", "https://api.deepseek.com/v1"));
AIProviderRegistry.register(new OpenAICompatibleProvider("groq", "Groq", "https://api.groq.com/openai/v1"));
AIProviderRegistry.register(new OpenAICompatibleProvider("openrouter", "OpenRouter", "https://openrouter.ai/api/v1"));
AIProviderRegistry.register(new OpenAICompatibleProvider("ollama", "Ollama (Local)", "http://localhost:11434/v1"));
AIProviderRegistry.register(new OpenAICompatibleProvider("custom", "Custom (OpenAI-Compatible)", "http://localhost:1234/v1"));

export { OpenAICompatibleProvider };
