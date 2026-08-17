// bg/features/pdf/index.js
// PDF 번역 기능의 등록부. bg/features/youtube/index.js 와 같은 모양이다.

import { registerAction } from "../../core/message_router.js";
import { registerJob } from "../../core/job_registry.js";
import { hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { getPdfDoc, listPdfRuns, deletePdfDoc, newId } from "../../../shared/pdf_db.js";
import { attachEnginePort, callEngine, shutdownEngine, PORT_NAME } from "./engine_port.js";
import { runPdfTranslation, normalizePdfOptions } from "./pipeline.js";

function register() {
  // 오프스크린 문서가 connect해 오는 지점. 반드시 동기 등록해야 한다
  // (background.js 헤더: 리스너는 파일 평가 중에 걸려야 이벤트를 놓치지 않는다).
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name === PORT_NAME) attachEnginePort(port);
  });

  // ---- 진단 ----
  registerAction("pdf.selftest", async () => {
    try {
      return await callEngine("selftest");
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), stack: String((e && e.engineStack) || "") };
    }
  });

  registerAction("pdf.shutdownEngine", async () => {
    await shutdownEngine();
    return { ok: true };
  });

  // ---- 화면이 쓰는 조회 ----
  // 파일을 고른 직후 쪽수를 보여주기 위한 것. 번역과 별개로 가볍게 연다.
  registerAction("pdf.probe", async (request) => {
    try {
      return await callEngine("probe", { docId: request.docId });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    } finally {
      await shutdownEngine();
    }
  });

  registerAction("pdf.listRuns", async (request) => ({
    ok: true,
    runs: await listPdfRuns(request.limit || 10),
  }));

  registerAction("pdf.deleteDoc", async (request) => {
    await deletePdfDoc(request.docId);
    return { ok: true };
  });

  // ---- 번역 작업 ----
  registerJob("pdf_translate", {
    aliases: ["pdf.translate", "docs_translate"],
    jobKind: "pdfTranslate",
    notifyTitleKey: "notifyTitlePdfTranslate",
    resolve: async (payload, settings) => {
      const docId = String((payload && payload.docId) || "");
      if (!docId) return { error: "번역할 PDF 파일을 먼저 선택해 주세요." };

      // resolve는 await 되므로(job_registry.js) 여기서 IndexedDB를 봐도 된다.
      const doc = await getPdfDoc(docId);
      if (!doc) return { error: "선택한 PDF를 찾을 수 없습니다. 파일을 다시 선택해 주세요." };

      if (!(await hasUsableAiCredential())) {
        return { error: "등록된 AI API 키가 없습니다. 설정 > AI 공급자에서 키를 추가하세요." };
      }

      const options = normalizePdfOptions(payload.options, settings.pdf);
      const runId = payload.runId || newId("run");

      return {
        run: () => runPdfTranslation({ runId, docId, options }),
        response: { ok: true, started: true, runId, docName: doc.name },
        notifyTitleParams: [doc.name],
      };
    },
  });
}

export { register };
