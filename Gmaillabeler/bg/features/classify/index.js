// bg/features/classify/index.js
// 분류 기능의 등록부. 이 파일이 아는 것은 자기 잡 정의뿐이다.

import { registerJob } from "../../core/job_registry.js";
import { BATCH_SIZE, MAX_EMAIL_COUNT_PER_RUN } from "../../domain/limits.js";
import { processRecentEmails, processRepeatClassification, processSpecificMessages } from "./classify.js";
import { NO_OPEN_THREAD_ERROR, resolveThreadTargets } from "../../domain/open_thread.js";

function register() {
  // ----- Gmail 분류 -----
  registerJob("gmail_classify", {
    aliases: ["gmail.classification"],
    jobKind: "classify",
    notifyTitleKey: "notifyTitleClassify",
    resolve: (payload, settings) => {
      const requested =
        Number(payload.count) > 0 ? Number(payload.count) : Number(settings.gmail?.fetching?.limit) || BATCH_SIZE;
      const count = Math.max(1, Math.min(MAX_EMAIL_COUNT_PER_RUN, Math.floor(requested)));
      return {
        run: () => processRecentEmails(count),
        response: { ok: true, started: true, messageKey: "resultRequesting", messageParams: [count] },
      };
    },
  });

  registerJob("gmail_classify_thread", {
    jobKind: "classify",
    notifyTitleKey: "notifyTitleClassify",
    resolve: async (payload) => {
      const messageIds = await resolveThreadTargets(payload);
      if (!messageIds.length) return { error: NO_OPEN_THREAD_ERROR };
      return { run: () => processSpecificMessages(messageIds) };
    },
  });

  registerJob("gmail_repeat_classify", {
    jobKind: "repeat",
    notifyTitleKey: "notifyTitleRepeat",
    resolve: (payload) => {
      const batchesPerRound = Math.max(1, Math.min(5, parseInt(payload.batchesPerRound, 10) || 1));
      const repeatCount = Math.max(1, parseInt(payload.repeatCount, 10) || 1);
      return {
        run: () => processRepeatClassification(batchesPerRound, repeatCount),
        response: { ok: true, started: true, messageKey: "repeatRequesting" },
      };
    },
  });
}

export { register };
