// popup/popup.js
// Gmail AI Labeler - Copyright (c) 2026 김태형 (thk7410@gmail.com). All rights reserved.
// See LICENSE file at the extension root for terms. Unauthorized redistribution or resale is prohibited.
const DEFAULT_CATEGORIES = ["보안", "광고", "쇼핑", "공지", "뉴스레터", "업무", "개인", "기타"]; // i18n 로딩 실패 시 최종 안전망

function getLocalizedDefaultCategories() {
  const raw = t("defaultCategoriesList");
  if (!raw || raw === "defaultCategoriesList") return DEFAULT_CATEGORIES;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ---------------- 테마 (라이트/다크/시스템) ----------------
const darkModeMql = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(mode) {
  let effective = mode;
  if (mode === "system") {
    effective = darkModeMql.matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", effective);

  document.querySelectorAll(".theme-row button").forEach((b) => b.classList.remove("active"));
  const activeBtn = document.getElementById(
    mode === "dark" ? "themeDarkBtn" : mode === "light" ? "themeLightBtn" : "themeSystemBtn"
  );
  if (activeBtn) activeBtn.classList.add("active");
}

function initTheme() {
  chrome.storage.local.get(["themeMode"], (result) => {
    const mode = result.themeMode || "system";
    applyTheme(mode);
  });
  darkModeMql.addEventListener("change", () => {
    chrome.storage.local.get(["themeMode"], (result) => {
      if ((result.themeMode || "system") === "system") applyTheme("system");
    });
  });
}


function setTheme(mode) {
  chrome.storage.local.set({ themeMode: mode });
  applyTheme(mode);
}

// ---------------- 언어 선택 ----------------
function initLanguageSelect() {
  const languageSelect = document.getElementById("languageSelect");
  chrome.storage.local.get(["uiLanguage"], (result) => {
    languageSelect.value = result.uiLanguage || "system";
  });
  const LANG_NATIVE_NAME = { ko: "한국어", en: "English", ja: "日本語", zh_CN: "简体中文" };
  const LANG_YES_WORD = { ko: "예", en: "Yes", ja: "はい", zh_CN: "是" };
  const LANG_NO_WORD = { ko: "아니오", en: "No", ja: "いいえ", zh_CN: "否" };

  const translateLabelsConfirmBox = document.getElementById("translateLabelsConfirmBox");
  const translateLabelsConfirmText = document.getElementById("translateLabelsConfirmText");
  const translateLabelsYesBtn = document.getElementById("translateLabelsYesBtn");
  const translateLabelsNoBtn = document.getElementById("translateLabelsNoBtn");

  function resolveEffectiveLocale(localeOrSystem) {
    if (localeOrSystem !== "system") return localeOrSystem;
    try {
      const mapped = i18nMapBrowserLangToSupported(chrome.i18n.getUILanguage());
      return mapped;
    } catch (e) {
      return "en";
    }
  }

  languageSelect.addEventListener("change", () => {
    const oldLocale = __i18nLocale; // i18nInit(true) 전이라 아직 이전 언어값 그대로임
    const newSelection = languageSelect.value;
    const newLocale = resolveEffectiveLocale(newSelection);

    chrome.storage.local.set({ uiLanguage: newSelection }, async () => {
      await i18nInit(true);
      i18nApplyToDom(document);

      if (!oldLocale || oldLocale === newLocale) {
        location.reload();
        return;
      }

      // 기존 언어 + 새 언어 둘 다 확인창에 적어서 어떤 언어로 바뀌는지 명확히 하고,
      // 버튼도 두 언어 단어를 같이 보여준다("예 / Yes" 식) - 화면 언어가 이미 바뀐 뒤라 헷갈리지 않게.
      const oldName = LANG_NATIVE_NAME[oldLocale] || oldLocale;
      const newName = LANG_NATIVE_NAME[newLocale] || newLocale;
      translateLabelsConfirmText.textContent = t("confirmTranslateLabels", [oldName, newName]);
      const yesWord = `${LANG_YES_WORD[oldLocale] || "Yes"} / ${LANG_YES_WORD[newLocale] || "Yes"}`;
      const noWord = `${LANG_NO_WORD[oldLocale] || "No"} / ${LANG_NO_WORD[newLocale] || "No"}`;
      translateLabelsYesBtn.textContent = yesWord;
      translateLabelsNoBtn.textContent = noWord;
      translateLabelsConfirmBox.style.display = "block";

      const cleanup = () => {
        translateLabelsConfirmBox.style.display = "none";
        location.reload();
      };

      translateLabelsYesBtn.onclick = () => {
        chrome.runtime.sendMessage({ action: "startTranslateCategories", targetLocale: newLocale }, () => {
          cleanup();
        });
      };
      translateLabelsNoBtn.onclick = cleanup;
    });
  });
}

// ---------------- 메인 초기화 (i18n 로드 후 진행) ----------------
async function main() {
  await i18nInit();
  i18nApplyToDom(document);
  initTheme();
  initLanguageSelect();

  // ---------------- 탭 전환 ----------------
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
    });
  });

  function openLogWindow() {
    const url = chrome.runtime.getURL("log/log.html");
    try {
      chrome.windows.create({ url, type: "popup", width: 560, height: 700 }, (win) => {
        if (chrome.runtime.lastError || !win) chrome.tabs.create({ url });
      });
    } catch (e) {
      chrome.tabs.create({ url });
    }
  }

  const logBtn = document.getElementById("logBtn"); if (logBtn) logBtn.addEventListener("click", openLogWindow);
  const advancedOptLink = document.getElementById("advancedOptionsLink"); if (advancedOptLink) advancedOptLink.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  const openDashboard = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
  };
  const openDashboardTabBtn = document.getElementById("openDashboardTabBtn");
  if (openDashboardTabBtn) openDashboardTabBtn.addEventListener("click", openDashboard);
  const openDashboardLink = document.getElementById("openDashboardLink");
  if (openDashboardLink) openDashboardLink.addEventListener("click", openDashboard);

  const supportBtn = document.getElementById("supportLinkBtn"); if (supportBtn) supportBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://ko-fi.com/thk7410" });
  });

  const headerDonateBtn = document.getElementById("headerDonateBtn"); if (headerDonateBtn) headerDonateBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://ko-fi.com/thk7410" });
  });

  const themeLightBtn = document.getElementById("themeLightBtn"); if (themeLightBtn) themeLightBtn.addEventListener("click", () => setTheme("light"));
  const themeDarkBtn = document.getElementById("themeDarkBtn"); if (themeDarkBtn) themeDarkBtn.addEventListener("click", () => setTheme("dark"));
  const themeSystemBtn = document.getElementById("themeSystemBtn"); if (themeSystemBtn) themeSystemBtn.addEventListener("click", () => setTheme("system"));

  // ---------------- 상단 상태 표시 ----------------
  const statusPill = document.getElementById("statusPill");
  const statusPillText = document.getElementById("statusPillText");
  const apiErrorBanner = document.getElementById("apiErrorBanner");

  function renderApiError(error) {
    if (!error || !error.message) {
      apiErrorBanner.classList.remove("show");
      apiErrorBanner.textContent = "";
      return;
    }
    apiErrorBanner.textContent = `${error.service || "API"} ${t("apiErrorPrefix")}: ${error.message}`;
    apiErrorBanner.classList.add("show");
  }

  function renderStatusPill(jobStatus) {
    statusPill.className = "status-pill";
    if (jobStatus === "running") {
      statusPill.classList.add("running");
      statusPillText.textContent = t("statusRunning");
    } else if (jobStatus === "done") {
      statusPill.classList.add("done");
      statusPillText.textContent = t("statusDone");
    } else if (jobStatus === "error") {
      statusPill.classList.add("error");
      statusPillText.textContent = t("statusError");
    } else if (jobStatus === "quota_exceeded") {
      statusPill.classList.add("error");
      statusPillText.textContent = t("statusQuotaExceeded");
    } else if (jobStatus === "cancelled") {
      statusPill.classList.add("cancelled");
      statusPillText.textContent = t("statusCancelled");
    } else {
      statusPillText.textContent = t("statusIdle");
    }
  }

  // ---------------- 분류 탭 ----------------
  const startBtn = document.getElementById("startBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const forceCancelBtn = document.getElementById("forceCancelBtn");
  const batchCountInput = document.getElementById("batchCountInput");
  const emailCountInput = document.getElementById("emailCountInput");
  const batchHint = document.getElementById("batchHint");
  const resultBox = document.getElementById("resultBox");
  const progressWrap = document.getElementById("progressWrap");
  const progressBar = document.getElementById("progressBar");
  const progressText = document.getElementById("progressText");

  let pollTimer = null;
  let config = { batchSize: 40, maxBatchCountPerRun: 10, maxEmailCountPerRun: 400 };
  let syncing = false;

  function syncFromEmailCount() {
    if (syncing) return;
    syncing = true;
    let count = parseInt(emailCountInput.value, 10);
    if (isNaN(count) || count < 1) count = 1;
    if (count > config.maxEmailCountPerRun) count = config.maxEmailCountPerRun;
    emailCountInput.value = count;
    batchCountInput.value = Math.max(1, Math.ceil(count / config.batchSize));
    syncing = false;
  }

  function syncFromBatchCount() {
    if (syncing) return;
    syncing = true;
    let batches = parseInt(batchCountInput.value, 10);
    if (isNaN(batches) || batches < 1) batches = 1;
    if (batches > config.maxBatchCountPerRun) batches = config.maxBatchCountPerRun;
    batchCountInput.value = batches;
    emailCountInput.value = batches * config.batchSize;
    syncing = false;
  }

  emailCountInput.addEventListener("input", syncFromEmailCount);
  batchCountInput.addEventListener("input", syncFromBatchCount);

  function initConfig() {
    chrome.runtime.sendMessage({ action: "getConfig" }, (result) => {
      if (chrome.runtime.lastError || !result) return;
      config = result;
      batchCountInput.max = config.maxBatchCountPerRun;
      emailCountInput.max = config.maxEmailCountPerRun;
      batchHint.textContent = t("batchHint", [config.batchSize, config.rpm, config.tpm, config.rpd]);
      emailCountInput.value = config.batchSize;
      syncFromEmailCount();
      const autoInput = document.getElementById("autoClassifyThresholdInput");
      if (autoInput) autoInput.max = config.batchSize;
    });
  }
  initConfig();

  function setClassifyRunningUi(isRunningThis, isAnyRunning) {
    startBtn.disabled = isAnyRunning;
    batchCountInput.disabled = isAnyRunning;
    emailCountInput.disabled = isAnyRunning;
    if (isRunningThis) {
      startBtn.classList.add("running");
      startBtn.textContent = t("btnStartRunning");
      cancelBtn.classList.add("show");
      cancelBtn.disabled = false;
      cancelBtn.textContent = t("btnStop");
      forceCancelBtn.classList.add("show");
      forceCancelBtn.disabled = false;
      forceCancelBtn.textContent = t("btnForceStop");
    } else {
      startBtn.classList.remove("running");
      startBtn.textContent = t("btnStart");
      cancelBtn.classList.remove("show");
      forceCancelBtn.classList.remove("show");
    }
  }

  function renderProgress(progress, jobStatus, jobKind) {
    const isThisJob = jobKind === "classify";
    const running = jobStatus === "running" && isThisJob;
    const anyRunning = jobStatus === "running";
    setClassifyRunningUi(running, anyRunning);

    if (!isThisJob && jobStatus === "running") return; // 다른 작업이 실행 중이면 이 탭 진행바는 그대로 둠

    progressWrap.style.display = "block";
    progressText.style.display = "block";

    if (running && progress && progress.total) {
      const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
      progressBar.style.width = `${pct}%`;
      progressText.textContent = t("progressRunning", [progress.processed, progress.total, progress.batchIndex, progress.batchTotal, pct]);
    } else if (isThisJob && (jobStatus === "done" || jobStatus === "cancelled")) {
      progressBar.style.width = "100%";
      progressText.textContent = t("progressDone");
    } else if (isThisJob && jobStatus === "quota_exceeded") {
      progressBar.style.width = "100%";
      progressText.textContent = t("progressQuotaExceededShort");
    } else if (isThisJob && jobStatus === "error") {
      progressBar.style.width = "0%";
      progressText.textContent = t("progressErrorShort");
    } else if (!anyRunning) {
      progressBar.style.width = "0%";
      progressText.textContent = t("progressIdle");
    }
  }

  function showResult(box, text) {
    box.textContent = text;
    box.classList.add("show");
  }

  function translateResponse(response) {
    if (!response) return "";
    if (response.messageKey) return t(response.messageKey, response.messageParams);
    return response.status || "";
  }

  function renderGlobalProgressBanner(result) {
    const banner = document.getElementById("globalProgressBanner");
    const titleEl = document.getElementById("globalProgressTitle");
    const barEl = document.getElementById("globalProgressBarInner");
    const textEl = document.getElementById("globalProgressText");
    const cancelBtn = document.getElementById("globalCancelBtn");

    if (!banner) return;

    if (result && result.jobStatus === "running") {
      banner.style.display = "block";

      const kindNames = {
        classify: "⚡ 이메일 자동 분류 진행 중...",
        repeat: "🔄 반복 분류 진행 중...",
        labelSummary: "📋 라벨 한국어 요약 생성 중...",
        relabel: "🏷️ 라벨 재분류 진행 중...",
        dedupe: "🧹 중복/오분류 라벨 정리 중...",
        analyze: "🔍 라벨 분석 진행 중...",
        deleteLabels: "🗑️ 모든 라벨 삭제 진행 중..."
      };

      const titleText = kindNames[result.jobKind] || "⚡ 작업 진행 중...";
      if (titleEl) titleEl.textContent = titleText;

      let pct = 0;
      let text = "진행 중...";
      if (result.jobProgress && result.jobProgress.total) {
        pct = Math.min(100, Math.round((result.jobProgress.processed / result.jobProgress.total) * 100));
        text = `${result.jobProgress.processed} / ${result.jobProgress.total} 메일 처리 완료 (${pct}%)`;
      } else if (result.jobProgress && typeof result.jobProgress.pct === "number") {
        pct = result.jobProgress.pct;
        text = `${pct}% 진행됨`;
      }

      if (barEl) barEl.style.width = `${pct}%`;
      if (textEl) textEl.textContent = text;

      if (cancelBtn) {
        cancelBtn.onclick = () => {
          chrome.runtime.sendMessage({ action: "cancelJob" });
        };
      }
    } else {
      banner.style.display = "none";
    }
  }

  function pollStatus() {
    chrome.runtime.sendMessage({ action: "getJobStatus" }, (result) => {
      if (chrome.runtime.lastError || !result) return;

      renderGlobalProgressBanner(result);
      renderStatusPill(result.jobStatus);
      renderApiError(result.lastApiError);
      renderProgress(result.jobProgress, result.jobStatus, result.jobKind);
      dedupeBtn.disabled = result.jobStatus === "running";
      deleteAllLabelsBtn.disabled = result.jobStatus === "running";
      renderRepeatProgress(result.jobProgress, result.jobStatus, result.jobKind === "repeat");
      setRepeatRunningUi(result.jobStatus === "running" && result.jobKind === "repeat", result.jobStatus === "running");

      if (result.jobKind === "repeat") {
        if (result.jobStatus === "running") {
          showResult(repeatResultBox, t("statusRunning"));
        } else if (result.jobStatus === "done" && result.jobResult) {
          const r = result.jobResult;
          let text = t("resultLastRun", [r.success, r.total]);
          if (r.failMessages && r.failMessages.length) text += t("resultFailReasonSuffix", [r.failMessages[0]]);
          showResult(repeatResultBox, text);
        } else if (result.jobStatus === "cancelled" && result.jobResult) {
          const r = result.jobResult;
          showResult(repeatResultBox, t("resultCancelled", [r.success, r.total]));
        } else if (result.jobStatus === "quota_exceeded" && result.jobResult) {
          const r = result.jobResult;
          showResult(repeatResultBox, t("resultQuotaExceeded", [r.success, r.total]));
        } else if (result.jobStatus === "error") {
          showResult(repeatResultBox, t("resultLastError", [result.jobError]));
        }
      }

      if (result.jobKind === "deleteLabels") {
        if (result.jobStatus === "running") {
          showResult(deleteAllLabelsResultBox, t("statusRunning"));
        } else if (result.jobStatus === "done" && result.jobResult) {
          showResult(deleteAllLabelsResultBox, t("resultLabelsDeleted", [result.jobResult.success]));
        } else if (result.jobStatus === "error") {
          showResult(deleteAllLabelsResultBox, t("resultLastError", [result.jobError]));
        }
      }

      backupToDriveBtn.disabled = result.jobStatus === "running";
      restoreFromDriveBtn.disabled = result.jobStatus === "running";
      analyzeLabelBtn.disabled = result.jobStatus === "running";

      const startSummaryBtn = document.getElementById("startSummaryBtn");
      const summaryProgressWrap = document.getElementById("summaryProgressWrap");
      const summaryProgressBar = document.getElementById("summaryProgressBar");
      const summaryProgressText = document.getElementById("summaryProgressText");
      const summaryResultBox = document.getElementById("summaryResultBox");
      const summaryActionRow = document.getElementById("summaryActionRow");

      if (startSummaryBtn) startSummaryBtn.disabled = result.jobStatus === "running";

      if (result.jobKind === "labelSummary") {
        if (summaryProgressWrap && summaryProgressBar && summaryProgressText) {
          summaryProgressWrap.style.display = "block";
          summaryProgressText.style.display = "block";
          if (result.jobStatus === "running" && result.jobProgress && result.jobProgress.total) {
            const pct = Math.min(100, Math.round((result.jobProgress.processed / result.jobProgress.total) * 100));
            summaryProgressBar.style.width = `${pct}%`;
            summaryProgressText.textContent = t("progressRunning", [
              result.jobProgress.processed,
              result.jobProgress.total,
              result.jobProgress.batchIndex || 1,
              result.jobProgress.batchTotal || 1,
              pct,
            ]);
          } else if (result.jobStatus === "done" || result.jobStatus === "error" || result.jobStatus === "cancelled") {
            summaryProgressBar.style.width = result.jobStatus === "done" ? "100%" : "0%";
            summaryProgressText.textContent = "";
          }
        }

        if (result.jobStatus === "running") {
          showResult(summaryResultBox, t("statusRunning"));
          if (summaryActionRow) summaryActionRow.style.display = "none";
        } else if (result.jobStatus === "done") {
          chrome.storage.local.get(["lastLabelSummary"], (stored) => {
            if (stored.lastLabelSummary) {
              displaySummaryReport(stored.lastLabelSummary);
            }
          });
        } else if (result.jobStatus === "error") {
          showResult(summaryResultBox, t("resultLastError", [result.jobError]));
          if (summaryActionRow) summaryActionRow.style.display = "none";
        }
      }

      if (result.jobKind === "oauthConnect") {
        if (result.jobStatus === "running") {
          showResult(oauthResultBox, t("msgOAuthConnecting"));
        } else if (result.jobStatus === "done") {
          showResult(oauthResultBox, t("msgOAuthConnected"));
          refreshOAuthStatus();
        } else if (result.jobStatus === "error") {
          showResult(oauthResultBox, t("errorGenericPrefix", [result.jobError]));
          refreshOAuthStatus();
        }
      }

      if (result.jobKind === "labelAnalysis" || result.jobKind === "labelAnalysisMulti") {
        // 진행률 표시 (다중 분석일 때 특히 유용 - 몇 번째 라벨 처리 중인지)
        labelAnalysisProgressWrap.style.display = "block";
        labelAnalysisProgressText.style.display = "block";
        if (result.jobStatus === "running" && result.jobProgress && result.jobProgress.total) {
          const pct = Math.min(100, Math.round((result.jobProgress.processed / result.jobProgress.total) * 100));
          labelAnalysisProgressBar.style.width = `${pct}%`;
          labelAnalysisProgressText.textContent = t("progressRunning", [
            result.jobProgress.processed,
            result.jobProgress.total,
            result.jobProgress.batchIndex,
            result.jobProgress.batchTotal,
            pct,
          ]);
        } else if (result.jobStatus === "done" || result.jobStatus === "error" || result.jobStatus === "cancelled") {
          labelAnalysisProgressBar.style.width = result.jobStatus === "done" ? "100%" : "0%";
          labelAnalysisProgressText.textContent = "";
        }

        if (result.jobStatus === "running") {
          showResult(labelAnalysisResultBox, t("statusRunning"));
        } else if (result.jobStatus === "done" && result.jobResult) {
          if (result.jobFinishedAt && result.jobFinishedAt !== lastHandledLabelAnalysisAt) {
            lastHandledLabelAnalysisAt = result.jobFinishedAt;
            chrome.storage.local.set({ lastHandledLabelAnalysisAt });

            // 단일 분석(jobResult.suggestion)과 다중 분석(jobResult.suggestions 배열) 둘 다 처리
            if (result.jobResult.suggestion) {
              appendToScratchpad(result.jobResult.labelName, result.jobResult.suggestion);
              showResult(
                labelAnalysisResultBox,
                t("msgLabelAnalysisDone", [result.jobResult.labelName, result.jobResult.sampleCount, result.jobResult.totalCount])
              );
            } else if (Array.isArray(result.jobResult.suggestions)) {
              result.jobResult.suggestions.forEach((s) => appendToScratchpad(s.labelName, s.suggestion));
              let text = t("msgLabelAnalysisMultiDone", [result.jobResult.success, result.jobResult.total]);
              if (result.jobResult.failMessages && result.jobResult.failMessages.length) {
                text += t("resultFailReasonSuffix", [result.jobResult.failMessages[0]]);
              }
              showResult(labelAnalysisResultBox, text);
            }
          }
        } else if (result.jobStatus === "error") {
          showResult(labelAnalysisResultBox, t("resultLastError", [result.jobError]));
        }
      }

      if (result.jobKind === "driveBackup") {
        if (result.jobStatus === "running") {
          showResult(driveBackupResultBox, t("statusRunning"));
        } else if (result.jobStatus === "done") {
          showResult(driveBackupResultBox, t("msgDriveBackupDone"));
        } else if (result.jobStatus === "error") {
          showResult(driveBackupResultBox, t("resultLastError", [result.jobError]));
        }
      }

      if (result.jobKind === "driveRestore") {
        if (result.jobStatus === "running") {
          showResult(driveBackupResultBox, t("statusRunning"));
        } else if (result.jobStatus === "done" && result.jobResult) {
          showResult(driveBackupResultBox, t("msgDriveRestoreDone", [result.jobResult.restoredCount || 0]));
          loadSettings();
          loadOAuthFields();
          refreshOAuthStatus();
        } else if (result.jobStatus === "error") {
          showResult(driveBackupResultBox, t("resultLastError", [result.jobError]));
        }
      }

      if (result.jobKind === "classify") {
        if (result.jobStatus === "running") {
          showResult(resultBox, t("statusRunning"));
        } else if (result.jobStatus === "done" && result.jobResult) {
          const r = result.jobResult;
          let text = t("resultLastRun", [r.success, r.total]);
          if (r.requestsUsed !== undefined) text += t("resultRequestsUsedSuffix", [r.requestsUsed]);
          if (r.failMessages && r.failMessages.length) text += t("resultFailReasonSuffix", [r.failMessages[0]]);
          showResult(resultBox, text);
        } else if (result.jobStatus === "cancelled" && result.jobResult) {
          const r = result.jobResult;
          showResult(resultBox, t("resultCancelled", [r.success, r.total]));
        } else if (result.jobStatus === "quota_exceeded" && result.jobResult) {
          const r = result.jobResult;
          showResult(resultBox, t("resultQuotaExceeded", [r.success, r.total]));
        } else if (result.jobStatus === "error") {
          showResult(resultBox, t("resultLastError", [result.jobError]));
        }
      }

      if (result.jobStatus === "running") {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
      } else if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      refreshQuotaDisplay();
    });
  }
  pollStatus();

  cancelBtn.addEventListener("click", () => {
    cancelBtn.disabled = true;
    cancelBtn.textContent = t("btnStopRequesting");
    chrome.runtime.sendMessage({ action: "cancelJob" }, () => {
      // 상태는 다음 폴링에서 자동 반영됨
    });
  });

  forceCancelBtn.addEventListener("click", () => {
    forceCancelBtn.disabled = true;
    forceCancelBtn.textContent = t("btnForceStopping");
    chrome.runtime.sendMessage({ action: "forceCancelJob" }, () => {
      // 강제 중지는 백그라운드에서 즉시 cancelled 상태로 기록한다.
      pollStatus();
    });
  });

  startBtn.addEventListener("click", () => {
    const count = parseInt(emailCountInput.value, 10) || config.batchSize;
    showResult(resultBox, t("resultRequesting", [count]));

    chrome.runtime.sendMessage({ action: "startClassification", count }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(resultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(resultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  // ---------------- 반복 작업 ----------------
  const repeatBatchesInput = document.getElementById("repeatBatchesInput");
  const repeatCountInput = document.getElementById("repeatCountInput");
  const repeatBtn = document.getElementById("repeatBtn");
  const repeatResultBox = document.getElementById("repeatResultBox");
  const repeatProgressWrap = document.getElementById("repeatProgressWrap");
  const repeatProgressBar = document.getElementById("repeatProgressBar");
  const repeatProgressText = document.getElementById("repeatProgressText");

  repeatBatchesInput.addEventListener("change", () => {
    let v = parseInt(repeatBatchesInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    if (v > 5) v = 5;
    repeatBatchesInput.value = v;
  });
  repeatCountInput.addEventListener("change", () => {
    let v = parseInt(repeatCountInput.value, 10);
    if (isNaN(v) || v < 1) v = 1;
    repeatCountInput.value = v;
  });

  function setRepeatRunningUi(isRunningThis, isAnyRunning) {
    repeatBtn.disabled = isAnyRunning;
    repeatBatchesInput.disabled = isAnyRunning;
    repeatCountInput.disabled = isAnyRunning;
    if (isRunningThis) {
      repeatBtn.classList.add("running");
      repeatBtn.textContent = t("btnStartRunning");
    } else {
      repeatBtn.classList.remove("running");
      repeatBtn.textContent = t("btnStartRepeat");
    }
  }

  function renderRepeatProgress(progress, jobStatus, isThisJob) {
    if (!isThisJob) return;
    repeatProgressWrap.style.display = "block";
    repeatProgressText.style.display = "block";
    if (jobStatus === "running" && progress && progress.total) {
      const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
      repeatProgressBar.style.width = `${pct}%`;
      repeatProgressText.textContent = t("progressRunning", [progress.processed, progress.total, progress.batchIndex, progress.batchTotal, pct]);
    } else if (jobStatus === "done" || jobStatus === "cancelled") {
      repeatProgressBar.style.width = "100%";
      repeatProgressText.textContent = t("progressDone");
    } else if (jobStatus === "quota_exceeded") {
      repeatProgressBar.style.width = "100%";
      repeatProgressText.textContent = t("progressQuotaExceededShort");
    } else if (jobStatus === "error") {
      repeatProgressBar.style.width = "0%";
      repeatProgressText.textContent = t("progressErrorShort");
    }
  }

  repeatBtn.addEventListener("click", () => {
    const batchesPerRound = parseInt(repeatBatchesInput.value, 10) || 1;
    const repeatCount = parseInt(repeatCountInput.value, 10) || 1;
    showResult(repeatResultBox, t("repeatRequesting"));
    chrome.runtime.sendMessage({ action: "startRepeatClassification", batchesPerRound, repeatCount }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(repeatResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(repeatResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  // ---------------- 라벨 전체 삭제 ----------------
  const deleteAllLabelsBtn = document.getElementById("deleteAllLabelsBtn");
  const deleteAllLabelsResultBox = document.getElementById("deleteAllLabelsResultBox");
  const deleteAllLabelsConfirmBox = document.getElementById("deleteAllLabelsConfirmBox");
  const deleteAllLabelsConfirmText = document.getElementById("deleteAllLabelsConfirmText");
  const deleteAllLabelsConfirmBtn = document.getElementById("deleteAllLabelsConfirmBtn");
  const deleteAllLabelsCancelBtn = document.getElementById("deleteAllLabelsCancelBtn");

  function resetDeleteAllLabelsConfirmUi() {
    deleteAllLabelsConfirmBox.style.display = "none";
    deleteAllLabelsBtn.style.display = "block";
  }

  deleteAllLabelsBtn.addEventListener("click", () => {
    // window.confirm()은 팝업이 포커스를 잃어 닫힐 수 있어(message port closed 오류 원인) 팝업 내부 UI로 확인한다.
    deleteAllLabelsConfirmText.textContent = t("confirmDeleteAllLabels");
    deleteAllLabelsConfirmBtn.textContent = t("btnConfirmDeleteAllLabels");
    deleteAllLabelsCancelBtn.textContent = t("btnCancelAction");
    deleteAllLabelsBtn.style.display = "none";
    deleteAllLabelsConfirmBox.style.display = "block";
  });

  deleteAllLabelsCancelBtn.addEventListener("click", () => {
    resetDeleteAllLabelsConfirmUi();
  });

  deleteAllLabelsConfirmBtn.addEventListener("click", () => {
    resetDeleteAllLabelsConfirmUi();
    showResult(deleteAllLabelsResultBox, t("deleteLabelsRequesting"));
    chrome.runtime.sendMessage({ action: "startDeleteAllLabels" }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(deleteAllLabelsResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(deleteAllLabelsResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  // ---------------- 라벨 관리 탭 ----------------
  const relabelSelect = document.getElementById("relabelSelect");
  const excludeSelfCheckbox = document.getElementById("excludeSelfCheckbox");
  const relabelBtn = document.getElementById("relabelBtn");
  const relabelResultBox = document.getElementById("relabelResultBox");

  let currentCategoryDefs = getLocalizedDefaultCategories().map((name) => ({ name, description: "" }));

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML.replace(/"/g, "&quot;");
  }

  function renderRelabelSelect() {
    const optionsHtml = currentCategoryDefs
      .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
      .join("");
    relabelSelect.innerHTML = optionsHtml;
    const summaryLabelSelect = document.getElementById("summaryLabelSelect");
    if (summaryLabelSelect) {
      summaryLabelSelect.innerHTML = optionsHtml;
    }
    renderLabelAnalysisChecklist();
  }

  relabelBtn.addEventListener("click", () => {
    const label = relabelSelect.value;
    const excludeSelf = excludeSelfCheckbox.checked;
    if (!label) {
      showResult(relabelResultBox, t("errorSelectLabel"));
      return;
    }
    showResult(relabelResultBox, t("relabelRequesting"));
    chrome.runtime.sendMessage({ action: "startRelabel", label, excludeSelf }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(relabelResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(relabelResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  function normalizeName(name) {
    return String(name).trim().replace(/\s+/g, "").toLowerCase();
  }

  // ---------------- 라벨 정리(중복/오분류) ----------------
  const dedupeBtn = document.getElementById("dedupeBtn");
  const dedupeResultBox = document.getElementById("dedupeResultBox");

  dedupeBtn.addEventListener("click", () => {
    showResult(dedupeResultBox, t("dedupeRequesting"));
    chrome.runtime.sendMessage({ action: "startDedupeRelabel" }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(dedupeResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(dedupeResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  // ---------------- 개인 필터 규칙 ----------------
  const filterRulesList = document.getElementById("filterRulesList");
  const addFilterRuleBtn = document.getElementById("addFilterRuleBtn");
  const saveFilterRulesBtn = document.getElementById("saveFilterRulesBtn");
  const filterRulesResultBox = document.getElementById("filterRulesResultBox");
  let filterRules = [];

  function renderFilterRules() {
    const filterRulesList = document.getElementById("filterRulesList");
    if (!filterRulesList) return;
    filterRulesList.innerHTML = filterRules
      .map(
        (rule, idx) => `
        <div class="filter-rule-row" data-idx="${idx}">
          <div class="filter-rule-top">
            <select class="match-type">
              <option value="from" ${rule.matchType !== "subject" ? "selected" : ""}>${escapeHtml(t("matchTypeFrom"))}</option>
              <option value="subject" ${rule.matchType === "subject" ? "selected" : ""}>${escapeHtml(t("matchTypeSubject"))}</option>
            </select>
            <input type="text" class="match-value" placeholder="${escapeHtml(t("placeholderMatchValue"))}" value="${escapeHtml(rule.matchValue || "")}">
          </div>
          <input type="text" class="target-label" placeholder="${escapeHtml(t("placeholderTargetLabel"))}" value="${escapeHtml(rule.targetLabel || "")}">
          <div class="btn-row">
            <button class="danger delete-rule-btn">${escapeHtml(t("btnDeleteRule"))}</button>
          </div>
        </div>`
      )
      .join("");

    filterRulesList.querySelectorAll(".delete-rule-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.closest(".filter-rule-row").getAttribute("data-idx"), 10);
        filterRules.splice(idx, 1);
        renderFilterRules();
      });
    });
  }

  function collectFilterRulesFromDom() {
    const rows = filterRulesList.querySelectorAll(".filter-rule-row");
    filterRules = Array.from(rows).map((row) => ({
      matchType: row.querySelector(".match-type").value,
      matchValue: row.querySelector(".match-value").value.trim(),
      targetLabel: row.querySelector(".target-label").value.trim(),
    }));
  }

  addFilterRuleBtn.addEventListener("click", () => {
    collectFilterRulesFromDom();
    filterRules.push({ matchType: "from", matchValue: "", targetLabel: "" });
    renderFilterRules();
  });

  saveFilterRulesBtn.addEventListener("click", () => {
    collectFilterRulesFromDom();
    const validRules = filterRules.filter((r) => r.matchValue && r.targetLabel);
    chrome.storage.local.set({ filterRules: validRules }, () => {
      if (chrome.runtime.lastError) {
        showResult(filterRulesResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      filterRules = validRules;
      renderFilterRules();
      showResult(filterRulesResultBox, t("msgFilterRulesSaved", [validRules.length]));
      maybeAutoBackup();
    });
  });

  chrome.storage.local.get(["filterRules"], (result) => {
    filterRules = result.filterRules || [];
    renderFilterRules();
  });

  // ---------------- 설정 탭 ----------------
  const apiKeysList = document.getElementById("apiKeysList");
  const addApiKeyBtn = document.getElementById("addApiKeyBtn");
  const keyResultBox = document.getElementById("keyResultBox");
  const categoriesList = document.getElementById("categoriesList");
  const addCategoryBtn = document.getElementById("addCategoryBtn");
  const categoryResultBox = document.getElementById("categoryResultBox");

  let currentApiKeys = [];

  function renderApiKeysList() {
    apiKeysList.innerHTML = currentApiKeys
      .map(
        (entry, idx) => `
        <div class="apikey-row" data-idx="${idx}">
          <div class="apikey-top">
            <input type="text" class="apikey-label" data-i18n-placeholder="placeholderApiKeyLabel" placeholder="${escapeHtml(t("placeholderApiKeyLabel"))}" value="${escapeHtml(entry.label || "")}">
            <input type="password" class="apikey-value" placeholder="AIza..." value="${escapeHtml(entry.key || "")}">
            <button class="toggle-apikey-btn" type="button">${escapeHtml(t("btnToggleKey"))}</button>
          </div>
          <div class="btn-row">
            <button class="danger delete-apikey-btn">${escapeHtml(t("btnDeleteRule"))}</button>
          </div>
        </div>`
      )
      .join("");

    apiKeysList.querySelectorAll(".toggle-apikey-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = btn.closest(".apikey-row").querySelector(".apikey-value");
        input.type = input.type === "password" ? "text" : "password";
      });
    });

    apiKeysList.querySelectorAll(".delete-apikey-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        collectApiKeysFromDom();
        const idx = parseInt(btn.closest(".apikey-row").getAttribute("data-idx"), 10);
        currentApiKeys.splice(idx, 1);
        renderApiKeysList();
      });
    });
  }

  function collectApiKeysFromDom() {
    const rows = apiKeysList.querySelectorAll(".apikey-row");
    currentApiKeys = Array.from(rows).map((row) => ({
      label: row.querySelector(".apikey-label").value.trim(),
      key: row.querySelector(".apikey-value").value.trim(),
    }));
  }

  addApiKeyBtn.addEventListener("click", () => {
    collectApiKeysFromDom();
    currentApiKeys.push({ label: "", key: "" });
    renderApiKeysList();
  });

  // ---------------- 라벨 분석 도우미 + 임시저장 텍스트박스 ----------------
  const labelAnalysisChecklist = document.getElementById("labelAnalysisChecklist");
  const labelAnalysisSelectAllBtn = document.getElementById("labelAnalysisSelectAllBtn");
  const labelAnalysisSelectNoneBtn = document.getElementById("labelAnalysisSelectNoneBtn");
  const analyzeLabelBtn = document.getElementById("analyzeLabelBtn");
  const labelAnalysisResultBox = document.getElementById("labelAnalysisResultBox");
  const labelAnalysisProgressWrap = document.getElementById("labelAnalysisProgressWrap");
  const labelAnalysisProgressBar = document.getElementById("labelAnalysisProgressBar");
  const labelAnalysisProgressText = document.getElementById("labelAnalysisProgressText");
  const criteriaScratchpad = document.getElementById("criteriaScratchpad");
  const clearScratchpadBtn = document.getElementById("clearScratchpadBtn");
  let lastHandledLabelAnalysisAt = 0;

  chrome.storage.local.get(["criteriaScratchpad", "lastHandledLabelAnalysisAt"], (result) => {
    criteriaScratchpad.value = result.criteriaScratchpad || "";
    lastHandledLabelAnalysisAt = result.lastHandledLabelAnalysisAt || 0;
  });

  function renderLabelAnalysisChecklist() {
    // 이미 체크된 항목은 다시 그릴 때도 유지
    const checkedNames = new Set(
      Array.from(labelAnalysisChecklist.querySelectorAll("input:checked")).map((el) => el.value)
    );
    labelAnalysisChecklist.innerHTML = currentCategoryDefs
      .map(
        (c) => `
        <label class="label-check-row">
          <input type="checkbox" value="${escapeHtml(c.name)}" ${checkedNames.has(c.name) ? "checked" : ""}>
          <span>${escapeHtml(c.name)}</span>
        </label>`
      )
      .join("");
  }

  labelAnalysisSelectAllBtn.addEventListener("click", () => {
    labelAnalysisChecklist.querySelectorAll("input").forEach((el) => (el.checked = true));
  });
  labelAnalysisSelectNoneBtn.addEventListener("click", () => {
    labelAnalysisChecklist.querySelectorAll("input").forEach((el) => (el.checked = false));
  });

  // 실수로 다른 곳을 눌러서 내용이 날아가는 일이 없도록, 입력할 때마다 바로바로 저장
  criteriaScratchpad.addEventListener("input", () => {
    chrome.storage.local.set({ criteriaScratchpad: criteriaScratchpad.value });
  });

  clearScratchpadBtn.addEventListener("click", () => {
    criteriaScratchpad.value = "";
    chrome.storage.local.set({ criteriaScratchpad: "" });
  });

  // 임시저장 칸의 "라벨이름\n분류기준" 항목들(빈 줄로 구분)을 파싱
  function parseScratchpadEntries(text) {
    return text
      .split(/\n\s*\n/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => {
        const lines = block.split("\n");
        return { labelName: (lines[0] || "").trim(), suggestion: lines.slice(1).join("\n").trim() };
      })
      .filter((e) => e.labelName && e.suggestion);
  }

  const applyScratchpadBtn = document.getElementById("applyScratchpadBtn");
  applyScratchpadBtn.addEventListener("click", () => {
    collectCategoryDefsFromDom();
    const entries = parseScratchpadEntries(criteriaScratchpad.value);
    if (!entries.length) {
      showResult(categoryResultBox, t("msgNoScratchpadEntries"));
      return;
    }

    let appliedCount = 0;
    const notFoundNames = [];
    for (const entry of entries) {
      const idx = currentCategoryDefs.findIndex((c) => c.name === entry.labelName);
      if (idx >= 0) {
        currentCategoryDefs[idx] = { ...currentCategoryDefs[idx], description: entry.suggestion, autoLearned: false };
        appliedCount += 1;
      } else {
        notFoundNames.push(entry.labelName);
      }
    }

    renderCategoriesList();
    chrome.storage.local.set({ categoryDefinitions: currentCategoryDefs }, () => {
      let msg = t("msgScratchpadApplied", [appliedCount, entries.length]);
      if (notFoundNames.length) msg += t("msgScratchpadNotFound", [notFoundNames.join(", ")]);
      showResult(categoryResultBox, msg);
    });
  });

  // "라벨이름 줄바꿈 분류기준" 형식으로 기존 내용 뒤에 이어붙임(여러 번 만들면 빈 줄로 구분)
  function appendToScratchpad(labelName, suggestion) {
    const entry = `${labelName}\n${suggestion}`;
    const current = criteriaScratchpad.value.replace(/\s+$/, "");
    const updated = current ? `${current}\n\n${entry}` : entry;
    criteriaScratchpad.value = updated;
    chrome.storage.local.set({ criteriaScratchpad: updated });
  }

  analyzeLabelBtn.addEventListener("click", () => {
    const labelNames = Array.from(labelAnalysisChecklist.querySelectorAll("input:checked")).map((el) => el.value);
    if (!labelNames.length) {
      showResult(labelAnalysisResultBox, t("msgSelectAtLeastOneLabel"));
      return;
    }
    showResult(labelAnalysisResultBox, t("labelAnalysisRequesting"));
    chrome.runtime.sendMessage({ action: "startAnalyzeMultipleLabels", labelNames }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(labelAnalysisResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(labelAnalysisResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  function renderCategoriesList() {
    categoriesList.innerHTML = currentCategoryDefs
      .map(
        (def, idx) => `
        <div class="category-row" data-idx="${idx}" data-autolearned="${def.autoLearned ? "1" : "0"}" data-original-desc="${escapeHtml(def.description || "")}">
          <input type="text" class="category-name" data-i18n-placeholder="placeholderCategoryName" placeholder="${escapeHtml(t("placeholderCategoryName"))}" value="${escapeHtml(def.name)}">
          ${def.autoLearned ? `<div class="auto-learned-badge">${escapeHtml(t("badgeAutoLearned"))}</div>` : ""}
          <textarea class="category-desc" rows="2" data-i18n-placeholder="placeholderCategoryDesc" placeholder="${escapeHtml(t("placeholderCategoryDesc"))}">${escapeHtml(def.description || "")}</textarea>
          <div class="btn-row">
            <button class="danger delete-category-btn">${escapeHtml(t("btnDeleteRule"))}</button>
          </div>
        </div>`
      )
      .join("");

    categoriesList.querySelectorAll(".delete-category-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        collectCategoryDefsFromDom();
        const idx = parseInt(btn.closest(".category-row").getAttribute("data-idx"), 10);
        currentCategoryDefs.splice(idx, 1);
        renderCategoriesList();
      });
    });
  }

  function collectCategoryDefsFromDom() {
    const rows = categoriesList.querySelectorAll(".category-row");
    currentCategoryDefs = Array.from(rows).map((row) => {
      const description = row.querySelector(".category-desc").value.trim();
      const originalDesc = row.getAttribute("data-original-desc") || "";
      const wasAutoLearned = row.getAttribute("data-autolearned") === "1";
      // 사용자가 자동 생성된 설명을 직접 고쳤으면 "AI 자동 추가" 표시는 해제
      const autoLearned = wasAutoLearned && description === originalDesc;
      return {
        name: row.querySelector(".category-name").value.trim(),
        description,
        autoLearned,
      };
    });
  }

  addCategoryBtn.addEventListener("click", () => {
    collectCategoryDefsFromDom();
    currentCategoryDefs.push({ name: "", description: "" });
    renderCategoriesList();
  });

  function loadSettings() {
    chrome.storage.local.get(["geminiApiKeys", "geminiApiKey", "categoryDefinitions", "labelCategories"], (result) => {
      if (Array.isArray(result.geminiApiKeys) && result.geminiApiKeys.length) {
        currentApiKeys = result.geminiApiKeys.map((k) => ({ label: k.label || "", key: k.key || "" }));
      } else if (result.geminiApiKey) {
        // 예전 버전(단일 키) 데이터 자동 변환
        currentApiKeys = [{ label: "", key: result.geminiApiKey }];
      } else {
        currentApiKeys = [];
      }
      renderApiKeysList();

      if (Array.isArray(result.categoryDefinitions) && result.categoryDefinitions.length) {
        currentCategoryDefs = result.categoryDefinitions.map((c) => ({ name: c.name, description: c.description || "", autoLearned: !!c.autoLearned }));
      } else if (Array.isArray(result.labelCategories) && result.labelCategories.length) {
        // 예전 버전(이름만 있는 문자열 배열) 데이터 자동 변환
        currentCategoryDefs = result.labelCategories.map((name) => ({ name, description: "" }));
      } else {
        currentCategoryDefs = getLocalizedDefaultCategories().map((name) => ({ name, description: "" }));
      }
      renderCategoriesList();
      renderRelabelSelect();
    });
  }
  loadSettings();

  document.getElementById("openAiStudioBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://aistudio.google.com/apikey" });
  });

  document.getElementById("saveKeyBtn").addEventListener("click", () => {
    collectApiKeysFromDom();
    const validKeys = currentApiKeys.filter((k) => k.key);
    if (!validKeys.length) {
      showResult(keyResultBox, t("msgEnterKey"));
      return;
    }
    const badFormat = validKeys.some((k) => !k.key.startsWith("AIza"));
    if (badFormat) {
      showResult(keyResultBox, t("warnApiKeyFormat"));
    }
    chrome.storage.local.set({ geminiApiKeys: validKeys, geminiApiKey: null }, () => {
      currentApiKeys = validKeys;
      renderApiKeysList();
      showResult(keyResultBox, t("msgKeysSaved", [validKeys.length]));
      maybeAutoBackup();
    });
  });

  // ---------------- 개인 OAuth 설정 ----------------
  const oauthClientIdInput = document.getElementById("oauthClientIdInput");
  const oauthClientSecretInput = document.getElementById("oauthClientSecretInput");
  const oauthStatusText = document.getElementById("oauthStatusText");
  const oauthResultBox = document.getElementById("oauthResultBox");
  const oauthReauthBanner = document.getElementById("oauthReauthBanner");
  const oauthReauthBtn = document.getElementById("oauthReauthBtn");

  function loadOAuthFields() {
    chrome.storage.local.get(["oauthClientId", "oauthClientSecret"], (result) => {
      oauthClientIdInput.value = result.oauthClientId || "";
      oauthClientSecretInput.value = result.oauthClientSecret || "";
    });
  }
  loadOAuthFields();

  function refreshOAuthStatus() {
    chrome.runtime.sendMessage({ action: "getOAuthStatus" }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      oauthStatusText.textContent = response.connected ? t("oauthStatusConnected") : t("oauthStatusNotConnected");
      oauthReauthBanner.classList.toggle("show", !!response.requiresLogin);
    });
  }
  refreshOAuthStatus();

  document.getElementById("openOAuthGuideBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("guide/oauth-guide.html") });
  });

  document.getElementById("openOAuthConsoleBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://console.cloud.google.com/apis/credentials" });
  });

  document.getElementById("saveOAuthBtn").addEventListener("click", () => {
    const clientId = oauthClientIdInput.value.trim();
    const clientSecret = oauthClientSecretInput.value.trim();
    chrome.storage.local.set({ oauthClientId: clientId, oauthClientSecret: clientSecret }, () => {
      showResult(oauthResultBox, t("msgOAuthSaved"));
      maybeAutoBackup();
    });
  });

  document.getElementById("connectOAuthBtn").addEventListener("click", () => {
    showResult(oauthResultBox, t("msgOAuthConnecting"));
    chrome.runtime.sendMessage({ action: "authorizeOAuth" }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(oauthResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(oauthResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      } else {
        showResult(oauthResultBox, t("errorGenericPrefix", [(response && response.error) || ""]));
      }
    });
  });

  oauthReauthBtn.addEventListener("click", () => {
    document.getElementById("connectOAuthBtn").click();
  });

  document.getElementById("disconnectOAuthBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "disconnectOAuth" }, () => {
      showResult(oauthResultBox, t("msgOAuthDisconnected"));
      refreshOAuthStatus();
    });
  });

  document.getElementById("saveCategoriesBtn").addEventListener("click", () => {
    collectCategoryDefsFromDom();
    const validDefs = currentCategoryDefs.filter((c) => c.name);
    if (!validDefs.length) {
      showResult(categoryResultBox, t("msgCategoriesMin"));
      return;
    }
    chrome.storage.local.set({ categoryDefinitions: validDefs }, () => {
      showResult(categoryResultBox, t("msgCategoriesSaved", [validDefs.length]));
      currentCategoryDefs = validDefs;
      renderCategoriesList();
      renderRelabelSelect();
      maybeAutoBackup();
    });
  });

  document.getElementById("resetCategoriesBtn").addEventListener("click", () => {
    const localized = getLocalizedDefaultCategories().map((name) => ({ name, description: "" }));
    chrome.storage.local.set({ categoryDefinitions: localized }, () => {
      showResult(categoryResultBox, t("msgCategoriesReset"));
      currentCategoryDefs = localized;
      renderCategoriesList();
      renderRelabelSelect();
    });
  });

  const colorResultBox = document.getElementById("colorResultBox");
  document.getElementById("applyColorsBtn").addEventListener("click", () => {
    showResult(colorResultBox, t("colorRequesting"));
    chrome.runtime.sendMessage({ action: "applyLabelColors" }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(colorResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(colorResultBox, response ? translateResponse(response) : t("requestSent"));
      if (response && response.ok) {
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
      }
    });
  });

  // ---- 새 메일 자동 분류 ----
  const autoClassifyCheckbox = document.getElementById("autoClassifyCheckbox");
  const autoClassifyThresholdInput = document.getElementById("autoClassifyThresholdInput");

  chrome.storage.local.get(["autoClassifyEnabled", "autoClassifyThreshold"], (result) => {
    autoClassifyCheckbox.checked = result.autoClassifyEnabled === undefined ? true : !!result.autoClassifyEnabled;
    autoClassifyThresholdInput.value = result.autoClassifyThreshold || 1;
  });

  autoClassifyCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ autoClassifyEnabled: autoClassifyCheckbox.checked });
  });

  autoClassifyThresholdInput.addEventListener("change", () => {
    let val = parseInt(autoClassifyThresholdInput.value, 10);
    const max = config.batchSize || 37;
    if (isNaN(val) || val < 1) val = 1;
    if (val > max) val = max;
    autoClassifyThresholdInput.value = val;
    chrome.storage.local.set({ autoClassifyThreshold: val });
  });

  // ---- 고급 옵션: 정정 학습 ----
  const correctionLearningCheckbox = document.getElementById("correctionLearningCheckbox");
  chrome.storage.local.get(["correctionLearningEnabled"], (result) => {
    correctionLearningCheckbox.checked = result.correctionLearningEnabled !== false; // 기본값 켜짐
  });
  correctionLearningCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ correctionLearningEnabled: correctionLearningCheckbox.checked });
  });

  // ---- 고급 옵션: API 할당량 표시 ----
  const showQuotaCheckbox = document.getElementById("showQuotaCheckbox");
  const quotaText = document.getElementById("quotaText");
  let showQuotaOnMain = false;

  chrome.storage.local.get(["showQuotaOnMain"], (result) => {
    showQuotaOnMain = !!result.showQuotaOnMain;
    showQuotaCheckbox.checked = showQuotaOnMain;
    refreshQuotaDisplay();
  });

  showQuotaCheckbox.addEventListener("change", () => {
    showQuotaOnMain = showQuotaCheckbox.checked;
    chrome.storage.local.set({ showQuotaOnMain });
    refreshQuotaDisplay();
  });

  function refreshQuotaDisplay() {
    if (!showQuotaOnMain) {
      quotaText.style.display = "none";
      return;
    }
    chrome.runtime.sendMessage({ action: "getQuotaUsage" }, (usage) => {
      if (chrome.runtime.lastError || !usage) return;
      quotaText.style.display = "block";
      if (usage.keyCount > 1) {
        quotaText.textContent = t("quotaTextMultiKey", [usage.requestsToday, usage.rpd, usage.keyCount]);
      } else {
        quotaText.textContent = t("quotaText", [usage.requestsToday, usage.rpd]);
      }
    });
  }

  // ---------------- Google Drive 백업/복원 ----------------
  const includeCredentialsCheckbox = document.getElementById("includeCredentialsCheckbox");
  const backupToDriveBtn = document.getElementById("backupToDriveBtn");
  const restoreFromDriveBtn = document.getElementById("restoreFromDriveBtn");
  const driveBackupResultBox = document.getElementById("driveBackupResultBox");
  const driveBackupStatusText = document.getElementById("driveBackupStatusText");
  const driveRestoreConfirmBox = document.getElementById("driveRestoreConfirmBox");
  const driveRestoreConfirmText = document.getElementById("driveRestoreConfirmText");
  const driveRestoreConfirmBtn = document.getElementById("driveRestoreConfirmBtn");
  const driveRestoreCancelBtn = document.getElementById("driveRestoreCancelBtn");

  function refreshDriveBackupStatus() {
    chrome.runtime.sendMessage({ action: "getLastDriveBackupInfo" }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      if (response.lastDriveBackupAt) {
        const dateStr = new Date(response.lastDriveBackupAt).toLocaleString();
        driveBackupStatusText.textContent = t("lastBackupAt", [dateStr]);
      } else {
        driveBackupStatusText.textContent = t("noBackupYet");
      }
    });
  }
  refreshDriveBackupStatus();

  backupToDriveBtn.addEventListener("click", () => {
    showResult(driveBackupResultBox, t("driveBackupRequesting"));
    chrome.runtime.sendMessage(
      { action: "startBackupToDrive", includeCredentials: includeCredentialsCheckbox.checked, passphrase: backupPassphraseInput.value },
      (response) => {
        if (chrome.runtime.lastError) {
          showResult(driveBackupResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
          return;
        }
        showResult(driveBackupResultBox, response ? translateResponse(response) : t("requestSent"));
        if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
        pollStatus();
        setTimeout(refreshDriveBackupStatus, 2000);
      }
    );
  });

  function resetDriveRestoreConfirmUi() {
    driveRestoreConfirmBox.style.display = "none";
    restoreFromDriveBtn.style.display = "inline-block";
  }

  restoreFromDriveBtn.addEventListener("click", () => {
    driveRestoreConfirmText.textContent = t("confirmDriveRestore");
    driveRestoreConfirmBtn.textContent = t("btnConfirmDriveRestore");
    driveRestoreCancelBtn.textContent = t("btnCancelAction");
    restoreFromDriveBtn.style.display = "none";
    driveRestoreConfirmBox.style.display = "block";
  });

  driveRestoreCancelBtn.addEventListener("click", resetDriveRestoreConfirmUi);

  driveRestoreConfirmBtn.addEventListener("click", () => {
    resetDriveRestoreConfirmUi();
    showResult(driveBackupResultBox, t("driveRestoreRequesting"));
    chrome.runtime.sendMessage({ action: "startRestoreFromDrive", passphrase: backupPassphraseInput.value }, (response) => {
      if (chrome.runtime.lastError) {
        showResult(driveBackupResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
        return;
      }
      showResult(driveBackupResultBox, response ? translateResponse(response) : t("requestSent"));
      if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
      pollStatus();
    });
  });

  // ---------------- 로컬 파일 백업/복원 (암호를 입력하면 API 키/시크릿만 암호화) ----------------
  const LOCAL_BACKUP_SETTING_KEYS = [
    "categoryDefinitions",
    "filterRules",
    "autoClassifyEnabled",
    "autoClassifyThreshold",
    "themeMode",
    "uiLanguage",
    "showQuotaOnMain",
    "correctionLearningEnabled",
    "importanceCriteria",
    "discordWebhookUrl",
    "discordWebhookUrlHigh",
    "discordWebhookUrlMedium",
    "discordWebhookUrlLow",
    "lastLabelSummary",
    "criteriaScratchpad"
  ];
  const LOCAL_BACKUP_CREDENTIAL_KEYS = ["geminiApiKeys", "oauthClientId", "oauthClientSecret"];
  const backupPassphraseInput = document.getElementById("backupPassphraseInput");

  const backupLocalBtn = document.getElementById("backupLocalBtn");
  const restoreLocalBtn = document.getElementById("restoreLocalBtn");
  const restoreLocalFileInput = document.getElementById("restoreLocalFileInput");
  const localBackupResultBox = document.getElementById("localBackupResultBox");

  backupLocalBtn.addEventListener("click", () => {
    const passphrase = backupPassphraseInput.value;
    const keys = includeCredentialsCheckbox.checked
      ? [...LOCAL_BACKUP_SETTING_KEYS, ...LOCAL_BACKUP_CREDENTIAL_KEYS]
      : LOCAL_BACKUP_SETTING_KEYS;
    chrome.storage.local.get(keys, async (stored) => {
      const settings = {};
      const credentials = {};
      for (const key of LOCAL_BACKUP_SETTING_KEYS) if (key in stored) settings[key] = stored[key];
      for (const key of LOCAL_BACKUP_CREDENTIAL_KEYS) if (key in stored) credentials[key] = stored[key];

      const payload = {
        backupVersion: 2,
        createdAt: new Date().toISOString(),
        includesCredentials: includeCredentialsCheckbox.checked,
        settings,
      };

      if (includeCredentialsCheckbox.checked && Object.keys(credentials).length) {
        if (passphrase) {
          payload.encryptedCredentials = await encryptWithPassphrase(passphrase, credentials);
        } else {
          payload.settings = { ...payload.settings, ...credentials }; // 암호 없으면 예전처럼 평문 저장
        }
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const a = document.createElement("a");
      a.href = url;
      a.download = `gmail-ai-labeler-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showResult(
        localBackupResultBox,
        payload.encryptedCredentials ? t("msgLocalBackupDoneEncrypted") : t("msgLocalBackupDone")
      );
    });
  });

  restoreLocalBtn.addEventListener("click", () => {
    restoreLocalFileInput.value = "";
    restoreLocalFileInput.click();
  });

  restoreLocalFileInput.addEventListener("change", () => {
    const file = restoreLocalFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const payload = JSON.parse(String(reader.result));
        const settings = { ...(payload.settings || {}) };
        let restoredCount = Object.keys(settings).length;

        if (payload.encryptedCredentials) {
          const passphrase = backupPassphraseInput.value;
          if (!passphrase) {
            showResult(localBackupResultBox, t("errBackupPassphraseNeeded"));
            return;
          }
          try {
            const credentials = await decryptWithPassphrase(passphrase, payload.encryptedCredentials);
            Object.assign(settings, credentials);
            restoredCount += Object.keys(credentials).length;
          } catch (e) {
            showResult(localBackupResultBox, t("errBackupPassphraseWrong"));
            return;
          }
        }

        chrome.storage.local.set(settings, () => {
          showResult(localBackupResultBox, t("msgLocalRestoreDone", [restoredCount]));
          loadSettings();
          loadOAuthFields();
          refreshOAuthStatus();
        });
      } catch (e) {
        showResult(localBackupResultBox, t("errorGenericPrefix", [String(e.message || e)]));
      }
    };
    reader.readAsText(file);
  });

  // ---------------- 설정 변경 시 자동으로 Drive 백업 ----------------
  const autoBackupOnChangeCheckbox = document.getElementById("autoBackupOnChangeCheckbox");
  chrome.storage.local.get(["autoBackupOnChange"], (result) => {
    autoBackupOnChangeCheckbox.checked = result.autoBackupOnChange === undefined ? true : !!result.autoBackupOnChange;
  });
  autoBackupOnChangeCheckbox.addEventListener("change", () => {
    chrome.storage.local.set({ autoBackupOnChange: autoBackupOnChangeCheckbox.checked });
  });

  // 설정을 저장하는 주요 동작 뒤에 호출 - 실패해도 조용히 무시(자동 백업이라 사용자를 방해하지 않음)
  function maybeAutoBackup() {
    chrome.storage.local.get(["autoBackupOnChange"], (result) => {
      const enabled = result.autoBackupOnChange === undefined ? true : !!result.autoBackupOnChange;
      if (!enabled) return;
      chrome.runtime.sendMessage(
        { action: "startBackupToDrive", includeCredentials: includeCredentialsCheckbox.checked, passphrase: backupPassphraseInput.value },
        () => {
          if (chrome.runtime.lastError) return;
          setTimeout(refreshDriveBackupStatus, 3000);
        }
      );
    });
  }
  // ---------------- 메일 요약 / 디스코드 / 중요도 기준 탭 ----------------
  // 이 블록은 main() 내부 함수(escapeHtml, showResult, pollStatus, pollTimer)를 사용하므로
  // 반드시 main() 스코프 안에 있어야 한다(예전에는 최상위에 있어 ReferenceError가 났음).
  // ---------------- 메일 요약 탭 ----------------
  const summaryLabelSelect = document.getElementById("summaryLabelSelect");
  const summaryEmailCountInput = document.getElementById("summaryEmailCountInput");
  const summaryCriteriaInput = document.getElementById("summaryCriteriaInput");
  const startSummaryBtn = document.getElementById("startSummaryBtn");
  const summaryProgressWrap = document.getElementById("summaryProgressWrap");
  const summaryProgressBar = document.getElementById("summaryProgressBar");
  const summaryProgressText = document.getElementById("summaryProgressText");
  const summaryResultBox = document.getElementById("summaryResultBox");
  const summaryActionRow = document.getElementById("summaryActionRow");
  const copySummaryBtn = document.getElementById("copySummaryBtn");

  let lastSummaryPlainText = "";

  function renderSummaryReportHTML(report) {
    if (!report) return "";
    let html = `<div style="font-family: inherit; font-size: 12px; line-height: 1.5;">`;
    html += `<div style="font-weight: 700; font-size: 13px; color: var(--blue); margin-bottom: 6px;">📋 '${escapeHtml(report.labelName)}' 라벨 요약 리포트</div>`;

    if (report.overallSummary) {
      html += `<div style="background: var(--surface-2); border-left: 3px solid var(--blue); padding: 8px 10px; border-radius: 4px; margin-bottom: 10px; font-size: 12px; white-space: pre-wrap;">${escapeHtml(report.overallSummary)}</div>`;
    }

    html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 8px;">전체 ${report.totalAnalyzed || 0}개 메일 중 ${report.selectedCount || 0}개 주요 메일 선별</div>`;

    let plainText = `[${report.labelName} 라벨 요약 리포트]\n\n● 전체 요약:\n${report.overallSummary || ""}\n\n● 주요 선별 메일 목록 (${report.selectedCount || 0}/${report.totalAnalyzed || 0}):\n`;

    if (Array.isArray(report.selectedEmails) && report.selectedEmails.length) {
      report.selectedEmails.forEach((item, idx) => {
        const imp = item.importance || "중";
        const badgeColor = imp === "상" ? "#d93025" : imp === "중" ? "#f9a825" : "#188038";
        const mailUrl = item.id ? `https://mail.google.com/mail/u/0/#inbox/${item.id}` : null;

        html += `<div style="border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; margin-bottom: 8px; background: var(--bg);">`;
        html += `<div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">`;
        html += `<span style="font-weight: 600; font-size: 12.5px;">${idx + 1}. ${escapeHtml(item.subject)}</span>`;
        html += `<span style="font-size: 10px; font-weight: 700; color: #fff; background: ${badgeColor}; padding: 1px 6px; border-radius: 10px; white-space: nowrap;">중요도: ${escapeHtml(imp)}</span>`;
        html += `</div>`;

        html += `<div style="font-size: 11px; color: var(--text-secondary); margin-bottom: 4px;">발신자: ${escapeHtml(item.sender || "")}</div>`;

        if (Array.isArray(item.summaryPoints) && item.summaryPoints.length) {
          html += `<ul style="margin: 4px 0 6px 16px; padding: 0; font-size: 11.5px;">`;
          item.summaryPoints.forEach((pt) => {
            html += `<li>${escapeHtml(pt)}</li>`;
          });
          html += `</ul>`;
        }

        if (item.actionRequired && item.actionRequired !== "없음") {
          html += `<div style="font-size: 11px; color: var(--red); font-weight: 600; margin-top: 4px;">⚡ 조치 사항: ${escapeHtml(item.actionRequired)}</div>`;
        }

        if (mailUrl) {
          html += `<div style="margin-top: 6px; text-align: right;"><a href="${mailUrl}" target="_blank" style="font-size: 11px; color: var(--blue); text-decoration: none;">메일 보기 ↗</a></div>`;
        }
        html += `</div>`;

        plainText += `\n${idx + 1}. [중요도: ${imp}] ${item.subject}\n   - 발신자: ${item.sender || ""}\n`;
        if (Array.isArray(item.summaryPoints)) {
          item.summaryPoints.forEach((pt) => {
            plainText += `   - ${pt}\n`;
          });
        }
        if (item.actionRequired && item.actionRequired !== "없음") {
          plainText += `   - 조치 사항: ${item.actionRequired}\n`;
        }
      });
    } else {
      html += `<div style="font-size: 12px; color: var(--text-secondary);">선별된 중요 메일이 없습니다.</div>`;
    }

    html += `</div>`;
    lastSummaryPlainText = plainText;
    return html;
  }

  function displaySummaryReport(report) {
    if (!summaryResultBox || !report) return;
    const html = renderSummaryReportHTML(report);
    summaryResultBox.innerHTML = html;
    summaryResultBox.classList.add("show");
    if (summaryActionRow) summaryActionRow.style.display = "flex";
  }

  if (startSummaryBtn) {
    startSummaryBtn.addEventListener("click", () => {
      const labelName = summaryLabelSelect ? summaryLabelSelect.value : "";
      const count = parseInt(summaryEmailCountInput ? summaryEmailCountInput.value : "20", 10) || 20;
      const filterCriteria = summaryCriteriaInput ? summaryCriteriaInput.value : "";

      if (!labelName) {
        showResult(summaryResultBox, t("errorSelectSummaryLabel"));
        return;
      }

      if (summaryActionRow) summaryActionRow.style.display = "none";
      showResult(summaryResultBox, t("summaryRequesting"));
      chrome.runtime.sendMessage(
        { action: "startLabelSummary", labelName, count, filterCriteria },
        (response) => {
          if (chrome.runtime.lastError) {
            showResult(summaryResultBox, t("errorGenericPrefix", [chrome.runtime.lastError.message]));
            return;
          }
          if (response && !response.ok) {
            showResult(summaryResultBox, translateResponse(response));
          } else if (response && response.ok) {
            if (!pollTimer) pollTimer = setInterval(pollStatus, 1000);
            pollStatus();
          }
        }
      );
    });
  }

  if (copySummaryBtn) {
    copySummaryBtn.addEventListener("click", () => {
      if (!lastSummaryPlainText) return;
      navigator.clipboard.writeText(lastSummaryPlainText).then(() => {
        const origText = copySummaryBtn.textContent;
        copySummaryBtn.textContent = t("summaryCopied");
        setTimeout(() => {
          copySummaryBtn.textContent = origText;
        }, 1800);
      });
    });
  }

  const sendDiscordBtn = document.getElementById("sendDiscordBtn");
  if (sendDiscordBtn) {
    sendDiscordBtn.addEventListener("click", () => {
      chrome.storage.local.get(["lastLabelSummary", "discordWebhookUrl", "discordWebhookUrlHigh", "discordWebhookUrlMedium", "discordWebhookUrlLow"], (stored) => {
        if (!stored.lastLabelSummary) {
          showResult(summaryResultBox, "전송할 요약 리포트가 없습니다.");
          return;
        }
        const webhookInput = {
          defaultUrl: stored.discordWebhookUrl || "",
          highUrl: stored.discordWebhookUrlHigh || "",
          mediumUrl: stored.discordWebhookUrlMedium || "",
          lowUrl: stored.discordWebhookUrlLow || "",
        };
        if (!webhookInput.defaultUrl && !webhookInput.highUrl && !webhookInput.mediumUrl && !webhookInput.lowUrl) {
          showResult(summaryResultBox, t("errDiscordWebhookMissing"));
          return;
        }
        chrome.runtime.sendMessage(
          { action: "sendDiscordNotification", webhookUrl: webhookInput, summaryReport: stored.lastLabelSummary },
          (res) => {
            if (chrome.runtime.lastError || (res && !res.ok)) {
              showResult(summaryResultBox, t("errorGenericPrefix", [(res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message)]));
            } else {
              showResult(summaryResultBox, t("msgDiscordSent"));
            }
          }
        );
      });
    });
  }

  const popupDiscordWebhookUrl = document.getElementById("popupDiscordWebhookUrl");
  const savePopupDiscordBtn = document.getElementById("savePopupDiscordBtn");
  const discordResultBox = document.getElementById("discordResultBox");

  if (popupDiscordWebhookUrl) {
    chrome.storage.local.get(["discordWebhookUrl"], (stored) => {
      if (stored.discordWebhookUrl) popupDiscordWebhookUrl.value = stored.discordWebhookUrl;
    });
  }

  if (savePopupDiscordBtn && popupDiscordWebhookUrl) {
    savePopupDiscordBtn.addEventListener("click", () => {
      const url = popupDiscordWebhookUrl.value.trim();
      chrome.storage.local.set({ discordWebhookUrl: url }, () => {
        showResult(discordResultBox, "디스코드 웹훅 URL이 저장되었습니다.");
      });
    });
  }

  // ---------------- 중요도 분류 기준 설정 ----------------
  const DEFAULT_IMPORTANCE_CRITERIA = {
    high: "24시간 이내 마감/회신 요구, 결제 실패/서버 오류/계정 보안 경고, 상사의 직접 승인 요청, 법적/비용적 이슈 메일",
    medium: "일주일 이내 미팅/회의 일정, 프로젝트 진행상황 공유, 일반 업무 요청, 주요 회사/서비스 공지사항",
    low: "뉴스레터, 정기 보고서, 마케팅/프로모션 참고용, 회신이나 조치가 필요 없는 순수 정보성 알림"
  };

  const criteriaHighInput = document.getElementById("criteriaHighInput");
  const criteriaMediumInput = document.getElementById("criteriaMediumInput");
  const criteriaLowInput = document.getElementById("criteriaLowInput");
  const saveCriteriaBtn = document.getElementById("saveCriteriaBtn");
  const resetCriteriaBtn = document.getElementById("resetCriteriaBtn");
  const criteriaResultBox = document.getElementById("criteriaResultBox");

  function loadCriteriaFields() {
    chrome.storage.local.get(["importanceCriteria"], (stored) => {
      const c = stored.importanceCriteria || DEFAULT_IMPORTANCE_CRITERIA;
      if (criteriaHighInput) criteriaHighInput.value = c.high || DEFAULT_IMPORTANCE_CRITERIA.high;
      if (criteriaMediumInput) criteriaMediumInput.value = c.medium || DEFAULT_IMPORTANCE_CRITERIA.medium;
      if (criteriaLowInput) criteriaLowInput.value = c.low || DEFAULT_IMPORTANCE_CRITERIA.low;
    });
  }

  if (saveCriteriaBtn) {
    saveCriteriaBtn.addEventListener("click", () => {
      const importanceCriteria = {
        high: criteriaHighInput.value.trim(),
        medium: criteriaMediumInput.value.trim(),
        low: criteriaLowInput.value.trim()
      };
      chrome.storage.local.set({ importanceCriteria }, () => {
        showResult(criteriaResultBox, "중요도 분류 기준이 저장되었습니다.");
      });
    });
  }

  if (resetCriteriaBtn) {
    resetCriteriaBtn.addEventListener("click", () => {
      chrome.storage.local.set({ importanceCriteria: DEFAULT_IMPORTANCE_CRITERIA }, () => {
        loadCriteriaFields();
        showResult(criteriaResultBox, "기본 분류 기준으로 복원되었습니다.");
      });
    });
  }

  loadCriteriaFields();

  chrome.storage.local.get(["lastLabelSummary"], (stored) => {
    if (stored.lastLabelSummary) {
      displaySummaryReport(stored.lastLabelSummary);
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}