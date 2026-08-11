// ai/ai_quota_manager.js

class AIQuotaManager {
  static quotaMap = new Map();

  static markRateLimited(keyId, waitMs) {
    this.quotaMap.set(keyId, {
      status: "rate_limited",
      until: Date.now() + waitMs
    });
  }

  static markQuotaExhausted(keyId) {
    this.quotaMap.set(keyId, {
      status: "quota_exhausted",
      until: new Date().setHours(24, 0, 0, 0) // Next midnight
    });
  }

  static isAvailable(keyId) {
    const q = this.quotaMap.get(keyId);
    if (!q) return true;
    if (Date.now() > q.until) {
      this.quotaMap.delete(keyId);
      return true;
    }
    return false;
  }
}

if (typeof window !== "undefined") window.AIQuotaManager = AIQuotaManager;
