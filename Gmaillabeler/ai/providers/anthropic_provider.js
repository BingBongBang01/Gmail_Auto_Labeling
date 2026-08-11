// ai/providers/anthropic_provider.js

// Claude는 markdown 코드펜스나 앞뒤 설명을 함께 출력하는 경우가 있어, 순수 JSON.parse()만으로는
// 부서지기 쉽다. 코드펜스를 벗겨내고, 그래도 실패하면 첫 '{'~마지막 '}' 구간만 다시 추출해 재시도한다.
function parseJsonFromModelText(rawText) {
  let text = rawText.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text);
  } catch (e) {
    // 앞뒤에 설명 문장이 섞여 있거나 응답이 중간에 잘린 경우, 가장 바깥 JSON 객체 구간만 추출해본다.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (e2) {
        // fall through
      }
    }
    throw new Error(`Failed to parse JSON from Anthropic response: ${e.message}`);
  }
}

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

    const text = data.content[0]?.text;
    if (!text || !text.trim()) {
      throw new Error("Empty response text from Anthropic");
    }

    return parseJsonFromModelText(text);
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

if (typeof self !== "undefined") {
  self.AnthropicProvider = AnthropicProvider;
  if (self.AIProviderRegistry) {
    self.AIProviderRegistry.register(new AnthropicProvider());
  }
}
