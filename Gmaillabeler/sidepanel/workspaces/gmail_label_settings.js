// sidepanel/workspaces/gmail_label_settings.js
// 라벨 분류 기준 설정 워크스페이스. AI 제안 생성/검토/적용까지 담당한다.
// 작업 결과를 받아 카드를 갱신하는 저장소 리스너도 이 파일이 직접 등록한다.

import { SettingsStore } from "../../settings/settings_store.js";

import { updateContextUI } from "../ui/context.js";
import { $, escapeHtml } from "../ui/dom.js";
import { setActionFeedback, showSettingsToast } from "../ui/feedback.js";

let labelSettingsCategoryDefs = [];
let generatedSuggestions = new Map(); // labelName -> { suggestion, status: 'pending'|'done'|'error', errorMsg }
let isLabelSettingsActive = false;

// 이 화면이 떠 있는지 여부는 이 모듈이 소유한다. 다른 워크스페이스로 넘어갈 때
// 그쪽에서 이 함수로 꺼 준다(작업 결과 리스너가 헛돌지 않게).
function setLabelSettingsActive(active) {
  isLabelSettingsActive = !!active;
}

function renderGmailLabelSettingsWorkspace() {
  isLabelSettingsActive = true;
  const container = $("panelContainer");
  const dynamicActions = $("dynamicActions");
  if (!container) return;

  if (dynamicActions) dynamicActions.innerHTML = "";
  container.innerHTML = "";

  updateContextUI({
    service: "Gmail",
    pageType: "settings",
    title: "라벨 분류기준 설정",
    desc: "AI를 이용해 라벨별 메일을 분석하고 분류기준을 자동 생성 및 관리합니다."
  });

  const wrapper = document.createElement("div");
  wrapper.className = "label-settings-workspace";
  wrapper.id = "labelSettingsWorkspace";

  wrapper.innerHTML = `
    <div class="label-settings-topbar" id="labelSettingsTopBar">
      <!-- Top Sticky Toolbar dynamically populated -->
    </div>

    <div class="label-cards-list" id="labelCardsList">
      <div style="text-align:center; padding:16px; color:var(--md-sys-color-on-surface-variant); font-size:11.5px;">
        라벨 목록을 불러오는 중...
      </div>
    </div>
  `;

  container.appendChild(wrapper);

  loadLabelCategories(() => {
    renderLabelSettingsCards();
  });
}

function loadLabelCategories(callback) {
  // SettingsStore는 이제 import로 항상 들어온다. 예전의 typeof 가드는 참인 적이 없었고,
  // else 쪽 chrome.storage.sync 경로는 이 확장이 쓰지 않는 저장소라 늘 빈 값을 돌려줬다.
  SettingsStore.getSetting("gmail.categories").then((categories) => {
    if (Array.isArray(categories) && categories.length > 0) {
      labelSettingsCategoryDefs = categories.map((c) => ({
        name: c.name || "",
        description: c.description || "",
        colorId: c.colorId,
        autoLearned: !!c.autoLearned
      })).filter((c) => c.name);
    } else {
      const defaultNames = ["업무", "개인", "영수증", "알림", "뉴스레터"];
      labelSettingsCategoryDefs = defaultNames.map((name) => ({ name, description: "" }));
    }
    if (typeof callback === "function") callback();
  }).catch(() => {
    const defaultNames = ["업무", "개인", "영수증", "알림", "뉴스레터"];
    labelSettingsCategoryDefs = defaultNames.map((name) => ({ name, description: "" }));
    if (typeof callback === "function") callback();
  });
}

