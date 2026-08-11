// options/options.js
const $ = (id) => document.getElementById(id);

async function initOptions() {
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }

  // Ensure migration is complete, then load settings
  if (typeof migrateToV2Settings === 'function') {
    await migrateToV2Settings();
  }

  SettingsStore.getSettings(settings => {
    initNavigation();
    initSearch();
    
    // Phase 2
    initGeneralSettings(settings);
    
    // Phase 3, 4, 5
    initConnectionsSettings(settings);
    initGmailSettings(settings);
    initCalendarSettings(settings);
    
    // Phase 6, 7, 8, 9
    initAiSettings(settings);
    initAutomationSettings(settings);
    initNotificationSettings(settings);
    initDataSettings(settings);
    initAdvancedSettings(settings);
  });
}

function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.tab-panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Update active nav
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Update active panel
      panels.forEach(panel => panel.classList.remove('active'));
      const targetId = item.getAttribute('data-target');
      const targetPanel = $(targetId);
      if (targetPanel) {
        targetPanel.classList.add('active');
      }
    });
  });
}

function initSearch() {
  const searchInput = $('settingsSearch');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    // Basic search: hide/show cards based on query match in their text content
    const activePanel = document.querySelector('.tab-panel.active');
    if (!activePanel) return;
    
    const cards = activePanel.querySelectorAll('.card');
    cards.forEach(card => {
      if (card.textContent.toLowerCase().includes(query)) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
  });
}

const saveTimers = new Map();

// Global debounced save helper
function scheduleSave(path, value) {
  if (saveTimers.has(path)) clearTimeout(saveTimers.get(path));
  const timerId = setTimeout(() => {
    SettingsStore.setSetting(path, value).then(() => {
      showSnackbar("Changes saved successfully.");
      applyTheme(SettingsStore._cache.general.themeMode);
    });
    saveTimers.delete(path);
  }, 500); // 500ms debounce
  saveTimers.set(path, timerId);
}

function showSnackbar(message) {
  const snackbar = $('saveSnackbar');
  if (!snackbar) return;
  snackbar.textContent = message;
  snackbar.classList.add('show');
  setTimeout(() => snackbar.classList.remove('show'), 3000);
}

