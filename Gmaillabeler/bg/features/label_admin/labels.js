// bg/features/label_admin/labels.js
// 라벨 일괄 관리: 전체 삭제, 중복 정리, 재분류, 색상 적용.

import { isCancelled } from "../../core/cancellation.js";
import { addLog } from "../../core/logger.js";
import { updateProgress } from "../../core/progress.js";
import { getCategoryDefinitions, getCategoryNames, getGmailLabelColor } from "../../domain/categories.js";
import { BATCH_SIZE, MAX_MESSAGES_PER_LABEL_FETCH } from "../../domain/limits.js";
import { classifyAndLabelMessages, computeSafeEmailCount } from "../../pipeline/classification.js";
import { getMessagesByLabelId, getMessagesByLabelName, gmailFetch, modifyMessageLabels, patchLabelColor } from "../../platform/gmail_api.js";
import { getOrCreateLabelId, getSubLabelCandidates, initGeminiAndGmailContext, initGmailOnlyContext, trimAiDataForContentScript } from "../../platform/gmail_labels.js";
import { t } from "../../../i18n.js";

async function deleteAllManagedLabels(token, categories, labelCache) {
  let deletedCount = 0;
  for (const cat of categories) {
    const ids = [];
    const flatId = labelCache.exact.get(cat);
    if (flatId) ids.push(flatId);
    for (const child of getSubLabelCandidates(cat, labelCache)) {
      const childId = labelCache.exact.get(`${cat}/${child}`);
      if (childId) ids.push(childId);
    }
    for (const id of ids) {
      try {
        const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${id}`, { method: "DELETE" });
        if (response.ok || response.status === 404) deletedCount += 1;
      } catch (e) {
        // 개별 실패는 무시하고 계속
      }
    }
  }
  return deletedCount;
}

// 라벨 전체 삭제: 재분류 없이, 이 확장이 관리하는 모든 라벨만 깨끗이 지운다(Gemini 호출 없음, API 할당량과 무관).
async function processDeleteAllLabels() {
  const categoryDefs = await getCategoryDefinitions();
  const categories = getCategoryNames(categoryDefs);
  const { token, labelCache } = await initGmailOnlyContext();

  await addLog(t("logDeleteAllStart", [categories.length]), "warn");
  const deletedCount = await deleteAllManagedLabels(token, categories, labelCache);
  await addLog(t("logDeleteAllDone", [deletedCount]));

  return {
    total: deletedCount,
    success: deletedCount,
    failMessages: [],
    requestsUsed: 0,
    batchSize: BATCH_SIZE,
    cancelled: false,
    quotaExhausted: false,
  };
}

// 이미 관리 라벨이 붙어있는 메일만 모아서, 라벨을 뗀 뒤 처음부터 다시 분류한다.
// 라벨 정의(카테고리) 자체는 삭제하지 않고, 각 메일에서 현재 붙어있는 관리 라벨들만 제거한다.
// 여러 이유(과거 로직 변경, 재분류 반복 등)로 한 메일에 라벨이 중복/잘못 붙어있는 경우를 정리하는 용도.
async function processDedupeRelabel() {
  const { categoryDefs, categories, token, labelCache } = await initGeminiAndGmailContext();

  const allLabelIds = [];
  for (const cat of categories) {
    const flatId = labelCache.exact.get(cat);
    if (flatId) allLabelIds.push(flatId);
    for (const child of getSubLabelCandidates(cat, labelCache)) {
      const childId = labelCache.exact.get(`${cat}/${child}`);
      if (childId) allLabelIds.push(childId);
    }
  }

  if (!allLabelIds.length) {
    await addLog(t("logDedupeNoLabels"));
    return { total: 0, success: 0, failMessages: [], requestsUsed: 0, batchSize: BATCH_SIZE, cancelled: false, quotaExhausted: false };
  }

  await addLog(t("logDedupeFetchingMail", [allLabelIds.length]));
  const seen = new Set();
  let messages = [];
  for (const id of allLabelIds) {
    if (isCancelled()) break;
    try {
      const msgs = await getMessagesByLabelId(token, id, MAX_MESSAGES_PER_LABEL_FETCH);
      for (const m of msgs) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          messages.push(m);
        }
      }
    } catch (e) {
      await addLog(t("logLabelFetchFailed", [id, String(e.message || e)]), "error");
    }
  }
  await addLog(t("logDedupeFoundMail", [messages.length]));

  const safe = await computeSafeEmailCount(messages.length || 1);
  if (safe.reduced) {
    await addLog(t("logQuotaReducedGeneric", [safe.remainingRequests, safe.count]), "warn");
  }
  const targetMessages = messages.slice(0, safe.count);

  await addLog(t("logDedupeRemovingLabels", [targetMessages.length]));
  for (const msg of targetMessages) {
    if (isCancelled()) break;
    try {
      await modifyMessageLabels(token, msg.id, [], allLabelIds);
    } catch (e) {
      await addLog(t("logRemoveLabelFailed", [msg.id, String(e.message || e)]), "error", true);
    }
  }

  await addLog(t("logDedupeRemovedReclassify"));
  const summary = await classifyAndLabelMessages(token, categoryDefs, labelCache, targetMessages, null);
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

async function processRelabel(labelName, excludeSelf, maxResults) {
  const { categoryDefs, categories, token, labelCache } = await initGeminiAndGmailContext();
  if (!categories.includes(labelName)) {
    throw new Error(t("errLabelNotInCategories", [labelName]));
  }
  if (excludeSelf && categories.filter((c) => c !== labelName).length < 2) {
    throw new Error(t("errTooFewCategoriesAfterExclude"));
  }

  const safe = await computeSafeEmailCount(maxResults);
  if (safe.reduced) {
    await addLog(t("logQuotaReducedGeneric", [safe.remainingRequests, safe.count]), "warn");
  }

  await addLog(t("logRelabelFetchingMail", [labelName]));
  const messages = await getMessagesByLabelName(token, labelName, safe.count);
  await addLog(t("logRelabelFoundMail", [messages.length]));
  if (messages.length < safe.count) {
    await addLog(t("logFewerTargetThanRequested", [messages.length]));
  }

  const summary = await classifyAndLabelMessages(
    token,
    categoryDefs,
    labelCache,
    messages,
    excludeSelf ? labelName : null
  );
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

// 라벨 병합: fromLabel의 메일을 전부 toLabel로 옮기고 fromLabel 자체를 삭제 (Gemini 호출 없음, Gmail API만 사용)


async function processApplyLabelColors() {
  const categories = getCategoryNames(await getCategoryDefinitions());
  const { token, labelCache } = await initGmailOnlyContext();
  await addLog(t("logColorsStart", [categories.length]));
  await updateProgress({ processed: 0, total: categories.length, batchIndex: 1, batchTotal: 1 });

  let successCount = 0;
  const failMessages = [];

  for (let i = 0; i < categories.length; i += 1) {
    const cat = categories[i];
    try {
      const label = await getOrCreateLabelId(token, cat, labelCache, categories);
      const color = getGmailLabelColor(cat, categories);
      await patchLabelColor(token, label.id, color);
      successCount += 1;
      await addLog(t("logColorItemDone", [cat]), "info", true);
    } catch (err) {
      const msgText = String(err.message || err);
      failMessages.push(msgText);
      await addLog(t("logColorItemFailed", [cat, msgText]), "error");
    }
    await updateProgress(
      { processed: i + 1, total: categories.length, batchIndex: 1, batchTotal: 1 },
      { force: i + 1 === categories.length }
    );
  }

  await addLog(t("logColorsDone", [successCount, categories.length]));
  return { total: categories.length, success: successCount, failMessages, requestsUsed: 0, batchSize: 1, cancelled: false };
}


export {
  deleteAllManagedLabels,
  processApplyLabelColors,
  processDedupeRelabel,
  processDeleteAllLabels,
  processRelabel,
};
