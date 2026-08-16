// sidepanel/workspaces/settings.js
// 사이드패널에서 바로 바꾸는 설정 패널.

import { SettingsStore } from "../../settings/settings_store.js";

import { $, escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { applyTheme } from "../ui/theme.js";

let currentSettingsSection = "oauth";

// 밖에서는 이 함수로만 읽는다(import 바인딩에 직접 대입할 수 없으므로 읽기 경로도 하나로 둔다).
function getCurrentSettingsSection() {
  return currentSettingsSection;
}


function bindSettingsPanelEvents(sectionId, settings) {
  if (!settings) return;

  if (sectionId === "oauth") {
    const badge = $("spOAuthStatusBadge");
    const desc = $("spOAuthAccountDesc");
    const btnConnect = $("btnConnectGoogleSP");
    const btnDisconnect = $("btnDisconnectGoogleSP");

    function refreshOAuthStatus() {
      chrome.runtime.sendMessage({ action: "getOAuthStatus" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.connected) {
          if (badge) {
            badge.textContent = res && res.connecting ? "로그인 진행 중" : "미연결";
            badge.className = "oauth-status-badge error";
          }
          if (desc) {
            desc.textContent = res && res.connecting
              ? "Google 로그인 창에서 인증을 완료해 주세요."
              : "Google 계정에 로그인하여 AI 자동 라벨링 및 캘린더 기능을 연동하세요.";
          }
          if (btnConnect) {
            btnConnect.textContent = "Google 계정 로그인 / 연결";
            btnConnect.style.display = "inline-flex";
            btnConnect.disabled = !!(res && res.connecting);
          }
          if (btnDisconnect) btnDisconnect.style.display = "none";
        } else {
          if (badge) {
            badge.textContent = "연결됨";
            badge.className = "oauth-status-badge success";
          }
          if (desc) desc.textContent = res.email ? `${res.email} 계정과 연결되어 정상 작동 중입니다.` : "Google 서비스와 정상 연결되어 있습니다.";
          if (btnConnect) {
            btnConnect.textContent = "계정 재연결";
            btnConnect.style.display = "inline-flex";
            btnConnect.disabled = false;
          }
          if (btnDisconnect) btnDisconnect.style.display = "inline-flex";
        }
      });
    }

    refreshOAuthStatus();

    // 배경 스크립트가 로그인 성공/실패 직후 알려준다. 예전에는 3.5초짜리 타이머 하나에만
    // 의존해서, 계정 선택과 동의를 마치는 데 그보다 오래 걸리면(거의 항상) 로그인에 성공해도
    // 화면은 계속 "미연결"로 남았다.
    if (!bindSettingsPanelEvents._oauthListenerBound) {
      bindSettingsPanelEvents._oauthListenerBound = true;
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg && (msg.action === "oauthStatusUpdated" || msg.type === "oauthStatusUpdated")) {
          if (currentSettingsSection === "oauth") renderSettingsPanel("oauth");
        }
      });
    }

    // Client ID/Secret을 저장하고 나서 인증 창을 연다.
    // 백그라운드는 저장된 설정만 읽으므로, 입력만 하고 연결을 누르면 예전 값(또는 빈 값)으로 시도했다.
    function saveOAuthCredentials(done) {
      const clientId = ($("spOAuthClientId")?.value || "").trim();
      const clientSecret = ($("spOAuthClientSecret")?.value || "").trim();
      SettingsStore.updateCategory("google", { oauth: { clientId, clientSecret } }, () => done(clientId));
    }

    btnConnect?.addEventListener("click", () => {
      if (!($("spOAuthClientId")?.value || "").trim()) {
        showSettingsToast("먼저 아래에 Client ID를 입력해 주세요.");
        return;
      }
      btnConnect.disabled = true;
      saveOAuthCredentials(() => {
        if (desc) desc.textContent = "Google 로그인 창이 열렸습니다. 인증을 완료해 주세요...";
        chrome.runtime.sendMessage({ action: "authorizeOAuth" }, (res) => {
          if (chrome.runtime.lastError) {
            showSettingsToast(chrome.runtime.lastError.message || "OAuth 시작 실패");
          } else if (res && res.ok === false) {
            showSettingsToast(res.error || "OAuth 시작 실패");
          } else {
            showSettingsToast("Google 로그인이 시작되었습니다.");
          }
          refreshOAuthStatus();
        });
      });
    });

    btnDisconnect?.addEventListener("click", () => {
      btnDisconnect.disabled = true;
      chrome.runtime.sendMessage({ action: "disconnectOAuth" }, (res) => {
        btnDisconnect.disabled = false;
        if (chrome.runtime.lastError) {
          showSettingsToast(chrome.runtime.lastError.message || "연동 해제 실패");
        } else if (res && res.ok === false) {
          showSettingsToast(res.error || "연동 해제 실패");
        } else {
          showSettingsToast("Google 계정 연동이 해제되었습니다.");
        }
        refreshOAuthStatus();
      });
    });

    const saveBtn = $("btnSaveOAuth");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        saveOAuthCredentials(() => {
          showSettingsToast("OAuth 설정이 저장되었습니다.");
          refreshOAuthStatus();
        });
      });
    }
    $("btnOAuthOptionsGuide")?.addEventListener("click", () => {
      chrome.runtime.openOptionsPage?.();
    });
  }

  if (sectionId === "general") {
    const themeSelect = $("spThemeMode");
    if (themeSelect) {
      themeSelect.addEventListener("change", (e) => {
        const theme = e.target.value;
        applyTheme(theme);
        SettingsStore.updateCategory("general", { themeMode: theme }, () => {
          showSettingsToast("테마가 변경되었습니다.");
        });
      });
    }

    const langSelect = $("spLanguage");
    if (langSelect) {
      langSelect.addEventListener("change", (e) => {
        const lang = e.target.value;
        SettingsStore.updateCategory("general", { language: lang }, () => {
          showSettingsToast("언어가 저장되었습니다.");
        });
      });
    }

    const openSideCheck = $("spOpenSidePanel");
    const showStatusCheck = $("spShowStatus");
    const saveStartup = () => {
      SettingsStore.updateCategory("general", {
        startupBehavior: {
          openSidePanelOnGmail: !!openSideCheck?.checked,
          showStatusOnGmail: !!showStatusCheck?.checked
        }
      }, () => {
        showSettingsToast("시작 옵션이 저장되었습니다.");
      });
    };
    openSideCheck?.addEventListener("change", saveStartup);
    showStatusCheck?.addEventListener("change", saveStartup);
  }

  if (sectionId === "ai") {
    const saveBtn = $("btnSaveAi");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const apiKey = ($("spGeminiApiKey")?.value || "").trim();
        const model = $("spGeminiModel")?.value || "gemini-2.0-flash";
        const rpmLimit = parseInt($("spRpmLimit")?.value, 10) || 15;

        const credentials = [...(settings.ai?.credentials || [])];
        if (credentials.length === 0) {
          credentials.push({
            id: "cred_gemini_1",
            provider: "gemini",
            name: "Gemini Key",
            apiKey,
            model,
            enabled: true,
            priority: 1,
            status: "active"
          });
        } else {
          credentials[0].apiKey = apiKey;
          credentials[0].model = model;
        }

        SettingsStore.updateCategory("ai", {
          credentials,
          requestPolicy: {
            ...(settings.ai?.requestPolicy || {}),
            rpmLimit
          }
        }, () => {
          showSettingsToast("AI 설정이 저장되었습니다.");
        });
      });
    }
  }

  if (sectionId === "labels") {
    const saveBtn = $("btnSaveLabels");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const enabled = !!$("spClassificationEnabled")?.checked;
        const threshold = parseInt($("spThreshold")?.value, 10) || 1;
        const batchSize = parseInt($("spBatchSize")?.value, 10) || 50;

        SettingsStore.updateCategory("gmail", {
          classification: {
            ...(settings.gmail?.classification || {}),
            enabled,
            threshold,
            batchSize
          }
        }, () => {
          showSettingsToast("라벨 설정이 저장되었습니다.");
        });
      });
    }
  }

  if (sectionId === "automation") {
    const autoCheck = $("spAutoClassify");
    const newMailCheck = $("spNewMailOnly");
    const saveAuto = () => {
      SettingsStore.updateCategory("automation", {
        autoClassify: {
          ...(settings.automation?.autoClassify || {}),
          enabled: !!autoCheck?.checked,
          newMailOnly: !!newMailCheck?.checked
        }
      }, () => {
        showSettingsToast("자동화 설정이 저장되었습니다.");
      });
    };
    autoCheck?.addEventListener("change", saveAuto);
    newMailCheck?.addEventListener("change", saveAuto);
  }

  if (sectionId === "backup") {
    $("btnExportSettings")?.addEventListener("click", () => {
      SettingsStore.exportSettings((jsonStr) => {
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `gmail_labeler_settings_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showSettingsToast("설정 파일이 다운로드되었습니다.");
      });
    });

    const fileInput = $("spImportFileInput");
    $("btnImportSettings")?.addEventListener("click", () => {
      fileInput?.click();
    });

    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          SettingsStore.saveSettings(imported, () => {
            showSettingsToast("설정이 성공적으로 복원되었습니다.");
            renderSettingsPanel("backup");
          });
        } catch (_) {
          showSettingsToast("올바른 JSON 파일이 아닙니다.");
        }
      };
      reader.readAsText(file);
    });

    $("btnResetSettings")?.addEventListener("click", () => {
      if (confirm("모든 설정을 초기 기본값으로 되돌리시겠습니까?")) {
        SettingsStore.resetToDefaults(() => {
          showSettingsToast("설정이 초기화되었습니다.");
          renderSettingsPanel("backup");
        });
      }
    });
  }
}

function renderSettingsPanel(sectionId) {
  currentSettingsSection = sectionId || "oauth";
  const container = $("panelContainer");
  const dynamicActions = $("dynamicActions");
  if (!container) return;

  if (dynamicActions) dynamicActions.innerHTML = "";
  container.innerHTML = "";

  document.querySelectorAll(".action-nav-track .service-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.action === `settings_${currentSettingsSection}`);
  });

  const wrapper = document.createElement("div");
  wrapper.className = "settings-panel-wrapper";

  SettingsStore.getSettings((settings) => {
    let title = "";
    let icon = "";
    let contentHtml = "";

    switch (currentSettingsSection) {
      case "oauth":
        title = "Google OAuth 설정";
        icon = "🔑";
        const clientId = settings?.google?.oauth?.clientId || "";
        const clientSecret = settings?.google?.oauth?.clientSecret || "";

        contentHtml = `
          <div class="oauth-account-card" id="spOAuthAccountCard">
            <div class="oauth-account-header">
              <span class="oauth-account-title">Google 계정 연동 상태</span>
              <span class="oauth-status-badge" id="spOAuthStatusBadge">확인 중...</span>
            </div>
            <div class="oauth-account-desc" id="spOAuthAccountDesc">계정 연동 상태를 확인하고 있습니다.</div>
            <div class="oauth-btn-group">
              <button class="btn btn-primary" id="btnConnectGoogleSP">Google 계정 로그인 / 연결</button>
              <button class="btn btn-outlined danger" id="btnDisconnectGoogleSP" style="display:none;">연동 해제</button>
            </div>
          </div>
          <div class="form-group" style="margin-top: 14px;">
            <label class="settings-label">Client ID</label>
            <input type="text" id="spOAuthClientId" class="settings-input" placeholder="Google Cloud OAuth Client ID" value="${escapeHtml(clientId)}">
          </div>
          <div class="form-group">
            <label class="settings-label">Client Secret</label>
            <input type="password" id="spOAuthClientSecret" class="settings-input" placeholder="Client Secret" value="${escapeHtml(clientSecret)}">
          </div>
          <div class="settings-btn-row">
            <button class="btn btn-primary" id="btnSaveOAuth">OAuth 정보 저장</button>
            <button class="btn btn-outlined" id="btnOAuthOptionsGuide">전체 설정 열기</button>
          </div>
        `;
        break;

      case "general":
        title = "테마 및 언어 설정";
        icon = "🎨";
        const theme = settings?.general?.themeMode || "system";
        const lang = settings?.general?.language || "en";
        const openSidePanel = !!settings?.general?.startupBehavior?.openSidePanelOnGmail;
        const showStatus = !!settings?.general?.startupBehavior?.showStatusOnGmail;

        contentHtml = `
          <div class="form-group">
            <label class="settings-label">테마 모드 (Theme)</label>
            <select id="spThemeMode" class="settings-select">
              <option value="system" ${theme === "system" ? "selected" : ""}>시스템 기본값 (System)</option>
              <option value="light" ${theme === "light" ? "selected" : ""}>라이트 모드 (Light)</option>
              <option value="dark" ${theme === "dark" ? "selected" : ""}>다크 모드 (Dark)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="settings-label">언어 (Language)</label>
            <select id="spLanguage" class="settings-select">
              <option value="ko" ${lang === "ko" ? "selected" : ""}>한국어 (Korean)</option>
              <option value="en" ${lang === "en" ? "selected" : ""}>English</option>
              <option value="ja" ${lang === "ja" ? "selected" : ""}>日本語 (Japanese)</option>
              <option value="zh_CN" ${lang === "zh_CN" ? "selected" : ""}>简体中文 (Chinese)</option>
            </select>
          </div>
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="spOpenSidePanel" ${openSidePanel ? "checked" : ""}>
              <span>Gmail 열릴 때 사이드패널 자동 열기</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" id="spShowStatus" ${showStatus ? "checked" : ""}>
              <span>Gmail 상단에 확장 프로그램 상태 배지 표시</span>
            </label>
          </div>
        `;
        break;

      case "ai":
        title = "Gemini AI 모델 설정";
        icon = "✨";
        const cred = (settings?.ai?.credentials && settings.ai.credentials[0]) || {};
        const apiKey = cred.apiKey || "";
        const model = cred.model || "gemini-2.0-flash";
        const rpm = settings?.ai?.requestPolicy?.rpmLimit || 15;

        contentHtml = `
          <div class="form-group">
            <label class="settings-label">Gemini API 키</label>
            <input type="password" id="spGeminiApiKey" class="settings-input" placeholder="AI Studio API Key" value="${escapeHtml(apiKey)}">
          </div>
          <div class="form-group">
            <label class="settings-label">AI 모델</label>
            <select id="spGeminiModel" class="settings-select">
              <option value="gemini-2.0-flash" ${model === "gemini-2.0-flash" ? "selected" : ""}>Gemini 2.0 Flash (빠르고 권장)</option>
              <option value="gemini-1.5-flash" ${model === "gemini-1.5-flash" ? "selected" : ""}>Gemini 1.5 Flash</option>
              <option value="gemini-1.5-pro" ${model === "gemini-1.5-pro" ? "selected" : ""}>Gemini 1.5 Pro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="settings-label">분당 요청 한도 (RPM Limit)</label>
            <input type="number" id="spRpmLimit" class="settings-input" min="1" max="60" value="${rpm}">
          </div>
          <div class="settings-btn-row">
            <button class="btn btn-primary" id="btnSaveAi">AI 설정 저장</button>
          </div>
        `;
        break;

      case "labels":
        title = "라벨 및 분류 설정";
        icon = "🏷️";
        const classificationEnabled = settings?.gmail?.classification?.enabled !== false;
        const threshold = settings?.gmail?.classification?.threshold || 1;
        const batchSize = settings?.gmail?.classification?.batchSize || 50;

        contentHtml = `
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="spClassificationEnabled" ${classificationEnabled ? "checked" : ""}>
              <span>AI 자동 분류 활성화</span>
            </label>
          </div>
          <div class="form-group">
            <label class="settings-label">분류 트리거 기준 (신규 메일 수)</label>
            <input type="number" id="spThreshold" class="settings-input" min="1" max="20" value="${threshold}">
          </div>
          <div class="form-group">
            <label class="settings-label">1회 배치 처리량 (Batch Size)</label>
            <input type="number" id="spBatchSize" class="settings-input" min="10" max="100" value="${batchSize}">
          </div>
          <div class="settings-btn-row">
            <button class="btn btn-primary" id="btnSaveLabels">라벨 설정 저장</button>
          </div>
        `;
        break;

      case "automation":
        title = "자동화 실행 설정";
        icon = "⚡";
        const autoEnabled = settings?.automation?.autoClassify?.enabled !== false;
        const newMailOnly = settings?.automation?.autoClassify?.newMailOnly !== false;

        contentHtml = `
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="spAutoClassify" ${autoEnabled ? "checked" : ""}>
              <span>백그라운드 자동 라벨링 활성화</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" id="spNewMailOnly" ${newMailOnly ? "checked" : ""}>
              <span>읽지 않은 신규 메일만 처리</span>
            </label>
          </div>
        `;
        break;

      case "notifications":
        title = "알림 설정";
        icon = "🔔";
        contentHtml = `
          <div class="settings-status-banner info">
            <span>🔔 라벨링 작업 완료 및 상태 변경 알림이 브라우저 알림으로 전달됩니다.</span>
          </div>
        `;
        break;

      case "backup":
        title = "데이터 및 백업";
        icon = "💾";
        contentHtml = `
          <div class="settings-btn-column">
            <button class="btn btn-outlined" id="btnExportSettings">📥 설정 JSON 내보내기 (백업)</button>
            <button class="btn btn-outlined" id="btnImportSettings">📤 설정 JSON 가져오기 (복원)</button>
            <input type="file" id="spImportFileInput" accept=".json" style="display:none;">
            <button class="btn btn-outlined danger" id="btnResetSettings">⚠️ 전체 설정 초기화</button>
          </div>
        `;
        break;

      default:
        title = "설정";
        icon = "⚙️";
        contentHtml = `<p class="body-medium">원하는 설정 타일을 상단 중간바에서 선택해 주세요.</p>`;
    }

    wrapper.innerHTML = `
      <div class="settings-card">
        <div class="settings-header">
          <span class="settings-header-icon">${icon}</span>
          <h3 class="settings-header-title">${title}</h3>
          <span class="settings-feedback-pill" id="settingsFeedbackPill"></span>
        </div>
        <div class="settings-body">
          ${contentHtml}
        </div>
      </div>
    `;

    container.appendChild(wrapper);
    bindSettingsPanelEvents(currentSettingsSection, settings);
  });
}


export {
  bindSettingsPanelEvents,
  getCurrentSettingsSection,
  renderSettingsPanel,
};
