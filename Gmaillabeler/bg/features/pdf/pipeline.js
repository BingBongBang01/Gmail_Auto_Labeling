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
};

function normalizePdfOptions(raw = {}, stored = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...(stored.translation || {}), ...(stored.processing || {}), ...raw };
  merged.batchChars = Math.max(200, Math.min(8000, Number(merged.batchChars) || 1500));
  merged.batchSegs = Math.max(1, Math.min(40, Number(merged.batchSegs) || 10));
  merged.fontScale = Math.max(0.5, Math.min(2, Number(merged.fontScale) || 1));
  return merged;
}

async function runPdfTranslation({ runId, docId, options }) {
  const doc = await getPdfDoc(docId);
  const docName = (doc && doc.name) || "document.pdf";

  await patchPdfRun({ runId, docId, status: "running", options, name: docName, startedAt: Date.now() });
  await setPdfStatus({ runId, docName, stage: "extract", segDone: 0, segTotal: 0 }, true);

  // 오프스크린에서 올라오는 페이지 단위 진행을 화면에 그대로 흘려준다.
  const off = onEngineEvent(async (msg) => {
    if (msg.evt === "extractProgress") {
      await setPdfStatus({ stage: "extract", page: msg.page, pageTotal: msg.pageCount, segTotal: msg.segCount });
    } else if (msg.evt === "renderProgress") {
      await setPdfStatus({ stage: "render", page: msg.page, pageTotal: msg.pageCount });
    }
  });

  try {
    // ---- 1. 추출 ----
    await addLog(`[PDF] '${docName}' 추출을 시작합니다.`);
    const extracted = await callEngine("extract", { docId, pageRange: options.pageRange });
    const segments = extracted.segments || [];
    const targetCount = segments.filter((s) => s.needsTranslation).length;

    await addLog(`[PDF] ${extracted.pageCount}쪽에서 세그먼트 ${segments.length}개(번역 대상 ${targetCount}개)를 찾았습니다.`);
    await setPdfStatus({ stage: "translate", segTotal: targetCount, segDone: 0, pageTotal: extracted.pageCount }, true);

    if (targetCount === 0) {
      await patchPdfRun({ runId, status: "empty" });
      await addLog("[PDF] 번역할 텍스트가 없습니다. 스캔된 이미지 PDF일 수 있습니다(OCR은 아직 미지원).", "warn");
      return {
        total: 0, success: 0, failMessages: ["번역할 텍스트를 찾지 못했습니다(이미지 PDF일 수 있음)."],
        requestsUsed: 0, cancelled: false, quotaExhausted: false, runId,
      };
    }

    // ---- 2. 번역 ----
    // translateSegments는 예외를 던지지 않는다. 중지/할당량 소진이어도 그때까지의
    // 결과를 들고 돌아온다 - 반드시 재구성 단계까지 가야 진행분이 파일로 남는다.
    const stats = await translateSegments(segments, options, {
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
        });
      },
    });

    // ---- 3. 재구성 ----
    const translatedAny = segments.some((s) => s.translated && s.translated !== s.text);
    if (!translatedAny) {
      await patchPdfRun({ runId, status: "failed", stats });
      await addLog("[PDF] 번역된 세그먼트가 없어 결과 파일을 만들지 않았습니다.", "error");
      return { ...toSummary(stats), runId };
    }

    await addLog("[PDF] 번역문을 원본에 삽입하는 중입니다.");
    await setPdfStatus({ stage: "render" }, true);
    await updateProgress({ processed: stats.total, total: stats.total, batchIndex: 0, batchTotal: 0 }, { force: true });

    const rendered = await callEngine("render", { docId, runId, segments, options });

    await patchPdfRun({
      runId, status: stats.cancelled ? "partial" : "done",
      outId: rendered.outId, outName: rendered.outName,
      stats: { ...stats, ...rendered }, finishedAt: Date.now(),
    });
    await setPdfStatus({ stage: "done", outId: rendered.outId, outName: rendered.outName }, true);
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
    // WASM 힙을 계속 붙들고 있을 이유가 없다. 다음 작업 때 다시 띄운다.
    await shutdownEngine();
  }
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
  };
}

export { runPdfTranslation, normalizePdfOptions, DEFAULT_OPTIONS };
