// bg/pipeline/classification.js
// 분류 엔진: 메일 상세 조회 -> 배치 AI 분류 -> 라벨 적용까지의 처리 흐름.
//
// features/ 아래가 아니라 그 밑 계층에 둔다. 분류 기능(features/classify)과
// 라벨 관리 기능(features/label_admin의 재분류/중복 정리)이 둘 다 이 엔진을 쓰기 때문이다.
// 기능끼리 서로 import 하지 않는다는 규칙을 지키려면 공유되는 것은 아래 계층으로 내려야 한다.
//
// 이 파일은 "어떤 메일을 대상으로 할지"를 정하지 않는다. 그건 호출하는 기능의 몫이다.

import { isCancellationError, isCancelled } from "../core/cancellation.js";
import { recordLabelHistoryBatch } from "../core/history_db.js";
import { addLog } from "../core/logger.js";
import { updateProgress } from "../core/progress.js";
import { chunkArray, mapWithConcurrency, truncateForLog } from "../core/util.js";
import { getCategoryColor, getFilterRules, matchesFilterRule } from "../domain/categories.js";
import { BATCH_SIZE, GEMINI_BATCH_CONCURRENCY, GMAIL_FETCH_CONCURRENCY } from "../domain/limits.js";
import { emit } from "../core/events.js";
import { CLASSIFY_CORRECTION_HINT_REQUESTED, CLASSIFY_FLUSH_LEARNING } from "../core/topics.js";
import { callAiForJson, getQuotaUsage } from "../platform/ai_gateway.js";
import { GMAIL_BATCH_MODIFY_LIMIT, getEmailContent } from "../platform/gmail_api.js";
import { applyLabelExclusive, batchModifyLabels, collectManagedLabelIds, computeExclusiveRemovals, getOrCreateLabelId } from "../platform/gmail_labels.js";
import { i18nCurrentLocale, t } from "../../i18n.js";

const CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE = {
  ko:
    "일반 참고 기준(설명이 없는 카테고리에 한해 참고):\n" +
    "- '뉴스레터'는 실제 구독 중인 서비스의 정보성/편집성 소식(팁, 업데이트, 시즌 소식 등)에만 쓰고, 순수 할인·세일·쿠폰·설문 요청처럼 판매 유도가 목적인 메일은 '광고'로 분류해. 팁이나 노하우가 일부 섞여 있어도 핵심 목적이 제품 구매·업그레이드·유료 구독 유도('Order Now', 'Unlock', 'Upgrade' 같은 CTA)라면 '광고'로 분류해.\n" +
    "- '광고'는 아직 사지 않은 상품/서비스를 사라고 설득하는 메일(할인, 신상품 소개, 재입고 알림, 설문·리뷰 요청, 프로모션)이다. 메일 하단에 'Unsubscribe from Marketing Emails', '수신거부', '구독취소', '프로모션 이메일' 같은 문구가 있으면 그 신호를 강하게 반영해서 '광고'로 분류해.\n" +
    "- '쇼핑'은 이미 결제/주문한 물건의 처리 과정을 알려주는 거래 상태 알림이다(주문 확인, 배송 시작, 배송 조회, 세관 통과, 국가 도착, 배송 완료, 주문 취소, 환불 처리, 고객센터 문의 후속 조치, 결제/청구 확인 포함). 단, 설문조사·리뷰 작성 요청은 상태 알림이 아니라 참여 유도이므로 '광고'로 분류해. 이건 특정 제품을 사라고 설득하는 메일이 아니라 이미 산 것의 상태 보고이므로 '광고'가 아니다.\n" +
    "- 중요: 이미 발생한 거래의 사후 처리(주문 취소, 환불 시작/완료, 고객센터 문의 후속 조치, 자동구매확정 안내, 배송/결제 관련 모든 알림)는 어떤 경우에도 '광고'로 분류하면 안 된다.\n" +
    "- '메시지가 도착했다', '읽지 않은 메시지 N개'처럼 협업툴 알림과 비슷해 보여도 발신자가 쇼핑몰/커머스이고 위 마케팅 신호가 있으면 '광고'로 분류해.\n" +
    "메일은 '주제'가 아니라 '기능'(보안 알림/판매 유도/거래 상태 알림/공지 등) 기준으로 분류해.",
  en:
    "General reference criteria (only for categories with no description):\n" +
    "- 'Newsletters' is only for informational/editorial updates from a service you're actually subscribed to (tips, feature updates, seasonal news). Pure discount/sale/coupon/survey emails meant to drive a purchase belong in 'Ads', even if they include some tips, if the core purpose is a purchase/upgrade/paid-subscription CTA ('Order Now', 'Unlock', 'Upgrade').\n" +
    "- 'Ads' is for emails trying to sell you something you haven't bought yet (discounts, new product announcements, back-in-stock alerts, survey/review requests, promotions). If the email has 'Unsubscribe from Marketing Emails' or similar language, treat that as a strong signal for 'Ads'.\n" +
    "- 'Shopping' is a transaction-status notice for something already purchased/ordered (order confirmation, shipping started, tracking, customs, delivered, cancellation, refund, support follow-up, payment/billing confirmation). Survey/review requests are NOT a status update - they're a call to participate, so classify those as 'Ads' instead. This is a status report on something already bought, not a pitch to buy something, so it is not 'Ads'.\n" +
    "- Important: post-purchase handling of an existing transaction (order cancellation, refund started/completed, support follow-up, auto-confirm notices, any shipping/payment notification) must never be classified as 'Ads'.\n" +
    "- Even if it looks like a collaboration-tool notification ('you have a new message', 'N unread messages'), if the sender is a shopping/commerce platform and shows the marketing signals above, classify it as 'Ads'.\n" +
    "Classify by the email's function (security alert / sales pitch / transaction status / notice), not its topic.",
  ja:
    "一般参考基準(説明がないカテゴリにのみ適用):\n" +
    "- 「ニュースレター」は実際に登録済みのサービスからの情報提供・編集的な内容(ヒント、アップデート、季節のお知らせなど)にのみ使い、割引・セール・クーポン・アンケート依頼など販売誘導が目的のメールは「広告」に分類する。ヒントが多少含まれていても、目的が購入・アップグレード・有料登録の誘導('Order Now'、'Unlock'、'Upgrade'などのCTA)なら「広告」に分類する。\n" +
    "- 「広告」はまだ購入していない商品・サービスを勧めるメール(割引、新商品案内、再入荷通知、アンケート・レビュー依頼、プロモーション)。「配信停止」等の文言があれば強く「広告」のシグナルとして扱う。\n" +
    "- 「ショッピング」はすでに購入・注文した商品の処理状況を知らせる取引状況通知(注文確認、発送開始、追跡、通関、到着、キャンセル、返金、サポート対応、支払い確認を含む)。ただしアンケート・レビュー依頼は状況通知ではなく参加の誘導なので「広告」に分類する。これは商品購入を勧めるメールではなく、すでに買ったものの状況報告なので「広告」ではない。\n" +
    "- 重要: 既存取引の事後処理(注文キャンセル、返金開始・完了、サポート対応、自動確定通知、配送・支払いに関する通知)はいかなる場合も「広告」に分類してはならない。\n" +
    "- コラボレーションツールの通知(「新着メッセージがあります」「未読メッセージN件」)のように見えても、送信者がショッピング・コマースプラットフォームで上記のマーケティングシグナルがあれば「広告」に分類する。\n" +
    "メールは「話題」ではなく「機能」(セキュリティ通知・販売誘導・取引状況通知・お知らせなど)を基準に分類する。",
  zh_CN:
    "通用参考标准(仅适用于没有说明的分类):\n" +
    "- “订阅通讯”仅用于你实际订阅的服务发来的信息性/编辑性内容(小贴士、更新、季节性消息等)，纯粹的折扣/促销/优惠券/问卷请求应归为“广告”，即使掺杂了一些技巧内容，只要核心目的是购买/升级/付费订阅引导('Order Now'、'Unlock'、'Upgrade'等CTA)，就归为“广告”。\n" +
    "- “广告”指推销你尚未购买的商品/服务的邮件(折扣、新品介绍、补货通知、问卷/评价请求、促销)。如果邮件底部有“取消订阅营销邮件”等字样，应强烈视为“广告”信号。\n" +
    "- “购物”指已购买/已下单商品的交易状态通知(订单确认、发货开始、物流跟踪、清关、送达、取消、退款、客服跟进、付款/账单确认)。但问卷调查/评价请求不是状态通知而是参与邀请，应归为“广告”。这不是推销购买的邮件，而是已购买物品的状态报告，因此不是“广告”。\n" +
    "- 重要：对已发生交易的后续处理(订单取消、退款开始/完成、客服跟进、自动确认通知、任何物流/付款通知)在任何情况下都不应归为“广告”。\n" +
    "- 即使看起来像协作工具通知(“您有新消息”“N条未读消息”)，如果发件人是购物/电商平台且带有上述营销信号，也应归为“广告”。\n" +
    "邮件应按“功能”(安全提醒/销售推广/交易状态通知/公告等)分类，而非按主题分类。",
};



