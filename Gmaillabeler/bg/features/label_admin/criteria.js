// bg/features/label_admin/criteria.js
// 라벨 분류 기준 분석/제안, 카테고리 번역.

import { isCancellationError, isCancelled } from "../../core/cancellation.js";
import { addLog } from "../../core/logger.js";
import { updateProgress } from "../../core/progress.js";
import { mapWithConcurrency, truncateForLog } from "../../core/util.js";
import { getCategoryDefinitions, saveCategoryDefinitions } from "../../domain/categories.js";
import { GMAIL_FETCH_CONCURRENCY, MAX_MESSAGES_PER_LABEL_FETCH } from "../../domain/limits.js";
import { LANGUAGE_NAME_BY_LOCALE } from "../../domain/prompt_language.js";
import { callAiForJson } from "../../platform/ai_gateway.js";
import { getEmailContent, getMessagesByLabelName, gmailFetch } from "../../platform/gmail_api.js";
import { getSubLabelCandidates, initGeminiAndGmailContext, initGmailOnlyContext, normalizeLabelName, renameInLabelCache } from "../../platform/gmail_labels.js";
import { i18nCurrentLocale, t } from "../../../i18n.js";

const MAX_LABEL_ANALYSIS_SAMPLE = 40; // 라벨 분석 시 한 번에 살펴볼 메일 샘플 상한

// 카테고리 이름 + 분류기준 설명을 AI로 번역하고, 실제 Gmail 라벨 이름도 함께 바꾼다.
// (하위 라벨이 남아있는 경우 "부모/자식" 형태의 자식 라벨도 부모 이름 변경에 맞춰 함께 옮긴다.)
async function processTranslateCategories(targetLocale) {
  const langName = LANGUAGE_NAME_BY_LOCALE[targetLocale] || targetLocale;
  const categoryDefs = await getCategoryDefinitions();
  const { token, labelCache } = await initGmailOnlyContext();

  await addLog(t("logTranslateStart", [langName]));

  const itemsForPrompt = categoryDefs.map((c, i) => ({ idx: i, name: c.name, description: c.description || "" }));
  const prompt =
    `다음은 이메일 분류 카테고리의 이름과 분류 기준 설명 목록이다. 각 항목을 ${langName}로 자연스럽게 번역해라. ` +
    "name은 아주 짧은 한 단어(또는 그 언어에서 관용적으로 쓰는 짧은 표현)로, description은 자연스러운 문장으로 번역해라. " +
    "description이 빈 문자열이면 번역하지 말고 그대로 빈 문자열로 둬라. 원래 의미와 카테고리 개수, 순서(idx)는 그대로 유지해라.\n\n" +
    JSON.stringify(itemsForPrompt);

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            idx: { type: "INTEGER" },
            name: { type: "STRING" },
            description: { type: "STRING" },
          },
          required: ["idx", "name"],
        },
      },
    },
  };

  const result = await callAiForJson(requestBody);
  if (!Array.isArray(result) || !result.length) throw new Error(t("errTranslateNoResult"));

  const translatedDefs = categoryDefs.map((c, i) => {
    const found = result.find((r) => r.idx === i);
    if (!found || !found.name) return c;
    return { ...c, name: found.name, description: found.description || c.description, autoLearned: false };
  });

  // 서로 다른 카테고리가 같은 이름으로 번역되면 Gmail 라벨 이름이 충돌해서 PATCH가 실패한다.
  // 저장 데이터와 실제 라벨이 어긋나지 않도록, 중복 이름은 여기서 미리 구분해둔다.
  const usedNames = new Set();
  for (const def of translatedDefs) {
    let candidate = def.name;
    let suffix = 2;
    while (usedNames.has(normalizeLabelName(candidate))) {
      candidate = `${def.name} ${suffix}`;
      suffix += 1;
    }
    if (candidate !== def.name) {
      await addLog(t("logTranslateNameConflict", [def.name, candidate]), "warn");
      def.name = candidate;
    }
    usedNames.add(normalizeLabelName(candidate));
  }

  // 실제 Gmail 라벨 이름도 함께 변경 (하위 라벨이 남아있으면 "새이름/자식" 형태로 함께 이동)
  for (let i = 0; i < categoryDefs.length; i += 1) {
    const oldName = categoryDefs[i].name;
    const newName = translatedDefs[i].name;
    if (oldName === newName) continue;

    const labelId = labelCache.exact.get(oldName);
    if (labelId) {
      try {
        const resp = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${labelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        if (resp.ok) {
          // 캐시를 갱신하지 않으면 이후 단계(하위 라벨 처리·다음 작업)가 존재하지 않는 옛 이름을 계속 참조한다.
          renameInLabelCache(labelCache, oldName, newName, labelId);
          await addLog(t("logTranslateLabelRenamed", [oldName, newName]));
        } else {
          const errText = await resp.text();
          // 라벨 이름 변경이 실패했으면 저장 데이터도 옛 이름을 유지해야 실제 Gmail 상태와 어긋나지 않는다.
          translatedDefs[i] = { ...translatedDefs[i], name: oldName };
          await addLog(t("logTranslateLabelRenameFailed", [oldName, newName, errText.slice(0, 150)]), "error");
          continue;
        }
      } catch (e) {
        translatedDefs[i] = { ...translatedDefs[i], name: oldName };
        await addLog(t("logTranslateLabelRenameFailed", [oldName, newName, String(e.message || e)]), "error");
        continue;
      }
    }

    for (const child of getSubLabelCandidates(oldName, labelCache)) {
      const childId = labelCache.exact.get(`${oldName}/${child}`);
      if (!childId) continue;
      try {
        await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${childId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `${newName}/${child}` }),
        });
        renameInLabelCache(labelCache, `${oldName}/${child}`, `${newName}/${child}`, childId);
      } catch (e) {
        // 하위 라벨 개별 실패는 무시하고 계속
      }
    }
  }

  await saveCategoryDefinitions(translatedDefs);
  await addLog(t("logTranslateDone"));

  return {
    total: categoryDefs.length,
    success: categoryDefs.length,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: false,
    quotaExhausted: false,
  };
}

