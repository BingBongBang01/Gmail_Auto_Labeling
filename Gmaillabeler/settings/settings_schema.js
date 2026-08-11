// settings/settings_schema.js

/**
 * Single Source of Truth for the structure of all settings.
 * This defines the nested object structure that will be saved to chrome.storage.
 */
const SETTINGS_SCHEMA = {
  schemaVersion: "number",
  general: {
    language: "string", // "ko", "en", "ja", "zh_CN"
    themeMode: "string", // "system", "light", "dark"
    startupBehavior: {
      openSidePanelOnGmail: "boolean",
      showStatusOnGmail: "boolean",
      restoreLastWorkspace: "boolean"
    }
  },
  
  google: {
    oauth: {
      clientId: "string",
      clientSecret: "string" // Should eventually be moved out for security, but keeping for compatibility
    }
  },
  
  ai: {
    credentials: "array", // Array of { id, provider, name, apiKey, model, enabled, priority, status }
    requestPolicy: {
      failoverEnabled: "boolean",
      retryEnabled: "boolean",
      maxRetries: "number",
      quotaAware: "boolean"
    },
    processing: {
      batchSize: "number",
      concurrency: "number"
    }
  },
  
  gmail: {
    classification: {
      enabled: "boolean",
      threshold: "number",
      batchSize: "number",
      processingMode: "string", // "standard", "fast"
      duplicateHandling: "string" // "skip", "reclassify"
    },
    categories: "array", // Array of { name, description, color, enabled, importance, keywords }
    importance: {
      high: "string",
      medium: "string",
      low: "string",
      mode: "string" // "criteria-based", "ai-assisted"
    },
    personalization: {
      identityHints: "string",
      exclusionRules: "string"
    },
    filters: "array", // Array of manual filter rules
    fetching: {
      lightweight: "boolean",
      limit: "number",
      unreadOnly: "boolean"
    },
    correctionLearning: {
      enabled: "boolean",
      patterns: "array"
    }
  },
  
  calendar: {
    general: {
      enabled: "boolean",
      defaultCalendar: "string"
    },
    classification: {
      enabled: "boolean",
      dateRange: "string", // "today", "week", "month", "custom"
      applyColors: "boolean",
      analysisMode: "string", // "ai"
      maxEventsPerRun: "number",
      overwriteExistingColors: "boolean"
    },
    categories: "array", // Array of { id, name, criteria, colorId, priority, enabled, colorSource }
    filters: "array"
  },
  
  automation: {
    autoClassify: {
      enabled: "boolean",
      threshold: "number",
      newMailOnly: "boolean",
      isPaused: "boolean"
    },
    autoSummary: {
      enabled: "boolean",
      label: "string",
      maxCount: "number",
      criteria: "string",
      sendToDiscord: "boolean"
    }
  },
  
  notifications: {
    browser: {
      enabled: "boolean",
      onClassifyComplete: "boolean",
      onClassifyError: "boolean",
      onSummaryComplete: "boolean"
    },
    discord: {
      enabled: "boolean",
      defaultWebhook: "string",
      highWebhook: "string",
      mediumWebhook: "string",
      lowWebhook: "string",
      sendPerEmail: "boolean"
    },
    customWebhooks: "array" // Array of { name, url, categories, importance, enabled }
  },
  
  data: {
    backup: {
      autoBackupToDrive: "boolean",
      includeCredentials: "boolean",
      lastBackupAt: "string"
    }
  },
  
  advanced: {
    logging: {
      debugMode: "boolean",
      verbose: "boolean"
    },
    experimentalFeatures: "boolean"
  }
};

if (typeof self !== "undefined") {
  self.SETTINGS_SCHEMA = SETTINGS_SCHEMA;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SETTINGS_SCHEMA;
}
