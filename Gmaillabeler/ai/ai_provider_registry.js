// ai/ai_provider_registry.js

class AIProviderRegistry {
  static providers = new Map();

  static SUPPORTED_PROVIDERS = [
    { id: "google", name: "Google Gemini" },
    { id: "openai", name: "OpenAI" },
    { id: "anthropic", name: "Anthropic Claude" }
  ];

  // 모델 목록은 공급자가 새 모델을 내면 금방 낡는다. 목록에 없는 모델을 쓰고 싶을 때를 위해
  // 옵션 화면에서 모델 ID를 직접 입력할 수 있게 해두었다(isCustomModelAllowed 참고).
  static SUPPORTED_MODELS = {
    "google": [
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (빠르고 저렴)" },
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (고급 추론)" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" }
    ],
    "openai": [
      { id: "gpt-4.1-mini", name: "GPT-4.1 Mini (빠름)" },
      { id: "gpt-4.1", name: "GPT-4.1 (고급)" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini (구형)" },
      { id: "gpt-4o", name: "GPT-4o (구형)" }
    ],
    "anthropic": [
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5 (빠르고 저렴)" },
      { id: "claude-sonnet-5", name: "Claude Sonnet 5 (균형)" },
      { id: "claude-fable-5", name: "Claude Fable 5 (최고 성능)" },
      { id: "claude-opus-5", name: "Claude Opus 5" }
    ]
  };

  // 분류/요약은 호출량이 많아서 각 공급자에서 가장 저렴하고 빠른 모델을 기본값으로 둔다.
  // 마이그레이션과 옵션 화면이 모델 미지정 상태를 메울 때 이 값을 쓴다.
  static DEFAULT_MODELS = {
    "google": "gemini-2.5-flash",
    "openai": "gpt-4.1-mini",
    "anthropic": "claude-haiku-4-5-20251001"
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

  static getDefaultModel(providerId) {
    return this.DEFAULT_MODELS[providerId] || "";
  }

  static isKnownProvider(providerId) {
    return this.SUPPORTED_PROVIDERS.some((p) => p.id === providerId);
  }
}

globalThis.AIProviderRegistry = AIProviderRegistry;
