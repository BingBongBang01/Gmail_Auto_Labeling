// bg/features/pdf/index.js
// PDF 번역 기능의 등록부. bg/features/youtube/index.js 와 같은 모양이다.

import { registerAction } from "../../core/message_router.js";
import { registerJob, startJob } from "../../core/job_registry.js";
import { hasUsableAiCredential } from "../../platform/ai_gateway.js";
import {
  getPdfDoc,
  getPdfRun,
  listPdfRuns,
  deletePdfDoc,
  countSegCache,
  clearSegCache,
  newId,
} from "../../../shared/pdf_db.js";
import { attachEnginePort, callEngine, shutdownEngine, PORT_NAME } from "./engine_port.js";
import { runPdfTranslation, normalizePdfOptions } from "./pipeline.js";
import { loadGlossaries, resolveGlossaryText } from "../../../shared/glossary_store.js";
import { parseGlossaryText } from "../../../pdf/text/glossary.js";

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

  registerAction("pdf.ocrSelftest", async (request) => {
    try {
      return await callEngine("ocrSelftest", { langs: request.langs, dpi: request.dpi });
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e), stack: String((e && e.engineStack) || "") };
    } finally {
      await shutdownEngine();
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

  // ---- 이어하기 / 캐시 ----
  // 끊긴 실행을 같은 문서·같은 옵션으로 다시 돌린다. 이미 번역한 세그먼트는 캐시에서 나오므로
  // 남은 구간만 API를 쓴다. 새 runId를 발급하고 resumedFrom으로 원래 실행을 가리킨다 -
  // 옛 기록을 덮어쓰면 어디까지 갔었는지가 사라진다.
  registerAction("pdf.resumeRun", async (request) => {
    const run = await getPdfRun(String(request.runId || ""));
    if (!run) return { ok: false, error: "이어할 실행 기록을 찾을 수 없습니다." };
    // 옛 기록에는 docId가 없다(이 필드를 저장하기 전에 만들어진 것).
    if (!run.docId) return { ok: false, error: "이 기록에는 원본 문서 정보가 없어 이어할 수 없습니다." };

    const doc = await getPdfDoc(run.docId);
    if (!doc) {
      return { ok: false, error: "원본 PDF가 남아 있지 않습니다. 파일을 다시 선택해 주세요." };
    }

    return await startJob("pdf_translate", {
      docId: run.docId,
      options: run.options || {},
      resumedFrom: run.runId,
    });
  });

  registerAction("pdf.cacheStats", async () => ({ ok: true, count: await countSegCache() }));

  // 번역 화면의 '용어집 프로필' 목록. 화면이 저장소를 직접 읽어도 되지만,
  // 실제로 프롬프트에 들어갈 항목 수를 함께 알려주려면 파싱이 필요하다.
  registerAction("pdf.listGlossaries", async () => {
    const { profiles, activeId } = await loadGlossaries();
    return {
      ok: true,
      activeId,
      profiles: profiles.map((p) => ({
        id: p.id,
        name: p.name,
        entryCount: parseGlossaryText(p.text).entries.length,
        updatedAt: p.updatedAt,
      })),
    };
  });

  registerAction("pdf.clearCache", async () => {
    const count = await countSegCache();
    await clearSegCache();
    return { ok: true, cleared: count };
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

      // 고른 용어집 프로필을 지금 텍스트로 바꿔 넣는다. 화면이 텍스트를 직접 보내지 않는
      // 이유: 이어하기(pdf.resumeRun)는 저장된 옵션을 그대로 다시 쓰는데, 그때 옛 용어집
      // 텍스트가 박혀 있으면 그 사이 고친 용어집이 반영되지 않는다. 프로필 id만 저장하고
      // 실행할 때마다 최신 내용을 읽는다.
      if (options.glossaryProfileId) {
        options.glossaryText = await resolveGlossaryText(options.glossaryProfileId);
      }

      const runId = payload.runId || newId("run");
      const resumedFrom = payload.resumedFrom || null;

      return {
        run: () => runPdfTranslation({ runId, docId, options, resumedFrom }),
        response: { ok: true, started: true, runId, docName: doc.name, resumedFrom },
        notifyTitleParams: [doc.name],
      };
    },
  });
}

export { register };
