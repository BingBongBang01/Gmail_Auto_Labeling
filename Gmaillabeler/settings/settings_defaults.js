// settings/settings_defaults.js

/**
 * Default values for all settings based on SETTINGS_SCHEMA.
 */
const SETTINGS_DEFAULTS = {
  schemaVersion: 3,
  general: {
    language: "en",
    themeMode: "system",
    startupBehavior: {
      openSidePanelOnGmail: false,
      showStatusOnGmail: true,
      restoreLastWorkspace: false
    }
  },
  
  google: {
    oauth: {
      clientId: "",
      clientSecret: ""
    }
  },
  
  ai: {
    credentials: [], // Will store { id, provider, name, apiKey, model, enabled, priority, status }
    requestPolicy: {
      failoverEnabled: true,
      retryEnabled: true,
      maxRetries: 3,
      quotaAware: true
    },
    processing: {
      batchSize: 50,
      concurrency: 1
    }
  },
  
  gmail: {
    classification: {
      enabled: true,
      threshold: 1,
      batchSize: 50,
      processingMode: "standard",
      duplicateHandling: "skip"
    },
    categories: [], // Populated from default rules if empty
    importance: {
      high: "",
      medium: "",
      low: "",
      mode: "criteria-based"
    },
    personalization: {
      identityHints: "",
      exclusionRules: ""
    },
    filters: [],
    fetching: {
      lightweight: false,
      limit: 50,
      unreadOnly: false
    },
    correctionLearning: {
      enabled: false,
      patterns: []
    }
  },
  
  calendar: {
    general: {
      enabled: false,
      defaultCalendar: "primary"
    },
    classification: {
      enabled: true,
      dateRange: "week",
      applyColors: true,
      analysisMode: "ai",
      maxEventsPerRun: 100,
      overwriteExistingColors: false
    },
    categories: [],
    filters: []
  },
  
  automation: {
    autoClassify: {
      enabled: true,
      threshold: 1,
      newMailOnly: true,
      isPaused: false
    },
    autoSummary: {
      enabled: false,
      label: "",
      maxCount: 20,
      criteria: "",
      sendToDiscord: true
    }
  },
  
  notifications: {
    browser: {
      enabled: false,
      onClassifyComplete: true,
      onClassifyError: true,
      onSummaryComplete: true
    },
    discord: {
      enabled: false,
      defaultWebhook: "",
      highWebhook: "",
      mediumWebhook: "",
      lowWebhook: "",
      sendPerEmail: true
    },
    customWebhooks: []
  },
  
  data: {
    backup: {
      autoBackupToDrive: true,
      includeCredentials: true,
      lastBackupAt: ""
    }
  },
  
  advanced: {
    logging: {
      debugMode: false,
      verbose: false
    },
    experimentalFeatures: false
  }
};

if (typeof self !== "undefined") {
  self.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = SETTINGS_DEFAULTS;
}
