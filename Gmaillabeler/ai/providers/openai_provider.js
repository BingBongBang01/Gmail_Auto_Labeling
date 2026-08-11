// ai/providers/openai_provider.js

class OpenAIProvider {
  id = "openai";
  name = "OpenAI";

  async generateStructured(apiKey, model, prompt, schema) {
    const url = "https://api.openai.com/v1/chat/completions";
    
    // Convert generic JSON schema to OpenAI's strict json_schema format
    const payload = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          schema: schema,
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

if (typeof window !== "undefined") {
  window.OpenAIProvider = OpenAIProvider;
  if (window.AIProviderRegistry) {
    window.AIProviderRegistry.register(new OpenAIProvider());
  }
}
