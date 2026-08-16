// dashboard/dashboard.js
// Gmail AI Labeler Dashboard - Copyright (c) 2026 김태형 (thk7410@gmail.com)
//
// 대시보드 진입점. 하는 일은 패널을 조립하고 초기 데이터를 읽는 것뿐이다.
//
//   ui/         dom, 테마, 작업 상태 표시(상태 배지·결과 카드·진행률·폴링)
//   panels/     탭별 화면. 각 패널이 자기 DOM 이벤트를 직접 연결한다(initXxxEvents)
//   job_client  백그라운드에 작업을 요청하는 유일한 통로
//
// 예전에는 425줄짜리 initEvents() 하나가 모든 탭의 이벤트를 한꺼번에 연결했다.
// 이제는 패널마다 자기 이벤트를 자기 파일에서 연결하고, 이 파일은 그것들을 부르기만 한다.
//
// 패널끼리 공유하는 상태(카테고리 목록, 마지막 리포트 등)는 소유 패널이 들고 있고
// 다른 패널은 getter로만 읽는다. ES 모듈에서는 import한 바인딩에 대입할 수 없으므로,
// 값을 바꾸는 경로도 소유 패널이 내보낸 함수 하나로 자연히 고정된다.

import { i18nInit, i18nApplyToDom, t } from "../i18n.js";

import { $ } from "./ui/dom.js";
import { initTheme } from "./ui/theme.js";
import { pollStatus } from "./ui/status.js";

import { initDashTabSwitching } from "./panels/tabs.js";
import {
  loadCategories,
  renderSidebarLabels,
  renderDashboardCategories,
  updateSelectedLabelHeader,
  selectLabel,
  initLabelAdminEvents,
} from "./panels/labels.js";
import { renderReport, getLastReportData, initReportEvents } from "./panels/report.js";
import { loadSummaryFeedback } from "./panels/feedback.js";
import { loadDashFilterRules, renderDashFilterRules } from "./panels/filters.js";
import {
  renderDashAnalysisChecklist,
  loadDashScratchpad,
  initDashboardExtraFeatureEvents,
  initCriteriaEvents,
} from "./panels/analysis.js";
import { loadDashboardLogs, initLogsEvents } from "./panels/logs.js";
import { initRelabelEvents } from "./panels/relabel.js";
import { initSettingsEvents } from "./panels/settings.js";
import { initClassifyEvents, setDashBatchSize, getDashBatchSize } from "./panels/classify.js";
import { initCalendarEvents } from "./panels/calendar.js";

// 어느 한 패널에도 속하지 않는 두 컨트롤만 여기서 연결한다.
function initSharedEvents() {
  const refreshBtn = $("dashRefreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      loadCategories();
      pollStatus();
      loadDashboardLogs();
    });
  }

  const summarySelect = $("dashSummaryLabelSelect");
  if (summarySelect) {
    summarySelect.addEventListener("change", () => selectLabel(summarySelect.value));
  }
}

// 반복 분류 힌트에 쓸 실제 배치 크기를 background에서 받아온다.
function loadBatchSizeHint() {
  chrome.runtime.sendMessage({ action: "getConfig" }, (config) => {
    if (chrome.runtime.lastError || !config || !config.batchSize) return;
    setDashBatchSize(config.batchSize);

    const hintEl = $("dashRepeatHint");
    const batchesEl = $("dashRepeatBatchesInput");
    const roundsEl = $("dashRepeatRoundsInput");
    if (!hintEl || !batchesEl || !roundsEl) return;

    const perRound = Math.max(1, Math.min(5, parseInt(batchesEl.value, 10) || 1)) * getDashBatchSize();
    const rounds = Math.max(1, parseInt(roundsEl.value, 10) || 1);
    hintEl.textContent = t("hintRepeatRounds", [perRound, rounds, perRound * rounds]);
  });
}

// 다른 화면에서 언어를 바꾸면 열려 있는 대시보드에도 반영한다.
// 언어 설정은 appSettings.general.language로 옮겨졌다(예전 평면 키 uiLanguage 아님).
function watchLanguageChange() {
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local") return;
    const langChanged =
      changes.uiLanguage ||
      (changes.appSettings &&
        changes.appSettings.oldValue?.general?.language !== changes.appSettings.newValue?.general?.language);
    if (!langChanged) return;

    await i18nInit(true);
    i18nApplyToDom(document);
    pollStatus(); // 상태 pill과 진행/결과 문구를 새 언어로 다시 채운다
    updateSelectedLabelHeader();
    renderSidebarLabels();
    renderDashboardCategories();
    renderDashFilterRules();
    renderDashAnalysisChecklist();
    if (getLastReportData()) renderReport(getLastReportData());
  });
}

async function main() {
  // 대시보드는 예전에 i18n을 전혀 쓰지 않아서 화면 문자열이 전부 한국어로 고정돼 있었다.
  // 먼저 로케일을 로드하고 DOM에 적용한 뒤에 나머지를 그린다
  // (t()를 쓰는 렌더 함수들이 뒤따르므로 순서가 중요).
  await i18nInit();
  i18nApplyToDom(document);

  initTheme();

  // 저장된 판정을 먼저 읽어야 요약 리포트의 피드백 버튼이 눌린 상태로 그려진다.
  loadSummaryFeedback();
  // 필터 규칙 행의 라벨 자동완성이 카테고리 목록을 쓰므로 카테고리를 먼저 읽는다.
  await loadCategories();

  initSharedEvents();
  initReportEvents();
  initCriteriaEvents();
  initClassifyEvents();
  initLabelAdminEvents();
  initRelabelEvents();
  initSettingsEvents();
  initCalendarEvents();
  initLogsEvents();
  initDashTabSwitching();
  initDashboardExtraFeatureEvents();

  await loadDashFilterRules();
  loadDashScratchpad();
  loadBatchSizeHint();

  chrome.storage.local.get(["lastLabelSummary"], (stored) => {
    if (stored.lastLabelSummary) renderReport(stored.lastLabelSummary);
  });

  pollStatus();
  watchLanguageChange();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}
