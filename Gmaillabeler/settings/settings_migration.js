// settings/settings_migration.js

/**
 * Handles migrating settings from flat structure (v1) or nested (v2) to the latest structure (v3).
 * It reads all existing keys, maps them to the new structure if they exist,
 * saves to appSettings, and optionally cleans up the old keys.
 */

async function migrateToLatestSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, async (allData) => {
      const currentVersion = allData.appSettings?.schemaVersion || 1;
      if (currentVersion >= 3) {
        console.log("Settings already migrated to latest schema.");
        return resolve(false);
      }

      console.log(`Starting settings migration from v${currentVersion} to v3...`);
      
      const migratedSettings = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)); // Deep copy defaults
      migratedSettings.schemaVersion = 3;

      // Use either the existing nested structure (v2) or fallback to v1 top-level keys
      const existing = allData.appSettings || {};

      // 1. General & Theme
      if (existing.general?.themeMode) migratedSettings.general.themeMode = existing.general.themeMode;
      else if (allData.themeMode) migratedSettings.general.themeMode = allData.themeMode;
      else if (allData.dashboardTheme) migratedSettings.general.themeMode = allData.dashboardTheme;
      
      let lang = existing.general?.language || allData.uiLanguage;
      if (!lang || lang === "system") {
        const browserLang = chrome.i18n.getUILanguage().toLowerCase();
        if (browserLang.startsWith("ko")) lang = "ko";
        else if (browserLang.startsWith("ja")) lang = "ja";
        else if (browserLang.startsWith("zh")) lang = "zh_CN";
        else lang = "en";
      }
      migratedSettings.general.language = lang;

      // 2. Google OAuth
      if (existing.google?.oauth?.clientId) migratedSettings.google.oauth.clientId = existing.google.oauth.clientId;
      else if (allData.oauthClientId) migratedSettings.google.oauth.clientId = allData.oauthClientId;
      
      if (existing.google?.oauth?.clientSecret) migratedSettings.google.oauth.clientSecret = existing.google.oauth.clientSecret;
      else if (allData.oauthClientSecret) migratedSettings.google.oauth.clientSecret = allData.oauthClientSecret;

      // 3. AI & API Keys (Migration to ai.credentials)
      migratedSettings.ai.credentials = [];
      let priorityCounter = 1;

      // Try migrating from v2 providers structure
      if (existing.ai?.providers) {
        Object.keys(existing.ai.providers).forEach(providerId => {
          const provider = existing.ai.providers[providerId];
          if (provider.apiKeys && Array.isArray(provider.apiKeys)) {
            provider.apiKeys.forEach(k => {
              migratedSettings.ai.credentials.push({
                id: k.id || (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString()),
                provider: providerId,
                name: k.label || k.name || `Migrated ${providerId} Key`,
                apiKey: k.key || k.apiKey,
                model: provider.selectedModel || `${providerId}-default-model`,
                enabled: k.enabled !== false,
                priority: priorityCounter++,
                status: "Ready"
              });
            });
          }
        });
      }
      // Fallback migrating from v1 flat keys
      else if (allData.geminiApiKeys && Array.isArray(allData.geminiApiKeys) && allData.geminiApiKeys.length > 0) {
        allData.geminiApiKeys.forEach((k) => {
          migratedSettings.ai.credentials.push({
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
            provider: "google",
            name: k.label || `Migrated Key ${priorityCounter}`,
            apiKey: k.key,
            model: "gemini-1.5-flash",
            enabled: k.active !== false,
            priority: priorityCounter++,
            status: "Ready"
          });
        });
      } else if (allData.geminiApiKey) {
        migratedSettings.ai.credentials.push({
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(),
          provider: "google",
          name: "Default Migrated Key",
          apiKey: allData.geminiApiKey,
          model: "gemini-1.5-flash",
          enabled: true,
          priority: priorityCounter++,
          status: "Ready"
        });
      }

      // Restore AI policies
      if (existing.ai?.requestPolicy) {
        migratedSettings.ai.requestPolicy = { ...migratedSettings.ai.requestPolicy, ...existing.ai.requestPolicy };
      }
      if (existing.ai?.processing) {
        migratedSettings.ai.processing = { ...migratedSettings.ai.processing, ...existing.ai.processing };
      }

      // 4. Gmail Settings
      if (allData.autoClassifyEnabled !== undefined) migratedSettings.automation.autoClassify.enabled = allData.autoClassifyEnabled;
      if (allData.autoClassifyThreshold !== undefined) migratedSettings.automation.autoClassify.threshold = allData.autoClassifyThreshold;
      
      if (allData.categoryDefinitions) {
        migratedSettings.gmail.categories = allData.categoryDefinitions;
      } else if (allData.labelCategories) {
        migratedSettings.gmail.categories = allData.labelCategories;
      }

      if (allData.importanceCriteria) {
        if (allData.importanceCriteria.high) migratedSettings.gmail.importance.high = allData.importanceCriteria.high;
        if (allData.importanceCriteria.medium) migratedSettings.gmail.importance.medium = allData.importanceCriteria.medium;
        if (allData.importanceCriteria.low) migratedSettings.gmail.importance.low = allData.importanceCriteria.low;
      }

      if (allData.personalIdentityHints) migratedSettings.gmail.personalization.identityHints = allData.personalIdentityHints;
      if (allData.personalExclusionRules) migratedSettings.gmail.personalization.exclusionRules = allData.personalExclusionRules;

      if (allData.filterRules) migratedSettings.gmail.filters = allData.filterRules;

      if (allData.lightMailFetchEnabled !== undefined) migratedSettings.gmail.fetching.lightweight = allData.lightMailFetchEnabled;
      if (allData.correctionLearningEnabled !== undefined) migratedSettings.gmail.correctionLearning.enabled = allData.correctionLearningEnabled;

      // 5. Automation Summary
      if (allData.autoSummaryEnabled !== undefined) migratedSettings.automation.autoSummary.enabled = allData.autoSummaryEnabled;
      if (allData.autoSummaryLabel) migratedSettings.automation.autoSummary.label = allData.autoSummaryLabel;
      if (allData.autoSummaryMaxCount !== undefined) migratedSettings.automation.autoSummary.maxCount = allData.autoSummaryMaxCount;
      if (allData.autoSummaryCriteria) migratedSettings.automation.autoSummary.criteria = allData.autoSummaryCriteria;
      if (allData.autoSummarySendDiscord !== undefined) migratedSettings.automation.autoSummary.sendToDiscord = allData.autoSummarySendDiscord;

      // 6. Discord Notifications
      if (allData.discordWebhookUrl) migratedSettings.notifications.discord.defaultWebhook = allData.discordWebhookUrl;
      if (allData.discordWebhookUrlHigh) migratedSettings.notifications.discord.highWebhook = allData.discordWebhookUrlHigh;
      if (allData.discordWebhookUrlMedium) migratedSettings.notifications.discord.mediumWebhook = allData.discordWebhookUrlMedium;
      if (allData.discordWebhookUrlLow) migratedSettings.notifications.discord.lowWebhook = allData.discordWebhookUrlLow;
      if (allData.discordSendPerEmail !== undefined) migratedSettings.notifications.discord.sendPerEmail = allData.discordSendPerEmail;
      
      if (allData.customDiscordWebhooks) migratedSettings.notifications.customWebhooks = allData.customDiscordWebhooks;

      // 7. Calendar
      if (allData.calendarFilterRules) migratedSettings.calendar.filters = allData.calendarFilterRules;

      // 8. Data
      if (allData.lastDriveBackupAt) migratedSettings.data.backup.lastBackupAt = allData.lastDriveBackupAt;

      // Save the new structure
      await SettingsStore.setSettings(migratedSettings);
      console.log("Migration to latest schema complete.");
      
      resolve(true);
    });
  });
}

if (typeof window !== "undefined") {
  window.migrateToLatestSettings = migrateToLatestSettings;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = migrateToLatestSettings;
}
