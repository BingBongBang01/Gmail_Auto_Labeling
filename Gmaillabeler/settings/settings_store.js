// settings/settings_store.js

/**
 * SettingsStore provides the single source of truth for reading and writing settings.
 * It uses the 'appSettings' key in chrome.storage.local to store the nested configuration.
 */

const SETTINGS_STORAGE_KEY = "appSettings";

const SettingsStore = {
  // In-memory cache to prevent frequent storage gets
  _cache: null,

  // 쓰기는 반드시 한 번에 하나씩 순서대로 처리한다.
  // 예전에는 setSettings가 (캐시 읽기 -> 병합 -> 전체 blob 쓰기)를 비동기로 겹쳐 실행해서,
  // 옵션 페이지와 서비스워커가 거의 동시에 저장하면 나중 쓰기가 앞 쓰기를 통째로 덮어썼다.
  _writeChain: Promise.resolve(),

  // getSettings()가 동시에 여러 번 불릴 때 스토리지 읽기를 중복으로 던지지 않게 한다.
  _loadPromise: null,

  _deepMerge: function (target, source) {
    if (Array.isArray(source)) {
      return structuredClone(source);
    }
    if (source && typeof source === "object" && !Array.isArray(source)) {
      const result = { ...(target && typeof target === "object" ? target : {}) };
      for (const [key, value] of Object.entries(source)) {
        result[key] = this._deepMerge(result[key], value);
      }
      return result;
    }
    // NaN은 JSON 직렬화에서 null이 되어 조용히 설정을 망가뜨린다.
    // (옵션 화면의 숫자 입력을 비우면 parseInt가 NaN을 만든다)
    if (typeof source === "number" && !Number.isFinite(source)) {
      return target;
    }
    return source;
  },

  _withDefaults: function (stored) {
    return this._deepMerge(structuredClone(SETTINGS_DEFAULTS), stored || {});
  },

  _readFromStorage: function () {
    return new Promise((resolve) => {
      chrome.storage.local.get([SETTINGS_STORAGE_KEY], (result) => {
        if (chrome.runtime.lastError) {
          console.warn("[SettingsStore] 설정을 읽지 못했습니다:", chrome.runtime.lastError.message);
          resolve({});
          return;
        }
        resolve((result && result[SETTINGS_STORAGE_KEY]) || {});
      });
    });
  },

  _writeToStorage: function (settings) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings }, () => {
        if (chrome.runtime.lastError) {
          // 저장 실패를 성공으로 처리하면 메모리 캐시와 스토리지가 영구히 어긋난다.
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  },

  /**
   * Loads settings from storage, falls back to defaults.
   * Caches the result in memory.
   */
  loadSettings: function (callback) {
    if (this._loadPromise) {
      return this._loadPromise.then((settings) => {
        if (callback) callback(settings);
        return settings;
      });
    }

    this._loadPromise = this._readFromStorage()
      .then((stored) => {
        this._cache = this._withDefaults(stored);
        return this._cache;
      })
      .finally(() => {
        this._loadPromise = null;
      });

    return this._loadPromise.then((settings) => {
      if (callback) callback(settings);
      return settings;
    });
  },

  /**
   * Retrieves all settings.
   */
  getSettings: function (callback) {
    if (this._cache) {
      if (callback) callback(this._cache);
      return Promise.resolve(this._cache);
    }
    return this.loadSettings(callback);
  },

  /**
   * Retrieves a specific setting using dot notation (e.g., 'general.themeMode').
   */
  getSetting: function (path, callback) {
    return this.getSettings().then((settings) => {
      const keys = path.split(".");
      let current = settings;
      for (const key of keys) {
        if (current === undefined || current === null) break;
        current = current[key];
      }
      if (callback) callback(current);
      return current;
    });
  },

  /**
   * Updates multiple settings and saves to storage.
   * Partial objects are deep merged.
   */
  setSettings: function (partialSettings, callback) {
    const run = () =>
      // 캐시가 아니라 스토리지에서 다시 읽어 병합한다. 다른 컨텍스트가 그 사이에 저장한
      // 내용을 잃지 않기 위해서다.
      this._readFromStorage()
        .then((stored) => {
          const merged = this._deepMerge(this._withDefaults(stored), partialSettings);
          return this._writeToStorage(merged).then(() => {
            this._cache = merged;
            return merged;
          });
        })
        .then((merged) => {
          // 다른 컨텍스트에 알린다(실패해도 무해하다 - storage.onChanged가 주 경로다).
          try {
            const maybePromise = chrome.runtime.sendMessage({ type: "settings.updated" });
            if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
          } catch (e) {
            /* 수신자가 없을 수 있다 */
          }
          if (callback) callback(merged);
          return merged;
        })
        .catch((err) => {
          console.warn("[SettingsStore] 설정을 저장하지 못했습니다:", err.message);
          throw err;
        });

    // 실패가 체인을 끊어서 이후 쓰기가 전부 막히지 않게 한다.
    const result = this._writeChain.then(run, run);
    this._writeChain = result.catch(() => {});
    return result;
  },

  /**
   * Updates a specific setting using dot notation.
   */
  setSetting: function (path, value, callback) {
    const keys = path.split(".");
    const partialSettings = {};
    let current = partialSettings;

    for (let i = 0; i < keys.length - 1; i++) {
      current[keys[i]] = {};
      current = current[keys[i]];
    }
    current[keys[keys.length - 1]] = value;

    return this.setSettings(partialSettings, callback);
  },

  /**
   * Resets all settings to their defaults.
   */
  resetAllSettings: function (callback) {
    const run = () => {
      const fresh = structuredClone(SETTINGS_DEFAULTS);
      return this._writeToStorage(fresh).then(() => {
        this._cache = fresh;
        try {
          const maybePromise = chrome.runtime.sendMessage({ type: "settings.updated" });
          if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
        } catch (e) {
          /* noop */
        }
        if (callback) callback(fresh);
        return fresh;
      });
    };
    const result = this._writeChain.then(run, run);
    this._writeChain = result.catch(() => {});
    return result;
  },
};

// Listen for storage changes from other windows/contexts to invalidate cache
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_STORAGE_KEY]) return;
    const next = changes[SETTINGS_STORAGE_KEY].newValue;
    // 저장된 값을 그대로 캐시에 넣으면(예전 동작) 기본값과 병합되지 않아서,
    // 부분적인 blob이 들어온 순간 settings.calendar.classification 같은 깊은 접근이 전부 터진다.
    SettingsStore._cache = next ? SettingsStore._withDefaults(next) : null;
  });
}

globalThis.SettingsStore = SettingsStore;
if (typeof module !== "undefined" && module.exports) {
  module.exports = SettingsStore;
}