// ---------------- 1단계: 상위 카테고리만 분류 (신규 상위 카테고리 생성 없음, 고정 목록 중에서만 선택) ----------------
async function classifyTopLevelBatch(items, categoryDefs, correctionHint) {
  const emailListText = items
    .map((it) => `[idx=${it.idx}] 보낸사람: ${it.from} / 제목: ${it.subject} / 본문요약: ${it.snippet}`)
    .join("\n");

  const categoryNames = categoryDefs.map((c) => c.name);
  const categoryListText = categoryDefs
    .map((c) => (c.description && c.description.trim() ? `- ${c.name}: ${c.description.trim()}` : `- ${c.name}`))
    .join("\n");

  const locale = i18nCurrentLocale();
  const referenceCriteria = CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE[locale] || CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE.ko;

  const prompt =
    "아래는 여러 개의 이메일 목록이다. 각 이메일을 아래 카테고리 목록 중 가장 알맞은 것 하나로만 분류해. " +
    "목록에 없는 새 카테고리는 절대 만들지 마라 - 애매하거나 목록에 딱 맞는 게 없으면 '기타'로 분류해.\n" +
    "카테고리 목록과 분류 기준(콜론 뒤에 설명이 있으면 그 설명을 최우선으로 따르고, 설명이 없는 카테고리는 이름과 아래 일반 참고 기준으로 판단해):\n" +
    categoryListText +
    "\n\n" +
    referenceCriteria +
    "\n각 이메일마다 confidence도 함께 판단해: 내용이 명확해서 확신이 높으면 'high', 애매하거나 정보가 부족해서 확신이 낮으면 'low'로 표시해(low인 경우 자동으로 '기타'로 재분류됨)." +
    (correctionHint || "") +
    "\n\n" +
    emailListText;

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
            labelName: { type: "STRING", enum: categoryNames },
            confidence: { type: "STRING", enum: ["high", "low"] },
          },
          required: ["idx", "labelName", "confidence"],
        },
      },
    },
  };

  const parsedArray = await callAiForJson(requestBody);
  if (!Array.isArray(parsedArray)) throw new Error(t("errGeminiNotArray"));
  return parsedArray.filter((e) => typeof e.idx === "number" && e.labelName);
}


