// ai/ai_request_router.js

class AIRequestRouter {
  static async generateStructured(prompt, schema, options = {}) {
    // Quota 상태 복원이 끝나기 전에 quota 판단을 내리면(서비스 워커 재시작 직후) 이미 소진된
    // Credential을 다시 호출하게 된다. Router 진입 시 반드시 초기화를 기다린다.
    await AIQuotaManager.initialize();

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
    // maxRetries = "재시도 횟수"이며 총 시도 횟수는 1 + maxRetries다 (최초 시도 1회 + 재시도 maxRetries회).
    const maxRetries = settings.ai?.requestPolicy?.maxRetries ?? 3;
    const maxAttemptsPerCredential = 1 + maxRetries;

    let lastError = null;

    for (const cred of credentials) {
      // quotaAware === false면 예전에 quota/rate-limit로 표시된 Credential이라도 다시 시도한다.
      if (policy.quotaAware && !(await AIQuotaManager.isAvailable(cred.id))) continue;

      const provider = AIProviderRegistry.getProvider(cred.provider);
      if (!provider) continue;

      // 이 Credential 하나에 대한 attempts. 다음 Credential로 넘어가면 0부터 다시 센다
      // (Credential A의 retry 횟수가 Credential B에 누적되지 않는다).
      let attempts = 0;
      let credentialOutcome = null; // "success" | "failover" | "fail"

      while (attempts < maxAttemptsPerCredential) {
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

          if (decision.action === "retry") {
            if (attempts < maxAttemptsPerCredential) {
              await new Promise((r) => setTimeout(r, decision.waitMs || 2000));
              continue; // 같은 Credential로 재시도
            }
            // 재시도 횟수를 다 썼다 - retry 성격의 오류였더라도 이 Credential은 여기서 끝내고
            // failoverEnabled 정책에 따라 다음 Credential로 넘어갈지 결정한다.
            credentialOutcome = policy.failoverEnabled ? "failover" : "fail";
            break;
          }
          if (decision.action === "failover") {
            credentialOutcome = "failover";
          } else {
            credentialOutcome = "fail";
          }
          break;
        }
      }

      if (credentialOutcome !== "failover") {
        // failoverEnabled === false이거나 명시적으로 "fail" 판정을 받은 경우, 다음 Credential로 넘어가지 않는다.
        break;
      }
      // credentialOutcome === "failover" → for 루프가 자연스럽게 다음 credential로 이동한다.
    }

    const err = new Error(
      `All active AI credentials failed or exhausted their quotas. Please check your AI Settings.` +
      (lastError ? ` (last error: ${lastError.type})` : "")
    );
    err.code = "ALL_CREDENTIALS_EXHAUSTED";
    err.lastError = lastError;
    throw err;
  }
}

if (typeof self !== "undefined") self.AIRequestRouter = AIRequestRouter;
