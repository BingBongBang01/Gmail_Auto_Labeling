// sidepanel/workspaces/pdf.js
// 문서 번역 워크스페이스. 상단바 "문서" 서비스의 '문서번역' 타일이 이 화면을 연다.
//
// 이 화면은 자기 모듈 상태를 믿으면 안 된다. 사이드패널은 사용자가 다른 서비스로
// 옮기거나 패널을 닫으면 통째로 파괴되는데, 번역 작업은 서비스워커에서 계속 돈다.
// 그래서 렌더할 때마다 chrome.storage.local(jobStatus/pdfProgress)과 IndexedDB에서
// 상태를 다시 읽어와 그린다. youtube.js가 loadedComments를 모듈 변수에 들고 있다가
// 그냥 잃어버리는 것과 다른 점이다.

import { $, escapeHtml } from "../ui/dom.js";
import { updateContextUI } from "../ui/context.js";
import { showSettingsToast } from "../ui/feedback.js";
import { putPdfDoc, getPdfOutput, newId } from "../../shared/pdf_db.js";

// 선택된 문서(파일을 고른 직후에만 의미가 있다. 작업 상태는 storage가 진실이다.)
let picked = null; // { docId, name, size, pageCount }
let storageListenerBound = false;
let objectUrl = null;

const TARGET_LANGS = ["한국어", "English", "日本語", "中文(简体)", "中文(繁體)", "Español", "Français", "Deutsch"];
const SOURCE_LANGS = ["자동 인식", "English", "한국어", "日本語", "中文(简体)", "Español", "Français", "Deutsch"];

const STAGE_LABEL = {
  extract: "① 추출",
  translate: "② 번역",
  render: "③ 재구성",
  done: "완료",
  error: "오류",
};

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "응답이 없습니다." });
    });
  });
}

function fmtBytes(n) {
  if (!n) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// 렌더
// ---------------------------------------------------------------------------

function renderPdfWorkspace() {
  const container = $("panelContainer");
  if (!container) return;
  container.innerHTML = "";

  updateContextUI({
    service: "문서",
    pageType: "pdf_translate",
    title: "문서 번역",
    desc: "PDF를 레이아웃 그대로 두고 본문만 번역합니다.",
  });

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-workspace";
  wrapper.innerHTML = `
    <div class="pdf-section-card">
      <div class="pdf-section-head">
        <span class="pdf-section-title">📄 원본 PDF</span>
        <span class="pdf-hint" id="pdfDocMeta"></span>
      </div>
      <div class="pdf-dropzone" id="pdfDropzone" tabindex="0" role="button">
        <div class="pdf-dropzone-icon">⬆️</div>
        <div class="pdf-dropzone-text" id="pdfDropText">PDF를 끌어다 놓거나 눌러서 선택</div>
      </div>
      <input type="file" id="pdfFileInput" accept="application/pdf,.pdf" style="display:none;">
    </div>

    <div class="pdf-section-card">
      <div class="pdf-section-head"><span class="pdf-section-title">🌐 번역 설정</span></div>
      <div class="pdf-section-body">
        <div class="pdf-field-grid">
          <div class="pdf-field">
            <label class="pdf-field-label" for="pdfSourceLang">원문 언어</label>
            <select class="settings-select-compact" id="pdfSourceLang">
              ${SOURCE_LANGS.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}
            </select>
          </div>
          <div class="pdf-field">
            <label class="pdf-field-label" for="pdfTargetLang">번역 언어</label>
            <select class="settings-select-compact" id="pdfTargetLang">
              ${TARGET_LANGS.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("")}
            </select>
          </div>
        </div>

        <div class="pdf-field">
          <label class="pdf-field-label" for="pdfPageRange">페이지 범위 <span class="pdf-hint">비우면 전체</span></label>
          <input type="text" class="pdf-input" id="pdfPageRange" placeholder="예: 1-5, 8, 12-">
        </div>

        <details class="pdf-advanced">
          <summary>세부 설정</summary>
          <div class="pdf-section-body">
            <div class="pdf-field">
              <label class="pdf-field-label" for="pdfDocType">문서 유형</label>
              <input type="text" class="pdf-input" id="pdfDocType" placeholder="technical documentation">
            </div>
            <div class="pdf-field">
              <label class="pdf-field-label" for="pdfStyle">문체</label>
              <input type="text" class="pdf-input" id="pdfStyle" placeholder="formal, professional">
            </div>
            <div class="pdf-field">
              <label class="pdf-field-label" for="pdfInstructions">추가 지시사항</label>
              <textarea class="pdf-input pdf-textarea" id="pdfInstructions" rows="2"
                placeholder="이 문서에만 적용할 번역 지침"></textarea>
            </div>
            <div class="pdf-field-grid">
              <div class="pdf-field">
                <label class="pdf-field-label" for="pdfPromptProfile">프롬프트</label>
                <select class="settings-select-compact" id="pdfPromptProfile">
                  <option value="compact">간결 (권장 · 토큰 절약)</option>
                  <option value="full">전체 (품질 우선 · 토큰 많이 씀)</option>
                </select>
              </div>
              <div class="pdf-field">
                <label class="pdf-field-label" for="pdfFontScale">글자 크기 배율</label>
                <input type="number" class="pdf-input" id="pdfFontScale" min="0.5" max="2" step="0.05" value="1">
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>

    <div class="pdf-actions">
      <button class="btn btn-primary pdf-btn-run" id="btnPdfTranslate" disabled>번역 시작</button>
      <button class="btn btn-small" id="btnPdfStop" style="display:none;">중지</button>
    </div>

    <div class="pdf-section-card pdf-status-card" id="pdfStatusCard" style="display:none;">
      <div class="pdf-section-head">
        <span class="pdf-section-title" id="pdfStageTitle">진행 상황</span>
        <span class="pdf-hint" id="pdfStageCounts"></span>
      </div>
      <div class="pdf-stages" id="pdfStages"></div>
      <div class="pdf-progress-track"><div class="pdf-progress-fill" id="pdfProgressFill"></div></div>
      <div class="pdf-status-text" id="pdfStatusText"></div>
    </div>

    <div class="pdf-section-card" id="pdfResultCard" style="display:none;">
      <div class="pdf-section-head"><span class="pdf-section-title">✅ 결과</span></div>
      <div class="pdf-section-body" id="pdfResultBody"></div>
    </div>

    <div class="pdf-section-card">
      <div class="pdf-section-head">
        <span class="pdf-section-title">🕘 최근 번역</span>
        <button class="btn-small" id="btnPdfRefreshRuns">새로고침</button>
      </div>
      <div class="pdf-runs" id="pdfRuns"><div class="pdf-hint">불러오는 중...</div></div>
    </div>
  `;

  container.appendChild(wrapper);

  bindPicker();
  bindOptions();
  bindActions();
  bindStorage();

  refreshFromStorage();
  refreshRuns();
}

// ---------------------------------------------------------------------------
// 파일 선택
// ---------------------------------------------------------------------------

function bindPicker() {
  const zone = $("pdfDropzone");
  const input = $("pdfFileInput");
  if (!zone || !input) return;

  zone.addEventListener("click", () => input.click());
  zone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });

  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("is-over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("is-over");
    })
  );
  zone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) acceptFile(file);
  });

  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) acceptFile(file);
  });
}