async function classifyAndLabelMessages(token, categoryDefs, labelCache, messages, excludeLabel) {
  const results = [];
  const failMessages = [];
  let successCount = 0;
  let cancelled = false;
  let quotaExhausted = false;

  if (!messages.length) {
    await addLog(t("logNoMailToProcess"));
    return { results, failMessages, successCount, success: successCount, total: 0, requestsUsed: 0, cancelled, quotaExhausted };
  }

  const categories = categoryDefs.map((c) => c.name);
  const fallbackCategory = categories.includes("기타") ? "기타" : categories[categories.length - 1];

  await addLog(t("logFetchStart", [messages.length]));

  let fetchDone = 0;
  let classifyDone = 0;
  let applyDone = 0;

  // 상세조회 / 분류 / 적용 세 구간을 동일 비중으로 섞어서 전체 진행률을 계산.
  // 분모는 전부 messages.length로 통일해서(단계별로 실제 대상 수가 조금씩 달라도) 마지막 "적용" 단계가
  // 끝나야만 비로소 100%에 도달하도록 만든다 - 그래야 적용 작업이 남았는데 100%로 잘못 보이는 일이 없다.
  function computeCombinedProgress() {
    const p1 = messages.length ? fetchDone / messages.length : 0;
    const p2 = messages.length ? classifyDone / messages.length : 0;
    const p3 = messages.length ? applyDone / messages.length : 0;
    const avg = (p1 + p2 + p3) / 3;
    return Math.min(messages.length, Math.round(avg * messages.length));
  }

  function reportProgress(batchIndex, batchTotal) {
    return updateProgress({ processed: computeCombinedProgress(), total: messages.length, batchIndex, batchTotal });
  }

  // 상세 조회는 서로 독립적이라 순서대로 기다릴 이유가 없다 - 제한된 동시성으로 병렬 처리한다.
  // 결과 순서는 mapWithConcurrency가 입력 순서로 유지해주므로 이후 단계 동작은 그대로다.
  const fetched = await mapWithConcurrency(messages, GMAIL_FETCH_CONCURRENCY, async (msg) => {
    if (isCancelled()) return null;
    try {
      const detail = await getEmailContent(token, msg.id);
      fetchDone += 1;
      await addLog(t("logFetchItemDone", [fetchDone, messages.length, truncateForLog(detail.subject), detail.from]), "info", true);
      await reportProgress(0, 3);
      return { detail };
    } catch (err) {
      if (isCancellationError(err)) return null;
      fetchDone += 1;
      const msgText = String(err.message || err);
      await addLog(t("logFetchItemFailed", [fetchDone, messages.length, msg.id, msgText]), "error", true);
      await reportProgress(0, 3);
      return { error: msgText, id: msg.id };
    }
  });

  const details = [];
  for (const entry of fetched) {
    if (!entry) continue; // 중지되어 처리하지 않은 항목
    if (entry.error) {
      results.push({ id: entry.id, error: entry.error });
      failMessages.push(entry.error);
      continue;
    }
    details.push(entry.detail);
  }

  if (isCancelled()) {
    await addLog(t("logCancelledDuringFetch", [fetchDone, messages.length]), "warn");
    return { results, failMessages, successCount, success: successCount, total: messages.length, requestsUsed: 0, cancelled: true, quotaExhausted: false };
  }
  await addLog(t("logFetchComplete", [fetchDone, messages.length]));

  // ---------------- 개인 필터 규칙 적용 (AI 호출 전에 먼저 확인, 매칭되면 AI 분석 자체를 건너뜀) ----------------
  const filterRules = await getFilterRules();
  const finalLabelById = new Map(); // detail.id -> 최종 라벨명(필터 매칭분은 여기서 바로 채워짐)
  let detailsToClassify = details;
  if (filterRules.length) {
    detailsToClassify = [];
    for (const detail of details) {
      const rule = filterRules.find((r) => matchesFilterRule(detail, r));
      if (rule) {
        finalLabelById.set(detail.id, rule.targetLabel);
        classifyDone += 1;
        await addLog(t("logFilterMatched", [truncateForLog(detail.subject), rule.targetLabel]), "info", true);
      } else {
        detailsToClassify.push(detail);
      }
    }
    if (finalLabelById.size) await addLog(t("logFilterAppliedCount", [finalLabelById.size]));
  }

  // ---------------- 수동 정정 학습: 과거 사례 중 사용자가 직접 고친 게 있으면 프롬프트에 참고로 넣는다 ----------------
  // 학습 기능에게 힌트를 "요청"만 한다. 학습이 어떻게 사례를 모으는지, 언제 다시 훑을지,
  // 그 사이 자동 학습을 미뤄야 하는지는 전부 구독자 쪽 사정이다.
  // 구독자가 없으면(학습 기능을 뺐다면) 힌트 없이 그대로 진행된다.
  let correctionHint = "";
  const hintResults = await emit(CLASSIFY_CORRECTION_HINT_REQUESTED, { labelCache, categories });
  const hintResult = hintResults.find((r) => r && r.hint);
  if (hintResult) {
    correctionHint = hintResult.hint;
    await addLog(t("logCorrectionExamplesUsed", [hintResult.examplesUsed]));
  }

  // ---------------- 분류: 사용자 정의 카테고리(이름+설명) 중 하나로 배정 ----------------
  const candidateDefs = excludeLabel ? categoryDefs.filter((c) => c.name !== excludeLabel) : categoryDefs;
  const batches = chunkArray(detailsToClassify, BATCH_SIZE);
  const totalBatches = batches.length;
  let requestsUsed = 0;

  await addLog(t("logClassifyStageStart", [totalBatches, BATCH_SIZE]));
  if (excludeLabel) await addLog(t("logSplitModeExclude", [excludeLabel]));
  await reportProgress(1, 3);

  // 배치끼리는 서로 의존하지 않으므로 겹쳐서 보낸다. 이렇게 하면 앞 요청의 응답 대기 시간 동안
  // 배치끼리는 서로 의존하지 않으므로 겹쳐서 보낸다.
  // RPM 상한은 AIPacer가 지키고, 이렇게 하면 앞 요청의 응답 대기 시간 동안
  // 다음 요청이 출발해서 "간격 + 응답지연"이 배치마다 누적되던 것을 없앨 수 있다.
  let stopClassifying = false;
  let fatalClassifyError = null;
  let batchesDone = 0;

  await mapWithConcurrency(batches, GEMINI_BATCH_CONCURRENCY, async (batch, b) => {
    if (stopClassifying) return;
    if (isCancelled()) {
      await addLog(t("logCancelledBeforeBatch", [b + 1, totalBatches]), "warn");
      cancelled = true;
      stopClassifying = true;
      return;
    }

    const items = batch.map((d, i) => ({ idx: i, subject: d.subject, from: d.from, snippet: d.snippet }));

    await addLog(t("logBatchRequesting", [b + 1, totalBatches, batch.length]));

    let rawEntries;
    try {
      rawEntries = await classifyTopLevelBatch(items, candidateDefs, correctionHint);
      requestsUsed += 1;
      batchesDone += 1;
      await addLog(t("logBatchDone", [b + 1, totalBatches]));
    } catch (err) {
      if (isCancelled() || isCancellationError(err)) {
        await addLog(t("logCancelledAfterBatch", [b + 1, totalBatches]), "warn");
        cancelled = true;
        stopClassifying = true;
        return;
      }
      // A hung Gemini request is not a mail-specific classification failure.
      // End the job and surface it instead of spending another timeout per batch.
      if (err && err.isRequestTimeout) {
        fatalClassifyError = err;
        stopClassifying = true;
        return;
      }
      const msgText = String(err.message || err);
      await addLog(t("logBatchFailed", [b + 1, totalBatches, msgText]), "error");
      batch.forEach((d) => {
        results.push({ id: d.id, error: msgText });
        failMessages.push(msgText);
      });
      if (err.isQuotaExhausted) {
        await addLog(t("logQuotaExhaustedStop"), "error");
        quotaExhausted = true;
        stopClassifying = true;
        return;
      }
      classifyDone += batch.length;
      batchesDone += 1;
      await reportProgress(batchesDone, totalBatches);
      return;
    }

    const entryByIdx = new Map(rawEntries.map((e) => [e.idx, e]));
    for (let i = 0; i < batch.length; i += 1) {
      const entry = entryByIdx.get(i);
      let labelName = entry ? entry.labelName : fallbackCategory;
      if (entry && entry.confidence === "low") labelName = fallbackCategory; // 저신뢰도는 무조건 기타
      if (!categories.includes(labelName)) labelName = fallbackCategory; // 안전망
      finalLabelById.set(batch[i].id, labelName);
    }

    classifyDone += batch.length;
    await reportProgress(batchesDone, totalBatches);

    if (isCancelled()) {
      await addLog(t("logCancelledAfterBatch", [b + 1, totalBatches]), "warn");
      cancelled = true;
      stopClassifying = true;
    }
  });

  // 응답이 오지 않아 타임아웃된 경우는 메일별 실패가 아니라 작업 자체의 실패로 올린다.
  if (fatalClassifyError) throw fatalClassifyError;

  // 취소/오류로 분류를 못 거친 메일은 최종 라벨에서 제외(적용 대상에서 빠짐)
  await addLog(t("logClassifyDoneApplyStart", [finalLabelById.size]));

  // ---------------- 라벨 실제 적용 (필터 매칭분 + AI 분류분 전체) ----------------
  // 메일마다 messages.modify를 한 번씩 보내면 수천 번의 왕복이 생긴다.
  // "붙일 라벨 + 뗄 라벨"이 같은 메일끼리 묶어서 messages.batchModify로 한 번에 처리한다.
  let processedCount = 0;
  const totalToApply = finalLabelById.size;
  const managedLabelIds = collectManagedLabelIds(labelCache, categories);

  // 같은 라벨 이름을 메일마다 다시 조회하지 않도록 이름당 한 번만 확인/생성한다.
  const labelByName = new Map();
  async function resolveLabel(labelName) {
    if (labelByName.has(labelName)) return labelByName.get(labelName);
    const label = await getOrCreateLabelId(token, labelName, labelCache, categories);
    labelByName.set(labelName, label);
    return label;
  }

  // groupKey -> { label, removeLabelIds, details }
  const applyGroups = new Map();
  for (const detail of details) {
    const labelName = finalLabelById.get(detail.id);
    if (!labelName) continue;

    let label;
    try {
      label = await resolveLabel(labelName);
    } catch (err) {
      const msgText = String(err.message || err);
      if (isCancellationError(err)) {
        cancelled = true;
        break;
      }
      processedCount += 1;
      applyDone += 1;
      results.push({ id: detail.id, error: msgText });
      failMessages.push(msgText);
      await addLog(t("logApplyItemFailed", [processedCount, totalToApply, truncateForLog(detail.subject), msgText]), "error", true);
      continue;
    }

    const removeLabelIds = computeExclusiveRemovals(detail, label, managedLabelIds);
    const groupKey = `${label.id}|${removeLabelIds.join(",")}`;
    if (!applyGroups.has(groupKey)) applyGroups.set(groupKey, { label, removeLabelIds, details: [] });
    applyGroups.get(groupKey).details.push(detail);
  }

  for (const group of applyGroups.values()) {
    if (isCancelled()) {
      await addLog(t("logCancelledDuringApply", [processedCount, totalToApply]), "warn");
      cancelled = true;
      break;
    }

    for (const chunk of chunkArray(group.details, GMAIL_BATCH_MODIFY_LIMIT)) {
      if (isCancelled()) {
        await addLog(t("logCancelledDuringApply", [processedCount, totalToApply]), "warn");
        cancelled = true;
        break;
      }

      // batchModify는 부분 실패를 알려주지 않으므로(전체 성공 아니면 전체 실패),
      // 실패하면 그 묶음만 메일 단위로 다시 시도해서 어느 메일이 문제인지 남긴다.
      let appliedIds;
      try {
        await batchModifyLabels(
          chunk.map((d) => d.id),
          [group.label.id],
          group.removeLabelIds
        );
        appliedIds = chunk;
      } catch (err) {
        if (isCancellationError(err)) {
          cancelled = true;
          break;
        }
        await addLog(t("logBatchApplyFallback", [chunk.length, String(err.message || err)]), "warn");
        appliedIds = [];
        for (const detail of chunk) {
          if (isCancelled()) {
            cancelled = true;
            break;
          }
          try {
            await applyLabelExclusive(token, detail, group.label, categories, labelCache, managedLabelIds);
            appliedIds.push(detail);
          } catch (itemErr) {
            const msgText = String(itemErr.message || itemErr);
            processedCount += 1;
            applyDone += 1;
            results.push({ id: detail.id, error: msgText });
            failMessages.push(msgText);
            await addLog(
              t("logApplyItemFailed", [processedCount, totalToApply, truncateForLog(detail.subject), msgText]),
              "error",
              true
            );
          }
        }
      }

      const historyEntries = [];
      for (const detail of appliedIds) {
        const color = getCategoryColor(group.label.name, categories);
        historyEntries.push({
          messageId: detail.id,
          subject: detail.subject,
          from: detail.from,
          labelName: group.label.name,
        });

        results.push({
          id: detail.id,
          threadId: detail.threadId,
          subject: detail.subject,
          from: detail.from,
          labelName: group.label.name,
          bgColor: color.bgColor,
          textColor: color.textColor,
        });
        successCount += 1;
        processedCount += 1;
        applyDone += 1;

        await addLog(
          t("logApplyItemDone", [processedCount, totalToApply, truncateForLog(detail.subject), group.label.name]) +
            (group.removeLabelIds.length ? t("logReplacedSuffix") : ""),
          "info",
          true
        );
      }

      // 히스토리도 건당 트랜잭션을 열지 않고 한 번에 기록
      await recordLabelHistoryBatch(historyEntries);
      await reportProgress(totalBatches, totalBatches);
    }

    if (cancelled) break;
  }

  await addLog(t("logApplyComplete", [processedCount, totalToApply]));
  await updateProgress(
    { processed: messages.length, total: messages.length, batchIndex: totalBatches, batchTotal: totalBatches },
    { force: true }
  );

  // 라벨 적용을 묶음으로 처리하면서 결과가 그룹 순서로 쌓이므로, 호출자가 보던 대로 입력 순서로 되돌린다.
  const inputOrderById = new Map(messages.map((m, i) => [m.id, i]));
  results.sort((a, b) => (inputOrderById.get(a.id) ?? 0) - (inputOrderById.get(b.id) ?? 0));

  // 분류 도중 미뤄둔 자동 학습을 여기서 처리하고, 소비한 요청 수를 집계에 합산한다.
  // 구독자가 없으면 빈 배열이 와서 0이 더해진다.
  const flushed = await emit(CLASSIFY_FLUSH_LEARNING, {});
  requestsUsed += flushed.reduce((sum, n) => sum + (Number(n) || 0), 0);

  return { results, failMessages, successCount, success: successCount, total: messages.length, requestsUsed, cancelled, quotaExhausted };
}



