// ai/ai_provider_registry.js

class AIProviderRegistry {
  static providers = new Map();

  static SUPPORTED_PROVIDERS = [
    { id: "google", name: "Google Gemini" },
    { id: "openai", name: "OpenAI" },
    { id: "anthropic", name: "Anthropic Claude" }
  ];

  static SUPPORTED_MODELS = {
    "google": [
      { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash (Fast & Cost-effective)" },
      { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro (Advanced Reasoning)" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash (Latest)" }
    ],
    "openai": [
      { id: "gpt-4o-mini", name: "GPT-4o Mini (Fast)" },
      { id: "gpt-4o", name: "GPT-4o (Advanced)" }
    ],
    "anthropic": [
      { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku (Fast)" },
      { id: "claude-3-5-sonnet-latest", name: "Claude 3.5 Sonnet (Advanced)" },
      { id: "claude-3-opus-latest", name: "Claude 3 Opus" }
    ]
  };

  static register(provider) {
    this.providers.set(provider.id, provider);
  }

  static getProvider(id) {
    return this.providers.get(id);
  }

  static getAllProviders() {
    return Array.from(this.providers.values());
  }

  static getModelsForProvider(providerId) {
    return this.SUPPORTED_MODELS[providerId] || [];
  }
}

if (typeof window !== "undefined") window.AIProviderRegistry = AIProviderRegistry;
