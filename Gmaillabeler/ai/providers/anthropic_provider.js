// ai/providers/anthropic_provider.js

class AnthropicProvider {
  id = "anthropic";
  name = "Anthropic Claude";

  async generateStructured(apiKey, model, prompt, schema) {
    const url = "https://api.anthropic.com/v1/messages";
    
    // Anthropic doesn't have a native JSON Schema enforcer like OpenAI/Gemini yet.
    // We enforce it through a system prompt with XML tags.
    const systemPrompt = `You are a data extraction AI. You must return EXACTLY a raw JSON object that conforms to the following JSON schema. Do not include markdown formatting like \`\`\`json. Only output the raw JSON.
Schema:
${JSON.stringify(schema)}
`;

    const payload = {
      model: model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
      temperature: 0
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true" // Required for CORS from an extension
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch(e) {}
      throw { status: res.status, raw: errBody };
    }

    const data = await res.json();
    if (!data.content || data.content.length === 0) {
      throw new Error("No content returned from Anthropic");
    }

    let text = data.content[0].text;
    
    // Clean up potential markdown formatting if the model disobeys
    text = text.trim();
    if (text.startsWith("```json")) text = text.substring(7);
    if (text.startsWith("```")) text = text.substring(3);
    if (text.endsWith("```")) text = text.substring(0, text.length - 3);
    
    return JSON.parse(text.trim());
  }

  normalizeError(error) {
    if (error.status === 429) {
      // Differentiate rate limit from quota based on raw error message if possible
      if (error.raw?.error?.type === "insufficient_quota" || error.raw?.error?.message?.toLowerCase().includes("credit")) {
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
  window.AnthropicProvider = AnthropicProvider;
  if (window.AIProviderRegistry) {
    window.AIProviderRegistry.register(new AnthropicProvider());
  }
}
