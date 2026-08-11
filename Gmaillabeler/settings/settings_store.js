// settings/settings_store.js

/**
 * SettingsStore provides the single source of truth for reading and writing settings.
 * It uses the 'appSettings' key in chrome.storage.local to store the nested configuration.
 */

const SETTINGS_STORAGE_KEY = "appSettings";

const SettingsStore = {
  // In-memory cache to prevent frequent storage gets
  _cache: null,
  
  _deepMerge: function(target, source) {
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && key in target) {
        Object.assign(source[key], this._deepMerge(target[key], source[key]));
      }
    }
    Object.assign(target || {}, source);
    return target;
  },

  /**
   * Loads settings from storage, falls back to defaults.
   * Caches the result in memory.
   */
  loadSettings: function(callback) {
    chrome.storage.local.get([SETTINGS_STORAGE_KEY], (result) => {
      let storedSettings = result[SETTINGS_STORAGE_KEY] || {};
      
      // Deep merge with defaults to ensure all keys exist
      this._cache = this._deepMerge(JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)), storedSettings);
      
      if (callback) callback(this._cache);
    });
  },

  /**
   * Retrieves all settings.
   */
  getSettings: function(callback) {
    if (this._cache) {
      if (callback) callback(this._cache);
      return Promise.resolve(this._cache);
    }
    return new Promise((resolve) => {
      this.loadSettings((settings) => {
        if (callback) callback(settings);
        resolve(settings);
      });
    });
  },

  /**
   * Retrieves a specific setting using dot notation (e.g., 'general.themeMode').
   */
  getSetting: function(path, callback) {
    return this.getSettings().then((settings) => {
      const keys = path.split('.');
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
  setSettings: function(partialSettings, callback) {
    return this.getSettings().then((currentSettings) => {
      this._cache = this._deepMerge(currentSettings, partialSettings);
      
      const payload = {};
      payload[SETTINGS_STORAGE_KEY] = this._cache;
      
      return new Promise((resolve) => {
        chrome.storage.local.set(payload, () => {
          // Notify other parts of the extension that settings changed
          chrome.runtime.sendMessage({ type: "settings.updated", settings: this._cache }).catch(() => {});
          if (callback) callback(this._cache);
          resolve(this._cache);
        });
      });
    });
  },

  /**
   * Updates a specific setting using dot notation.
   */
  setSetting: function(path, value, callback) {
    const keys = path.split('.');
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
  resetAllSettings: function(callback) {
    this._cache = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS));
    const payload = {};
    payload[SETTINGS_STORAGE_KEY] = this._cache;
    
    return new Promise((resolve) => {
      chrome.storage.local.set(payload, () => {
        chrome.runtime.sendMessage({ type: "settings.updated", settings: this._cache }).catch(() => {});
        if (callback) callback(this._cache);
        resolve(this._cache);
      });
    });
  }
};

// Listen for storage changes from other windows/contexts to invalidate cache
if (typeof chrome !== "undefined" && chrome.storage) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[SETTINGS_STORAGE_KEY]) {
      SettingsStore._cache = changes[SETTINGS_STORAGE_KEY].newValue;
    }
  });
}

if (typeof window !== "undefined") {
  window.SettingsStore = SettingsStore;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SettingsStore;
}
