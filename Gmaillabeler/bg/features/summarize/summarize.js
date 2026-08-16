// bg/features/summarize/summarize.js
// 라벨 메일 요약, 요약 기준 생성, 사용자 피드백 학습.
// 요약이 끝나면 summary.completed 이벤트만 발행한다. Discord 전송 여부는 알지 못한다.

import { JobCancelledError, isCancellationError, isCancelled } from "../../core/cancellation.js";
import { emit } from "../../core/events.js";
import { addLog } from "../../core/logger.js";
import { updateProgress } from "../../core/progress.js";
import { SUMMARY_COMPLETED } from "../../core/topics.js";
import { mapWithConcurrency } from "../../core/util.js";
import { GMAIL_FETCH_CONCURRENCY } from "../../domain/limits.js";
import { LANGUAGE_NAME_BY_LOCALE } from "../../domain/prompt_language.js";
import { callAiForJson } from "../../platform/ai_gateway.js";
import { getEmailContent, getMessagesByLabelName, getMyEmailAddress, listMessagesPaged } from "../../platform/gmail_api.js";
import { fetchLabelCache, initGeminiAndGmailContext } from "../../platform/gmail_labels.js";
import { i18nCurrentLocale } from "../../../i18n.js";
import { SettingsStore } from "../../../settings/settings_store.js";

async function generateSummaryCriteriaWithAI(labelName, sampleCount) {
  const { token } = await initGeminiAndGmailContext();
  const limit = Math.max(5, Math.min(50, parseInt(sampleCount, 10) || 25));
  const target = (labelName || "").trim();

  const messages = target
    ? await getMessagesByLabelName(token, target, limit)
    : await listMessagesPaged({}, limit, "errMessageListFailed");

  if (!messages || !messages.length) {
    throw new Error(target ? `'${target}' 라벨에서 참고할 메일을 찾지 못했습니다.` : "참고할 메일을 찾지 못했습니다.");
  }

  const details = (
    await mapWithConcurrency(messages, GMAIL_FETCH_CONCURRENCY, async (msg) => {
      try {
        return await getEmailContent(token, msg.id);
      } catch (e) {
        return null;
      }
    })
  ).filter(Boolean);

  if (!details.length) throw new Error("메일 본문을 읽어오지 못했습니다.");

  const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
  const sampleText = details
    .map((d, i) => `[${i + 1}] 발신자: ${d.from} / 제목: ${d.subject} / 내용: ${(d.snippet || "").slice(0, 300)}`)
    .join("\n");

  const prompt =
    `아래는 사용자가 실제로 받은 이메일 표본이다${target ? ` ('${target}' 라벨)` : ""}. ` +
    `이 표본을 근거로, 앞으로 이 사용자의 메일을 요약할 때 쓸 판단 기준을 ${langName}로 작성해라.\n\n` +
    `[작성 규칙]\n` +
    `1. 'filterCriteria': 요약 대상으로 선별할 메일의 조건을 한두 문장으로. 표본에 실제로 등장한 발신자/업무/서비스 성격을 반영해라.\n` +
    `2. 'importanceHigh' / 'importanceMedium' / 'importanceLow': 중요도 상/중/하 판단 기준을 각각 한 문장으로. 서로 겹치지 않게 구분되게 써라.\n` +
    `3. 표본에 없는 상황을 지어내지 말고, 실제로 보이는 메일 유형을 근거로 구체적으로 써라.\n` +
    `4. 각 항목은 200자를 넘기지 마라.\n\n` +
    `[메일 표본]\n` +
    sampleText;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          filterCriteria: { type: "STRING" },
          importanceHigh: { type: "STRING" },
          importanceMedium: { type: "STRING" },
          importanceLow: { type: "STRING" },
        },
        required: ["filterCriteria", "importanceHigh", "importanceMedium", "importanceLow"],
      },
    },
  };

  const parsed = await callAiForJson(requestBody);
  await addLog(`[기준 생성] 메일 ${details.length}건을 근거로 요약 판단 기준 초안을 만들었습니다.`);

  return {
    sampleSize: details.length,
    filterCriteria: parsed.filterCriteria || "",
    importanceCriteria: {
      high: parsed.importanceHigh || "",
      medium: parsed.importanceMedium || "",
      low: parsed.importanceLow || "",
    },
  };
}

