// bg/features/pdf/pipeline.js
// 추출 -> 번역 -> 재구성 세 단계를 엮는다.
// 엔진 작업(추출/재구성)은 오프스크린 문서에, LLM 호출은 여기(서비스워커)에 있다.
// 서비스워커가 AI 호출을 독점해야 AIPacer/AIQuotaManager의 상태가 하나로 유지된다.

import { addLog } from "../../core/logger.js";
import { updateProgress } from "../../core/progress.js";
import { isCancelled } from "../../core/cancellation.js";
import { getQuotaUsage } from "../../platform/ai_gateway.js";
import { callEngine, onEngineEvent, shutdownEngine } from "./engine_port.js";
import { translateSegments } from "./translate.js";
import { trimSegCache } from "./seg_cache.js";
import { patchPdfRun, getPdfDoc } from "../../../shared/pdf_db.js";

// 화면이 읽는 상세 진행 상태. jobProgress(숫자)와 분리해 둔다 -
// jobProgress는 팝업/대시보드도 함께 보는 공용 키라 PDF 전용 단계 이름을 넣을 자리가 아니다.
let lastStatusWrite = 0;
async function setPdfStatus(patch, force = false) {
  const now = Date.now();
  if (!force && now - lastStatusWrite < 700) return;
  lastStatusWrite = now;
  const prev = (await chrome.storage.local.get(["pdfProgress"])).pdfProgress || {};
  await chrome.storage.local.set({ pdfProgress: { ...prev, ...patch, updatedAt: now } });
}

const DEFAULT_OPTIONS = {
  sourceLang: "auto",
  targetLang: "한국어",
  docType: "general document",
  style: "natural, professional",
  terminologyPolicy:
    "Use established target-language technical terminology. Keep well-known abbreviations, " +
    "protocol names, commands, and product names in their original form.",
  domain: "general",
  instructions: "",
  glossaryText: "",
  promptProfile: "compact",
  pageRange: "",
  batchChars: 1500,
  batchSegs: 10,
  fontScale: 1,
  // 스캔본 OCR. auto = 텍스트 레이어가 없는 쪽만, force = 텍스트가 있어도 OCR로 다시 읽기.
  ocrMode: "auto",
  ocrLangs: "", // 비우면 원문 언어에서 추정한다
  ocrDpi: 300,
  // 이 글자 수보다 적게 나온 쪽을 스캔본으로 본다. 표지처럼 쪽번호 하나만 있는 페이지가
  // 텍스트 레이어를 가진 것으로 취급되지 않게 0보다 넉넉히 둔다.
  ocrMinChars: 16,
  useCache: true,
};

const OCR_MODES = new Set(["auto", "off", "force"]);

function normalizePdfOptions(raw = {}, stored = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...(stored.translation || {}), ...(stored.processing || {}), ...raw };
  merged.batchChars = Math.max(200, Math.min(8000, Number(merged.batchChars) || 1500));
  merged.batchSegs = Math.max(1, Math.min(40, Number(merged.batchSegs) || 10));
  merged.fontScale = Math.max(0.5, Math.min(2, Number(merged.fontScale) || 1));
  merged.ocrMode = OCR_MODES.has(merged.ocrMode) ? merged.ocrMode : "auto";
  // 150 미만에서는 본문 글자가 뭉개지고, 400을 넘으면 픽스맵만 수십 MB가 되면서 정확도는 그대로다.
  merged.ocrDpi = Math.max(150, Math.min(400, Number(merged.ocrDpi) || 300));
  merged.ocrMinChars = Math.max(0, Math.min(2000, Number(merged.ocrMinChars) || 0));
  merged.ocrLangs = String(merged.ocrLangs || "").trim();
  merged.useCache = merged.useCache !== false;
  return merged;
}

// 추출/OCR은 오프스크린에서 돌기 때문에 isCancelled()를 볼 수 없다.
// 중지 플래그를 폴링해서 엔진에 abort를 한 번 보내주는 감시자를 붙인다.
// 이게 없으면 100쪽짜리 스캔본에서 "중지"를 눌러도 OCR이 끝까지 다 돌아간다.
function watchCancellationForEngine() {
  let stopped = false;
  (async () => {
    while (!stopped) {
      await new Promise((resolve) => setTimeout(resolve, 700));
      if (stopped) return;
      if (!isCancelled()) continue;
      try {
        await callEngine("abort");
      } catch (e) {
        // 엔진이 이미 내려갔으면 알릴 대상도 없다.
      }
      return;
    }
  })();
  return () => {
    stopped = true;
  };
}