// 사용자가 고른 라벨에 실제로 분류된 메일들 + 현재 분류 기준 설명을 함께 보고,
// 그 라벨에 맞는 분류 기준 텍스트를 새로 제안한다(자동 저장은 안 하고, 팝업의 임시저장 칸에 보여주기만 함).
async function analyzeOneLabelCriteria(token, categoryDefs, labelName) {
  await addLog(t("logLabelAnalysisStart", [labelName]));
  const messages = await getMessagesByLabelName(token, labelName, MAX_MESSAGES_PER_LABEL_FETCH);
  await addLog(t("logLabelAnalysisFoundMail", [labelName, messages.length]));

  if (!messages.length) {
    throw new Error(t("errLabelAnalysisNoMail", [labelName]));
  }

  const sample = messages.slice(0, MAX_LABEL_ANALYSIS_SAMPLE);
  let sampleDone = 0;
  const fetchedSamples = await mapWithConcurrency(sample, GMAIL_FETCH_CONCURRENCY, async (msg) => {
    if (isCancelled()) return null;
    try {
      const detail = await getEmailContent(token, msg.id);
      sampleDone += 1;
      await addLog(t("logAnalysisSampleDone", [sampleDone, sample.length, truncateForLog(detail.subject)]), "info", true);
      return detail;
    } catch (e) {
      if (isCancellationError(e)) return null;
      await addLog(t("logAnalysisSampleFailed", [msg.id, String(e.message || e)]), "error", true);
      return null;
    }
  });
  const details = fetchedSamples.filter(Boolean);

  if (!details.length) {
    throw new Error(t("errAnalysisNoSample"));
  }

  const categoryDef = categoryDefs.find((c) => c.name === labelName);
  const currentDescription = (categoryDef && categoryDef.description) || "";

  const exampleText = details.map((d) => `- 보낸사람: ${d.from} / 제목: ${d.subject}`).join("\n");
  const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
  const prompt =
    `"${labelName}" 카테고리에 실제로 분류된 메일 목록이다(전체 ${messages.length}개 중 ${details.length}개 샘플).\n` +
    (currentDescription ? `현재 이 카테고리에 등록된 분류 기준 설명: "${currentDescription}"\n` : "현재 등록된 분류 기준 설명은 없음.\n") +
    `이 메일들의 공통점을 분석해서, 앞으로 비슷한 메일을 이 카테고리로 분류하기 위한 분류 기준 설명을 2~3문장 이내로 ${langName}로 작성해라. ` +
    "기존 설명이 있다면 실제 사례에 맞게 다듬거나 보완하고, 안 맞는 부분이 있으면 바로잡아라. 메일 하나하나가 아니라 일반화된 기준으로 작성해라.\n\n" +
    exampleText;

  await addLog(t("logAnalysisRequestSent", [labelName]));
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { description: { type: "STRING" } },
        required: ["description"],
      },
    },
  };

  const result = await callAiForJson(requestBody);
  const suggestion = (result && result.description && result.description.trim()) || "";
  if (!suggestion) throw new Error(t("errAnalysisNoSuggestion"));

  await addLog(t("logAnalysisDone", [labelName, suggestion]));

  return { labelName, suggestion, sampleCount: details.length, totalCount: messages.length };
}


