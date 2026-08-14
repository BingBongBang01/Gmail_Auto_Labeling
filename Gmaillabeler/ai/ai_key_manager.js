// ai/ai_key_manager.js

class AIKeyManager {
  static async getActiveCredentials() {
    const settings = await SettingsStore.getSettings();
    const creds = settings.ai?.credentials || [];
    // 모델은 라우터가 AIProviderRegistry.getDefaultModel()로 메워주므로 여기서 거르지 않는다.
    // priority가 없는 옛 항목이 섞여 있어도 정렬이 NaN으로 무너지지 않게 기본값을 준다.
    return creds
      .filter((k) => k && k.enabled && k.apiKey)
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  static async getAllCredentials() {
    const settings = await SettingsStore.getSettings();
    return settings.ai?.credentials || [];
  }

  // background.js의 할당량 표시가 쓰는 조회. 예전에는 이 메서드가 없는데도 호출해서
  // getQuotaUsage()가 매번 TypeError로 죽었다.
  static async getKeysForProvider(providerId) {
    const creds = await this.getAllCredentials();
    return creds.filter((k) => k && k.provider === providerId);
  }

  // 상태를 갱신할 때는 항상 저장소에서 다시 읽어 id로 찾아 고친다.
  // 라우터가 들고 있던 cred 객체를 직접 고치면, 첫 저장 직후 storage.onChanged가
  // SettingsStore._cache를 새 객체로 갈아치우면서 그 참조가 캐시와 분리돼
  // 이후 변경이 조용히 사라진다.
  static async setCredentialStatus(credId, status) {
    const settings = await SettingsStore.getSettings();
    const creds = settings.ai?.credentials;
    if (!Array.isArray(creds)) return;
    const target = creds.find((c) => c && c.id === credId);
    if (!target || target.status === status) return;
    target.status = status;
    await SettingsStore.setSetting("ai.credentials", creds);
  }

  static async markCredentialInvalid(credId, message) {
    const settings = await SettingsStore.getSettings();
    const creds = settings.ai?.credentials;
    if (!Array.isArray(creds)) return;
    const target = creds.find((c) => c && c.id === credId);
    if (!target) return;
    target.enabled = false;
    target.status = message ? `Invalid API Key: ${String(message).slice(0, 120)}` : "Invalid API Key";
    await SettingsStore.setSetting("ai.credentials", creds);
  }
}

if (typeof self !== "undefined") self.AIKeyManager = AIKeyManager;
globalThis.AIKeyManager = AIKeyManager;
