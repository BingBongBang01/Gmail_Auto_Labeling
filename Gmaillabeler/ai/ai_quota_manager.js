// ai/ai_quota_manager.js
//
// MV3 서비스 워커는 언제든 종료/재시작될 수 있어서 quota 상태를 메모리(Map)에만 두면 재시작 직후
// 상태가 사라져 이미 소진된 Credential을 다시 시도하게 된다. 그래서 최소한의 상태만
// chrome.storage.local(aiRuntimeState)에도 함께 저장하고, 모듈 로드 시점에 복원한다.
// API Key 자체는 여기에 절대 복제하지 않는다.

const AI_RUNTIME_STATE_KEY = "aiRuntimeState";

class AIQuotaManager {
  static quotaMap = new Map();
  static _restored = false;
  static _restorePromise = null;

  // 공개 진입점: 호출부(Router 등)는 quota를 판단하기 전에 반드시 이걸 await해야 한다.
  static async initialize() {
    return this._restoreFromStorage();
  }

  static async _restoreFromStorage() {
    if (this._restored) return;
    if (!this._restorePromise) {
      this._restorePromise = new Promise((resolve) => {
        if (typeof chrome === "undefined" || !chrome.storage?.local) {
          resolve();
          return;
        }
        chrome.storage.local.get([AI_RUNTIME_STATE_KEY], (result) => {
          const stored = result?.[AI_RUNTIME_STATE_KEY]?.credentials || {};
          const now = Date.now();
          for (const credId of Object.keys(stored)) {
            const entry = stored[credId];
            if (entry && entry.until && entry.until > now) {
              this.quotaMap.set(credId, entry);
            }
          }
          this._restored = true;
          resolve();
        });
      });
    }
    return this._restorePromise;
  }

  static _persist() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const credentials = {};
    for (const [credId, entry] of this.quotaMap.entries()) {
      credentials[credId] = entry;
    }
    chrome.storage.local.set({ [AI_RUNTIME_STATE_KEY]: { credentials, updatedAt: Date.now() } });
  }

  static markRateLimited(keyId, waitMs) {
    this.quotaMap.set(keyId, {
      status: "rate_limited",
      until: Date.now() + waitMs,
      updatedAt: Date.now()
    });
    this._persist();
  }

  static markQuotaExhausted(keyId) {
    this.quotaMap.set(keyId, {
      status: "quota_exhausted",
      until: new Date().setHours(24, 0, 0, 0), // Next midnight
      updatedAt: Date.now()
    });
    this._persist();
  }

  static async isAvailable(keyId) {
    // storage 복원이 끝나기 전에는 판단하지 않는다(서비스 워커 재시작 직후 race 방지).
    await this._restoreFromStorage();

    const q = this.quotaMap.get(keyId);
    if (!q) return true;
    if (Date.now() > q.until) {
      this.quotaMap.delete(keyId);
      this._persist();
      return true;
    }
    return false;
  }
}

if (typeof self !== "undefined") {
  self.AIQuotaManager = AIQuotaManager;
  AIQuotaManager._restoreFromStorage();
}