function applyTheme(themeMode) {
  if (themeMode === "dark" || (themeMode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function initGeneralSettings(settings) {
  const selectThemeMode = $('selectThemeMode');
  const selectUiLanguage = $('selectUiLanguage');
  const checkOpenSidePanelOnGmail = $('checkOpenSidePanelOnGmail');
  const checkShowStatusOnGmail = $('checkShowStatusOnGmail');

  if (selectThemeMode) {
    selectThemeMode.value = settings.general.themeMode;
    applyTheme(settings.general.themeMode); // Apply immediately on load
    selectThemeMode.addEventListener('change', (e) => {
      scheduleSave('general.themeMode', e.target.value);
    });
  }

  if (selectUiLanguage) {
    selectUiLanguage.value = settings.general.language;
    selectUiLanguage.addEventListener('change', async (e) => {
      await SettingsStore.setSetting('general.language', e.target.value);
      if (typeof i18nInit === 'function') {
        await i18nInit(true);
        if (typeof i18nApplyToDom === 'function') {
          i18nApplyToDom(document);
        }
      }
      showSnackbar("Language updated.");
    });
  }

  if (checkOpenSidePanelOnGmail) {
    checkOpenSidePanelOnGmail.checked = settings.general.startupBehavior.openSidePanelOnGmail;
    checkOpenSidePanelOnGmail.addEventListener('change', (e) => {
      scheduleSave('general.startupBehavior.openSidePanelOnGmail', e.target.checked);
    });
  }

  if (checkShowStatusOnGmail) {
    checkShowStatusOnGmail.checked = settings.general.startupBehavior.showStatusOnGmail;
    checkShowStatusOnGmail.addEventListener('change', (e) => {
      scheduleSave('general.startupBehavior.showStatusOnGmail', e.target.checked);
    });
  }
}

function initConnectionsSettings(settings) {
  // Google Account Status
  const statusBox = $('googleAccountStatus');
  const btnConnect = $('btnConnectGoogle');
  const btnDisconnect = $('btnDisconnectGoogle');

  function updateOAuthStatusUI() {
    if (!statusBox) return;
    chrome.runtime.sendMessage({ action: "getOAuthStatus" }, (oauth) => {
      if (chrome.runtime.lastError || !oauth || !oauth.connected) {
        statusBox.innerHTML = `<span style="color:var(--md-sys-color-error)" data-i18n="settingsOAuthNotConnected">Not Connected</span>`;
        if (btnConnect) {
          btnConnect.disabled = false;
          btnConnect.textContent = "Connect Google Account";
        }
        if (btnDisconnect) btnDisconnect.disabled = true;
      } else {
        const emailStr = oauth.email ? `<br><span style="color:var(--md-sys-color-on-surface-variant)">${oauth.email}</span>` : '';
        statusBox.innerHTML = `<span style="color:var(--md-sys-color-success)" data-i18n="settingsOAuthConnected">Connected to Google Services</span>${emailStr}`;
        if (btnConnect) {
          btnConnect.disabled = false;
          btnConnect.textContent = "Reconnect";
        }
        if (btnDisconnect) btnDisconnect.disabled = false;
      }
    });
  }

  updateOAuthStatusUI();

  // Listen for OAuth completion from background
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "oauthStatusUpdated" || msg.type === "oauthStatusUpdated") {
      updateOAuthStatusUI();
    }
  });

  btnConnect?.addEventListener('click', () => {
    btnConnect.disabled = true;
    if (statusBox) statusBox.innerHTML = `<span style="color:var(--md-sys-color-primary)" data-i18n="settingsOAuthConnecting">Opening Google login...</span>`;
    
    chrome.runtime.sendMessage({ action: "authorizeOAuth" }, (response) => {
      if (chrome.runtime.lastError) {
        showSnackbar(chrome.runtime.lastError.message || "Failed to start OAuth");
        updateOAuthStatusUI();
      } else if (response && response.error) {
        showSnackbar(response.error);
        updateOAuthStatusUI();
      } else {
        // We wait for the background to complete and send 'oauthStatusUpdated', or we poll as fallback
        setTimeout(updateOAuthStatusUI, 5000); // fallback polling
      }
    });
  });
  
  btnDisconnect?.addEventListener('click', () => {
    btnDisconnect.disabled = true;
    chrome.runtime.sendMessage({ action: "disconnectOAuth" }, (response) => {
      if (chrome.runtime.lastError) {
        showSnackbar(chrome.runtime.lastError.message);
      } else if (response && response.error) {
        showSnackbar(response.error);
      }
      updateOAuthStatusUI();
    });
  });

  // OAuth Settings
  const inputClientId = $('inputOAuthClientId');
  if (inputClientId) {
    inputClientId.value = settings.google?.oauth?.clientId || '';
    inputClientId.addEventListener('input', (e) => scheduleSave('google.oauth.clientId', e.target.value));
  }
  
  const inputClientSecret = $('inputOAuthClientSecret');
  if (inputClientSecret) {
    inputClientSecret.value = settings.google?.oauth?.clientSecret || '';
    inputClientSecret.addEventListener('input', (e) => scheduleSave('google.oauth.clientSecret', e.target.value));
  }

  $('btnOAuthGuide')?.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("guide/oauth-guide.html") });
  });

  // Gemini API Keys
  let currentKeys = Array.isArray(settings.ai.geminiApiKeys) ? [...settings.ai.geminiApiKeys] : [];
  const keysList = $('geminiApiKeysList');
  
  function renderKeys() {
    if (!keysList) return;
    
    if (currentKeys.length === 0) {
      keysList.innerHTML = `<p class="body-medium" style="color:var(--md-sys-color-error)">No API keys configured.</p>`;
      return;
    }

    keysList.innerHTML = currentKeys.map((k, idx) => `
      <div class="apikey-row" style="display:flex; gap:8px; margin-bottom:8px; align-items:center;">
        <input type="radio" name="activeApiKey" value="${idx}" ${k.active ? 'checked' : ''} style="margin:0 8px;">
        <input type="text" class="form-input apikey-label" placeholder="Label (e.g. Prod)" value="${k.label || ""}" style="flex:1;">
        <input type="password" class="form-input apikey-value" placeholder="AIza..." value="${k.key || ""}" style="flex:2;">
        <button class="btn btn-icon toggle-apikey-btn" type="button" data-idx="${idx}">👁</button>
        <button class="btn btn-icon danger delete-apikey-btn" type="button" data-idx="${idx}" style="color:var(--md-sys-color-error)">✕</button>
      </div>
    `).join("");

    // Bind events
    keysList.querySelectorAll('.toggle-apikey-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const row = e.target.closest('.apikey-row');
        const input = row.querySelector('.apikey-value');
        input.type = input.type === "password" ? "text" : "password";
      });
    });

    keysList.querySelectorAll('.delete-apikey-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        currentKeys.splice(idx, 1);
        if (currentKeys.length > 0 && !currentKeys.some(k => k.active)) {
          currentKeys[0].active = true;
        }
        saveKeys();
      });
    });

    keysList.querySelectorAll('input').forEach(input => {
      input.addEventListener('change', () => {
        collectAndSaveKeys();
      });
    });
  }

  function collectAndSaveKeys() {
    if (!keysList) return;
    const rows = keysList.querySelectorAll('.apikey-row');
    currentKeys = Array.from(rows).map(row => ({
      active: row.querySelector('input[type="radio"]').checked,
      label: row.querySelector('.apikey-label').value.trim(),
      key: row.querySelector('.apikey-value').value.trim()
    }));
    saveKeys();
  }

  function saveKeys() {
    // Only save valid keys
    const validKeys = currentKeys.filter(k => k.key);
    scheduleSave('ai.geminiApiKeys', validKeys);
    renderKeys(); // Re-render to clean up empty rows if they were saved (though we filter them out)
  }

  $('btnAddGeminiKey')?.addEventListener('click', () => {
    currentKeys.push({ label: "", key: "", active: currentKeys.length === 0 });
    renderKeys();
  });
}

