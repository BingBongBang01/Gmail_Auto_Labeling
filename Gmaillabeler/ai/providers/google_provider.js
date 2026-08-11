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
    if (error.status === 429) {
      return { type: "rate_limit", waitMs: 15000, retryable: true };
    }
    if (error.status === 401 || error.status === 403 || error.status === 400) {
      return { type: "invalid_key", retryable: false };
    }
    if (error.status >= 500) {
      return { type: "server_error", retryable: true };
    }
    // Check if it's quota specifically if google provides it in raw error
    if (error.raw?.error?.message?.toLowerCase().includes("quota")) {
      return { type: "quota", retryable: false };
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
