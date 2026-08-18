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

// 단계 이름. 번호는 붙여두지 않는다 - OCR 단계는 스캔본에서만 끼어들기 때문에
// 화면에 실제로 그릴 단계 목록이 정해진 다음에 번호를 매긴다.
const STAGE_NAME = {
  extract: "추출",
  ocr: "OCR",
  translate: "번역",
  render: "재구성",
};

const STAGE_TITLE = { ...STAGE_NAME, done: "완료", error: "오류" };

const STAGE_NUMBER = ["①", "②", "③", "④"];

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

// job_registry는 오류를 i18n 키로 돌려주는데(errorAlreadyRunning 등) 사이드패널 워크스페이스에는
// i18n 헬퍼가 없다. 키가 그대로 토스트에 찍히지 않게 여기서 바꿔준다.
const JOB_MESSAGES = {
  errorAlreadyRunning: "다른 작업이 이미 실행 중입니다. 끝난 뒤에 다시 시도하세요.",
};

function jobErrorText(res, fallback) {
  return res.error || JOB_MESSAGES[res.messageKey] || res.messageKey || fallback;
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

            <div class="pdf-field-grid">
              <div class="pdf-field">
                <label class="pdf-field-label" for="pdfOcrMode">스캔본 OCR</label>
                <select class="settings-select-compact" id="pdfOcrMode">
                  <option value="auto">자동 (텍스트 없는 쪽만)</option>
                  <option value="off">끄기</option>
                  <option value="force">강제 (모든 쪽을 OCR)</option>
                </select>
              </div>
              <div class="pdf-field">
                <label class="pdf-field-label" for="pdfOcrDpi">OCR 해상도(DPI)</label>
                <input type="number" class="pdf-input" id="pdfOcrDpi" min="150" max="400" step="50" value="300">
              </div>
            </div>
            <div class="pdf-field">
              <label class="pdf-field-label" for="pdfGlossaryProfile">
                용어집 <span class="pdf-hint">번역할 때 반드시 지킬 용어</span>
              </label>
              <select class="settings-select-compact" id="pdfGlossaryProfile">
                <option value="">사용 안 함</option>
              </select>
            </div>

            <div class="pdf-field">
              <label class="pdf-field-label" for="pdfOcrLangs">
                OCR 언어 <span class="pdf-hint">비우면 원문 언어에서 추정</span>
              </label>
              <input type="text" class="pdf-input" id="pdfOcrLangs" placeholder="예: kor+eng">
            </div>

            <div class="pdf-field">
              <label class="checkbox-label">
                <input type="checkbox" id="pdfUseCache" checked>
                <span>번역 캐시 사용 (중단된 작업 이어하기)</span>
              </label>
              <div class="pdf-cache-row">
                <span class="pdf-hint" id="pdfCacheStat">캐시를 확인하는 중...</span>
                <button class="btn-small" id="btnPdfClearCache">캐시 비우기</button>
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
  refreshCacheStat();
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
  pdfOcrMode: "ocrMode",
  pdfOcrLangs: "ocrLangs",
  pdfOcrDpi: "ocrDpi",
  pdfGlossaryProfile: "glossaryProfileId",
  pdfUseCache: "useCache",
};

// 문자열이 아닌 값으로 읽어야 하는 필드. 기본값은 서비스워커에서 다시 한 번 정리되지만
// (normalizePdfOptions) 화면에서 NaN을 보내면 저장된 마지막 값이 NaN으로 굳는다.
const NUMBER_FIELDS = { fontScale: 1, ocrDpi: 300 };
const BOOLEAN_FIELDS = new Set(["useCache"]);

// 용어집 프로필 목록을 채운다. 목록이 오기 전에 저장값을 복원하면 select에 그 option이
// 아직 없어서 빈 값으로 떨어진다. 그래서 목록을 채운 뒤 값을 한 번 더 맞춘다.
function fillGlossaryOptions() {
  const select = $("pdfGlossaryProfile");
  if (!select) return;
  sendMessage({ action: "pdf.listGlossaries" }).then((res) => {
    const profiles = (res.ok && res.profiles) || [];
    const wanted = select.dataset.wanted || select.value;
    select.innerHTML =
      `<option value="">사용 안 함</option>` +
      profiles
        .map(
          (p) =>
            `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${p.entryCount}개)</option>`
        )
        .join("");
    if (wanted && profiles.some((p) => p.id === wanted)) select.value = wanted;
  });
}