async function runPdfTranslation({ runId, docId, options, resumedFrom = null }) {
  const doc = await getPdfDoc(docId);
  const docName = (doc && doc.name) || "document.pdf";

  await patchPdfRun({
    runId, docId, status: "running", options, name: docName,
    startedAt: Date.now(), resumedFrom,
  });
  await setPdfStatus(
    { runId, docName, stage: "extract", segDone: 0, segTotal: 0, ocrTotal: 0, cacheHits: 0, resumedFrom },
    true
  );

  // 오프스크린에서 올라오는 페이지 단위 진행을 화면에 그대로 흘려준다.
  const off = onEngineEvent(async (msg) => {
    if (msg.evt === "extractProgress") {
      await setPdfStatus({ stage: "extract", page: msg.page, pageTotal: msg.pageCount, segTotal: msg.segCount });
    } else if (msg.evt === "ocrProgress") {
      await setPdfStatus({ stage: "ocr", page: msg.page, pageTotal: msg.pageCount, ocrTotal: msg.pageCount });
    } else if (msg.evt === "renderProgress") {
      await setPdfStatus({ stage: "render", page: msg.page, pageTotal: msg.pageCount });
    }
  });

  try {
    // ---- 1. 추출 (+ 필요하면 OCR) ----
    await addLog(`[PDF] '${docName}' 추출을 시작합니다.${resumedFrom ? " (이어하기)" : ""}`);
    const stopWatching = watchCancellationForEngine();
    let extracted;
    try {
      extracted = await callEngine("extract", {
        docId,
        pageRange: options.pageRange,
        ocr: {
          mode: options.ocrMode,
          langs: options.ocrLangs,
          sourceLang: options.sourceLang,
          dpi: options.ocrDpi,
          minChars: options.ocrMinChars,
        },
      });
    } finally {
      stopWatching();
    }

    const segments = extracted.segments || [];
    const targetCount = segments.filter((s) => s.needsTranslation).length;
    const ocrPages = extracted.ocrPages || 0;
    const ocrSegments = extracted.ocrSegments || 0;

    await addLog(
      `[PDF] ${extracted.pageCount}쪽에서 세그먼트 ${segments.length}개(번역 대상 ${targetCount}개)를 찾았습니다.`
    );
    if (ocrPages) {
      await addLog(`[PDF] 스캔된 쪽 ${ocrPages}개를 OCR로 읽어 세그먼트 ${ocrSegments}개를 얻었습니다.`);
    }
    if (extracted.scannedPages && !ocrPages && options.ocrMode === "off") {
      await addLog(
        `[PDF] 텍스트가 없는 쪽이 ${extracted.scannedPages}개 있습니다. 세부 설정에서 '스캔본 OCR'을 켜면 읽을 수 있습니다.`,
        "warn"
      );
    }
    if (extracted.ocrError) {
      await addLog(`[PDF] OCR을 쓸 수 없습니다: ${extracted.ocrError}`, "error");
    }

    await setPdfStatus(
      { stage: "translate", segTotal: targetCount, segDone: 0, pageTotal: extracted.pageCount, ocrTotal: ocrPages },
      true
    );

    if (targetCount === 0) {
      await patchPdfRun({ runId, status: "empty", stats: { ocrPages, ocrSegments } });
      await addLog(`[PDF] 번역할 텍스트가 없습니다. ${emptyReason(extracted, options)}`, "warn");
      return {
        total: 0, success: 0, failMessages: [`번역할 텍스트를 찾지 못했습니다. ${emptyReason(extracted, options)}`],
        requestsUsed: 0, cancelled: false, quotaExhausted: false, runId,
      };
    }

    // ---- 2. 번역 ----
    // translateSegments는 예외를 던지지 않는다. 중지/할당량 소진이어도 그때까지의
    // 결과를 들고 돌아온다 - 반드시 재구성 단계까지 가야 진행분이 파일로 남는다.
    // 캐시 조회/저장도 이 안에서 한다(= 이어하기).
    const stats = await translateSegments(segments, options, {
      docId,
      isQuotaExhausted: async () => {
        const usage = await getQuotaUsage();
        return usage.usableKeyCount === 0;
      },
      // stats는 아래 const에 아직 바인딩되기 전이라(TDZ) 여기서 참조하면 안 된다.
      // translateSegments가 콜백 인자로 그때그때의 통계를 넘겨준다.
      onBatch: async ({ processed, total, batchIndex, batchTotal, stats: live }) => {
        await setPdfStatus({
          stage: "translate", segDone: processed, segTotal: total,
          batchIndex, batchTotal, degraded: live.degraded, success: live.success,
          cacheHits: live.cacheHits,
        });
      },
    });
    stats.ocrPages = ocrPages;
    stats.ocrSegments = ocrSegments;

    // ---- 3. 재구성 ----
    const translatedAny = segments.some((s) => s.translated && s.translated !== s.text);
    if (!translatedAny) {
      await patchPdfRun({ runId, status: "failed", stats });
      await addLog("[PDF] 번역된 세그먼트가 없어 결과 파일을 만들지 않았습니다.", "error");
      return { ...toSummary(stats), runId };
    }

    await addLog("[PDF] 번역문을 원본에 삽입하는 중입니다.");
    await setPdfStatus({ stage: "render", cacheHits: stats.cacheHits }, true);
    await updateProgress({ processed: stats.total, total: stats.total, batchIndex: 0, batchTotal: 0 }, { force: true });

    const rendered = await callEngine("render", { docId, runId, segments, options });

    // 남은 구간이 있는 실행은 partial로 남긴다. 화면이 이 상태를 보고 '이어하기'를 띄운다.
    const incomplete = stats.cancelled || stats.quotaExhausted || stats.degraded > 0;
    await patchPdfRun({
      runId, status: incomplete ? "partial" : "done",
      outId: rendered.outId, outName: rendered.outName,
      stats: { ...stats, ...rendered }, finishedAt: Date.now(),
    });
    await setPdfStatus(
      { stage: "done", outId: rendered.outId, outName: rendered.outName, cacheHits: stats.cacheHits },
      true
    );
    await addLog(
      `[PDF] 완료: ${rendered.pagesRendered}쪽 재구성, ${Math.round(rendered.outputBytes / 1024)}KB ` +
      `(원문유지 ${stats.degraded}개${rendered.overflowCount ? `, 넘침 ${rendered.overflowCount}개` : ""})`
    );

    return { ...toSummary(stats), runId, outId: rendered.outId, outName: rendered.outName };
  } catch (e) {
    await patchPdfRun({ runId, status: "error", error: String((e && e.message) || e) });
    await setPdfStatus({ stage: "error", error: String((e && e.message) || e) }, true);
    throw e;
  } finally {
    off();
    // 캐시가 무한히 자라지 않게 상한을 넘은 만큼 걷어낸다.
    await trimSegCache();
    // WASM 힙을 계속 붙들고 있을 이유가 없다. 다음 작업 때 다시 띄운다.
    await shutdownEngine();
  }
}