async function acceptFile(file) {
  if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
    showSettingsToast("PDF 파일만 선택할 수 있습니다.");
    return;
  }

  const text = $("pdfDropText");
  if (text) text.textContent = "파일을 읽는 중...";

  try {
    // 바이트는 메시지에 실을 수 없다(JSON 직렬화). IndexedDB에 넣고 id만 넘긴다.
    const docId = newId("doc");
    await putPdfDoc({
      docId,
      name: file.name,
      size: file.size,
      blob: file,
      addedAt: Date.now(),
    });

    picked = { docId, name: file.name, size: file.size, pageCount: null };
    paintPicked();

    // 쪽수는 엔진을 잠깐 띄워서 알아온다. 실패해도 번역 자체는 가능하다.
    const probe = await sendMessage({ action: "pdf.probe", docId });
    if (probe.ok && probe.pageCount) {
      picked.pageCount = probe.pageCount;
      paintPicked();
    }
  } catch (e) {
    if (text) text.textContent = "PDF를 끌어다 놓거나 눌러서 선택";
    showSettingsToast(`파일을 읽지 못했습니다: ${(e && e.message) || e}`);
  }
}

function paintPicked() {
  const text = $("pdfDropText");
  const meta = $("pdfDocMeta");
  const btn = $("btnPdfTranslate");
  if (!picked) return;

  if (text) text.textContent = picked.name;
  if (meta) {
    meta.textContent = picked.pageCount
      ? `${picked.pageCount}쪽 · ${fmtBytes(picked.size)}`
      : fmtBytes(picked.size);
  }
  if (btn) btn.disabled = false;
  $("pdfDropzone")?.classList.add("has-file");
}

// ---------------------------------------------------------------------------
// 옵션
// ---------------------------------------------------------------------------

const OPTION_FIELDS = {
  pdfSourceLang: "sourceLang",
  pdfTargetLang: "targetLang",
  pdfPageRange: "pageRange",
  pdfDocType: "docType",
  pdfStyle: "style",
  pdfInstructions: "instructions",
  pdfPromptProfile: "promptProfile",
  pdfFontScale: "fontScale",
};