function initGmailSettings(settings) {
  // Classification
  const checkEnabled = $('checkGmailClassificationEnabled');
  if (checkEnabled) {
    checkEnabled.checked = settings.gmail.classification.enabled;
    checkEnabled.addEventListener('change', (e) => scheduleSave('gmail.classification.enabled', e.target.checked));
  }
  const inputThreshold = $('inputGmailThreshold');
  if (inputThreshold) {
    inputThreshold.value = settings.gmail.classification.threshold;
    inputThreshold.addEventListener('input', (e) => scheduleSave('gmail.classification.threshold', parseInt(e.target.value, 10)));
  }
  const inputBatch = $('inputGmailBatchSize');
  if (inputBatch) {
    inputBatch.value = settings.gmail.classification.batchSize;
    inputBatch.addEventListener('input', (e) => scheduleSave('gmail.classification.batchSize', parseInt(e.target.value, 10)));
  }

  // Importance
  const tHigh = $('textareaImportanceHigh');
  if (tHigh) {
    tHigh.value = settings.gmail.importance.high;
    tHigh.addEventListener('input', (e) => scheduleSave('gmail.importance.high', e.target.value));
  }
  const tMedium = $('textareaImportanceMedium');
  if (tMedium) {
    tMedium.value = settings.gmail.importance.medium;
    tMedium.addEventListener('input', (e) => scheduleSave('gmail.importance.medium', e.target.value));
  }
  const tLow = $('textareaImportanceLow');
  if (tLow) {
    tLow.value = settings.gmail.importance.low;
    tLow.addEventListener('input', (e) => scheduleSave('gmail.importance.low', e.target.value));
  }

  // Personalization
  const inputHints = $('inputIdentityHints');
  if (inputHints) {
    inputHints.value = settings.gmail.personalization.identityHints;
    inputHints.addEventListener('input', (e) => scheduleSave('gmail.personalization.identityHints', e.target.value));
  }
  const tRules = $('textareaExclusionRules');
  if (tRules) {
    tRules.value = settings.gmail.personalization.exclusionRules;
    tRules.addEventListener('input', (e) => scheduleSave('gmail.personalization.exclusionRules', e.target.value));
  }

  // Fetching & Learning
  const checkLight = $('checkLightweightFetching');
  if (checkLight) {
    checkLight.checked = settings.gmail.fetching.lightweight;
    checkLight.addEventListener('change', (e) => scheduleSave('gmail.fetching.lightweight', e.target.checked));
  }
  const checkLearn = $('checkCorrectionLearning');
  if (checkLearn) {
    checkLearn.checked = settings.gmail.correctionLearning.enabled;
    checkLearn.addEventListener('change', (e) => scheduleSave('gmail.correctionLearning.enabled', e.target.checked));
  }

  // Categories
  let currentCategories = Array.isArray(settings.gmail.categories) ? [...settings.gmail.categories] : [];
  const catList = $('gmailCategoriesList');

  function renderCategories() {
    if (!catList) return;
    if (currentCategories.length === 0) {
      catList.innerHTML = `<p class="body-medium" style="color:var(--md-sys-color-on-surface-variant)">No categories defined.</p>`;
      return;
    }
    catList.innerHTML = currentCategories.map((c, idx) => `
      <div class="category-row" style="border:1px solid var(--md-sys-color-outline-variant); border-radius:8px; padding:12px; margin-bottom:8px;">
        <div style="display:flex; gap:8px; align-items:center; margin-bottom:8px;">
          <input type="text" class="form-input cat-name" placeholder="Category Name" value="${c.name || ''}" style="flex:1; font-weight:600;">
          <button class="btn btn-icon danger delete-cat-btn" data-idx="${idx}" style="color:var(--md-sys-color-error)">✕</button>
        </div>
        <textarea class="form-input cat-desc" placeholder="Description of when this category should apply" style="resize:vertical; min-height:40px;">${c.description || ''}</textarea>
      </div>
    `).join("");

    catList.querySelectorAll('.delete-cat-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-idx'), 10);
        currentCategories.splice(idx, 1);
        saveCategories();
      });
    });

    catList.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('change', () => collectAndSaveCategories());
    });
  }

  function collectAndSaveCategories() {
    if (!catList) return;
    const rows = catList.querySelectorAll('.category-row');
    currentCategories = Array.from(rows).map(row => ({
      name: row.querySelector('.cat-name').value.trim(),
      description: row.querySelector('.cat-desc').value.trim()
    }));
    saveCategories();
  }

  function saveCategories() {
    // Basic validation: name cannot be empty
    const validCats = currentCategories.filter(c => c.name);
    scheduleSave('gmail.categories', validCats);
    renderCategories();
  }

  $('btnAddCategory')?.addEventListener('click', () => {
    currentCategories.push({ name: "", description: "" });
    renderCategories();
  });

  renderCategories();
}

