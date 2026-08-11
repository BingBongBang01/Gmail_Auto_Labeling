// settings/settings_defaults.js

/**
 * Default values for all settings based on SETTINGS_SCHEMA.
 */
const SETTINGS_DEFAULTS = {
  // 마이그레이션이 기록하는 버전과 같아야 한다. 예전에는 여기가 2였는데 마이그레이션은 3을 써서,
  // 설정 초기화나 백업 가져오기로 이 기본값이 적용되면 버전이 2로 되돌아가 마이그레이션이
  // 다시 실행됐고, 그때 ai.credentials가 비워지면서 API 키가 사라졌다.
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
      quotaAware: true,
      // 분당 요청 수 상한. AIPacer가 이 값으로 공급자별 요청 간격을 계산한다.
      // Gemini 무료 티어가 15 RPM이라 그 값을 기본으로 둔다.
      rpmLimit: 15
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

// 서비스워커에는 window가 없다. window로만 내보내면 background.js에서 이 값이 사라진다.
globalThis.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
if (typeof module !== "undefined" && module.exports) {
  module.exports = SETTINGS_DEFAULTS;
}
