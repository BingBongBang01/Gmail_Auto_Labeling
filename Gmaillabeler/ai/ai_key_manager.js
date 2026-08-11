// ai/ai_key_manager.js

class AIKeyManager {
  static async getActiveCredentials() {
    const settings = await SettingsStore.getSettings();
    const creds = settings.ai?.credentials || [];
    // model이 없거나 사용자가 아직 모델을 고르지 않은(modelNeedsSelection) Credential은 그대로
    // Provider를 호출하면 잘못된 모델 ID로 요청하게 되므로 활성 목록에서 제외한다.
    return creds
      .filter(k => k.enabled && k.model && !k.modelNeedsSelection)
      .sort((a, b) => a.priority - b.priority);
  }

  static async markCredentialInvalid(credId) {
    const settings = await SettingsStore.getSettings();
    const creds = settings.ai?.credentials;
    if (creds) {
      const k = creds.find(x => x.id === credId);
      if (k) {
        k.enabled = false;
        k.status = "Invalid API Key";
      }
      await SettingsStore.setSetting(`ai.credentials`, creds);
    }
  }
}

if (typeof self !== "undefined") self.AIKeyManager = AIKeyManager;
