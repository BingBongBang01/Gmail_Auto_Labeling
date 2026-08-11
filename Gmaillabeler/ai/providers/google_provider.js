// ai/providers/google_provider.js

class GoogleProvider {
  id = "google";
  name = "Google Gemini";

  async generateStructured(apiKey, model, prompt, schema) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch(e) {}
      throw { status: res.status, raw: errBody };
    }

    const data = await res.json();
    if (!data.candidates || data.candidates.length === 0) {
      throw new Error("No candidates returned from Gemini");
    }

    const text = data.candidates[0].content.parts[0].text;
    return JSON.parse(text);
  }

  normalizeError(error) {
    // 판단 순서: (1) 응답 본문의 명시적 quota/rate-limit 신호 → (2) HTTP status → (3) 일반 fallback.
    // status만 보고 성격을 단정하지 않는다 (예: 429가 항상 "하루 quota 소진"은 아님).
    const message = (error.raw?.error?.message || "").toLowerCase();
    const status = error.raw?.error?.status || "";

    if (message.includes("quota") || status === "RESOURCE_EXHAUSTED") {
      return { type: "quota", scope: "unknown", retryable: false };
    }
    if (error.status === 429) {
      return { type: "rate_limit", scope: "minute", waitMs: 15000, retryable: true };
    }
    if (error.status === 401 || error.status === 403) {
      return { type: "invalid_key", retryable: false };
    }
    if (error.status === 400) {
      // 잘못된 요청/모델/파라미터일 수 있다. API Key 문제로 단정하여 credential을 비활성화하지 않는다.
      return { type: "invalid_request", retryable: false };
    }
    if (error.status >= 500) {
      return { type: "server_error", retryable: true };
    }
    return { type: "unknown", retryable: false };
  }
}

if (typeof self !== "undefined") {
  self.GoogleProvider = GoogleProvider;
  if (self.AIProviderRegistry) {
    self.AIProviderRegistry.register(new GoogleProvider());
  }
}
