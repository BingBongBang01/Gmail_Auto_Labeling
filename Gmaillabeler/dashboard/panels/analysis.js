// dashboard/panels/analysis.js
// 라벨 분석 체크리스트, 분류 기준 임시저장(스크래치패드), 기준 AI 자동 생성.

// ---------------- 라벨 분석 + 분류 기준 임시저장 ----------------

import { startJob } from "../job_client.js";
import { getDashBatchSize } from "./classify.js";
import {
  addEmptyDashFilterRule,
  collectDashFilterRules,
  getDashFilterRules,
  renderDashFilterRules,
  setDashFilterRules,
} from "./filters.js";
import { getCategoryDefs, getSelectedLabelName, renderDashboardCategories } from "./labels.js";
import { generateSummaryText, getLastReportData } from "./report.js";
import { $, escapeHtml, setText } from "../ui/dom.js";
import { t } from "../../i18n.js";
import { SettingsStore } from "../../settings/settings_store.js";

function renderDashAnalysisChecklist() {
  const box = $("dashLabelAnalysisChecklist");
  if (!box) return;
  const checked = new Set([...box.querySelectorAll("input:checked")].map((el) => el.value));
  box.innerHTML = getCategoryDefs()
    .map(
      (c) => `
      <label class="dash-check-row">
        <input type="checkbox" value="${escapeHtml(c.name)}"${checked.has(c.name) ? " checked" : ""}>
        <span>${escapeHtml(c.name)}</span>
      </label>`
    )
    .join("");
}

function loadDashScratchpad() {
  const pad = $("dashCriteriaScratchpad");
  if (!pad) return;
  chrome.storage.local.get(["criteriaScratchpad"], (result) => {
    pad.value = result.criteriaScratchpad || "";
  });
}

// 팝업과 같은 형식을 읽는다: 빈 줄로 구분된 블록에서 첫 줄이 카테고리명, 나머지가 기준 문장
function parseDashScratchpad(text) {
  return String(text || "")
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return { labelName: (lines[0] || "").trim(), suggestion: lines.slice(1).join("\n").trim() };
    })
    .filter((e) => e.labelName && e.suggestion);
}

