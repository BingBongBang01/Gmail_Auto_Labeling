// bg/features/pdf/translate.js
// 세그먼트 배치 번역 루프.
//
// 원본 pdf_engine/translator/scheduler.py(717줄)를 그대로 옮기지 않는다. 그 파일의 대부분
// (키 선택 점수화, 쿨다운, 모델 폴백, RPM/RPD 원장)은 이 확장의 ai/ai_request_router.js가
// 이미 하는 일이다. callAiForJson 한 번이 그 전부를 거친다:
//   AIQuotaManager.load()  - 서비스워커 재시작 후 할당량 상태 복원
//   AIPacer.acquire()      - 공급자별 요청 간격(RPM) 직렬 대기, 429면 간격 확대
//   키 순회 + 재시도        - 여러 키를 우선순위대로, maxRetries+1 라운드
//   AIFailoverManager      - 오류 종류별 쿨다운/영구 제외 판단
// 여기 남는 것은 "무엇을 몇 개씩 묶어 보낼지"와 "응답을 어떻게 세그먼트에 되돌릴지"뿐이다.

import { callAiForJson } from "../../platform/ai_gateway.js";
import { addLog } from "../../core/logger.js";
import { updateProgress } from "../../core/progress.js";
import { isCancelled, JobCancelledError } from "../../core/cancellation.js";
import {
  makeBatches,
  renderPrevContext,
  buildUserPrompt,
  reconcileTranslations,
} from "../../../pdf/text/batching.js";
import { pdfSystemPrompt, PDF_USER_TEMPLATE } from "./prompts.js";
import { attachCacheKeys, applyCachedTranslations, rememberTranslations } from "./seg_cache.js";

// 루트가 OBJECT라서 AISchema.wrapRoot가 그대로 통과시킨다(래핑/언래핑 불필요).
// 모든 속성을 required에 넣어두는 게 중요하다 - OpenAI strict 모드는
// required = Object.keys(properties)로 덮어쓰기 때문에, 일부만 넣으면
// Gemini와 OpenAI의 의미가 달라진다.
const PDF_TRANSLATION_SCHEMA = {
  type: "OBJECT",
  properties: {
    translations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          segment_id: { type: "STRING" },
          translated_text: { type: "STRING" },
        },
        required: ["segment_id", "translated_text"],
      },
    },
  },
  required: ["translations"],
};

const PREV_CONTEXT_PAIRS = 12;
const PREV_CONTEXT_CHARS = 1500;

async function translateBatch(batch, options, prevPairs) {
  const system = pdfSystemPrompt(options.promptProfile);
  const user = buildUserPrompt(
    PDF_USER_TEMPLATE,
    options,
    options.glossaryText,
    renderPrevContext(prevPairs, PREV_CONTEXT_CHARS),
    batch
  );

  // 라우터에 system 슬롯이 없어 한 덩어리로 붙여 보낸다.
  const requestBody = {
    contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: PDF_TRANSLATION_SCHEMA,
    },
  };

  const parsed = await callAiForJson(requestBody);
  return (parsed && parsed.translations) || [];
}

// 배치 앞에 붙일 직전 문맥. 문서 순서상 이 배치보다 앞에 있고 이미 번역된 세그먼트를
// 뒤에서부터 모은다.
//
// 캐시로 채워진 세그먼트도 문맥에 넣는다. 이어하기로 돌린 실행에서는 실제로 API를 타는
// 세그먼트가 문서 중간부터 시작하는데, 그때 문맥이 텅 비어 있으면 앞부분에서 정한 용어와
// 어긋난 번역이 나온다(이어하기의 결과가 한 번에 돌린 결과와 달라지는 지점이다).
function precedingPairs(targets, upto, limit) {
  const pairs = [];
  for (let i = upto - 1; i >= 0 && pairs.length < limit; i -= 1) {
    const seg = targets[i];
    if (!seg.translated || seg.translationFailed) continue;
    pairs.push([seg.text, seg.translated]);
  }
  return pairs.reverse();
}

/**
 * segments를 제자리에서 채운다: s.translated / s.translationFailed / s.failReason.
 * 반환값은 요약 통계.
 *
 * 중요: 여기서 예외를 위로 던지지 않는다. 번역이 중간에 끊겨도 그때까지의 결과로
 * PDF를 만들어야 하기 때문이다. 원본 pipeline.py가 주석으로 남긴 사고(마지막 단계
 * 예외 하나로 몇 시간치 번역이 통째로 사라짐)와 같은 실수를 반복하지 않는다.
 */
