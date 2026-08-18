// sidepanel/workspaces/glossary.js
// 용어집 편집 화면.
//
// 번역 프롬프트는 처음부터 용어집을 받도록 되어 있었다({{glossary_data}}).
// 그런데 그 값을 넣을 화면이 없어서 늘 "(no glossary provided)"가 들어갔다.
// 프롬프트 쪽은 손대지 않고 입력 경로만 만든다.
//
// 표 편집기가 아니라 텍스트 상자인 이유: 용어집은 보통 스프레드시트나 기존 문서에서
// 통째로 가져온다. 좁은 패널에서 입력칸 20쌍을 하나씩 채우는 것보다 붙여넣고 고치는 편이
// 실제 작업 방식이다. 대신 무엇으로 읽혔는지를 바로 아래에 계속 보여준다 -
// 자유 텍스트를 받으면서 해석 결과를 감추면 사용자는 자기가 뭘 적었는지 알 수 없다.

import { $, escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, statRow, emptyState, formatWhen } from "./shell.js";
import { loadGlossaries, newProfileId, saveGlossaries } from "../../shared/glossary_store.js";
import { formatGlossaryText, parseGlossaryText, renderGlossaryForPrompt, MAX_ENTRIES } from "../../pdf/text/glossary.js";

const SAVE_DEBOUNCE_MS = 700;

const STARTER_TEXT = `# 한 줄에 하나씩. "원문 => 번역" 형식입니다.
# 스프레드시트에서 복사해 붙여넣어도 됩니다(탭으로 구분된 열을 알아서 읽습니다).

machine learning => 기계 학습
throughput => 처리량 [네트워크 문맥]

# 대상을 비우면 "번역하지 말고 그대로 두라"는 뜻입니다.
API
OAuth`;

let state = { profiles: [], activeId: "" };
let draft = ""; // 편집 중인 텍스트(저장 전)
let saveTimer = null;
let savedAt = 0;
let loaded = false;

function renderGlossaryWorkspace() {
  const wrap = openWorkspace({
    service: "문서",
    title: "번역 용어집",
    desc: "번역할 때 반드시 지킬 용어를 정해둡니다.",
  });
  if (!wrap) return;

  if (!loaded) {
    const box = section(wrap, { title: "용어집" });
    emptyState(box, "불러오는 중...");
    loadGlossaries().then((data) => {
      state = data;
      const active = currentProfile();
      draft = active ? active.text : "";
      loaded = true;
      renderGlossaryWorkspace();
    });
    return;
  }

  renderProfileBar(wrap);
  if (!state.profiles.length) {
    const box = section(wrap, { title: "용어집이 없습니다" });
    emptyState(
      box,
      "용어집을 만들면 번역할 때 그 용어를 반드시 지킵니다. 문서 종류마다 따로 만들어 두면(기술문서·계약서 등) 필요한 것만 골라 쓸 수 있습니다."
    );
    return;
  }
  renderEditor(wrap);
}

function currentProfile() {
  return state.profiles.find((p) => p.id === state.activeId) || state.profiles[0] || null;
}

// ---------------------------------------------------------------------------
// 프로필
// ---------------------------------------------------------------------------

function renderProfileBar(wrap) {
  const body = section(wrap, {
    title: "📖 용어집 선택",
    actions: [{ label: "새로 만들기", onClick: createProfile }],
  });

  if (!state.profiles.length) return;

  const field = document.createElement("div");
  field.className = "pdf-field";
  field.innerHTML = `
    <select class="settings-select-compact" id="glProfile">
      ${state.profiles
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
        .join("")}
    </select>`;
  const select = field.querySelector("select");
  select.value = currentProfile().id;
  select.addEventListener("change", async () => {
    await flushSave();
    state.activeId = select.value;
    draft = currentProfile().text;
    await persist();
    renderGlossaryWorkspace();
  });
  body.appendChild(field);

  const row = document.createElement("div");
  row.className = "ws-btn-row";
  row.appendChild(smallButton("이름 변경", renameProfile));
  row.appendChild(smallButton("복제", duplicateProfile));
  row.appendChild(smallButton("삭제", deleteProfile));
  body.appendChild(row);
}

