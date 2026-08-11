// ai/ai_failover_manager.js

class AIFailoverManager {
  // standardized error structure: { type: "quota"|"rate_limit"|"invalid_key"|"server_error", retryable: boolean, waitMs?: number }
  
  static async handleProviderError(providerId, keyId, errorMeta) {
    if (errorMeta.type === "invalid_key") {
      await AIKeyManager.markCredentialInvalid(keyId);
      return { action: "failover" };
    }
    
    if (errorMeta.type === "quota") {
      AIQuotaManager.markQuotaExhausted(keyId);
      return { action: "failover" };
    }

    if (errorMeta.type === "rate_limit") {
      AIQuotaManager.markRateLimited(keyId, errorMeta.waitMs || 10000);
      return { action: "failover" }; // failover to next key if available
    }

    if (errorMeta.type === "server_error") {
      return { action: "retry_or_failover", waitMs: 2000 };
    }

    return { action: "failover" };
  }
}

if (typeof self !== "undefined") self.AIFailoverManager = AIFailoverManager;