function bindOptions() {
  // 마지막에 쓴 값을 그대로 되살린다. 매번 다시 고르게 하면 번거롭다.
  chrome.storage.local.get(["pdfLastOptions"], (res) => {
    const saved = res.pdfLastOptions || {};
    for (const [id, key] of Object.entries(OPTION_FIELDS)) {
      const el = $(id);
      if (!el) continue;
      if (BOOLEAN_FIELDS.has(key)) {
        // 저장된 값이 없으면 마크업의 기본값(켜짐)을 그대로 둔다.
        if (saved[key] !== undefined) el.checked = saved[key] !== false;
      } else if (saved[key] !== undefined && saved[key] !== "") {
        // 용어집 목록은 비동기로 채워진다. 원하는 값을 적어두고 목록이 온 뒤 맞춘다.
        if (id === "pdfGlossaryProfile") el.dataset.wanted = saved[key];
        el.value = saved[key];
      }
    }
    fillGlossaryOptions();
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
    if (BOOLEAN_FIELDS.has(key)) out[key] = !!el.checked;
    else if (key in NUMBER_FIELDS) out[key] = Number(el.value) || NUMBER_FIELDS[key];
    else out[key] = el.value;
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
      showSettingsToast(jobErrorText(res, "번역을 시작하지 못했습니다."));
      return;
    }
    showSettingsToast("번역을 시작했습니다.");
    refreshFromStorage();
  });

  $("btnPdfStop")?.addEventListener("click", async () => {
    await sendMessage({ action: "cancelJob" });
    showSettingsToast("중지를 요청했습니다. 진행분까지는 파일로 만들어지고, 나중에 이어할 수 있습니다.");
  });

  $("btnPdfRefreshRuns")?.addEventListener("click", refreshRuns);

  $("btnPdfClearCache")?.addEventListener("click", async () => {
    const res = await sendMessage({ action: "pdf.clearCache" });
    if (!res.ok) {
      showSettingsToast(res.error || "캐시를 비우지 못했습니다.");
      return;
    }
    showSettingsToast(`번역 캐시 ${res.cleared || 0}건을 비웠습니다.`);
    refreshCacheStat();
  });
}

async function refreshCacheStat() {
  const el = $("pdfCacheStat");
  if (!el) return;
  const res = await sendMessage({ action: "pdf.cacheStats" });
  el.textContent = res.ok
    ? `저장된 번역 ${(res.count || 0).toLocaleString()}건 · 같은 문서를 다시 돌리면 여기서 재사용합니다`
    : "캐시 상태를 읽지 못했습니다.";
}

