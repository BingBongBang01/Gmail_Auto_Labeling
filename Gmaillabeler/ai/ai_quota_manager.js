// ai/ai_quota_manager.js
//
// MV3 서비스워커는 30초쯤 유휴하면 종료되고, 다시 깨어날 때 importScripts가 재실행된다.
// 예전 구현은 상태를 in-memory Map에만 들고 있었기 때문에, 워커가 죽는 순간
// "이 키는 오늘 할당량이 끝났다"는 정보가 전부 사라졌다. 다음 알람에서 같은 키를
// 우선순위 1번으로 다시 골라 또 할당량 오류를 맞는 낭비가 반복됐다.
// 그래서 상태와 사용량을 chrome.storage.local에 함께 보존한다.
// API Key 자체는 여기에 절대 복제하지 않는다.

const AI_QUOTA_STORAGE_KEY = "aiQuotaState";
const AI_QUOTA_PERSIST_DEBOUNCE_MS = 1000;

class AIQuotaManager {
  static quotaMap = new Map(); // keyId -> { status, until, message }
  static usage = { date: "", perKey: {} };

  static _loadPromise = null;
  static _persistTimer = null;

  // Gemini 무료 티어의 일일 한도는 태평양 시간 자정에 리셋된다.
  // 예전 구현은 setHours(24,0,0,0)으로 "브라우저 로컬" 자정을 썼는데,
  // 한국 사용자라면 실제 리셋보다 약 17시간 일찍 풀려버린다.
  static _msUntilNextPacificMidnight() {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Los_Angeles",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).formatToParts(new Date());
      const get = (type) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
      const hour = get("hour") % 24; // hour12:false에서 24가 나오는 구현이 있다
      const elapsedSeconds = hour * 3600 + get("minute") * 60 + get("second");
      return Math.max(60000, (86400 - elapsedSeconds) * 1000);
    } catch (e) {
      return 60 * 60 * 1000; // 계산 실패 시엔 한 시간만 쉬게 한다
    }
  }

  static pacificDateString() {
    try {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  static load() {
    if (this._loadPromise) return this._loadPromise;
    this._loadPromise = new Promise((resolve) => {
      if (typeof chrome === "undefined" || !chrome.storage?.local) {
        resolve();
        return;
      }
      chrome.storage.local.get([AI_QUOTA_STORAGE_KEY], (result) => {
        const stored = (result && result[AI_QUOTA_STORAGE_KEY]) || {};
        const now = Date.now();

        this.quotaMap = new Map();
        for (const [keyId, entry] of Object.entries(stored.keys || {})) {
          // 이미 리셋 시점이 지난 항목은 되살리지 않는다.
          if (entry && typeof entry.until === "number" && entry.until > now) {
            this.quotaMap.set(keyId, entry);
          }
        }

        const today = this.pacificDateString();
        this.usage =
          stored.usage && stored.usage.date === today
            ? { date: today, perKey: { ...stored.usage.perKey } }
            : { date: today, perKey: {} };

        resolve();
      });
    });
    return this._loadPromise;
  }

  // 호출부가 quota를 판단하기 전에 반드시 await해야 하는 진입점.
  static initialize() {
    return this.load();
  }

  static _schedulePersist(immediate) {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (immediate) {
      this._persist();
      return;
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persist();
    }, AI_QUOTA_PERSIST_DEBOUNCE_MS);
  }

  static _persist() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const payload = {
      keys: Object.fromEntries(this.quotaMap.entries()),
      usage: this.usage,
    };
    try {
      chrome.storage.local.set({ [AI_QUOTA_STORAGE_KEY]: payload });
    } catch (e) {
      // 저장 실패가 요청 자체를 막을 이유는 없다.
    }
  }

  static markRateLimited(keyId, waitMs, message) {
    this.quotaMap.set(keyId, {
      status: "rate_limited",
      until: Date.now() + Math.max(1000, waitMs || 10000),
      message: message || "",
    });
    this._schedulePersist(true);
  }

  // resetsDaily가 true면 태평양 자정까지, 아니면 한 시간만 쉬게 한다.
  // OpenAI/Anthropic의 크레딧 소진은 "하루 뒤 자동 복구" 성질이 아니어서
  // 자정까지 묶어두면 사용자가 결제를 채워도 그날 내내 쓸 수 없게 된다.
  static markQuotaExhausted(keyId, options = {}) {
    const waitMs = options.resetsDaily ? this._msUntilNextPacificMidnight() : 60 * 60 * 1000;
    this.quotaMap.set(keyId, {
      status: "quota_exhausted",
      until: Date.now() + waitMs,
      message: options.message || "",
    });
    this._schedulePersist(true);
  }

  static isAvailable(keyId) {
    const entry = this.quotaMap.get(keyId);
    if (!entry) return true;
    if (Date.now() > entry.until) {
      this.quotaMap.delete(keyId);
      this._schedulePersist(true);
      return true;
    }
    return false;
  }

  static getState(keyId) {
    return this.quotaMap.get(keyId) || null;
  }

  static clear(keyId) {
    if (this.quotaMap.delete(keyId)) this._schedulePersist(true);
  }

  static recordRequest(keyId) {
    const today = this.pacificDateString();
    if (this.usage.date !== today) this.usage = { date: today, perKey: {} };
    this.usage.perKey[keyId] = (this.usage.perKey[keyId] || 0) + 1;
    // 요청마다 스토리지에 쓰면 낭비가 크므로 카운터는 묶어서 저장한다.
    this._schedulePersist(false);
  }

  static getRequestCount(keyId) {
    if (this.usage.date !== this.pacificDateString()) return 0;
    return this.usage.perKey[keyId] || 0;
  }

  static getTotalRequestCount() {
    if (this.usage.date !== this.pacificDateString()) return 0;
    return Object.values(this.usage.perKey).reduce((sum, n) => sum + n, 0);
  }
}

if (typeof self !== "undefined") self.AIQuotaManager = AIQuotaManager;
globalThis.AIQuotaManager = AIQuotaManager;
