// settings/settings_migration.js

/**
 * Handles migrating settings from the v1 flat structure to the v2 nested structure.
 * It reads all existing keys, maps them to the new structure if they exist,
 * saves to appSettings, and optionally cleans up the old keys.
 */

async function migrateToV2Settings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(null, async (allData) => {
      const currentVersion = allData.appSettings?.schemaVersion || 1;
      if (currentVersion >= 2) {
        console.log("Settings already migrated to v2 schema.");
        return resolve(false);
      }

      console.log("Starting v1 to v2 settings migration...");
      
      const migratedSettings = JSON.parse(JSON.stringify(SETTINGS_DEFAULTS)); // Deep copy defaults
      migratedSettings.schemaVersion = 2;

      // 1. General & Theme
      if (allData.themeMode) migratedSettings.general.themeMode = allData.themeMode;
      else if (allData.dashboardTheme) migratedSettings.general.themeMode = allData.dashboardTheme;
      
      if (allData.uiLanguage) migratedSettings.general.language = allData.uiLanguage;

      // 2. Google OAuth
      if (allData.oauthClientId) migratedSettings.google.oauth.clientId = allData.oauthClientId;
      if (allData.oauthClientSecret) migratedSettings.google.oauth.clientSecret = allData.oauthClientSecret;

      // 3. AI & API Keys
      if (allData.geminiApiKeys && Array.isArray(allData.geminiApiKeys) && allData.geminiApiKeys.length > 0) {
        migratedSettings.ai.geminiApiKeys = allData.geminiApiKeys;
      } else if (allData.geminiApiKey) {
        migratedSettings.ai.geminiApiKeys = [{ label: "Default", key: allData.geminiApiKey, active: true }];
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
      console.log("Migration to v2 schema complete.", migratedSettings);

      // Note: We are NOT deleting the old keys yet, to ensure backward compatibility 
      // with any running background scripts during the update transition.
      // They can be safely deleted in a future v3 update.
      
      resolve(true);
    });
  });
}

if (typeof window !== "undefined") {
  window.migrateToV2Settings = migrateToV2Settings;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = migrateToV2Settings;
}