function initCalendarSettings(settings) {
  const checkEnabled = $('checkCalendarEnabled');
  if (checkEnabled) {
    checkEnabled.checked = settings.calendar.general.enabled;
    checkEnabled.addEventListener('change', (e) => scheduleSave('calendar.general.enabled', e.target.checked));
  }
  
  const checkClassify = $('checkCalendarClassificationEnabled');
  if (checkClassify) {
    checkClassify.checked = settings.calendar.classification.enabled;
    checkClassify.addEventListener('change', (e) => scheduleSave('calendar.classification.enabled', e.target.checked));
  }

  const selectRange = $('selectCalendarDateRange');
  if (selectRange) {
    selectRange.value = settings.calendar.classification.dateRange;
    selectRange.addEventListener('change', (e) => scheduleSave('calendar.classification.dateRange', e.target.value));
  }

  const checkColors = $('checkCalendarApplyColors');
  if (checkColors) {
    checkColors.checked = settings.calendar.classification.applyColors;
    checkColors.addEventListener('change', (e) => scheduleSave('calendar.classification.applyColors', e.target.checked));
  }

  // Calendar Colors
  const colorsList = $('calendarColorsList');
  if (colorsList && settings.gmail.categories) {
    let colors = settings.calendar.colors || {};
    
    // We map over gmail categories since they define the classifications
    colorsList.innerHTML = settings.gmail.categories.map(c => `
      <div class="form-row">
        <label class="body-medium" style="flex:1;">${c.name}</label>
        <select class="form-select calendar-color-select" data-category="${c.name}" style="flex:1;">
          <option value="">Default</option>
          <option value="1" ${colors[c.name] === "1" ? "selected" : ""}>Lavender (1)</option>
          <option value="2" ${colors[c.name] === "2" ? "selected" : ""}>Sage (2)</option>
          <option value="3" ${colors[c.name] === "3" ? "selected" : ""}>Grape (3)</option>
          <option value="4" ${colors[c.name] === "4" ? "selected" : ""}>Flamingo (4)</option>
          <option value="5" ${colors[c.name] === "5" ? "selected" : ""}>Banana (5)</option>
          <option value="6" ${colors[c.name] === "6" ? "selected" : ""}>Tangerine (6)</option>
          <option value="7" ${colors[c.name] === "7" ? "selected" : ""}>Peacock (7)</option>
          <option value="8" ${colors[c.name] === "8" ? "selected" : ""}>Graphite (8)</option>
          <option value="9" ${colors[c.name] === "9" ? "selected" : ""}>Blueberry (9)</option>
          <option value="10" ${colors[c.name] === "10" ? "selected" : ""}>Basil (10)</option>
          <option value="11" ${colors[c.name] === "11" ? "selected" : ""}>Tomato (11)</option>
        </select>
      </div>
    `).join("");

    colorsList.querySelectorAll('.calendar-color-select').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const cat = e.target.getAttribute('data-category');
        colors[cat] = e.target.value;
        scheduleSave('calendar.colors', colors);
      });
    });
  }
}
function initAiSettings(settings) {
  const selModel = $('selectAiModel');
  if (selModel) {
    selModel.value = settings.ai.model;
    selModel.addEventListener('change', e => scheduleSave('ai.model', e.target.value));
  }
  const checkRetry = $('checkAiRetry');
  if (checkRetry) {
    checkRetry.checked = settings.ai.retry.enabled;
    checkRetry.addEventListener('change', e => scheduleSave('ai.retry.enabled', e.target.checked));
  }
  const maxRetry = $('inputAiMaxRetries');
  if (maxRetry) {
    maxRetry.value = settings.ai.retry.maxRetries;
    maxRetry.addEventListener('input', e => scheduleSave('ai.retry.maxRetries', parseInt(e.target.value, 10)));
  }
  const fallback = $('checkAiFallbackKey');
  if (fallback) {
    fallback.checked = settings.ai.retry.useFallbackKey;
    fallback.addEventListener('change', e => scheduleSave('ai.retry.useFallbackKey', e.target.checked));
  }
  const concurrency = $('inputAiConcurrency');
  if (concurrency) {
    concurrency.value = settings.ai.processing.concurrency;
    concurrency.addEventListener('input', e => scheduleSave('ai.processing.concurrency', parseInt(e.target.value, 10)));
  }
}