// 끊긴 실행을 이어한다. 이미 번역한 세그먼트는 캐시에서 나오므로 남은 구간만 API를 쓴다.
async function resumeRun(runId) {
  const res = await sendMessage({ action: "pdf.resumeRun", runId });
  if (!res.ok) {
    showSettingsToast(jobErrorText(res, "이어하기를 시작하지 못했습니다."));
    return;
  }
  showSettingsToast("이어서 번역을 시작했습니다. 이미 번역한 부분은 다시 요청하지 않습니다.");
  refreshFromStorage();
  refreshRuns();
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
      if (!$("pdfStatusCard")) return;
      refreshFromStorage();
      // 작업이 끝나면 최근 목록과 캐시 통계도 새로 읽는다. 이어하기 버튼은 실행 기록의
      // status에서 나오므로, 여기서 갱신하지 않으면 새로고침을 눌러야 보인다.
      const status = changes.jobStatus && changes.jobStatus.newValue;
      if (status && status !== "running") {
        refreshRuns();
        refreshCacheStat();
      }
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
  // OCR 칸은 실제로 OCR을 돌린 실행에서만 보여준다. 텍스트 PDF에서 늘 비어 있는 칸을
  // 띄우면 무언가 건너뛴 것처럼 읽힌다.
  const stages = ["extract"];
  if (p.ocrTotal || p.stage === "ocr") stages.push("ocr");
  stages.push("translate", "render");

  const currentIdx = stages.indexOf(p.stage);

  const el = $("pdfStages");
  if (el) {
    el.innerHTML = stages
      .map((s, i) => {
        const done = p.stage === "done" || (currentIdx >= 0 && i < currentIdx);
        const active = p.stage === s;
        const cls = done ? "is-done" : active ? "is-active" : "";
        const label = `${STAGE_NUMBER[i] || ""} ${STAGE_NAME[s]}`.trim();
        return `<span class="pdf-stage ${cls}">${escapeHtml(label)}</span>`;
      })
      .join("");
  }

  const title = $("pdfStageTitle");
  if (title) title.textContent = STAGE_TITLE[p.stage] || "진행 상황";

  let pct = 0;
  let counts = "";
  if (p.stage === "extract") {
    pct = p.pageTotal ? Math.round((p.page / p.pageTotal) * 100) : 0;
    counts = p.pageTotal ? `${p.page || 0}/${p.pageTotal}쪽` : "";
  } else if (p.stage === "ocr") {
    pct = p.pageTotal ? Math.round((p.page / p.pageTotal) * 100) : 0;
    counts = p.pageTotal ? `${p.page || 0}/${p.pageTotal}쪽 인식` : "";
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
    const cached = p.cacheHits ? ` · 캐시 재사용 ${p.cacheHits}` : "";
    if (p.stage === "error") status.textContent = `오류: ${p.error || "원인 불명"}`;
    else if (p.stage === "ocr") status.textContent = `스캔된 쪽을 읽는 중...${cached}`;
    else if (p.batchTotal) {
      const extra = p.degraded ? ` · 원문유지 ${p.degraded}` : "";
      status.textContent = `배치 ${p.batchIndex}/${p.batchTotal}${extra}${cached}`;
    } else if (running) status.textContent = `처리 중...${cached}`;
    else status.textContent = cached ? cached.replace(" · ", "") : "";
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
  const runId = summary.runId || p?.runId;

  card.style.display = "";
  body.innerHTML = `
    ${
      partial
        ? `<div class="pdf-warn">일부만 번역되었습니다. 번역되지 않은 부분은 원문이 그대로 남아 있습니다.
             '이어하기'를 누르면 번역된 부분은 다시 요청하지 않고 남은 구간만 이어서 처리합니다.</div>`
        : ""
    }
    <div class="pdf-result-row">
      <span class="pdf-result-name">${escapeHtml(name)}</span>
      <span class="pdf-result-actions">
        ${
          runId && (partial || summary.degraded)
            ? `<button class="btn-small pdf-btn-resume" data-run="${escapeHtml(runId)}">이어하기</button>`
            : ""
        }
        <button class="btn btn-small pdf-btn-download" id="btnPdfDownload" data-out="${escapeHtml(outId)}">내려받기</button>
      </span>
    </div>
    <div class="pdf-hint">
      번역 ${summary.success || 0} / 전체 ${summary.total || 0}
      ${summary.cacheHits ? ` · 캐시 재사용 ${summary.cacheHits}` : ""}
      ${summary.degraded ? ` · 원문유지 ${summary.degraded}` : ""}
      ${summary.ocrPages ? ` · OCR ${summary.ocrPages}쪽` : ""}
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
  body.querySelector(".pdf-btn-resume")?.addEventListener("click", (e) => resumeRun(e.currentTarget.dataset.run));
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
      // 완료된 실행 말고는 모두 이어할 수 있다. 워커가 죽어 'running'으로 굳은 기록도 여기 들어온다
      // (진짜로 실행 중이면 job_registry가 "이미 실행 중"으로 막아준다).
      const resumable = r.status !== "done" && r.status !== "empty" && !!r.docId;
      const detail = [
        r.stats && r.stats.cacheHits ? `캐시 ${r.stats.cacheHits}` : "",
        r.stats && r.stats.degraded ? `원문유지 ${r.stats.degraded}` : "",
        r.stats && r.stats.ocrPages ? `OCR ${r.stats.ocrPages}쪽` : "",
        r.resumedFrom ? "이어한 실행" : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <div class="pdf-run-row">
          <div class="pdf-run-main">
            <span class="pdf-run-name">${escapeHtml(r.name || r.docId || "")}</span>
            <span class="pdf-hint">${escapeHtml(when)}${detail ? ` · ${escapeHtml(detail)}` : ""}</span>
          </div>
          <span class="pdf-run-badge is-${escapeHtml(r.status || "error")}">${badge}</span>
          ${
            resumable
              ? `<button class="btn-small pdf-run-resume" data-run="${escapeHtml(r.runId)}">이어하기</button>`
              : ""
          }
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
  box.querySelectorAll(".pdf-run-resume").forEach((btn) => {
    btn.addEventListener("click", () => resumeRun(btn.dataset.run));
  });
}

export { renderPdfWorkspace };
