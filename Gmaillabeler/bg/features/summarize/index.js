// bg/features/summarize/index.js
// 요약 기능의 등록부. Discord는 여기서도 저기서도 언급되지 않는다.

import { registerAction } from "../../core/message_router.js";
import { registerJob } from "../../core/job_registry.js";
import { isJobRunning } from "../../core/job_runner.js";
import { generateSummaryCriteriaWithAI, learnFromSummaryFeedback, processSummarizeLabelEmails } from "./summarize.js";
import { NO_OPEN_THREAD_ERROR, resolveThreadTargets } from "../../domain/open_thread.js";

function register() {
  // ----- Gmail 요약 -----
  registerJob("gmail_summarize", {
    aliases: ["gmail.summary"],
    jobKind: "labelSummary",
    notifyTitleKey: "notifyTitleSummary",
    resolve: (payload, settings) => {
      const labelName = String(payload.labelName || settings.automation?.autoSummary?.label || "").trim();
      if (!labelName) return { messageKey: "errorSelectSummaryLabel" };
      return {
        run: () =>
          processSummarizeLabelEmails(labelName, payload.count, payload.filterCriteria, {
            source: payload.source,
          }),
        response: { ok: true, started: true, messageKey: "summaryRequesting" },
      };
    },
  });

  registerJob("gmail_summarize_thread", {
    jobKind: "labelSummary",
    notifyTitleKey: "notifyTitleSummary",
    resolve: async (payload) => {
      const messageIds = await resolveThreadTargets(payload);
      if (!messageIds.length) return { error: NO_OPEN_THREAD_ERROR };
      return {
        run: () => processSummarizeLabelEmails("", messageIds.length, payload.filterCriteria, { messageIds }),
      };
    },
  });

  registerAction("learnFromFeedback", async () => {
    if (await isJobRunning()) return { ok: false, messageKey: "errorAlreadyRunning" };
    return { ok: true, ...(await learnFromSummaryFeedback()) };
  });

  registerAction("generateSummaryCriteria", async (request) => {
    if (await isJobRunning()) return { ok: false, messageKey: "errorAlreadyRunning" };
    return { ok: true, ...(await generateSummaryCriteriaWithAI(request.labelName, request.sampleCount)) };
  });
}

export { register };