function bindOptions() {
  // 마지막에 쓴 값을 그대로 되살린다. 매번 다시 고르게 하면 번거롭다.
  chrome.storage.local.get(["pdfLastOptions"], (res) => {
    const saved = res.pdfLastOptions || {};
    for (const [id, key] of Object.entries(OPTION_FIELDS)) {
      const el = $(id);
      if (el && saved[key] !== undefined && saved[key] !== "") el.value = saved[key];
    }
  });

  for (const id of Object.keys(OPTION_FIELDS)) {
    $(id)?.addEventListener("change", () => {
      chrome.storage.local.set({ pdfLastOptions: collectOptions() });
    });
  }
}

function collectOptions() {
  const out = {};
  for (const [id, key] of Object.entries(OPTION_FIELDS)) {
    const el = $(id);
    if (!el) continue;
    out[key] = key === "fontScale" ? Number(el.value) || 1 : el.value;
  }
  if (out.sourceLang === "자동 인식") out.sourceLang = "auto";
  return out;
}

// ---------------------------------------------------------------------------
// 실행 / 중지
// ---------------------------------------------------------------------------

function bindActions() {
  $("btnPdfTranslate")?.addEventListener("click", async () => {
    if (!picked) {
      showSettingsToast("먼저 PDF를 선택하세요.");
      return;
    }
    const btn = $("btnPdfTranslate");
    if (btn) btn.disabled = true;

    const res = await sendMessage({
      action: "job.start",
      jobType: "pdf_translate",
      payload: { docId: picked.docId, options: collectOptions() },
    });

    if (!res.ok) {
      if (btn) btn.disabled = false;
      showSettingsToast(res.error || res.messageKey || "번역을 시작하지 못했습니다.");
      return;
    }
    showSettingsToast("번역을 시작했습니다.");
    refreshFromStorage();
  });

  $("btnPdfStop")?.addEventListener("click", async () => {
    await sendMessage({ action: "cancelJob" });
    showSettingsToast("중지를 요청했습니다. 진행분까지는 파일로 만들어집니다.");
  });

  $("btnPdfRefreshRuns")?.addEventListener("click", refreshRuns);
}

// ---------------------------------------------------------------------------
// 상태 반영
// ---------------------------------------------------------------------------

function bindStorage() {
  if (storageListenerBound) return;
  storageListenerBound = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.pdfProgress || changes.jobStatus || changes.jobResult) {
      // 화면이 이미 다른 워크스페이스로 바뀌었으면 조용히 무시된다.
      if ($("pdfStatusCard")) refreshFromStorage();
    }
  });
}

function refreshFromStorage() {
  chrome.storage.local.get(["jobStatus", "jobKind", "jobResult", "pdfProgress"], (res) => {
    const isPdfJob = res.jobKind === "pdfTranslate";
    const running = isPdfJob && res.jobStatus === "running";
    const p = (isPdfJob && res.pdfProgress) || null;

    const card = $("pdfStatusCard");
    const stopBtn = $("btnPdfStop");
    const runBtn = $("btnPdfTranslate");

    if (stopBtn) stopBtn.style.display = running ? "" : "none";
    if (runBtn) runBtn.disabled = running || !picked;

    if (!p) {
      if (card) card.style.display = "none";
      return;
    }

    if (card) card.style.display = "";
    paintStages(p, running);

    if (!running && isPdfJob && res.jobResult) paintResult(res.jobResult, res.jobStatus, p);
    else if (running) {
      const rc = $("pdfResultCard");
      if (rc) rc.style.display = "none";
    }
  });
}

function paintStages(p, running) {
  const stages = ["extract", "translate", "render"];
  const currentIdx = stages.indexOf(p.stage);

  const el = $("pdfStages");
  if (el) {
    el.innerHTML = stages
      .map((s, i) => {
        const done = p.stage === "done" || (currentIdx >= 0 && i < currentIdx);
        const active = p.stage === s;
        const cls = done ? "is-done" : active ? "is-active" : "";
        return `<span class="pdf-stage ${cls}">${escapeHtml(STAGE_LABEL[s])}</span>`;
      })
      .join("");
  }

  const title = $("pdfStageTitle");
  if (title) title.textContent = STAGE_LABEL[p.stage] || "진행 상황";

  let pct = 0;
  let counts = "";
  if (p.stage === "extract") {
    pct = p.pageTotal ? Math.round((p.page / p.pageTotal) * 100) : 0;
    counts = p.pageTotal ? `${p.page || 0}/${p.pageTotal}쪽` : "";
  } else if (p.stage === "translate") {
    pct = p.segTotal ? Math.round((p.segDone / p.segTotal) * 100) : 0;
    counts = p.segTotal ? `${p.segDone || 0}/${p.segTotal} 세그먼트` : "";
  } else if (p.stage === "render") {
    pct = p.pageTotal ? Math.round((p.page / p.pageTotal) * 100) : 50;
    counts = p.pageTotal ? `${p.page || 0}/${p.pageTotal}쪽` : "";
  } else if (p.stage === "done") {
    pct = 100;
  }

  const fill = $("pdfProgressFill");
  if (fill) fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  const cnt = $("pdfStageCounts");
  if (cnt) cnt.textContent = counts;

  const status = $("pdfStatusText");
  if (status) {
    if (p.stage === "error") status.textContent = `오류: ${p.error || "원인 불명"}`;
    else if (p.batchTotal) {
      const extra = p.degraded ? ` · 원문유지 ${p.degraded}` : "";
      status.textContent = `배치 ${p.batchIndex}/${p.batchTotal}${extra}`;
    } else if (running) status.textContent = "처리 중...";
    else status.textContent = "";
  }
}

