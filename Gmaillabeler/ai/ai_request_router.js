// ai/ai_request_router.js

class AIRequestRouter {
  static async generateStructured(prompt, schema, options = {}) {
    const settings = await SettingsStore.getSettings();
    const credentials = await AIKeyManager.getActiveCredentials();
    
    if (!credentials || credentials.length === 0) {
      throw new Error("No enabled AI credentials found. Please configure them in Settings.");
    }

    let attempts = 0;
    const maxRetries = settings.ai?.requestPolicy?.maxRetries ?? 3;

    for (let cred of credentials) {
      if (!AIQuotaManager.isAvailable(cred.id)) continue;
      
      const provider = AIProviderRegistry.getProvider(cred.provider);
      if (!provider) continue;

      while (attempts <= maxRetries) {
        attempts++;
        try {
          // generateStructured(apiKey, modelId, prompt, schema)
          const result = await provider.generateStructured(cred.apiKey, cred.model, prompt, schema);
          
          // Reset quota state on success if it was previously marked exhausted
          if (cred.status !== "Ready") {
            cred.status = "Ready";
            const latestCreds = settings.ai.credentials.map(c => c.id === cred.id ? { ...c, status: "Ready" } : c);
            await SettingsStore.setSetting(`ai.credentials`, latestCreds);
          }
          
          return result;
        } catch (error) {
          const errorMeta = provider.normalizeError(error);
          const failoverDecision = await AIFailoverManager.handleProviderError(cred.provider, cred.id, errorMeta);
          
          if (failoverDecision.action === "failover") {
            break; // Break the while loop to try the next credential
          } else if (failoverDecision.action === "retry_or_failover") {
            await new Promise(r => setTimeout(r, failoverDecision.waitMs || 2000));
            // will retry in the while loop
          }
        }
      }
      attempts = 0; // Reset attempts counter for the next credential in the failover chain
    }

    throw new Error("All active AI credentials failed or exhausted their quotas. Please check your AI Settings.");
  }
}

if (typeof self !== "undefined") self.AIRequestRouter = AIRequestRouter;