// 사용자가 요약 결과에 남긴 피드백("이건 내 것 아님" 등)을 모아, 판단 기준 문장을 다시 쓴다.
// Gmail 라벨은 전혀 건드리지 않는다. 바뀌는 것은 대시보드에 보이는 기준 텍스트뿐이다.
const FEEDBACK_VERDICT_LABEL = {
  notMine: "내 것이 아님(개인 관련 없음)",
  mine: "내 것이 맞음(개인 관련 있음)",
  notImportant: "덜 중요함",
  important: "더 중요함",
};

async function learnFromSummaryFeedback() {
  const stored = await new Promise((resolve) =>
    chrome.storage.local.get(
      ["summaryFeedback", "importanceCriteria", "lastSummaryCriteria", "personalExclusionRules", "personalIdentityHints"],
      resolve
    )
  );

  const feedback = Array.isArray(stored.summaryFeedback) ? stored.summaryFeedback : [];
  if (!feedback.length) throw new Error("학습에 쓸 피드백이 아직 없습니다.");

  const criteria = stored.importanceCriteria || {};
  const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";

  const feedbackText = feedback
    .map(
      (f, i) =>
        `[${i + 1}] 판정: ${FEEDBACK_VERDICT_LABEL[f.verdict] || f.verdict} / 라벨: ${f.labelName || "-"} / 발신자: ${f.sender || "-"} / 제목: ${f.subject || "-"}${f.summary ? ` / 요약: ${String(f.summary).slice(0, 200)}` : ""}`
    )
    .join("\n");

  const settings = await SettingsStore.getSettings();
  const identityHints = (settings.gmail.personalization.identityHints || "").trim();
  const exclusionRulesText = (settings.gmail.personalization.exclusionRules || "").trim();

  const prompt =
    `사용자가 메일 요약 결과를 보고 직접 남긴 판정 기록이다. 이 기록을 반영해서 판단 기준 문장을 다시 써라. 출력 언어는 ${langName}.\n\n` +
    `[현재 기준]\n` +
    `- 요약 선별 조건: ${stored.lastSummaryCriteria || "(없음)"}\n` +
    `- 중요도 상: ${criteria.high || "(없음)"}\n` +
    `- 중요도 중: ${criteria.medium || "(없음)"}\n` +
    `- 중요도 하: ${criteria.low || "(없음)"}\n` +
    `- 개인 관련 제외 규칙: ${exclusionRulesText || "(없음)"}\n` +
    (identityHints ? `- 사용자를 가리키는 이름/별칭: ${identityHints}\n` : "") +
    `\n[사용자 판정 기록]\n${feedbackText}\n\n` +
    `[작성 규칙]\n` +
    `1. 기존 기준을 통째로 갈아엎지 말고, 판정 기록과 어긋나는 부분만 고치거나 규칙을 덧붙여라.\n` +
    `2. 'personalExclusionRules'에는 "내 것이 아님"으로 판정된 메일의 공통 패턴을 한 줄에 하나씩 적어라(발신 도메인, 업무 영역, 지역, 장비/서비스 종류 등 재사용 가능한 형태로). "내 것이 맞음"으로 판정된 유형은 절대 제외 규칙에 넣지 마라.\n` +
    `3. 표본 하나뿐인 우연한 특징으로 지나치게 넓은 규칙을 만들지 마라(예: 특정 메일 한 통 때문에 "모든 알림 메일 제외"라고 쓰지 말 것).\n` +
    `4. 각 항목은 400자를 넘기지 마라. 바뀔 이유가 없는 항목은 기존 문장을 그대로 반환해라.\n` +
    `5. 'changeSummary'에 무엇을 왜 바꿨는지 ${langName} 2~3문장으로 요약해라.`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          filterCriteria: { type: "STRING" },
          importanceHigh: { type: "STRING" },
          importanceMedium: { type: "STRING" },
          importanceLow: { type: "STRING" },
          personalExclusionRules: { type: "STRING" },
          changeSummary: { type: "STRING" },
        },
        required: [
          "filterCriteria",
          "importanceHigh",
          "importanceMedium",
          "importanceLow",
          "personalExclusionRules",
          "changeSummary",
        ],
      },
    },
  };

  const parsed = await callAiForJson(requestBody);

  const updated = {
    lastSummaryCriteria: parsed.filterCriteria || stored.lastSummaryCriteria || "",
    importanceCriteria: {
      high: parsed.importanceHigh || criteria.high || "",
      medium: parsed.importanceMedium || criteria.medium || "",
      low: parsed.importanceLow || criteria.low || "",
    },
    personalExclusionRules: parsed.personalExclusionRules || stored.personalExclusionRules || "",
    feedbackLearnedAt: Date.now(),
  };

  await chrome.storage.local.set(updated);
  await addLog(`[피드백 학습] 판정 ${feedback.length}건을 반영해 판단 기준을 갱신했습니다.`);

  return { ...updated, feedbackCount: feedback.length, changeSummary: parsed.changeSummary || "" };
}