function smallButton(label, onClick) {
  const btn = document.createElement("button");
  btn.className = "btn-small";
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

async function createProfile() {
  await flushSave();
  const name = prompt("새 용어집 이름", `용어집 ${state.profiles.length + 1}`);
  if (name === null) return;

  const profile = {
    id: newProfileId(),
    name: String(name).trim() || `용어집 ${state.profiles.length + 1}`,
    text: STARTER_TEXT,
    updatedAt: Date.now(),
  };
  state.profiles.push(profile);
  state.activeId = profile.id;
  draft = profile.text;
  await persist();
  renderGlossaryWorkspace();
}

async function renameProfile() {
  const profile = currentProfile();
  if (!profile) return;
  const name = prompt("용어집 이름", profile.name);
  if (name === null) return;
  profile.name = String(name).trim() || profile.name;
  profile.updatedAt = Date.now();
  await persist();
  renderGlossaryWorkspace();
}

async function duplicateProfile() {
  await flushSave();
  const profile = currentProfile();
  if (!profile) return;
  const copy = { id: newProfileId(), name: `${profile.name} 사본`, text: profile.text, updatedAt: Date.now() };
  state.profiles.push(copy);
  state.activeId = copy.id;
  draft = copy.text;
  await persist();
  renderGlossaryWorkspace();
}

async function deleteProfile() {
  const profile = currentProfile();
  if (!profile) return;
  // 되돌릴 수 없는 삭제라 확인을 받는다. 용어집은 손으로 쌓은 것이라 다시 만들기 번거롭다.
  if (!confirm(`"${profile.name}" 용어집을 삭제할까요? 되돌릴 수 없습니다.`)) return;

  clearTimeout(saveTimer);
  saveTimer = null;
  state.profiles = state.profiles.filter((p) => p.id !== profile.id);
  state.activeId = state.profiles[0] ? state.profiles[0].id : "";
  draft = state.profiles[0] ? state.profiles[0].text : "";
  await persist();
  showSettingsToast("용어집을 삭제했습니다.");
  renderGlossaryWorkspace();
}

// ---------------------------------------------------------------------------
// 편집
// ---------------------------------------------------------------------------

function renderEditor(wrap) {
  const parsed = parseGlossaryText(draft);

  const statHost = document.createElement("div");
  wrap.appendChild(statHost);
  statRow(statHost, [
    { label: "용어", value: parsed.entries.length, tone: parsed.entries.length ? "good" : undefined },
    { label: "중복", value: parsed.duplicates.length, tone: parsed.duplicates.length ? "warn" : undefined },
    { label: "무시된 줄", value: parsed.ignored, tone: parsed.ignored ? "warn" : undefined },
  ]);

  const body = section(wrap, {
    title: "용어 목록",
    actions: [{ label: "정리", onClick: tidy }],
  });

  const textarea = document.createElement("textarea");
  textarea.className = "pdf-input gl-editor";
  textarea.id = "glText";
  textarea.rows = 14;
  textarea.spellcheck = false;
  textarea.value = draft;
  textarea.addEventListener("input", () => {
    draft = textarea.value;
    scheduleSave();
    // 화면 전체를 다시 그리면 입력 중 커서가 튄다. 바뀐 부분만 갱신한다.
    // 미리보기도 반드시 여기 포함해야 한다 - "실제로 전달되는 내용"이라고 적어놓고
    // 편집 전 내용을 보여주면 그 문구가 거짓말이 된다.
    const next = parseGlossaryText(draft);
    repaintStats(statHost, next);
    repaintNotices(body, next);
    repaintPreview(next);
  });
  body.appendChild(textarea);

  const notices = document.createElement("div");
  notices.className = "gl-notices";
  body.appendChild(notices);
  repaintNotices(body, parsed);

  const status = document.createElement("div");
  status.className = "ws-hint gl-status";
  status.id = "glStatus";
  status.textContent = savedAt ? `저장됨 · ${formatWhen(savedAt)}` : "";
  body.appendChild(status);

  // 형식 안내와 실제로 프롬프트에 들어갈 내용은 접어 둔다. 평소에는 목록만 보면 된다.
  const help = document.createElement("details");
  help.className = "pdf-advanced";
  help.innerHTML = `
    <summary>형식 안내</summary>
    <div class="ws-section-body">
      <pre class="gl-help">machine learning => 기계 학습
throughput => 처리량 [네트워크 문맥]
API                      ← 대상을 비우면 "번역하지 않음"
원문&#9;번역&#9;비고        ← 스프레드시트에서 붙여넣기(탭 구분)
# 이 줄은 무시됩니다</pre>
      <p class="ws-note">용어는 최대 ${MAX_ENTRIES}개까지 쓰입니다. 같은 원문이 두 번 나오면 마지막 줄이 이깁니다.</p>
    </div>`;
  body.appendChild(help);

  const promptView = document.createElement("details");
  promptView.className = "pdf-advanced";
  promptView.innerHTML = `
    <summary>번역할 때 실제로 전달되는 내용</summary>
    <div class="ws-section-body">
      <pre class="gl-help" id="glPromptPreview">${escapeHtml(
        renderGlossaryForPrompt(parsed.entries) || "(용어집 없음)"
      )}</pre>
      <p class="ws-note">이 내용이 배치마다 프롬프트에 실립니다. 용어가 많을수록 입력 토큰도 늘어납니다.</p>
    </div>`;
  body.appendChild(promptView);

  const warn = document.createElement("p");
  warn.className = "ws-note";
  warn.textContent =
    "용어집을 고치면 번역 캐시가 더 이상 맞지 않으므로, 다음 실행에서 그 조건의 문단을 다시 번역합니다. 용어를 바꿨는데 옛 번역문을 재사용하면 고친 의미가 없기 때문입니다.";
  body.appendChild(warn);
}

function repaintStats(host, parsed) {
  host.innerHTML = "";
  statRow(host, [
    { label: "용어", value: parsed.entries.length, tone: parsed.entries.length ? "good" : undefined },
    { label: "중복", value: parsed.duplicates.length, tone: parsed.duplicates.length ? "warn" : undefined },
    { label: "무시된 줄", value: parsed.ignored, tone: parsed.ignored ? "warn" : undefined },
  ]);
}

function repaintPreview(parsed) {
  const pre = $("glPromptPreview");
  if (!pre) return;
  pre.textContent = renderGlossaryForPrompt(parsed.entries) || "(용어집 없음)";
}

function repaintNotices(body, parsed) {
  const box = body.querySelector(".gl-notices");
  if (!box) return;
  const lines = [];
  if (parsed.duplicates.length) {
    lines.push(`같은 원문이 여러 번 있습니다(마지막 줄이 적용): ${parsed.duplicates.slice(0, 5).join(", ")}`);
  }
  if (parsed.truncated) lines.push(`용어가 ${MAX_ENTRIES}개를 넘어 뒷부분은 쓰이지 않습니다.`);
  box.innerHTML = lines.map((l) => `<div class="pdf-warn">${escapeHtml(l)}</div>`).join("");
}

async function tidy() {
  await flushSave();
  const parsed = parseGlossaryText(draft);
  draft = formatGlossaryText(parsed.entries);
  await persist();
  showSettingsToast(`중복을 정리했습니다. 용어 ${parsed.entries.length}개.`);
  renderGlossaryWorkspace();
}

// ---------------------------------------------------------------------------
// 저장
// ---------------------------------------------------------------------------
// 사이드패널은 사용자가 다른 서비스로 옮기면 통째로 파괴된다. 저장 버튼을 누르기 전에
// 화면이 사라지면 편집분이 사라지므로, 입력이 멈추면 알아서 저장한다.

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistDraft();
  }, SAVE_DEBOUNCE_MS);
}

async function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  await persistDraft();
}

async function persistDraft() {
  const profile = currentProfile();
  if (!profile) return;
  profile.text = draft;
  profile.updatedAt = Date.now();
  await persist();
  savedAt = profile.updatedAt;
  const status = $("glStatus");
  if (status) status.textContent = `저장됨 · ${formatWhen(savedAt)}`;
}

async function persist() {
  state = await saveGlossaries(state).then(() => loadGlossaries());
}

export { renderGlossaryWorkspace };
