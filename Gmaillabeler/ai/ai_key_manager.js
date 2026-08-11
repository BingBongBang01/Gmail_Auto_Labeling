// ai/ai_key_manager.js

class AIKeyManager {
  static async getActiveCredentials() {
    const settings = await SettingsStore.getSettings();
    const creds = settings.ai?.credentials || [];
    return creds.filter(k => k.enabled).sort((a, b) => a.priority - b.priority);
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