// 오늘 남은 추정 RPD에 맞춰 요청 개수를 미리 안전하게 축소한다 (배치 1개 = 요청 1회 기준)
async function computeSafeEmailCount(requestedCount) {
  const usage = await getQuotaUsage();

  if (usage.keyCount === 0) {
    throw new Error(t("errNoApiKey"));
  }
  if (usage.usableKeyCount === 0) {
    throw new Error(
      "등록된 모든 AI 키가 할당량 소진 상태입니다. 잠시 후 다시 시도하거나 다른 공급자의 키를 추가하세요."
    );
  }

  // 하루 상한을 추정할 수 있는 건 Gemini 무료 티어 키가 있을 때뿐이다.
  // OpenAI/Anthropic만 쓰는 구성에서는 상한을 모르므로 요청 수를 줄이지 않는다.
  if (usage.rpd === null) {
    return { count: requestedCount, reduced: false, usage, remainingRequests: null };
  }

  // 분류 배치 외에도 자동 학습/요약 등 부수적인 AI 호출이 몇 건 생길 수 있으므로 여유분을 남겨둔다.
  const QUOTA_RESERVE_REQUESTS = 5;
  const remainingRequests = Math.max(0, usage.rpd - usage.requestsToday - QUOTA_RESERVE_REQUESTS);
  const maxEmailsFromQuota = remainingRequests * BATCH_SIZE;

  if (maxEmailsFromQuota <= 0) {
    throw new Error(
      `오늘 AI 요청 추정치(${usage.requestsToday}/${usage.rpd})가 이미 한도에 도달했습니다. 태평양 시간 자정 이후 다시 시도하세요.`
    );
  }

  if (requestedCount > maxEmailsFromQuota) {
    return { count: maxEmailsFromQuota, reduced: true, usage, remainingRequests };
  }
  return { count: requestedCount, reduced: false, usage, remainingRequests };
}

export {
  CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE,
  classifyTopLevelBatch,
  classifyAndLabelMessages,
  computeSafeEmailCount,
};
