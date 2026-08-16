// bg/features/classify/classify.js
// 분류 기능의 작업 진입점. 무엇을 분류 대상으로 삼을지만 정하고,
// 실제 분류/라벨 적용은 bg/pipeline/classification.js에 맡긴다.

import { isCancelled } from "../../core/cancellation.js";
import { addLog } from "../../core/logger.js";
import { BATCH_SIZE } from "../../domain/limits.js";
import { classifyAndLabelMessages, computeSafeEmailCount } from "../../pipeline/classification.js";
import { getRecentMessages } from "../../platform/gmail_api.js";
import { initGeminiAndGmailContext, trimAiDataForContentScript } from "../../platform/gmail_labels.js";
import { t } from "../../../i18n.js";

async function processRecentEmails(count) {
  const { categoryDefs, categories, token, labelCache } = await initGeminiAndGmailContext();

  const safe = await computeSafeEmailCount(count);
  if (safe.reduced) {
    await addLog(t("logQuotaReduced", [count, safe.remainingRequests, safe.count]), "warn");
  }

  await addLog(t("logFetchingUnlabeled", [safe.count]));
  const messages = await getRecentMessages(token, safe.count, categories);
  if (messages.length < safe.count) {
    await addLog(t("logFewerThanRequested", [messages.length]));
  }

  const summary = await classifyAndLabelMessages(token, categoryDefs, labelCache, messages, null);
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

// 대상 메일이 이미 정해진 경우(사이드패널의 "지금 보고 있는 메일 분류")에 쓴다.
// 라벨/최근 목록 조회를 건너뛰고 주어진 ID만 분류한다.
async function processSpecificMessages(messageIds) {
  const { categoryDefs, token, labelCache } = await initGeminiAndGmailContext();
  const messages = messageIds.map((id) => ({ id }));

  await addLog(`[분류] 지정된 메일 ${messages.length}건 분류 중...`);
  const summary = await classifyAndLabelMessages(token, categoryDefs, labelCache, messages, null);
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

// ---------------- 반복 작업: 한 번에 너무 많이 처리해서 API 할당량을 넘기지 않도록,
// 사용자가 지정한 작은 배치 수만큼씩 여러 라운드로 나눠서 안전하게 반복 처리한다 ----------------
async function processRepeatClassification(batchesPerRound, repeatCount) {
  const perRoundCount = batchesPerRound * BATCH_SIZE;
  let totalSuccess = 0;
  let totalProcessed = 0;
  let totalRequestsUsed = 0;
  const allFailMessages = [];
  let cancelled = false;
  let quotaExhausted = false;

  await addLog(t("logRepeatStart", [batchesPerRound, perRoundCount, repeatCount]));

  for (let round = 1; round <= repeatCount; round += 1) {
    if (isCancelled()) {
      await addLog(t("logRepeatCancelledBefore", [round, repeatCount]), "warn");
      cancelled = true;
      break;
    }

    await addLog(t("logRepeatRoundStart", [round, repeatCount]));

    let roundSummary;
    try {
      roundSummary = await processRecentEmails(perRoundCount);
    } catch (err) {
      await addLog(t("logRepeatRoundFailed", [round, repeatCount, String(err.message || err)]), "error");
      allFailMessages.push(String(err.message || err));
      break;
    }

    totalSuccess += roundSummary.success;
    totalProcessed += roundSummary.total;
    totalRequestsUsed += roundSummary.requestsUsed || 0;
    if (roundSummary.failMessages && roundSummary.failMessages.length) {
      allFailMessages.push(...roundSummary.failMessages);
    }

    await addLog(t("logRepeatRoundDone", [round, repeatCount, roundSummary.success, roundSummary.total]));

    if (roundSummary.cancelled) {
      cancelled = true;
      break;
    }
    if (roundSummary.quotaExhausted) {
      quotaExhausted = true;
      await addLog(t("logRepeatQuotaStop"), "error");
      break;
    }
    if (roundSummary.total === 0) {
      await addLog(t("logRepeatNoMoreMail"));
      break;
    }
  }

  await addLog(t("logRepeatAllDone", [totalSuccess, totalProcessed]));

  return {
    total: totalProcessed,
    success: totalSuccess,
    failMessages: allFailMessages,
    requestsUsed: totalRequestsUsed,
    batchSize: BATCH_SIZE,
    cancelled,
    quotaExhausted,
  };
}

// 이 확장이 관리하는 모든 카테고리 라벨(최상위 + 그 하위 라벨 전부)을 Gmail에서 완전히 삭제한다.
// 라벨을 삭제하면 Gmail이 그 라벨이 붙어있던 모든 메일에서 자동으로 라벨을 떼어주므로, 메일 하나하나 라벨을 뗄 필요는 없다.

export {
  processRecentEmails,
  processSpecificMessages,
  processRepeatClassification,
};
