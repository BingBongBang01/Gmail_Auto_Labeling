// ai/ai_request_router.js

class AIRequestRouter {
  static async generateStructured(prompt, schema, options = {}) {
    const settings = await SettingsStore.getSettings();
    const credentials = await AIKeyManager.getActiveCredentials();

    if (!credentials || credentials.length === 0) {
      throw new Error("No enabled AI credentials found. Please configure them in Settings.");
    }

    const policy = {
      retryEnabled: settings.ai?.requestPolicy?.retryEnabled !== false,
      failoverEnabled: settings.ai?.requestPolicy?.failoverEnabled !== false,
      quotaAware: settings.ai?.requestPolicy?.quotaAware !== false
    };
    const maxRetries = settings.ai?.requestPolicy?.maxRetries ?? 3;

    let lastError = null;

    for (const cred of credentials) {
      // quotaAware === false면 예전에 quota/rate-limit로 표시된 Credential이라도 다시 시도한다.
      if (policy.quotaAware && !AIQuotaManager.isAvailable(cred.id)) continue;

      const provider = AIProviderRegistry.getProvider(cred.provider);
      if (!provider) continue;

      // 이 Credential 하나에 대한 attempts. 다음 Credential로 넘어가면 0부터 다시 센다
      // (Credential A의 retry 횟수가 Credential B에 누적되지 않는다).
      let attempts = 0;
      let moveToNextCredential = false;

      while (attempts <= maxRetries) {
        attempts++;
        try {
          const result = await provider.generateStructured(cred.apiKey, cred.model, prompt, schema);

          // 실패했다가 복구된 Credential이면 상태를 Ready로 되돌려 저장한다.
          if (cred.status !== "Ready") {
            const latest = await SettingsStore.getSettings();
            const latestCreds = (latest.ai?.credentials || []).map((c) =>
              c.id === cred.id ? { ...c, status: "Ready" } : c
            );
            await SettingsStore.setSetting("ai.credentials", latestCreds);
          }

          return result;
        } catch (error) {
          const errorMeta = provider.normalizeError(error);
          lastError = errorMeta;
          const decision = await AIFailoverManager.handleProviderError(cred.provider, cred.id, errorMeta, policy);

          if (decision.action === "retry" && attempts <= maxRetries) {
            await new Promise((r) => setTimeout(r, decision.waitMs || 2000));
            continue; // 같은 Credential로 재시도
          }
          if (decision.action === "failover") {
            moveToNextCredential = true;
          }
          break; // "fail" 또는 retry 횟수 소진 → while 루프 종료
        }
      }

      if (!moveToNextCredential) {
        // failoverEnabled === false이거나 명시적으로 "fail" 판정을 받은 경우, 다음 Credential로 넘어가지 않는다.
        break;
      }
    }

    const reason = lastError ? ` (last error: ${lastError.type})` : "";
    throw new Error(`All active AI credentials failed or exhausted their quotas. Please check your AI Settings.${reason}`);
  }
}

if (typeof self !== "undefined") self.AIRequestRouter = AIRequestRouter;
