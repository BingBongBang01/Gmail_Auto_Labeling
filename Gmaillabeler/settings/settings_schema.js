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
      quotaAware: "boolean",
      rpmLimit: "number"
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
// 값이 정해진 문자열 설정. 예전에는 주석으로만 적혀 있어서 아무도 확인하지 않았다.
const SETTINGS_ENUMS = {
  "general.language": ["ko", "en", "ja", "zh_CN", "system"],
  "general.themeMode": ["system", "light", "dark"],
  "gmail.classification.processingMode": ["standard", "fast"],
  "gmail.classification.duplicateHandling": ["skip", "reclassify"],
  "gmail.importance.mode": ["criteria-based", "ai-assisted"],
  "calendar.classification.dateRange": ["today", "week", "month", "custom"],
  "calendar.classification.analysisMode": ["ai"],
};

// ai.credentials 항목의 형태. 스키마에서는 그냥 "array"라서 내용 검증이 없었고,
// 마이그레이션이 apiKey가 undefined인 항목을 enabled 상태로 넣는 일도 있었다.
function sanitizeCredentialList(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  input.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const provider = typeof raw.provider === "string" ? raw.provider : "";
    const apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
    if (!provider || !apiKey) return; // 공급자나 키가 없으면 쓸 수 없는 항목이다
    out.push({
      id: typeof raw.id === "string" && raw.id ? raw.id : `cred-${Date.now()}-${index}`,
      provider,
      name: typeof raw.name === "string" ? raw.name : provider,
      apiKey,
      model: typeof raw.model === "string" ? raw.model : "",
      enabled: raw.enabled !== false,
      priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : index + 1,
      status: typeof raw.status === "string" ? raw.status : "Unknown",
    });
  });
  return out;
}

// 스키마에 있는 키만, 스키마가 말하는 타입으로만 통과시킨다.
// 설정 가져오기(임의의 JSON 파일)처럼 신뢰할 수 없는 입력을 걸러내는 데 쓴다.
// 반환: { value, errors } - value는 병합해도 안전한 부분 설정 객체.
function validateSettingsAgainstSchema(input) {
  const errors = [];

  function leaf(node, type, path) {
    if (node === undefined || node === null) return undefined;

    if (type === "array") {
      if (!Array.isArray(node)) {
        errors.push(`${path}: 배열이어야 합니다.`);
        return undefined;
      }
      if (path === "ai.credentials") return sanitizeCredentialList(node);
      try {
        return JSON.parse(JSON.stringify(node));
      } catch (e) {
        errors.push(`${path}: 직렬화할 수 없는 값입니다.`);
        return undefined;
      }
    }

    if (type === "number") {
      const num = typeof node === "number" ? node : Number(node);
      if (!Number.isFinite(num)) {
        errors.push(`${path}: 숫자여야 합니다.`);
        return undefined;
      }
      return num;
    }

    if (type === "boolean") {
      if (typeof node === "boolean") return node;
      errors.push(`${path}: true 또는 false여야 합니다.`);
      return undefined;
    }

    if (type === "string") {
      if (typeof node !== "string") {
        errors.push(`${path}: 문자열이어야 합니다.`);
        return undefined;
      }
      const allowed = SETTINGS_ENUMS[path];
      if (allowed && !allowed.includes(node)) {
        errors.push(`${path}: 허용되지 않은 값입니다 (${node}).`);
        return undefined;
      }
      return node;
    }

    return undefined;
  }

  function walk(node, schemaNode, path) {
    if (typeof schemaNode === "string") return leaf(node, schemaNode, path);

    if (!node || typeof node !== "object" || Array.isArray(node)) {
      if (node !== undefined) errors.push(`${path || "(루트)"}: 객체여야 합니다.`);
      return undefined;
    }

    const out = {};
    for (const [key, childSchema] of Object.entries(schemaNode)) {
      if (!(key in node)) continue; // 없는 키는 기본값을 유지하도록 그냥 넘긴다
      const childPath = path ? `${path}.${key}` : key;
      const converted = walk(node[key], childSchema, childPath);
      if (converted !== undefined) out[key] = converted;
    }
    // 스키마에 없는 키는 여기서 자동으로 버려진다.
    return Object.keys(out).length ? out : undefined;
  }

  return { value: walk(input, SETTINGS_SCHEMA, "") || {}, errors };
}

export { SETTINGS_SCHEMA, SETTINGS_ENUMS, validateSettingsAgainstSchema, sanitizeCredentialList };