function initDashboardExtraFeatureEvents() {
  // --- 반복 분류 ---
  const repeatBatches = $("dashRepeatBatchesInput");
  const repeatRounds = $("dashRepeatRoundsInput");

  function updateDashRepeatHint() {
    const hint = $("dashRepeatHint");
    if (!hint || !repeatBatches || !repeatRounds) return;
    const batches = Math.max(1, Math.min(5, parseInt(repeatBatches.value, 10) || 1));
    const rounds = Math.max(1, parseInt(repeatRounds.value, 10) || 1);
    const perRound = batches * getDashBatchSize();
    hint.textContent = t("hintRepeatRounds", [perRound, rounds, perRound * rounds]);
  }

  if (repeatBatches) repeatBatches.addEventListener("input", updateDashRepeatHint);
  if (repeatRounds) repeatRounds.addEventListener("input", updateDashRepeatHint);
  updateDashRepeatHint();

  const startRepeatBtn = $("dashStartRepeatBtn");
  if (startRepeatBtn) {
    startRepeatBtn.addEventListener("click", () => {
      const batchesPerRound = Math.max(1, Math.min(5, parseInt(repeatBatches.value, 10) || 1));
      const repeatCount = Math.max(1, parseInt(repeatRounds.value, 10) || 1);
      startJob({ action: "startRepeatClassification", batchesPerRound, repeatCount });
    });
  }

  // --- 개인 필터 규칙 ---
  const addRuleBtn = $("dashAddFilterRuleBtn");
  if (addRuleBtn) {
    addRuleBtn.addEventListener("click", () => {
      collectDashFilterRules();
      addEmptyDashFilterRule();
      renderDashFilterRules();
    });
  }

  const saveRulesBtn = $("dashSaveFilterRulesBtn");
  if (saveRulesBtn) {
    saveRulesBtn.addEventListener("click", () => {
      collectDashFilterRules();
      const valid = getDashFilterRules().filter((r) => r.matchValue && r.targetLabel);
      // background.js는 settings.gmail.filters를 읽는다. 예전에는 평면 키 filterRules에
      // 저장해서, 여기서 만든 규칙이 분류에 전혀 반영되지 않았다.
      SettingsStore.setSetting("gmail.filters", valid).then(() => {
        setDashFilterRules(valid);
        renderDashFilterRules();
        setText("dashFilterRulesResultBox", t("dashMsgFilterRulesSaved", [valid.length]));
      });
    });
  }

  // --- 라벨 분석 ---
  const selectAllBtn = $("dashAnalysisSelectAllBtn");
  if (selectAllBtn) {
    selectAllBtn.addEventListener("click", () => {
      document.querySelectorAll("#dashLabelAnalysisChecklist input").forEach((el) => (el.checked = true));
    });
  }
  const selectNoneBtn = $("dashAnalysisSelectNoneBtn");
  if (selectNoneBtn) {
    selectNoneBtn.addEventListener("click", () => {
      document.querySelectorAll("#dashLabelAnalysisChecklist input").forEach((el) => (el.checked = false));
    });
  }

  const startAnalysisBtn = $("dashStartAnalysisBtn");
  if (startAnalysisBtn) {
    startAnalysisBtn.addEventListener("click", () => {
      const labelNames = [...document.querySelectorAll("#dashLabelAnalysisChecklist input:checked")].map((el) => el.value);
      if (!labelNames.length) {
        setText("dashAnalysisResultBox", t("dashMsgNeedAnalysisLabel"));
        return;
      }
      startJob({ action: "startAnalyzeMultipleLabels", labelNames });
    });
  }

  // --- 임시저장 칸 ---
  const pad = $("dashCriteriaScratchpad");
  if (pad) {
    // 실수로 창을 닫아도 내용이 남도록 입력할 때마다 저장(팝업과 같은 키를 쓴다)
    pad.addEventListener("input", () => chrome.storage.local.set({ criteriaScratchpad: pad.value }));

    // 백그라운드가 분석 결과를 적재하면 바로 화면에 반영한다
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes.criteriaScratchpad) return;
      if (document.activeElement === pad) return; // 입력 중이면 덮어쓰지 않는다
      pad.value = changes.criteriaScratchpad.newValue || "";
    });
  }

  const applyPadBtn = $("dashApplyScratchpadBtn");
  if (applyPadBtn) {
    applyPadBtn.addEventListener("click", () => {
      if (!pad || !pad.value.trim()) {
        setText("dashAnalysisResultBox", t("dashMsgScratchpadEmpty"));
        return;
      }
      const entries = parseDashScratchpad(pad.value);
      if (!entries.length) {
        setText("dashAnalysisResultBox", t("dashMsgScratchpadNotFound"));
        return;
      }
      let applied = 0;
      for (const entry of entries) {
        const idx = getCategoryDefs().findIndex((c) => c.name === entry.labelName);
        if (idx < 0) continue;
        getCategoryDefs()[idx] = { ...getCategoryDefs()[idx], description: entry.suggestion, autoLearned: false };
        applied += 1;
      }
      if (!applied) {
        setText("dashAnalysisResultBox", t("dashMsgScratchpadNotFound"));
        return;
      }
      SettingsStore.setSetting("gmail.categories", getCategoryDefs()).then(() => {
        renderDashboardCategories();
        setText("dashAnalysisResultBox", t("dashMsgScratchpadApplied", [applied]));
      });
    });
  }

  const clearPadBtn = $("dashClearScratchpadBtn");
  if (clearPadBtn) {
    clearPadBtn.addEventListener("click", () => {
      if (pad) pad.value = "";
      chrome.storage.local.set({ criteriaScratchpad: "" });
    });
  }
}



// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.
function initCriteriaEvents() {
  // --- 요약 판단 기준 AI 자동 생성 ---
  const generateCriteriaBtn = $("dashGenerateCriteriaBtn");
  if (generateCriteriaBtn) {
    generateCriteriaBtn.addEventListener("click", () => {
      const orig = generateCriteriaBtn.textContent;
      generateCriteriaBtn.disabled = true;
      generateCriteriaBtn.textContent = t("msgGeneratingCriteria");

      chrome.runtime.sendMessage(
        { action: "generateSummaryCriteria", labelName: getSelectedLabelName(), sampleCount: 25 },
        (res) => {
          generateCriteriaBtn.disabled = false;
          generateCriteriaBtn.textContent = orig;

          if (chrome.runtime.lastError || !res || !res.ok) {
            const detail =
              (res && (res.error || (res.messageKey ? t(res.messageKey) : ""))) ||
              (chrome.runtime.lastError && chrome.runtime.lastError.message) ||
              "";
            alert(t("errorGenericPrefix", [detail]));
            return;
          }

          const criteriaInput = $("dashSummaryCriteriaInput");
          if (criteriaInput) {
            criteriaInput.value = res.filterCriteria || "";
            chrome.storage.local.set({ lastSummaryCriteria: criteriaInput.value });
          }
          // 설정 탭의 중요도 기준까지 같이 채워둔다(자동 저장이 걸려 있으면 그대로 반영됨).
          const criteria = res.importanceCriteria || {};
          const fill = (id, value) => {
            const el = $(id);
            if (el && value) el.value = value;
          };
          fill("dashCriteriaHigh", criteria.high);
          fill("dashCriteriaMedium", criteria.medium);
          fill("dashCriteriaLow", criteria.low);
          if ($("dashCriteriaHigh")) {
            chrome.storage.local.set({
              importanceCriteria: {
                high: criteria.high || "",
                medium: criteria.medium || "",
                low: criteria.low || "",
              },
            });
          }

          alert(t("msgCriteriaGenerated", [String(res.sampleSize || 0)]));
        }
      );
    });
  }

  const copySummaryBtn = $("dashCopySummaryBtn");
  if (copySummaryBtn) {
    copySummaryBtn.addEventListener("click", () => {
      if (!getLastReportData()) return;
      navigator.clipboard.writeText(generateSummaryText(getLastReportData())).then(() => {
        const orig = copySummaryBtn.textContent;
        copySummaryBtn.textContent = t("dashMsgCopied");
        setTimeout(() => {
          copySummaryBtn.textContent = orig;
        }, 1800);
      });
    });
  }

  const sendDiscordBtn = $("dashSendDiscordBtn");
  if (sendDiscordBtn) {
    sendDiscordBtn.addEventListener("click", () => {
      if (!getLastReportData()) {
        alert(t("dashMsgNoReport"));
        return;
      }
      // 웹훅 설정은 settings.notifications에 있다. 예전에는 평면 키
      // discordWebhookUrl* / customDiscordWebhooks를 읽어서, 옵션 페이지에서 등록한
      // 웹훅이 여기서는 항상 빈 값으로 보였다.
      SettingsStore.getSettings().then(
        (settings) => {
          const discord = (settings.notifications && settings.notifications.discord) || {};
          const customs = Array.isArray(settings.notifications && settings.notifications.customWebhooks)
            ? settings.notifications.customWebhooks
            : [];
          const webhookInput = {
            defaultUrl: discord.defaultWebhook || "",
            highUrl: discord.highWebhook || "",
            mediumUrl: discord.mediumWebhook || "",
            lowUrl: discord.lowWebhook || "",
            custom: customs,
          };
          const hasCustom = customs.some((w) => w && w.enabled !== false && w.url);
          if (
            !webhookInput.defaultUrl &&
            !webhookInput.highUrl &&
            !webhookInput.mediumUrl &&
            !webhookInput.lowUrl &&
            !hasCustom
          ) {
            alert(t("dashMsgNeedWebhook"));
            return;
          }
          chrome.runtime.sendMessage(
            { action: "sendDiscordNotification", webhookUrl: webhookInput, summaryReport: getLastReportData() },
            (res) => {
              if (chrome.runtime.lastError || (res && !res.ok)) {
                alert(t("dashMsgDiscordFailed", [(res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || ""]));
                return;
              }
              const orig = sendDiscordBtn.textContent;
              sendDiscordBtn.textContent = t("dashMsgDiscordSent");
              setTimeout(() => {
                sendDiscordBtn.textContent = orig;
              }, 1800);
            }
          );
        }
      );
    });
  }
}


export {
  initCriteriaEvents,
  initDashboardExtraFeatureEvents,
  loadDashScratchpad,
  parseDashScratchpad,
  renderDashAnalysisChecklist,
};
