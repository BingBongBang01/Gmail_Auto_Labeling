// bg/features/label_admin/index.js
// 라벨 일괄 관리 기능의 등록부.

import { registerJob } from "../../core/job_registry.js";
import { MAX_EMAIL_COUNT_PER_RUN } from "../../domain/limits.js";
import { processApplyLabelColors, processDedupeRelabel, processDeleteAllLabels, processRelabel } from "./labels.js";
import { processAnalyzeLabelCriteria, processAnalyzeMultipleLabelsCriteria, processTranslateCategories } from "./criteria.js";

function register() {
  // ----- 라벨 관리 -----
  registerJob("gmail_relabel", {
    jobKind: "relabel",
    notifyTitleKey: "notifyTitleRelabel",
    resolve: (payload) => {
      const label = String(payload.label || payload.targetLabel || "").trim();
      if (!label) return { messageKey: "errorSelectLabel" };
      return {
        run: () => processRelabel(label, !!payload.excludeSelf, MAX_EMAIL_COUNT_PER_RUN),
        notifyTitleParams: [label],
        response: { ok: true, started: true, messageKey: "relabelRequesting" },
      };
    },
  });

  registerJob("gmail_dedupe_relabel", {
    jobKind: "dedupe",
    notifyTitleKey: "notifyTitleDedupe",
    resolve: () => ({
      run: () => processDedupeRelabel(),
      response: { ok: true, started: true, messageKey: "dedupeRequesting" },
    }),
  });

  registerJob("gmail_delete_all_labels", {
    jobKind: "deleteLabels",
    notifyTitleKey: "notifyTitleDeleteLabels",
    resolve: () => ({
      run: () => processDeleteAllLabels(),
      response: { ok: true, started: true, messageKey: "deleteLabelsRequesting" },
    }),
  });

  registerJob("gmail_apply_label_colors", {
    jobKind: "colors",
    notifyTitleKey: "notifyTitleApplyColors",
    resolve: () => ({
      run: () => processApplyLabelColors(),
      response: { ok: true, started: true, messageKey: "colorRequesting" },
    }),
  });

  registerJob("gmail_analyze_label_criteria", {
    jobKind: "labelAnalysis",
    notifyTitleKey: "notifyTitleLabelAnalysis",
    resolve: (payload) => ({
      run: () => processAnalyzeLabelCriteria(payload.labelName),
      response: { ok: true, started: true, messageKey: "labelAnalysisRequesting" },
    }),
  });

  registerJob("gmail_analyze_multiple_labels", {
    jobKind: "labelAnalysisMulti",
    notifyTitleKey: "notifyTitleLabelAnalysis",
    resolve: (payload) => {
      const labelNames = Array.isArray(payload.labelNames) ? payload.labelNames : [];
      if (!labelNames.length) {
        return { messageKey: "errorGenericPrefix", messageParams: ["선택된 라벨이 없습니다."] };
      }
      return {
        run: () => processAnalyzeMultipleLabelsCriteria(labelNames),
        response: { ok: true, started: true, messageKey: "labelAnalysisRequesting" },
      };
    },
  });

  registerJob("gmail_translate_categories", {
    jobKind: "translateCategories",
    notifyTitleKey: "notifyTitleTranslate",
    resolve: (payload) => ({ run: () => processTranslateCategories(payload.targetLocale) }),
  });
}

export { register };