function renderLabelSettingsCards() {
  const topBar = $("labelSettingsTopBar");
  const list = $("labelCardsList");
  if (!topBar || !list) return;

  const totalCount = labelSettingsCategoryDefs.length;
  const pendingCount = Array.from(generatedSuggestions.values()).filter((s) => s.status === "pending").length;
  const doneCount = Array.from(generatedSuggestions.values()).filter((s) => s.status === "done").length;
  const isAnalyzing = pendingCount > 0;
  const isReview = doneCount > 0 && !isAnalyzing;

  // 1. Render Sticky Top Toolbar
  if (isAnalyzing) {
    topBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <span class="label-count-badge">⏳ 분석 중 (${pendingCount}개)</span>
      </div>
      <button class="btn-pill-small danger" id="btnCancelLabelAnalysis">
        ⏹️ 중지
      </button>
    `;
    $("btnCancelLabelAnalysis")?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "cancelJob" }, () => {
        setActionFeedback("라벨 분석 중지를 요청했습니다.");
      });
    });
  } else if (isReview) {
    topBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:5px;">
        <span class="label-status-tag tag-new">✨ 새 추천 ${doneCount}건</span>
      </div>
      <div class="review-toolbar-actions">
        <button class="btn-pill-small success" id="btnApplyAllLabelSuggestions" title="모든 추천 기준 적용">
          ✅ 모두 적용 (${doneCount})
        </button>
        <button class="btn-pill-small outlined" id="btnReanalyzeAllLabels" title="전체 라벨 다시 분석">
          🔄 재생성
        </button>
        <button class="btn-pill-small secondary" id="btnCancelLabelReview" title="닫기">
          ✕
        </button>
      </div>
    `;
    $("btnApplyAllLabelSuggestions")?.addEventListener("click", handleApplyAllSuggestions);
    $("btnReanalyzeAllLabels")?.addEventListener("click", handleGenerateAllCriteria);
    $("btnCancelLabelReview")?.addEventListener("click", handleCancelReviewMode);
  } else {
    topBar.innerHTML = `
      <div style="display:flex; align-items:center; gap:5px;">
        <span class="label-count-badge">🏷️ 라벨 ${totalCount}개</span>
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <button class="btn-pill-small primary" id="btnGenerateAllLabelCriteria">
          ✨ 전체 AI 생성
        </button>
      </div>
    `;
    $("btnGenerateAllLabelCriteria")?.addEventListener("click", handleGenerateAllCriteria);
  }

  // 2. Render Edge-to-Edge List Cards
  if (totalCount === 0) {
    list.innerHTML = `
      <div style="text-align:center; padding:20px; color:var(--md-sys-color-on-surface-variant); font-size:11.5px;">
        등록된 라벨이 없습니다. Gmail 웹에서 라벨을 생성하거나 동기화해 주세요.
      </div>
    `;
    return;
  }

  list.innerHTML = "";

  labelSettingsCategoryDefs.forEach((cat, idx) => {
    const labelName = cat.name;
    const currentDesc = cat.description || "";
    const suggObj = generatedSuggestions.get(labelName);

    const card = document.createElement("div");
    card.className = "label-setting-card" + (suggObj?.status === "done" ? " has-suggestion" : suggObj?.status === "pending" ? " is-pending" : "");
    card.id = `labelCard_${idx}`;

    let statusTagHtml = "";
    let headActionsHtml = "";
    let bodyHtml = "";

    if (suggObj?.status === "pending") {
      statusTagHtml = `<span class="label-status-tag tag-pending">⏳ 분석중</span>`;
      bodyHtml = `
        <div class="label-card-body">
          <div class="old-criteria-inline" style="color:var(--md-sys-color-primary); justify-content:center; padding:6px;">
            🌀 최근 수신 메일 수집 및 AI 분석 중...
          </div>
        </div>
      `;
    } else if (suggObj?.status === "done") {
      statusTagHtml = `<span class="label-status-tag tag-new">✨ 새 추천</span>`;
      headActionsHtml = `
        <button class="btn-pill-small success" id="btnApplySugg_${idx}" title="이 기준 적용">✓ 적용</button>
        <button class="btn-pill-small secondary" id="btnRejectSugg_${idx}" title="기존 유지">✕</button>
        <button class="btn-pill-small outlined" id="btnReanalyzeSingle_${idx}" title="다시 생성">🔄</button>
      `;
      bodyHtml = `
        <div class="label-card-body">
          <div class="old-criteria-inline">
            <span class="old-label">🔹 기존:</span>
            <span class="old-text">${escapeHtml(currentDesc || "(설정된 기준 없음)")}</span>
          </div>
          <textarea class="criteria-edit-area suggestion-glow" id="textareaSugg_${idx}" placeholder="AI가 생성한 분류기준">${escapeHtml(suggObj.suggestion)}</textarea>
        </div>
      `;
    } else {
      // Normal/Idle state
      headActionsHtml = `
        <button class="btn-pill-small outlined" id="btnGenerateSingle_${idx}" title="AI로 이 라벨 기준 생성">✨ AI 생성</button>
        <button class="btn-pill-small secondary" id="btnSaveManual_${idx}" title="직접 입력한 기준 저장">💾</button>
      `;
      bodyHtml = `
        <div class="label-card-body">
          <textarea class="criteria-edit-area" id="textareaDesc_${idx}" placeholder="분류기준 입력 (예: 스프린트 일정, 배포 공지)">${escapeHtml(currentDesc)}</textarea>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="label-card-head">
        <div class="label-title-wrap">
          <span>🏷️</span>
          <span>${escapeHtml(labelName)}</span>
          ${statusTagHtml}
        </div>
        <div class="label-head-actions">
          ${headActionsHtml}
        </div>
      </div>
      ${bodyHtml}
    `;

    list.appendChild(card);

    // Event listeners
    if (suggObj?.status === "done") {
      $(`btnApplySugg_${idx}`)?.addEventListener("click", () => {
        const editedVal = $(`textareaSugg_${idx}`)?.value || suggObj.suggestion;
        handleApplySingleSuggestion(labelName, editedVal);
      });
      $(`btnRejectSugg_${idx}`)?.addEventListener("click", () => {
        handleRejectSingleSuggestion(labelName);
      });
      $(`btnReanalyzeSingle_${idx}`)?.addEventListener("click", () => {
        handleGenerateSingleCriteria(labelName);
      });
    } else if (suggObj?.status !== "pending") {
      $(`btnGenerateSingle_${idx}`)?.addEventListener("click", () => {
        handleGenerateSingleCriteria(labelName);
      });
      $(`btnSaveManual_${idx}`)?.addEventListener("click", () => {
        const val = $(`textareaDesc_${idx}`)?.value || "";
        handleSaveManualCriteria(labelName, val);
      });
    }
  });
}

function handleGenerateAllCriteria() {
  const targetNames = labelSettingsCategoryDefs.map((c) => c.name).filter(Boolean);
  if (!targetNames.length) {
    showSettingsToast("분석할 라벨이 없습니다.");
    return;
  }

  targetNames.forEach((name) => {
    generatedSuggestions.set(name, { suggestion: "", status: "pending" });
  });

  renderLabelSettingsCards();
  setActionFeedback(`전체 ${targetNames.length}개 라벨에 대한 AI 분류기준 생성을 시작합니다...`);

  chrome.runtime.sendMessage({ action: "startAnalyzeMultipleLabels", labelNames: targetNames }, (res) => {
    if (chrome.runtime.lastError || (res && res.ok === false)) {
      const err = chrome.runtime.lastError?.message || res?.message || "작업 시작 실패";
      showSettingsToast(`요청 실패: ${err}`);
      targetNames.forEach((name) => {
        generatedSuggestions.delete(name);
      });
      renderLabelSettingsCards();
    }
  });
}

function handleGenerateSingleCriteria(labelName) {
  if (!labelName) return;

  generatedSuggestions.set(labelName, { suggestion: "", status: "pending" });
  renderLabelSettingsCards();
  setActionFeedback(`"${labelName}" 라벨에 대한 AI 분류기준 생성을 시작합니다...`);

  chrome.runtime.sendMessage({ action: "startAnalyzeLabelCriteria", labelName }, (res) => {
    if (chrome.runtime.lastError || (res && res.ok === false)) {
      const err = chrome.runtime.lastError?.message || res?.message || "작업 시작 실패";
      showSettingsToast(`요청 실패: ${err}`);
      generatedSuggestions.delete(labelName);
      renderLabelSettingsCards();
    }
  });
}

function handleApplySingleSuggestion(labelName, newValue) {
  const item = labelSettingsCategoryDefs.find((c) => c.name === labelName);
  if (item) {
    item.description = newValue.trim();
    saveCategoryDefinitionsToStore(() => {
      generatedSuggestions.delete(labelName);
      showSettingsToast(`"${labelName}" 기준이 적용되었습니다.`);
      renderLabelSettingsCards();
    });
  }
}

function handleRejectSingleSuggestion(labelName) {
  generatedSuggestions.delete(labelName);
  showSettingsToast(`"${labelName}" 추천 기준을 취소했습니다.`);
  renderLabelSettingsCards();
}

function handleApplyAllSuggestions() {
  let appliedCount = 0;
  labelSettingsCategoryDefs.forEach((cat, idx) => {
    const suggObj = generatedSuggestions.get(cat.name);
    if (suggObj && suggObj.status === "done") {
      const editedVal = $(`textareaSugg_${idx}`)?.value || suggObj.suggestion;
      cat.description = editedVal.trim();
      appliedCount += 1;
    }
  });

  if (appliedCount > 0) {
    saveCategoryDefinitionsToStore(() => {
      generatedSuggestions.clear();
      showSettingsToast(`총 ${appliedCount}개의 분류기준이 모두 적용되었습니다.`);
      renderLabelSettingsCards();
    });
  } else {
    generatedSuggestions.clear();
    renderLabelSettingsCards();
  }
}

function handleCancelReviewMode() {
  generatedSuggestions.clear();
  showSettingsToast("추천 기준 검토를 취소했습니다.");
  renderLabelSettingsCards();
}

function handleSaveManualCriteria(labelName, value) {
  const item = labelSettingsCategoryDefs.find((c) => c.name === labelName);
  if (item) {
    item.description = value.trim();
    saveCategoryDefinitionsToStore(() => {
      showSettingsToast(`"${labelName}" 분류기준이 저장되었습니다.`);
      renderLabelSettingsCards();
    });
  }
}

function saveCategoryDefinitionsToStore(callback) {
  // SettingsStore는 이제 import로 항상 들어온다. 예전의 typeof 가드는 참인 적이 없었고,
  // else 쪽 chrome.storage.sync 경로는 이 확장이 쓰지 않는 저장소라 저장해도 아무도 읽지 않았다.
  SettingsStore.setSetting("gmail.categories", labelSettingsCategoryDefs).then(() => {
    if (typeof callback === "function") callback();
  });
}


// 기준 생성 작업 결과를 받아 카드를 갱신한다.
// 예전에는 이 처리가 ui/progress.js의 진행률 리스너 안에 섞여 있었다. 그래서 진행률 코드를
// 손대면 라벨 설정이 깨질 수 있었고, 진행률 모듈이 이 화면의 내부 상태를 import 해야 했다.
// 이제 이 화면이 자기 리스너를 직접 갖는다.
function initLabelSettingsJobListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (!changes.jobStatus && !changes.jobResult) return;
    // 이 화면이 떠 있지 않으면 볼 이유가 없다.
    if (!isLabelSettingsActive) return;

    chrome.storage.local.get(["jobStatus", "jobResult"], (res) => {
      if (!res || !isLabelSettingsActive) return;

      if (res.jobStatus === "done" && res.jobResult) {
        const result = res.jobResult;
        if (Array.isArray(result.suggestions) && result.suggestions.length > 0) {
          result.suggestions.forEach((s) => {
            if (s && s.labelName && s.suggestion) {
              generatedSuggestions.set(s.labelName, { suggestion: s.suggestion, status: "done" });
            }
          });
          renderLabelSettingsCards();
        } else if (result.labelName && result.suggestion) {
          generatedSuggestions.set(result.labelName, { suggestion: result.suggestion, status: "done" });
          renderLabelSettingsCards();
        }
      } else if (res.jobStatus === "error" || res.jobStatus === "cancelled") {
        // 실패했는데 "생성 중" 표시가 영원히 남지 않게 대기 상태를 걷어낸다.
        let hadPending = false;
        for (const [name, obj] of generatedSuggestions.entries()) {
          if (obj.status === "pending") {
            generatedSuggestions.delete(name);
            hadPending = true;
          }
        }
        if (hadPending) renderLabelSettingsCards();
      }
    });
  });
}


export {
  initLabelSettingsJobListener,
  generatedSuggestions,
  handleApplyAllSuggestions,
  handleApplySingleSuggestion,
  handleCancelReviewMode,
  handleGenerateAllCriteria,
  handleGenerateSingleCriteria,
  handleRejectSingleSuggestion,
  handleSaveManualCriteria,
  setLabelSettingsActive,
  labelSettingsCategoryDefs,
  loadLabelCategories,
  renderGmailLabelSettingsWorkspace,
  renderLabelSettingsCards,
  saveCategoryDefinitionsToStore,
};
