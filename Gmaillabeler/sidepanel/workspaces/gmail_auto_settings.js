// sidepanel/workspaces/gmail_auto_settings.js
// Gmail 자동 실행 설정 워크스페이스.

import { SettingsStore } from "../../settings/settings_store.js";

import { startJob } from "../job_client.js";
import { updateContextUI } from "../ui/context.js";
import { $ } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { setLabelSettingsActive } from "./gmail_label_settings.js";

function renderGmailAutoSettingsWorkspace() {
  setLabelSettingsActive(false);
  const container = $("panelContainer");
  if (!container) return;

  container.innerHTML = "";

  updateContextUI({
    service: "Gmail",
    pageType: "auto_settings",
    title: "자동 라벨링 설정",
    desc: "실시간/주기적 자동 라벨링, AI 신뢰도 기준, 후속 조치를 설정합니다."
  });

  const wrapper = document.createElement("div");
  wrapper.className = "auto-settings-workspace";
  wrapper.id = "autoSettingsWorkspace";

  wrapper.innerHTML = `
    <div class="auto-settings-topbar">
      <div style="display:flex; align-items:center; gap:6px;">
        <span class="auto-badge" id="autoStatusBadge">⚪ 로딩 중...</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <label class="switch-compact" title="자동 라벨링 전체 ON/OFF">
          <input type="checkbox" id="checkAutoClassifyMaster">
          <span class="slider-compact"></span>
        </label>
        <span style="font-size:11px; font-weight:600;" id="txtAutoMaster">자동 실행</span>
      </div>
    </div>

    <!-- 1. 실행 방식 & 주기 -->
    <div class="auto-section-card">
      <div class="auto-section-head">
        <span class="auto-section-title">⏱️ 1. 실행 방식 & 주기 (Trigger & Schedule)</span>
      </div>
      <div class="auto-section-body">
        <div class="auto-field-row">
          <label class="auto-field-label">검사 및 실행 주기</label>
          <select class="settings-select-compact" id="selectAutoInterval">
            <option value="5">⚡ 5분마다 (빠른 검사)</option>
            <option value="15">⏱️ 15분마다 (권장)</option>
            <option value="30">🕒 30분마다</option>
            <option value="60">🕐 1시간마다</option>
            <option value="manual">🖐️ 수동 실행만</option>
          </select>
        </div>
        <label class="auto-check-row">
          <input type="checkbox" id="checkWorkHoursOnly">
          <span>⏰ 평일 업무 시간(09:00 ~ 19:00)에만 자동 실행</span>
        </label>
        <label class="auto-check-row">
          <input type="checkbox" id="checkNewMailOnly">
          <span>📥 새로 수신된 신규 메일만 처리 (기존 메일 스킵)</span>
        </label>
      </div>
    </div>

    <!-- 2. AI 분류 정확도 & 신뢰도 -->
    <div class="auto-section-card">
      <div class="auto-section-head">
        <span class="auto-section-title">🧠 2. AI 분류 정확도 & 신뢰도 (AI Confidence)</span>
      </div>
      <div class="auto-section-body">
        <div class="auto-field-row">
          <label class="auto-field-label">정확도 신뢰도 기준</label>
          <select class="settings-select-compact" id="selectConfidenceThreshold">
            <option value="90">🎯 엄격 (90% 이상) - 확실한 메일만 분류</option>
            <option value="80">⚖️ 보통 (80%) - 균형적인 권장값</option>
            <option value="70">⚡ 적극적 (70%) - 가능한 모든 메일 분류</option>
          </select>
        </div>
        <div class="auto-field-row">
          <label class="auto-field-label">애매한 메일(신뢰도 미달) 처리</label>
          <select class="settings-select-compact" id="selectFallbackAction">
            <option value="skip">⏭️ 라벨 미부착 (건너뛰기)</option>
            <option value="review_label">❓ '[검토필요]' 라벨 부착</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 3. 라벨링 후 자동 조치 -->
    <div class="auto-section-card">
      <div class="auto-section-head">
        <span class="auto-section-title">⚡ 3. 라벨링 후 자동 조치 (Post-Action)</span>
      </div>
      <div class="auto-section-body">
        <label class="auto-check-row">
          <input type="checkbox" id="checkArchivePromo">
          <span>📦 영수증/뉴스레터/알림 라벨은 받은편지함 자동 보관 (Skip Inbox)</span>
        </label>
        <label class="auto-check-row">
          <input type="checkbox" id="checkMarkAsReadLow">
          <span>👀 프로모션/뉴스레터 등 저중요도 메일 자동 읽음 처리</span>
        </label>
        <label class="auto-check-row">
          <input type="checkbox" id="checkStarImportant">
          <span>⭐ 업무/긴급 등 중요 라벨 분류 시 자동 별표(⭐) 표시</span>
        </label>
      </div>
    </div>

    <div class="auto-actions-row">
      <button class="btn btn-primary btn-auto-save" id="btnSaveAutoSettings">
        💾 설정 저장
      </button>
      <button class="btn btn-outlined btn-auto-test" id="btnTestAutoClassify">
        🧪 즉시 1회 실행
      </button>
    </div>
  `;

  container.appendChild(wrapper);

  loadAndBindAutoSettings();
}