// options.messageIds가 주어지면 라벨 조회를 건너뛰고 그 메일들만 요약한다
// (사이드패널의 "지금 보고 있는 메일 요약").
async function processSummarizeLabelEmails(labelName, maxEmails, filterCriteria, options = {}) {
  const { categoryDefs, categories, token } = await initGeminiAndGmailContext();
  const emailLimit = Math.max(1, Math.min(100, parseInt(maxEmails, 10) || 20));

  let messages;
  if (Array.isArray(options.messageIds) && options.messageIds.length) {
    messages = options.messageIds.slice(0, emailLimit).map((id) => ({ id }));
    await addLog(`[요약] 지정된 메일 ${messages.length}건 요약 중...`);
  } else {
    await addLog(`[요약] '${labelName}' 라벨 메일 수집 중 (최대 ${emailLimit}개)...`);
    messages = await getMessagesByLabelName(token, labelName, emailLimit);
  }

  if (!messages || messages.length === 0) {
    const emptyReport = {
      labelName,
      overallSummary: `'${labelName}' 라벨에 수집된 메일이 없습니다.`,
      totalAnalyzed: 0,
      selectedCount: 0,
      selectedEmails: [],
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({ lastLabelSummary: emptyReport });
    return {
      total: 0,
      success: 0,
      failMessages: [],
      requestsUsed: 0,
      summaryReport: emptyReport,
      cancelled: isCancelled(),
      quotaExhausted: false,
    };
  }

  await updateProgress({ processed: 0, total: messages.length, batchIndex: 1, batchTotal: 1 });

  // 본문 조회는 서로 독립적이므로 제한된 동시성으로 병렬 처리한다(순서는 그대로 유지됨).
  let summaryFetchDone = 0;
  const fetchedSummaryDetails = await mapWithConcurrency(messages, GMAIL_FETCH_CONCURRENCY, async (msg, i) => {
    if (isCancelled()) return null;
    try {
      const detail = await getEmailContent(token, msg.id);
      return {
        id: detail.id,
        threadId: detail.threadId,
        idx: i + 1,
        from: detail.from,
        to: detail.to,
        cc: detail.cc,
        subject: detail.subject,
        date: detail.date,
        snippet: detail.snippet,
        labelIds: detail.labelIds || [],
      };
    } catch (e) {
      if (isCancellationError(e)) return null;
      await addLog(`메일 본문 읽기 실패 (${msg.id}): ${e.message}`, "warn");
      return null;
    } finally {
      summaryFetchDone += 1;
      await updateProgress(
        { processed: summaryFetchDone, total: messages.length, batchIndex: 1, batchTotal: 1 },
        { force: summaryFetchDone === messages.length }
      );
    }
  });
  if (isCancelled()) throw new JobCancelledError();
  const emailDetails = fetchedSummaryDetails.filter(Boolean);

  if (emailDetails.length === 0) {
    throw new Error("메일 본문을 읽어오지 못했습니다.");
  }

  await addLog(`[요약] Gemini AI로 메일 요약 및 선별 수행 중 (${emailDetails.length}개, 출력 언어: ${LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어"})...`);

  const emailListText = emailDetails
    .map(
      (item) =>
        `[idx=${item.idx}] 발신자: ${item.from} / 수신: ${item.to || "(정보없음)"} / 참조: ${item.cc || "(없음)"} / 제목: ${item.subject} / 내용: ${item.snippet}`
    )
    .join("\n");

  const filterInstruction = filterCriteria && filterCriteria.trim()
    ? `사용자 특별 필터링 조건: "${filterCriteria.trim()}" (이 조건에 맞는 메일을 최우선으로 선별해라.)\n`
    : "";

  const settings = await SettingsStore.getSettings();
  const criteria = settings.gmail.importance || {
    high: "24시간 이내 마감/회신 요구, 결제 실패/서버 오류/계정 보안 경고, 상사의 직접 승인 요청, 법적/비용적 이슈 메일",
    medium: "일주일 이내 미팅/회의 일정, 프로젝트 진행상황 공유, 일반 업무 요청, 주요 회사/서비스 공지사항",
    low: "뉴스레터, 정기 보고서, 마케팅/프로모션 참고용, 회신이나 조치가 필요 없는 순수 정보성 알림"
  };

  const importanceCriteriaInstruction =
    `[중요도(importance) 분류 사용자 정의 기준]\n` +
    `- "상" (긴급/조치 필요): ${criteria.high}\n` +
    `- "중" (공지/일정/업무): ${criteria.medium}\n` +
    `- "하" (정보/참고): ${criteria.low}\n\n`;

  // "나와 관련된 메일만" 웹훅이 쓸 개인 관련성(personallyRelevant) 판단 기준.
  // 내 주소는 Gmail 프로필에서, 이름/별칭 같은 추가 단서는 사용자가 설정에서 직접 적어둔 값을 쓴다.
  const myEmailAddress = await getMyEmailAddress();
  const storedIdentity = await new Promise((resolve) =>
    chrome.storage.local.get(["personalIdentityHints", "personalExclusionRules"], resolve)
  );
  const identityHints = (storedIdentity.personalIdentityHints || "").trim();
  // 사용자가 "이건 내 게 아니다"라고 피드백한 내용을 학습해 누적한 제외 규칙
  const exclusionRules = (storedIdentity.personalExclusionRules || "").trim();
  const personalRelevanceInstruction =
    `[개인 관련성(personallyRelevant) 판단 기준]\n` +
    `- 사용자 본인의 메일 주소: ${myEmailAddress || "(확인 불가 - 수신/참조 정보와 본문 맥락으로 추정해라)"}\n` +
    (identityHints ? `- 사용자 본인을 가리키는 이름/별칭/소속: ${identityHints}\n` : "") +
    `- true 조건: 본인에게 직접 보낸 메일, 본인이 회신/승인/제출/참석 등 조치를 해야 하는 메일, 본문에서 본인을 직접 지목하거나 언급한 메일, 본인이 보낸 메일에 대한 답장.\n` +
    `- false 조건: 대량 발송 뉴스레터/마케팅, 자동 알림/영수증, 단순 참조(Cc)로만 들어간 전체 공지, 본인 조치가 전혀 필요 없는 정보성 메일.\n` +
    (exclusionRules ? `- 사용자가 직접 "내 것이 아니다"라고 알려준 유형(해당하면 반드시 false):\n${exclusionRules}\n` : "") +
    `- 애매하면 false로 판단해라(관련 없는 메일이 개인 채널로 새는 것보다 낫다).\n\n`;

  // 요약 결과가 보일 화면의 언어와 맞춰야 하므로, 출력 언어는 현재 UI 언어를 따른다.
  // (예전에는 프롬프트에 "반드시 한국어로"가 박혀 있어서 영어/일본어/중국어 UI에서도 본문만 한국어로 나왔다)
  const summaryLangName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";

  const prompt =
    `아래는 '${labelName}' 라벨에 정리된 이메일 목록이다. 이 이메일들 중 중요하거나 사용자에게 필요한 메일만 선별하여 반드시 ${summaryLangName}로 깔끔하게 요약해라.\n\n` +
    filterInstruction +
    importanceCriteriaInstruction +
    personalRelevanceInstruction +
    `[지침]\n` +
    `1. 스팸, 단순 반복 알림, 불필요한 홍보성 메일은 선별 대상에서 제외해라.\n` +
    `2. 중요하거나 선별된 메일에 대해 핵심 내용 요약, 중요도(상/중/하 - 위 정밀 기준 준수), 그리고 발신자가 요구하거나 사용자가 해야 할 조치 사항(Action Item)을 ${summaryLangName}로 작성해라.\n` +
    `3. 각 메일별로 디스코드(Discord) 채널 알림 전송 필요 여부('discordNotificationNeeded': true/false - 단순 뉴스레터는 false, 중요/긴급/조치 필요 메일은 true)와 디스코드 카테고리('discordCategory': "긴급/조치필요" | "공지/일정" | "일반/리포트"), 및 디스코드 채널 전용 한 줄 핵심 브리핑('discordSummaryText', ${summaryLangName})을 AI 판단으로 자동 분류해라.\n` +
    `4. 전체 메일을 종합한 'overallSummary'(전체 요약 브리핑, ${summaryLangName} 2~4문장)를 작성해라.\n` +
    `5. 선별된 메일 목록 'selectedEmails' 배열에 정보를 담아 반환해라.\n` +
    `6. 조치할 것이 없는 메일은 'actionRequired'를 다른 표현 없이 정확히 "없음"으로만 적어라(화면에서 이 값을 기준으로 조치 항목을 숨긴다).\n` +
    `7. 각 메일별로 위 [개인 관련성 판단 기준]에 따라 'personallyRelevant'(true/false)와 그렇게 판단한 짧은 이유 'personalRelevanceReason'(${summaryLangName} 한 문장)을 반드시 채워라.\n\n` +
    `[이메일 목록]\n` +
    emailListText;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          overallSummary: { type: "STRING" },
          selectedEmails: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                idx: { type: "INTEGER" },
                subject: { type: "STRING" },
                sender: { type: "STRING" },
                importance: { type: "STRING", enum: ["상", "중", "하"] },
                summaryPoints: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
                actionRequired: { type: "STRING" },
                discordNotificationNeeded: { type: "BOOLEAN" },
                discordCategory: { type: "STRING", enum: ["긴급/조치필요", "공지/일정", "일반/리포트"] },
                discordSummaryText: { type: "STRING" },
                personallyRelevant: { type: "BOOLEAN" },
                personalRelevanceReason: { type: "STRING" },
              },
              required: [
                "idx",
                "subject",
                "sender",
                "importance",
                "summaryPoints",
                "actionRequired",
                "discordNotificationNeeded",
                "discordCategory",
                "discordSummaryText",
                "personallyRelevant",
                "personalRelevanceReason"
              ],
            },
          },
        },
        required: ["overallSummary", "selectedEmails"],
      },
    },
  };

  const parsedResult = await callAiForJson(requestBody);

  // 커스텀 웹훅의 '분류(라벨) 조건'이 쓸 수 있도록, 각 메일이 실제로 달고 있는 라벨 이름을 함께 담는다.
  // (라벨 ID는 그대로 두면 사람이 읽을 수 없으므로 목록을 한 번 받아 이름으로 바꾼다)
  let labelNameById = new Map();
  try {
    const labelCache = await fetchLabelCache(token);
    labelCache.exact.forEach((id, name) => {
      if (!labelCache.systemNames || !labelCache.systemNames.has(name)) labelNameById.set(id, name);
    });
  } catch (e) {
    await addLog(`[요약] 라벨 이름 조회 실패(분류 조건 라우팅은 라벨명 기준으로만 동작): ${e.message || e}`, "warn");
  }

  const enrichedSelectedEmails = (parsedResult.selectedEmails || []).map((item) => {
    const orig = emailDetails.find((e) => e.idx === item.idx);
    return {
      ...item,
      id: orig ? orig.id : null,
      threadId: orig ? orig.threadId : null,
      date: orig ? orig.date : null,
      labelNames: orig ? (orig.labelIds || []).map((id) => labelNameById.get(id)).filter(Boolean) : [],
    };
  });

  const summaryReport = {
    labelName,
    overallSummary: parsedResult.overallSummary || "",
    totalAnalyzed: emailDetails.length,
    selectedCount: enrichedSelectedEmails.length,
    selectedEmails: enrichedSelectedEmails,
    createdAt: Date.now(),
  };

  await chrome.storage.local.set({ lastLabelSummary: summaryReport });
  await addLog(`[요약 완료] ${emailDetails.length}개 중 ${enrichedSelectedEmails.length}개 메일 선별 및 요약 완료.`);

  // 요약이 끝났다는 사실만 알린다. 이걸 누가 받아서 무엇을 하는지(Discord 전송 등)는 모른다.
  // 예전에는 여기가 아니라 자동 요약 트리거가 sendSummaryToDiscord()를 직접 불렀고,
  // 그래서 Discord 코드를 건드리면 자동 요약이 함께 깨졌다.
  await emit(SUMMARY_COMPLETED, {
    summaryReport,
    labelName,
    source: options.source === "auto" ? "auto" : "manual",
  });

  return {
    total: emailDetails.length,
    success: enrichedSelectedEmails.length,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: isCancelled(),
    quotaExhausted: false,
    summaryReport,
  };
}


export {
  FEEDBACK_VERDICT_LABEL,
  generateSummaryCriteriaWithAI,
  learnFromSummaryFeedback,
  processSummarizeLabelEmails,
};