function initAutomationSettings(settings) {
  // Classification
  const autoClassifyEn = $('checkAutoClassifyEnabled');
  if (autoClassifyEn) {
    autoClassifyEn.checked = settings.automation.autoClassify.enabled;
    autoClassifyEn.addEventListener('change', e => scheduleSave('automation.autoClassify.enabled', e.target.checked));
  }
  const autoClassifyThresh = $('inputAutoClassifyThreshold');
  if (autoClassifyThresh) {
    autoClassifyThresh.value = settings.automation.autoClassify.threshold;
    autoClassifyThresh.addEventListener('input', e => scheduleSave('automation.autoClassify.threshold', parseInt(e.target.value, 10)));
  }
  const autoClassifyNew = $('checkAutoClassifyNewOnly');
  if (autoClassifyNew) {
    autoClassifyNew.checked = settings.automation.autoClassify.newMailOnly;
    autoClassifyNew.addEventListener('change', e => scheduleSave('automation.autoClassify.newMailOnly', e.target.checked));
  }

  // Summary
  const autoSumEn = $('checkAutoSummaryEnabled');
  if (autoSumEn) {
    autoSumEn.checked = settings.automation.autoSummary.enabled;
    autoSumEn.addEventListener('change', e => scheduleSave('automation.autoSummary.enabled', e.target.checked));
  }
  const autoSumLabel = $('inputAutoSummaryLabel');
  if (autoSumLabel) {
    autoSumLabel.value = settings.automation.autoSummary.label;
    autoSumLabel.addEventListener('input', e => scheduleSave('automation.autoSummary.label', e.target.value));
  }
  const autoSumMax = $('inputAutoSummaryMaxCount');
  if (autoSumMax) {
    autoSumMax.value = settings.automation.autoSummary.maxCount;
    autoSumMax.addEventListener('input', e => scheduleSave('automation.autoSummary.maxCount', parseInt(e.target.value, 10)));
  }
  const autoSumCriteria = $('textareaAutoSummaryCriteria');
  if (autoSumCriteria) {
    autoSumCriteria.value = settings.automation.autoSummary.criteria;
    autoSumCriteria.addEventListener('input', e => scheduleSave('automation.autoSummary.criteria', e.target.value));
  }
  const autoSumDiscord = $('checkAutoSummarySendDiscord');
  if (autoSumDiscord) {
    autoSumDiscord.checked = settings.automation.autoSummary.sendToDiscord;
    autoSumDiscord.addEventListener('change', e => scheduleSave('automation.autoSummary.sendToDiscord', e.target.checked));
  }
}

