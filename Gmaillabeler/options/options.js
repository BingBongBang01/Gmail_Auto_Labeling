// options/options.js
const $ = (id) => document.getElementById(id);

// 이 페이지는 사용자 입력, AI 생성 텍스트, 그리고 가져온 설정 파일의 내용을
// innerHTML 템플릿으로 그린다. 이스케이프 없이 속성에 꽂으면 따옴표를 닫고
// 이벤트 핸들러를 심을 수 있고, 옵션 페이지는 확장 오리진 권한을 그대로 갖는다.
function escapeHtml(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function initOptions() {
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }

  // Ensure migration is complete, then load settings
  if (typeof migrateToLatestSettings === 'function') {
    await migrateToLatestSettings();
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
      applyTheme(e.target.value); // Instant 0ms visual change
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
        const emailStr = oauth.email ? `<br><span style="color:var(--md-sys-color-on-surface-variant)">${escapeHtml(oauth.email)}</span>` : '';
        statusBox.innerHTML = `<span style="color:var(--md-sys-color-success)" data-i18n="settingsOAuthConnected">Connected to Google Services</span>${emailStr}`;
        if (btnConnect) {
          btnConnect.disabled = false;
          btnConnect.textContent = "Reconnect";
        }
        if (btnDisconnect) btnDisconnect.disabled = false;
      }
      // 방금 넣은 HTML에도 data-i18n이 붙어 있다. 초기 i18nApplyToDom은 이미 지나갔으므로
      // 여기서 다시 적용하지 않으면 OAuth 상태 문구만 영어로 남는다.
      if (typeof i18nApplyToDom === "function") i18nApplyToDom(statusBox);
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
          <input type="text" class="form-input cat-name" placeholder="Category Name" value="${escapeHtml(c.name)}" style="flex:1; font-weight:600;">
          <button class="btn btn-icon danger delete-cat-btn" data-idx="${idx}" style="color:var(--md-sys-color-error)">✕</button>
        </div>
        <textarea class="form-input cat-desc" placeholder="Description of when this category should apply" style="resize:vertical; min-height:40px;">${escapeHtml(c.description)}</textarea>
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
  if (colorsList) {
    if (!settings.calendar.categories || settings.calendar.categories.length === 0) {
      colorsList.innerHTML = `<p class="body-medium" style="color:var(--md-sys-color-on-surface-variant)">No calendar categories defined. Generate them using AI.</p>`;
    } else {
      colorsList.innerHTML = settings.calendar.categories.map((c, idx) => `
        <div class="form-row" style="margin-bottom:8px;">
          <label class="body-medium" style="flex:1;" title="${escapeHtml(c.criteria)}">${escapeHtml(c.name)}</label>
          <select class="form-select calendar-color-select" data-idx="${idx}" style="flex:1;">
            <option value="">Default</option>
            <option value="1" ${c.colorId === "1" ? "selected" : ""}>Lavender (1)</option>
            <option value="2" ${c.colorId === "2" ? "selected" : ""}>Sage (2)</option>
            <option value="3" ${c.colorId === "3" ? "selected" : ""}>Grape (3)</option>
            <option value="4" ${c.colorId === "4" ? "selected" : ""}>Flamingo (4)</option>
            <option value="5" ${c.colorId === "5" ? "selected" : ""}>Banana (5)</option>
            <option value="6" ${c.colorId === "6" ? "selected" : ""}>Tangerine (6)</option>
            <option value="7" ${c.colorId === "7" ? "selected" : ""}>Peacock (7)</option>
            <option value="8" ${c.colorId === "8" ? "selected" : ""}>Graphite (8)</option>
            <option value="9" ${c.colorId === "9" ? "selected" : ""}>Blueberry (9)</option>
            <option value="10" ${c.colorId === "10" ? "selected" : ""}>Basil (10)</option>
            <option value="11" ${c.colorId === "11" ? "selected" : ""}>Tomato (11)</option>
          </select>
        </div>
      `).join("");

      colorsList.querySelectorAll('.calendar-color-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          const idx = parseInt(e.target.getAttribute('data-idx'), 10);
          settings.calendar.categories[idx].colorId = e.target.value;
          // 사용자가 직접 고른 색상은 "user" 출처로 표시한다. 이후 AI로 category를 다시 생성해도
          // 이 색상은 덮어쓰지 않는다.
          settings.calendar.categories[idx].colorSource = "user";
          scheduleSave('calendar.categories', settings.calendar.categories);
        });
      });
    }
  }

  const btnGenerate = $('btnGenerateCalendarCategories');
  if (btnGenerate) {
    btnGenerate.addEventListener('click', () => {
      const statusSpan = $('calendarGenerateStatus');
      btnGenerate.disabled = true;
      statusSpan.textContent = t("calendarGeneratingStatus") || "Generating (may take a minute)...";
      statusSpan.style.color = "var(--md-sys-color-primary)";
      
      chrome.runtime.sendMessage({ action: "job.start", jobType: "calendar_init_categories" }, (response) => {
        btnGenerate.disabled = false;
        if (response && response.error) {
          statusSpan.textContent = "Error: " + response.error;
          statusSpan.style.color = "var(--md-sys-color-error)";
        } else {
          statusSpan.textContent = "Success! Reloading...";
          statusSpan.style.color = "var(--md-sys-color-success)";
          setTimeout(() => location.reload(), 1000);
        }
      });
    });
  }
}
function initAiSettings(settings) {
  // Failover & Retry Options
  const checkFailover = $('checkAiFailover');
  if (checkFailover) {
    checkFailover.checked = settings.ai.requestPolicy?.failoverEnabled ?? true;
    checkFailover.addEventListener('change', e => scheduleSave('ai.requestPolicy.failoverEnabled', e.target.checked));
  }
  
  const checkRetry = $('checkAiRetry');
  if (checkRetry) {
    checkRetry.checked = settings.ai.requestPolicy?.retryEnabled ?? true;
    checkRetry.addEventListener('change', e => scheduleSave('ai.requestPolicy.retryEnabled', e.target.checked));
  }
  
  const maxRetry = $('inputAiMaxRetries');
  if (maxRetry) {
    maxRetry.value = settings.ai.requestPolicy?.maxRetries ?? 3;
    maxRetry.addEventListener('input', e => scheduleSave('ai.requestPolicy.maxRetries', parseInt(e.target.value, 10)));
  }

  const batchSize = $('inputAiBatchSize');
  if (batchSize) {
    batchSize.value = settings.ai.processing?.batchSize ?? 10;
    batchSize.addEventListener('input', e => scheduleSave('ai.processing.batchSize', parseInt(e.target.value, 10)));
  }

  // Credentials UI
  const credsList = $('aiCredentialsList');
  const btnAdd = $('btnAddAiCredential');
  
  // Dialog Elements
  const dialog = $('aiCredentialDialog');
  const dTitle = $('aiCredentialDialogTitle');
  const dId = $('aiCredId');
  const dProvider = $('aiCredProvider');
  const dName = $('aiCredName');
  const dApiKey = $('aiCredApiKey');
  const dModel = $('aiCredModel');
  const btnToggleApiKey = $('btnToggleApiKeyVisibility');
  const btnTest = $('btnAiCredTest');
  const btnCancel = $('btnAiCredCancel');
  const btnSave = $('btnAiCredSave');

  let currentCreds = Array.isArray(settings.ai.credentials) ? [...settings.ai.credentials] : [];

  function renderCredentials() {
    if (!credsList) return;
    
    if (currentCreds.length === 0) {
      credsList.innerHTML = `<p class="body-medium" style="color:var(--md-sys-color-on-surface-variant)">No AI credentials configured.</p>`;
      return;
    }
    
    // Sort by priority
    currentCreds.sort((a, b) => a.priority - b.priority);
    
    credsList.innerHTML = currentCreds.map((cred, idx) => {
      const providerInfo = AIProviderRegistry ? AIProviderRegistry.getProvider(cred.provider) : null;
      const providerName = providerInfo ? providerInfo.name : cred.provider;
      const modelInfo = (AIProviderRegistry?.SUPPORTED_MODELS?.[cred.provider] || []).find(m => m.id === cred.model);
      const modelName = modelInfo ? modelInfo.name : cred.model;
      
      const statusColor = cred.status === "Ready" ? "var(--md-sys-color-success)" : "var(--md-sys-color-error)";
      
      return `
      <div class="cred-card" style="border:1px solid var(--md-sys-color-outline-variant); border-radius:8px; padding:12px; margin-bottom:8px; display:flex; align-items:center; gap:12px;">
        <div style="display:flex; flex-direction:column; align-items:center; gap:4px;">
          <button class="btn btn-icon btn-cred-up" data-id="${escapeHtml(cred.id)}" ${idx === 0 ? 'disabled' : ''} title="Move Up">▲</button>
          <button class="btn btn-icon btn-cred-down" data-id="${escapeHtml(cred.id)}" ${idx === currentCreds.length - 1 ? 'disabled' : ''} title="Move Down">▼</button>
        </div>
        <div style="flex:1;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-weight:600; font-size:16px;">${escapeHtml(cred.name)}</span>
            <span style="font-size:12px; background:var(--md-sys-color-surface-variant); padding:2px 6px; border-radius:4px;">${escapeHtml(providerName)}</span>
          </div>
          <div style="font-size:13px; color:var(--md-sys-color-on-surface-variant); margin-bottom:4px;">Model: ${escapeHtml(modelName)}</div>
          <div style="font-size:13px; display:flex; align-items:center; gap:4px;">
            <span>Status:</span>
            <span style="color:${statusColor}; font-weight:500;">${escapeHtml(cred.status || "Unknown")}</span>
          </div>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <label class="switch" style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:13px;">${cred.enabled ? 'Enabled' : 'Disabled'}</span>
            <input type="checkbox" class="cred-toggle" data-id="${escapeHtml(cred.id)}" ${cred.enabled ? 'checked' : ''}>
          </label>
        </div>
        <div style="display:flex; flex-direction:column; gap:4px;">
          <button class="btn btn-secondary btn-cred-edit" data-id="${escapeHtml(cred.id)}" style="padding:4px 8px; font-size:13px;">Edit</button>
          <button class="btn btn-outlined danger btn-cred-delete" data-id="${escapeHtml(cred.id)}" style="padding:4px 8px; font-size:13px;">Delete</button>
        </div>
      </div>
      `;
    }).join("");
    
    bindCredentialEvents();
  }

  function bindCredentialEvents() {
    credsList.querySelectorAll('.cred-toggle').forEach(el => {
      el.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        const cred = currentCreds.find(c => c.id === id);
        if (cred) {
          cred.enabled = e.target.checked;
          if (cred.enabled && cred.status !== "Ready") cred.status = "Ready"; // Optimistically reset status
          saveCredentials();
        }
      });
    });
    
    credsList.querySelectorAll('.btn-cred-delete').forEach(el => {
      el.addEventListener('click', (e) => {
        if (confirm(t("aiConfirmDelete") || "Are you sure you want to delete this credential?")) {
          const id = e.target.getAttribute('data-id');
          currentCreds = currentCreds.filter(c => c.id !== id);
          saveCredentials();
        }
      });
    });
    
    credsList.querySelectorAll('.btn-cred-edit').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const cred = currentCreds.find(c => c.id === id);
        if (cred) openDialog(cred);
      });
    });
    
    credsList.querySelectorAll('.btn-cred-up').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const idx = currentCreds.findIndex(c => c.id === id);
        if (idx > 0) {
          [currentCreds[idx-1], currentCreds[idx]] = [currentCreds[idx], currentCreds[idx-1]];
          updatePrioritiesAndSave();
        }
      });
    });
    
    credsList.querySelectorAll('.btn-cred-down').forEach(el => {
      el.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const idx = currentCreds.findIndex(c => c.id === id);
        if (idx < currentCreds.length - 1) {
          [currentCreds[idx+1], currentCreds[idx]] = [currentCreds[idx], currentCreds[idx+1]];
          updatePrioritiesAndSave();
        }
      });
    });
  }
  
  function updatePrioritiesAndSave() {
    currentCreds.forEach((c, idx) => c.priority = idx + 1);
    saveCredentials();
  }
  
  function saveCredentials() {
    settings.ai.credentials = currentCreds;
    scheduleSave('ai.credentials', currentCreds);
    renderCredentials();
  }

  // --- Dialog Management ---
  function populateProviders() {
    if (!AIProviderRegistry) return;
    dProvider.innerHTML = AIProviderRegistry.SUPPORTED_PROVIDERS.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  }
  
  // selectedModel이 목록에 없으면 항목을 추가해준다.
  // 그러지 않으면 select에 없는 값을 대입하는 셈이라 조용히 빈 값이 되고,
  // 편집 후 저장하면 사용자가 쓰던 모델이 다른 것으로 바뀐다.
  function populateModels(providerId, selectedModel) {
    if (!AIProviderRegistry) return;
    const models = [...(AIProviderRegistry.SUPPORTED_MODELS[providerId] || [])];
    if (selectedModel && !models.some((m) => m.id === selectedModel)) {
      models.push({ id: selectedModel, name: `${selectedModel} (직접 입력)` });
    }
    dModel.innerHTML = models
      .map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
      .join("");
    if (selectedModel) dModel.value = selectedModel;
  }
  
  if (dProvider) {
    dProvider.addEventListener('change', (e) => populateModels(e.target.value));
  }
  
  if (btnToggleApiKey) {
    btnToggleApiKey.addEventListener('click', () => {
      dApiKey.type = dApiKey.type === "password" ? "text" : "password";
    });
  }

  function openDialog(cred = null) {
    if (!dialog) return;
    
    populateProviders();
    
    if (cred) {
      dTitle.textContent = t("aiCredentialsEdit") || "Edit AI API";
      dId.value = cred.id;
      dProvider.value = cred.provider;
      populateModels(cred.provider, cred.model);
      dName.value = cred.name;
      dApiKey.value = cred.apiKey;
    } else {
      dTitle.textContent = t("aiCredentialsAdd") || "Add AI API";
      dId.value = "";
      dProvider.value = AIProviderRegistry.SUPPORTED_PROVIDERS[0].id;
      populateModels(dProvider.value, AIProviderRegistry.getDefaultModel(dProvider.value));
      dName.value = "";
      dApiKey.value = "";
    }
    
    dialog.showModal();
  }
  
  function closeDialog() {
    if (dialog) {
      dialog.close();
      dApiKey.type = "password";
    }
  }

  btnAdd?.addEventListener('click', () => openDialog());
  btnCancel?.addEventListener('click', () => closeDialog());
  
  btnSave?.addEventListener('click', () => {
    if (!dName.value.trim() || !dApiKey.value.trim()) {
      alert("Name and API Key are required.");
      return;
    }
    
    const isNew = !dId.value;
    const existingIdx = isNew ? -1 : currentCreds.findIndex(c => c.id === dId.value);
    // 다른 탭에서 이 항목을 삭제했다면 findIndex가 -1이 된다.
    // 예전에는 .find(...).priority를 바로 읽어서 그 상황에 TypeError가 났다.
    const existing = existingIdx >= 0 ? currentCreds[existingIdx] : null;

    const credData = {
      id: isNew || !existing ? (crypto.randomUUID ? crypto.randomUUID() : `cred-${Date.now()}`) : dId.value,
      provider: dProvider.value,
      name: dName.value.trim(),
      apiKey: dApiKey.value.trim(),
      model: dModel.value,
      enabled: existing ? existing.enabled !== false : true,
      priority: existing ? existing.priority : currentCreds.length + 1,
      // 실제로 호출해보기 전에는 정상인지 알 수 없다. 첫 요청이 성공하면 라우터가 Ready로 바꾼다.
      status: "Unknown"
    };

    if (existing) {
      currentCreds[existingIdx] = credData;
    } else {
      currentCreds.push(credData);
    }
    
    saveCredentials();
    closeDialog();
  });
  
  btnTest?.addEventListener('click', async () => {
    const originalText = btnTest.textContent;
    btnTest.textContent = "Testing...";
    btnTest.disabled = true;
    
    try {
      const providerId = dProvider.value;
      const apiKey = dApiKey.value.trim();
      const model = dModel.value;
      
      const provider = AIProviderRegistry.getProvider(providerId);
      if (!provider) {
        throw new Error(
          `공급자 어댑터를 찾을 수 없습니다: ${providerId}. 확장 프로그램을 새로 고친 뒤 다시 시도하세요.`
        );
      }
      if (!apiKey) throw new Error("API 키를 입력하세요.");
      if (!model) throw new Error("모델을 선택하세요.");

      // Simple prompt to test
      await provider.generateStructured(apiKey, model, "Reply with status OK.", {
        type: "OBJECT",
        properties: { status: { type: "STRING" } },
        required: ["status"]
      });

      alert(t("aiTestSuccess") || "Connection successful!");
    } catch (err) {
      // 어댑터가 던지는 것은 Error가 아니라 { status, raw }일 수도 있다.
      // normalizeError로 사람이 읽을 수 있는 원인으로 바꿔서 보여준다.
      let msg = err && err.message ? err.message : "";
      try {
        const provider = AIProviderRegistry.getProvider(dProvider.value);
        if (provider && (err?.status || err?.isBadResponse)) {
          const meta = provider.normalizeError(err);
          msg = `${meta.type}${meta.message ? `: ${meta.message}` : ""}`;
        }
      } catch (e) {
        /* 분류 실패 시엔 원래 메시지를 쓴다 */
      }
      alert(`Connection failed: ${msg || "Unknown error"}`);
    } finally {
      btnTest.textContent = originalText;
      btnTest.disabled = false;
    }
  });

  renderCredentials();
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
         if (!file) return;
         const reader = new FileReader();
         reader.readAsText(file,'UTF-8');
         reader.onload = readerEvent => {
            const content = readerEvent.target.result;
            let parsed;
            try {
              parsed = JSON.parse(content);
            } catch (err) {
              alert("설정 파일을 읽을 수 없습니다(JSON 형식 오류).");
              return;
            }

            // 임의의 JSON을 그대로 setSettings에 넘기면 안 된다.
            // 스키마에 없는 키, 잘못된 타입, 그리고 카테고리 이름 같은 문자열에 심어둔
            // HTML이 그대로 저장돼 옵션 화면을 렌더할 때 실행될 수 있다.
            // 예전 구현에는 검증이 전혀 없었다.
            const { value, errors } = validateSettingsAgainstSchema(parsed);

            if (!Object.keys(value).length) {
              alert("가져올 수 있는 설정이 없습니다. 이 확장 프로그램이 내보낸 파일인지 확인하세요.");
              return;
            }
            if (errors.length) {
              const preview = errors.slice(0, 8).join("\n");
              const more = errors.length > 8 ? `\n... 그리고 ${errors.length - 8}건 더` : "";
              const proceed = confirm(
                `설정 파일에서 ${errors.length}건의 항목을 건너뜁니다:\n\n${preview}${more}\n\n나머지만 가져올까요?`
              );
              if (!proceed) return;
            }

            // 가져온 파일에 schemaVersion이 없거나 낮으면 마이그레이션이 다시 돌아
            // 자격 증명이 지워질 수 있다. 현재 버전으로 고정한다.
            value.schemaVersion = SETTINGS_DEFAULTS.schemaVersion;

            SettingsStore.setSettings(value).then(() => {
              showSnackbar("Settings imported successfully!");
              setTimeout(() => window.location.reload(), 1000);
            }).catch((err) => {
              alert("설정을 저장하지 못했습니다: " + (err.message || err));
            });
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

  const includeCreds = $('checkBackupIncludeCredentials');
  if (includeCreds) {
    includeCreds.checked = settings.data.backup.includeCredentials === true;
    includeCreds.addEventListener('change', e => scheduleSave('data.backup.includeCredentials', e.target.checked));
  }
  
  const lastBackup = $('labelLastBackup');
  if (lastBackup) {
    lastBackup.textContent = settings.data.backup.lastBackupAt || "Never";
  }

  const btnBackupNow = $('btnDriveBackupNow');
  if (btnBackupNow) {
    btnBackupNow.addEventListener('click', () => {
      // 자격 증명을 포함하려면 암호가 필요하다. 암호 없이는 키를 백업하지 않는다
      // (평문으로 드라이브에 올리지 않기 위해서다).
      let passphrase = "";
      const includeCredentials = !!$('checkBackupIncludeCredentials')?.checked
        || SettingsStore._cache?.data?.backup?.includeCredentials === true;
      if (includeCredentials) {
        passphrase = prompt(
          "API 키와 OAuth 정보를 암호화해서 함께 백업합니다.\n복원할 때 필요한 암호를 입력하세요.\n(비워두면 키는 백업에서 제외됩니다)"
        ) || "";
      }

      btnBackupNow.disabled = true;
      btnBackupNow.textContent = "Backing up...";
      chrome.runtime.sendMessage({ action: "backupToDrive", includeCredentials, passphrase }, (response) => {
        btnBackupNow.disabled = false;
        btnBackupNow.textContent = "Backup Now";
        if (response && response.ok) {
          showSnackbar("Backup to Google Drive successful!");
          if (lastBackup) lastBackup.textContent = new Date().toLocaleString();
        } else {
          showSnackbar("Backup failed: " + (response?.error || "Unknown Error"));
        }
      });
    });
  }

  const btnRestore = $('btnDriveRestore');
  if (btnRestore) {
    btnRestore.addEventListener('click', () => {
      if (confirm("Restore settings from Google Drive? This will overwrite your current settings.")) {
        btnRestore.disabled = true;
        btnRestore.textContent = "Restoring...";
        // 암호화된 백업이면 복호화 암호가 필요하다.
        const passphrase = prompt(
          "백업에 암호가 걸려 있으면 그 암호를 입력하세요.\n(암호 없이 만든 백업이면 그냥 확인을 누르세요)"
        ) || "";
        // background.js가 처리하는 액션 이름은 startRestoreFromDrive다.
        // "restoreFromDrive"에는 핸들러가 없어서 항상 "Restore failed: Unknown Error"였다.
        chrome.runtime.sendMessage({ action: "startRestoreFromDrive", passphrase }, (response) => {
          btnRestore.disabled = false;
          btnRestore.textContent = "Restore from Drive";
          if (response && response.ok) {
            showSnackbar("Settings restored successfully!");
            setTimeout(() => window.location.reload(), 1000);
          } else {
            showSnackbar("Restore failed: " + (response?.error || "Unknown Error"));
          }
        });
      }
    });
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