// 분석 결과(분류 기준 제안)를 임시저장 칸에 직접 적재한다.
// 예전에는 팝업이 열려 있을 때만 팝업 쪽 코드가 이 작업을 해서, 대시보드에서 분석을 돌리거나
// 팝업을 닫아두면 결과가 어디에도 남지 않았다. 이제 백그라운드가 저장하고 화면들은 읽기만 한다.
async function appendCriteriaSuggestionsToScratchpad(suggestions) {
  const usable = (suggestions || []).filter((s) => s && s.labelName && s.suggestion);
  if (!usable.length) return;
  const stored = await chrome.storage.local.get(["criteriaScratchpad"]);
  let text = stored.criteriaScratchpad || "";
  for (const s of usable) {
    if (text.trim()) text += "\n\n";
    text += `${s.labelName}\n${s.suggestion}`;
  }
  await chrome.storage.local.set({ criteriaScratchpad: text });
}

async function processAnalyzeLabelCriteria(labelName) {
  const { categoryDefs, categories, token } = await initGeminiAndGmailContext();
  if (!categories.includes(labelName)) {
    throw new Error(t("errLabelNotInCategories", [labelName]));
  }
  const oneResult = await analyzeOneLabelCriteria(token, categoryDefs, labelName);
  await appendCriteriaSuggestionsToScratchpad([{ labelName: oneResult.labelName, suggestion: oneResult.suggestion }]);
  return {
    total: 1,
    success: 1,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: isCancelled(),
    quotaExhausted: false,
    ...oneResult,
  };
}

// 체크박스로 고른 라벨 여러 개를 순서대로 하나씩 분석한다(한 번의 클릭으로 여러 라벨 처리).
async function processAnalyzeMultipleLabelsCriteria(labelNames) {
  const { categoryDefs, categories, token } = await initGeminiAndGmailContext();
  const targets = labelNames.filter((name) => categories.includes(name));
  const skipped = labelNames.filter((name) => !categories.includes(name));
  const suggestions = [];
  const failMessages = [];
  let successCount = 0;

  await addLog(t("logMultiAnalysisStart", [targets.length]));
  if (skipped.length) await addLog(t("logMultiAnalysisSkipped", [skipped.join(", ")]), "warn");

  await updateProgress({ processed: 0, total: targets.length, batchIndex: 0, batchTotal: targets.length });

  for (let i = 0; i < targets.length; i += 1) {
    if (isCancelled()) {
      await addLog(t("logMultiAnalysisCancelled", [i, targets.length]), "warn");
      break;
    }
    const labelName = targets[i];
    await addLog(t("logMultiAnalysisItemStart", [i + 1, targets.length, labelName]));
    try {
      const oneResult = await analyzeOneLabelCriteria(token, categoryDefs, labelName);
      suggestions.push(oneResult);
      successCount += 1;
    } catch (e) {
      const msg = String(e.message || e);
      failMessages.push(`${labelName}: ${msg}`);
      await addLog(t("logMultiAnalysisItemFailed", [i + 1, targets.length, labelName, msg]), "error");
    }
    await updateProgress(
      { processed: i + 1, total: targets.length, batchIndex: i + 1, batchTotal: targets.length },
      { force: i + 1 === targets.length }
    );
  }

  await addLog(t("logMultiAnalysisDone", [successCount, targets.length]));
  await appendCriteriaSuggestionsToScratchpad(suggestions);

  return {
    total: targets.length,
    success: successCount,
    failMessages,
    requestsUsed: successCount,
    batchSize: 1,
    cancelled: isCancelled(),
    quotaExhausted: false,
    suggestions,
  };
}

// 선택한 라벨의 메일 목록을 수집하여 Gemini AI로 요약 및 중요 메일 선별 리포트를 생성한다(출력 언어는 현재 UI 언어).
// 요약 판단 기준(선별 조건 + 중요도 상/중/하 기준)을 실제 받은 메일을 근거로 AI가 초안 작성해준다.
// 사용자가 빈 칸을 보고 직접 문장을 짜내야 하는 부담을 없애기 위한 기능이라, 결과는 그대로 저장하지 않고
// 화면에 채워주기만 한다(사용자가 고친 뒤 저장).


export {
  MAX_LABEL_ANALYSIS_SAMPLE,
  analyzeOneLabelCriteria,
  appendCriteriaSuggestionsToScratchpad,
  processAnalyzeLabelCriteria,
  processAnalyzeMultipleLabelsCriteria,
  processTranslateCategories,
};