function initNotificationSettings(settings) {
  const discordEn = $('checkDiscordEnabled');
  if (discordEn) {
    discordEn.checked = settings.notifications.discord.enabled;
    discordEn.addEventListener('change', e => scheduleSave('notifications.discord.enabled', e.target.checked));
  }
  const discordDefault = $('inputDiscordDefault');
  if (discordDefault) {
    discordDefault.value = settings.notifications.discord.defaultWebhook;
    discordDefault.addEventListener('input', e => scheduleSave('notifications.discord.defaultWebhook', e.target.value));
  }
  const discordHigh = $('inputDiscordHigh');
  if (discordHigh) {
    discordHigh.value = settings.notifications.discord.highWebhook;
    discordHigh.addEventListener('input', e => scheduleSave('notifications.discord.highWebhook', e.target.value));
  }
  const discordMedium = $('inputDiscordMedium');
  if (discordMedium) {
    discordMedium.value = settings.notifications.discord.mediumWebhook;
    discordMedium.addEventListener('input', e => scheduleSave('notifications.discord.mediumWebhook', e.target.value));
  }
  const discordLow = $('inputDiscordLow');
  if (discordLow) {
    discordLow.value = settings.notifications.discord.lowWebhook;
    discordLow.addEventListener('input', e => scheduleSave('notifications.discord.lowWebhook', e.target.value));
  }
  const discordPerEmail = $('checkDiscordPerEmail');
  if (discordPerEmail) {
    discordPerEmail.checked = settings.notifications.discord.sendPerEmail;
    discordPerEmail.addEventListener('change', e => scheduleSave('notifications.discord.sendPerEmail', e.target.checked));
  }
}

function initDataSettings(settings) {
  const btnExport = $('btnExportSettings');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(SettingsStore._cache, null, 2));
      const anchor = document.createElement('a');
      anchor.setAttribute("href", dataStr);
      anchor.setAttribute("download", "gmail_ai_labeler_settings.json");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    });
  }

  const btnImport = $('btnImportSettings');
  if (btnImport) {
    btnImport.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = e => { 
         const file = e.target.files[0]; 
         const reader = new FileReader();
         reader.readAsText(file,'UTF-8');
         reader.onload = readerEvent => {
            const content = readerEvent.target.result;
            try {
              const parsed = JSON.parse(content);
              SettingsStore.setSettings(parsed).then(() => {
                showSnackbar("Settings imported successfully!");
                setTimeout(() => window.location.reload(), 1000);
              });
            } catch(err) {
              alert("Invalid settings file.");
            }
         }
      }
      input.click();
    });
  }

  const driveBackup = $('checkDriveAutoBackup');
  if (driveBackup) {
    driveBackup.checked = settings.data.backup.autoBackupToDrive;
    driveBackup.addEventListener('change', e => scheduleSave('data.backup.autoBackupToDrive', e.target.checked));
  }
  
  const lastBackup = $('labelLastBackup');
  if (lastBackup) {
    lastBackup.textContent = settings.data.backup.lastBackupAt || "Never";
  }
}

function initAdvancedSettings(settings) {
  const checkDebug = $('checkDebugMode');
  if (checkDebug) {
    checkDebug.checked = settings.advanced.logging.debugMode;
    checkDebug.addEventListener('change', e => scheduleSave('advanced.logging.debugMode', e.target.checked));
  }
  
  const checkVerbose = $('checkVerboseLogging');
  if (checkVerbose) {
    checkVerbose.checked = settings.advanced.logging.verbose;
    checkVerbose.addEventListener('change', e => scheduleSave('advanced.logging.verbose', e.target.checked));
  }
  
  const btnReset = $('btnResetAllSettings');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm("Are you sure you want to reset ALL settings to default? This cannot be undone.")) {
        SettingsStore.resetAllSettings().then(() => {
          showSnackbar("Settings reset to default.");
          setTimeout(() => window.location.reload(), 1000);
        });
      }
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOptions);
} else {
  initOptions();
}