function loadAndBindAutoSettings() {
  const masterSwitch = $("checkAutoClassifyMaster");
  const statusBadge = $("autoStatusBadge");
  const intervalSelect = $("selectAutoInterval");
  const workHoursCheck = $("checkWorkHoursOnly");
  const newMailCheck = $("checkNewMailOnly");
  const thresholdSelect = $("selectConfidenceThreshold");
  const fallbackSelect = $("selectFallbackAction");
  const archivePromoCheck = $("checkArchivePromo");
  const markAsReadLowCheck = $("checkMarkAsReadLow");
  const starImportantCheck = $("checkStarImportant");

  function updateStatusUI(enabled) {
    if (!statusBadge) return;
    if (enabled) {
      statusBadge.textContent = "🟢 자동 실행 중";
      statusBadge.className = "auto-badge active";
    } else {
      statusBadge.textContent = "⚪ 비활성";
      statusBadge.className = "auto-badge";
    }
  }

  // SettingsStore는 이제 import로 항상 들어온다.
  // 예전의 typeof 가드는 참인 적이 없었고(전역이 아니었다), chrome.storage.sync를 읽는
  // 대체 경로는 이 확장이 쓰지 않는 저장소라 항상 빈 설정을 돌려줬다.
  SettingsStore.getSettings().then((settings) => {
    const auto = settings?.automation?.autoClassify || {};
    const isEnabled = auto.enabled !== false;

    if (masterSwitch) masterSwitch.checked = isEnabled;
    updateStatusUI(isEnabled);

    if (intervalSelect) intervalSelect.value = String(auto.interval || "15");
    if (workHoursCheck) workHoursCheck.checked = !!auto.workHoursOnly;
    if (newMailCheck) newMailCheck.checked = auto.newMailOnly !== false;
    if (thresholdSelect) thresholdSelect.value = String(auto.threshold || "80");
    if (fallbackSelect) fallbackSelect.value = auto.fallbackAction || "skip";
    if (archivePromoCheck) archivePromoCheck.checked = !!auto.archivePromo;
    if (markAsReadLowCheck) markAsReadLowCheck.checked = !!auto.markAsReadLow;
    if (starImportantCheck) starImportantCheck.checked = auto.starImportant !== false;
  }).catch(() => {
    updateStatusUI(true);
  });

  masterSwitch?.addEventListener("change", (e) => {
    updateStatusUI(e.target.checked);
  });

  $("btnSaveAutoSettings")?.addEventListener("click", () => {
    const newValues = {
      enabled: masterSwitch?.checked ?? true,
      interval: intervalSelect?.value || "15",
      workHoursOnly: !!workHoursCheck?.checked,
      newMailOnly: newMailCheck?.checked !== false,
      threshold: parseInt(thresholdSelect?.value || "80", 10),
      fallbackAction: fallbackSelect?.value || "skip",
      archivePromo: !!archivePromoCheck?.checked,
      markAsReadLow: !!markAsReadLowCheck?.checked,
      starImportant: starImportantCheck?.checked !== false
    };
  // SettingsStore는 이제 import로 항상 들어온다. 예전의 typeof 가드는 참인 적이 없었고,
  // else 쪽 chrome.storage.sync 경로는 이 확장이 쓰지 않는 저장소라 늘 빈 값을 돌려줬다.
    SettingsStore.getSettings().then((settings) => {
      if (!settings.automation) settings.automation = {};
      if (!settings.automation.autoClassify) settings.automation.autoClassify = {};
      Object.assign(settings.automation.autoClassify, newValues);
      SettingsStore.setSetting("automation.autoClassify", settings.automation.autoClassify).then(() => {
        showSettingsToast("자동 라벨링 설정이 저장되었습니다.");
      });
    });
  
  });

  $("btnTestAutoClassify")?.addEventListener("click", () => {
    startJob("gmail_classify");
  });
}


export {
  loadAndBindAutoSettings,
  renderGmailAutoSettingsWorkspace,
};