async function translateSegments(segments, options, hooks = {}) {
  const targets = segments.filter((s) => s.needsTranslation);

  const stats = {
    total: targets.length,
    success: 0,
    degraded: 0,
    cacheHits: 0,
    requestsUsed: 0,
    cancelled: false,
    quotaExhausted: false,
    failMessages: [],
  };

  // ---- 캐시에서 채울 수 있는 것을 먼저 채운다(= 이어하기) ----
  await attachCacheKeys(targets, options);
  if (options.useCache !== false) {
    stats.cacheHits = await applyCachedTranslations(targets);
    stats.success += stats.cacheHits;
  }

  // 캐시로 채워지지 않은 것만 실제로 번역한다.
  const pending = targets.filter((s) => !s.translated);
  const batches = makeBatches(pending, options.batchChars, options.batchSegs);

  // 문맥 수집은 targets(문서 순서) 위에서 하므로 배치 첫 세그먼트의 위치를 알아야 한다.
  const orderIndex = new Map();
  targets.forEach((seg, i) => orderIndex.set(seg, i));

  let processed = stats.cacheHits;

  if (stats.cacheHits) {
    await addLog(
      `[PDF] 캐시에서 세그먼트 ${stats.cacheHits}개를 재사용합니다(남은 ${pending.length}개만 번역).`
    );
  }
  if (!pending.length) {
    await addLog("[PDF] 번역할 세그먼트가 모두 캐시에 있었습니다. AI 요청 없이 재구성으로 넘어갑니다.");
    await updateProgress({ processed: targets.length, total: targets.length, batchIndex: 0, batchTotal: 0 }, { force: true });
    return stats;
  }

  await addLog(`[PDF] 번역 시작: 세그먼트 ${pending.length}개, 배치 ${batches.length}개`);

  for (let bi = 0; bi < batches.length; bi += 1) {
    if (isCancelled()) {
      stats.cancelled = true;
      await addLog("[PDF] 사용자 중지 요청으로 번역을 멈춥니다.", "warn");
      break;
    }

    const batch = batches[bi];
    const prevPairs = precedingPairs(targets, orderIndex.get(batch[0]) ?? 0, PREV_CONTEXT_PAIRS);
    let results;

    try {
      stats.requestsUsed += 1;
      const translations = await translateBatch(batch, options, prevPairs);
      results = reconcileTranslations(batch, translations, options.targetLang);
    } catch (e) {
      if (e instanceof JobCancelledError || (e && e.isJobCancelled)) {
        stats.cancelled = true;
        break;
      }
      // 배치 하나가 실패해도 문서 전체를 버리지 않는다. 해당 세그먼트만 원문 유지.
      const msg = String((e && e.message) || e);
      await addLog(`[PDF] 배치 ${bi + 1}/${batches.length} 실패: ${msg}`, "error");
      results = batch.map((seg) => ({ seg, text: null, reason: msg.slice(0, 120) }));

      // 쓸 수 있는 키가 하나도 안 남았으면 더 돌아봐야 소용이 없다.
      if (await hooks.isQuotaExhausted?.()) {
        stats.quotaExhausted = true;
        for (const r of results) degrade(r.seg, "AI 할당량 소진", stats);
        processed += batch.length;
        await addLog("[PDF] 사용 가능한 AI 키가 없어 남은 구간은 원문을 유지합니다.", "warn");
        break;
      }
    }

    for (const { seg, text, reason } of results) {
      if (text) {
        seg.translated = text;
        seg.translationFailed = false;
        stats.success += 1;
      } else {
        degrade(seg, reason || "원인 불명", stats);
      }
    }

    // 배치 단위로 바로 캐시에 적는다. 문서 끝에서 한 번에 적으면 그 전에 워커가 죽었을 때
    // 이 배치의 진행분이 남지 않아 이어하기가 처음부터 다시 번역한다.
    await rememberTranslations(batch, hooks.docId);

    processed += batch.length;
    await updateProgress({
      processed,
      total: targets.length,
      batchIndex: bi + 1,
      batchTotal: batches.length,
    });
    await hooks.onBatch?.({ batchIndex: bi + 1, batchTotal: batches.length, processed, total: targets.length, stats });
  }

  // 중지/소진으로 손도 못 댄 세그먼트는 원문을 그대로 남긴다.
  for (const seg of targets) {
    if (!seg.translated) {
      seg.translated = seg.text;
      seg.translationFailed = true;
    }
  }

  await updateProgress(
    { processed: targets.length, total: targets.length, batchIndex: batches.length, batchTotal: batches.length },
    { force: true }
  );
  await addLog(
    `[PDF] 번역 완료: 성공 ${stats.success}(캐시 ${stats.cacheHits}) / 원문유지 ${stats.degraded} ` +
    `(요청 ${stats.requestsUsed}회)`
  );

  return stats;
}

// 세그먼트 하나를 "번역 실패(원문 유지)"로 강등한다.
// 문서 전체를 버리지 않기 위한 안전장치다.
function degrade(seg, reason, stats) {
  seg.translated = seg.text;
  seg.translationFailed = true;
  seg.failReason = reason;
  stats.degraded += 1;
  // failMessages는 chrome.storage.local에 들어가고 화면에는 첫 줄만 쓰인다.
  // 수천 개가 쌓이면 저장소만 부풀므로 상한을 둔다.
  if (stats.failMessages.length < 20) {
    stats.failMessages.push(`${seg.segId}: ${reason}`);
  }
}

export { translateSegments, PDF_TRANSLATION_SCHEMA };