function paintResult(summary, jobStatus, p) {
  const card = $("pdfResultCard");
  const body = $("pdfResultBody");
  if (!card || !body) return;

  const outId = summary.outId || p?.outId;
  if (!outId) {
    card.style.display = "";
    body.innerHTML = `<div class="pdf-error">결과 파일을 만들지 못했습니다. ${escapeHtml(
      (summary.failMessages && summary.failMessages[0]) || ""
    )}</div>`;
    return;
  }

  const name = summary.outName || p?.outName || "translated.pdf";
  const partial = jobStatus === "cancelled" || summary.cancelled || summary.quotaExhausted;

  card.style.display = "";
  body.innerHTML = `
    ${partial ? `<div class="pdf-warn">일부만 번역되었습니다. 번역되지 않은 부분은 원문이 그대로 남아 있습니다.</div>` : ""}
    <div class="pdf-result-row">
      <span class="pdf-result-name">${escapeHtml(name)}</span>
      <button class="btn btn-small pdf-btn-download" id="btnPdfDownload" data-out="${escapeHtml(outId)}">내려받기</button>
    </div>
    <div class="pdf-hint">
      번역 ${summary.success || 0} / 전체 ${summary.total || 0}
      ${summary.degraded ? ` · 원문유지 ${summary.degraded}` : ""}
      ${summary.requestsUsed ? ` · AI 요청 ${summary.requestsUsed}회` : ""}
    </div>
    ${
      summary.failMessages && summary.failMessages.length
        ? `<details class="pdf-advanced"><summary>실패한 세그먼트 ${summary.failMessages.length}건</summary>
             <pre class="pdf-fail-list">${escapeHtml(summary.failMessages.join("\n"))}</pre></details>`
        : ""
    }
  `;

  $("btnPdfDownload")?.addEventListener("click", (e) => downloadOutput(e.currentTarget.dataset.out));
}

async function downloadOutput(outId) {
  try {
    const rec = await getPdfOutput(outId);
    if (!rec) {
      showSettingsToast("결과 파일을 찾을 수 없습니다(정리되었을 수 있습니다).");
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(rec.blob);

    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = rec.name || "translated.pdf";
    a.click();
    showSettingsToast("내려받기를 시작했습니다.");
  } catch (e) {
    showSettingsToast(`내려받기 실패: ${(e && e.message) || e}`);
  }
}

// ---------------------------------------------------------------------------
// 최근 번역
// ---------------------------------------------------------------------------

async function refreshRuns() {
  const box = $("pdfRuns");
  if (!box) return;
  const res = await sendMessage({ action: "pdf.listRuns", limit: 8 });
  const runs = (res.ok && res.runs) || [];

  if (!runs.length) {
    box.innerHTML = `<div class="pdf-hint">아직 번역한 문서가 없습니다.</div>`;
    return;
  }

  box.innerHTML = runs
    .map((r) => {
      const when = r.updatedAt ? new Date(r.updatedAt).toLocaleString() : "";
      const badge =
        r.status === "done" ? "완료" : r.status === "partial" ? "일부" : r.status === "running" ? "진행중" : "실패";
      return `
        <div class="pdf-run-row">
          <div class="pdf-run-main">
            <span class="pdf-run-name">${escapeHtml(r.name || r.docId || "")}</span>
            <span class="pdf-hint">${escapeHtml(when)}</span>
          </div>
          <span class="pdf-run-badge is-${escapeHtml(r.status || "error")}">${badge}</span>
          ${
            r.outId
              ? `<button class="btn-small pdf-run-dl" data-out="${escapeHtml(r.outId)}">받기</button>`
              : ""
          }
        </div>`;
    })
    .join("");

  box.querySelectorAll(".pdf-run-dl").forEach((btn) => {
    btn.addEventListener("click", () => downloadOutput(btn.dataset.out));
  });
}

export { renderPdfWorkspace };