// 번역 대상이 0개일 때 사용자가 다음에 무엇을 할 수 있는지 알려준다.
// "텍스트가 없습니다"만 남기면 스캔본인지, OCR이 꺼져 있는지, 언어 데이터가 없는지 알 수 없다.
function emptyReason(extracted, options) {
  if (extracted.ocrError) return `OCR을 쓸 수 없습니다: ${extracted.ocrError}`;
  if (extracted.scannedPages && options.ocrMode === "off") {
    return "스캔된 이미지 PDF로 보입니다. 세부 설정에서 '스캔본 OCR'을 켜고 다시 시도하세요.";
  }
  if (extracted.ocrPages) {
    return "OCR이 글자를 찾지 못했습니다. OCR 언어 설정과 해상도(DPI)를 확인하세요.";
  }
  return "선택한 페이지 범위에 번역할 문장이 없습니다.";
}

// job_runner가 기대하는 요약 형태로 맞춘다.
function toSummary(stats) {
  return {
    total: stats.total,
    success: stats.success,
    failMessages: stats.failMessages,
    requestsUsed: stats.requestsUsed,
    cancelled: stats.cancelled,
    quotaExhausted: stats.quotaExhausted,
    degraded: stats.degraded,
    cacheHits: stats.cacheHits || 0,
    ocrPages: stats.ocrPages || 0,
    ocrSegments: stats.ocrSegments || 0,
  };
}

export { runPdfTranslation, normalizePdfOptions, DEFAULT_OPTIONS };
