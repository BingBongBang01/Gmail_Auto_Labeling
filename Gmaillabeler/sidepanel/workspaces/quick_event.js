// sidepanel/workspaces/quick_event.js
// '일정 만들기' 화면. 자연어 한 줄이나 열어 둔 메일에서 일정을 읽어 만든다.
//
// 메일 정리와 같은 원칙이다: **먼저 보여주고, 사용자가 확인한 것만 만든다.**
// AI가 읽은 날짜는 틀릴 수 있는데(연도를 잘못 적거나 "다음 주"를 지난주로 계산한다),
// 잘못 만들어진 일정은 한참 뒤에야 발견된다. 그래서 읽은 결과를 곧바로 만들지 않고
// 고칠 수 있는 폼으로 띄운 뒤, 확인 버튼을 눌러야 캘린더에 들어간다.

import { escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, emptyState, tabBar, badge, ask } from "./shell.js";

const TABS = [
  { id: "text", label: "직접 입력" },
  { id: "mail", label: "메일에서" },
];

const EXAMPLES = [
  "다음 주 화요일 오후 3시 팀 회의, 강남 회의실",
  "8월 30일 종일 휴가",
  "내일 아침 9시 30분부터 11시까지 고객 미팅",
];

let activeTab = "text";
let inputText = "";
let drafts = []; // [{ draft, warnings }]
let timeZone = "";
let lastCreated = null; // { summary, htmlLink }

function renderQuickEventWorkspace(tab) {
  if (tab) activeTab = tab;

  const wrap = openWorkspace({
    service: "캘린더",
    title: "일정 만들기",
    desc: "문장이나 메일에서 일정을 읽어 확인한 뒤 등록합니다.",
  });
  if (!wrap) return;

  tabBar(wrap, TABS, activeTab, (id) => {
    activeTab = id;
    drafts = [];
    renderQuickEventWorkspace();
  });

  const host = document.createElement("div");
  host.className = "ws-tabbody";
  wrap.appendChild(host);

  if (activeTab === "text") renderTextInput(host);
  else renderMailInput(host);

  renderDrafts(host);
  renderCreated(host);
}

// ---------------------------------------------------------------------------
// ② 입력
// ---------------------------------------------------------------------------

function renderTextInput(host) {
  const body = section(host, { title: "무슨 일정인가요?", hint: "평소 말하듯 적으면 됩니다" });

  const field = document.createElement("div");
  field.className = "pdf-field";
  field.innerHTML = `<textarea class="pdf-input pdf-textarea" id="qeText" rows="3"
    placeholder="예: 다음 주 화요일 오후 3시 팀 회의, 강남 회의실">${escapeHtml(inputText)}</textarea>`;
  body.appendChild(field);

  const chips = document.createElement("div");
  chips.className = "ai-chips-row";
  for (const example of EXAMPLES) {
    const chip = document.createElement("button");
    chip.className = "ai-chip";
    chip.textContent = example;
    chip.addEventListener("click", () => {
      const input = body.querySelector("#qeText");
      if (!input) return;
      input.value = example;
      inputText = example;
      input.focus();
    });
    chips.appendChild(chip);
  }
  body.appendChild(chips);

  const row = document.createElement("div");
  row.className = "ws-btn-row";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.id = "qeParseBtn";
  btn.textContent = "일정 읽기";
  btn.addEventListener("click", async () => {
    const input = body.querySelector("#qeText");
    inputText = (input && input.value) || "";
    if (!inputText.trim()) {
      showSettingsToast("일정 내용을 입력하세요.");
      return;
    }
    await runParse(btn, { action: "calendar.parseText", text: inputText });
  });
  row.appendChild(btn);
  body.appendChild(row);
}

function renderMailInput(host) {
  const body = section(host, { title: "열어 둔 메일에서", hint: "Gmail에서 메일을 열어 두세요" });

  const note = document.createElement("p");
  note.className = "ws-note";
  note.textContent =
    "지금 Gmail에서 보고 있는 메일의 제목·본문에서 일정을 찾습니다. 초대장이나 예약 확인 메일에서 날짜·장소를 뽑아 캘린더로 넘길 때 씁니다.";
  body.appendChild(note);

  const row = document.createElement("div");
  row.className = "ws-btn-row";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.id = "qeParseMailBtn";
  btn.textContent = "이 메일에서 일정 찾기";
  btn.addEventListener("click", () => runParse(btn, { action: "calendar.parseMail" }));
  row.appendChild(btn);
  body.appendChild(row);
}

async function runParse(btn, payload) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "읽는 중...";
  drafts = [];

  const res = await ask(payload);

  btn.disabled = false;
  btn.textContent = original;

  if (!res.ok) {
    showSettingsToast(res.error || "일정을 읽지 못했습니다.");
    return;
  }
  drafts = res.drafts || [];
  timeZone = res.timeZone || "";
  lastCreated = null;

  if (!drafts.length) showSettingsToast("일정으로 볼 만한 내용을 찾지 못했습니다.");
  renderQuickEventWorkspace();
}

// ---------------------------------------------------------------------------
// ④ 확인 + ⑤ 만들기
// ---------------------------------------------------------------------------

function renderDrafts(host) {
  if (!drafts.length) return;

  const body = section(host, {
    title: drafts.length > 1 ? `찾은 일정 ${drafts.length}건` : "이렇게 만들까요?",
    hint: timeZone,
  });

  drafts.forEach((item, index) => body.appendChild(draftCard(item, index)));

  const note = document.createElement("p");
  note.className = "ws-note";
  note.textContent = "확인 버튼을 눌러야 캘린더에 들어갑니다. 잘못 읽은 부분은 위에서 바로 고칠 수 있습니다.";
  body.appendChild(note);
}

function draftCard(item, index) {
  const { draft, warnings } = item;
  const card = document.createElement("div");
  card.className = "qe-card";
  card.dataset.index = String(index);

  const timeFields = draft.allDay
    ? `
      <div class="pdf-field">
        <label class="pdf-field-label">시작 날짜</label>
        <input type="date" class="pdf-input" data-field="start" value="${escapeHtml(draft.start)}">
      </div>
      <div class="pdf-field">
        <label class="pdf-field-label">끝 날짜</label>
        <input type="date" class="pdf-input" data-field="end" value="${escapeHtml(draft.end)}">
      </div>`
    : `
      <div class="pdf-field">
        <label class="pdf-field-label">시작</label>
        <input type="datetime-local" class="pdf-input" data-field="start" value="${escapeHtml(draft.start)}">
      </div>
      <div class="pdf-field">
        <label class="pdf-field-label">끝</label>
        <input type="datetime-local" class="pdf-input" data-field="end" value="${escapeHtml(draft.end)}">
      </div>`;

  card.innerHTML = `
    ${warnings.map((w) => `<div class="pdf-warn">${escapeHtml(w)}</div>`).join("")}
    <div class="pdf-field">
      <label class="pdf-field-label">제목</label>
      <input type="text" class="pdf-input" data-field="title" value="${escapeHtml(draft.title)}">
    </div>
    <label class="checkbox-label">
      <input type="checkbox" data-field="allDay" ${draft.allDay ? "checked" : ""}>
      <span>하루 종일</span>
    </label>
    <div class="pdf-field-grid">${timeFields}</div>
    <div class="pdf-field">
      <label class="pdf-field-label">장소</label>
      <input type="text" class="pdf-input" data-field="location" value="${escapeHtml(draft.location)}">
    </div>
    <div class="pdf-field">
      <label class="pdf-field-label">설명</label>
      <textarea class="pdf-input pdf-textarea" data-field="description" rows="2">${escapeHtml(
        draft.description
      )}</textarea>
    </div>
    ${
      draft.attendees.length
        ? `<label class="checkbox-label">
             <input type="checkbox" data-field="withAttendees">
             <span>참석자로 추가: ${escapeHtml(draft.attendees.join(", "))}</span>
           </label>
           <p class="ws-note">켜면 이 사람들의 캘린더에도 일정이 생깁니다. 초대 메일은 보내지 않습니다.</p>`
        : ""
    }
    ${draft.unresolvedAttendees.length ? `<p class="ws-note">이메일을 모르는 참석자는 설명에 적어 둡니다: ${escapeHtml(draft.unresolvedAttendees.join(", "))}</p>` : ""}
  `;

  // 하루 종일 토글은 입력 종류가 바뀌므로 화면을 다시 그린다.
  card.querySelector('[data-field="allDay"]').addEventListener("change", (e) => {
    const next = collectCard(card, draft);
    next.allDay = e.currentTarget.checked;
    // 날짜/시각 표기를 서로 바꿔준다. 값을 그대로 두면 input이 빈 칸이 된다.
    next.start = next.allDay ? next.start.slice(0, 10) : `${next.start.slice(0, 10)}T09:00`;
    next.end = next.allDay ? next.end.slice(0, 10) : `${next.end.slice(0, 10)}T10:00`;
    drafts[index] = { draft: next, warnings };
    renderQuickEventWorkspace();
  });

  const row = document.createElement("div");
  row.className = "ws-btn-row";
  const create = document.createElement("button");
  create.className = "btn btn-primary";
  create.dataset.create = String(index);
  create.textContent = "캘린더에 만들기";
  create.addEventListener("click", () => runCreate(card, item, create));
  row.appendChild(create);

  const drop = document.createElement("button");
  drop.className = "btn-small";
  drop.textContent = "버리기";
  drop.addEventListener("click", () => {
    drafts.splice(index, 1);
    renderQuickEventWorkspace();
  });
  row.appendChild(drop);
  card.appendChild(row);

  return card;
}

// 화면에서 고친 값을 초안에 다시 담는다. 만들기 직전에 이 값을 그대로 보낸다 -
// AI가 준 원본이 아니라 사용자가 마지막으로 본 것이 만들어져야 한다.
function collectCard(card, base) {
  const get = (field) => {
    const el = card.querySelector(`[data-field="${field}"]`);
    if (!el) return "";
    return el.type === "checkbox" ? el.checked : el.value;
  };
  return {
    ...base,
    title: get("title"),
    allDay: !!get("allDay"),
    start: get("start"),
    end: get("end"),
    location: get("location"),
    description: get("description"),
  };
}

async function runCreate(card, item, btn) {
  const draft = collectCard(card, item.draft);
  if (!draft.start) {
    showSettingsToast("시작 시각을 채워주세요.");
    return;
  }

  const attendeeToggle = card.querySelector('[data-field="withAttendees"]');
  btn.disabled = true;
  btn.textContent = "만드는 중...";

  const res = await ask({
    action: "calendar.createEvent",
    draft,
    withAttendees: !!(attendeeToggle && attendeeToggle.checked),
  });

  btn.disabled = false;
  btn.textContent = "캘린더에 만들기";

  if (!res.ok) {
    showSettingsToast(res.error || "일정을 만들지 못했습니다.");
    return;
  }

  lastCreated = { summary: res.summary, htmlLink: res.htmlLink };
  const index = Number(card.dataset.index);
  if (Number.isInteger(index)) drafts.splice(index, 1);
  showSettingsToast(`"${res.summary}" 일정을 만들었습니다.`);
  renderQuickEventWorkspace();
}

function renderCreated(host) {
  if (!lastCreated) return;
  const body = section(host, { title: "만든 일정" });

  const row = document.createElement("div");
  row.className = "ws-row";
  row.innerHTML = `
    <div class="ws-row-main">
      <span class="ws-row-title">${escapeHtml(lastCreated.summary)}</span>
      <span class="ws-hint">캘린더에 등록되었습니다</span>
    </div>
    ${badge("완료", "good")}`;
  body.appendChild(row);

  if (lastCreated.htmlLink) {
    const btnRow = document.createElement("div");
    btnRow.className = "ws-btn-row";
    const open = document.createElement("button");
    open.className = "btn-small";
    open.textContent = "캘린더에서 열기";
    open.addEventListener("click", () => window.open(lastCreated.htmlLink, "_blank"));
    btnRow.appendChild(open);
    body.appendChild(btnRow);
  }

  if (!drafts.length) {
    emptyState(body, "다른 일정을 더 만들려면 위에 내용을 입력하고 '일정 읽기'를 누르세요.");
  }
}

export { renderQuickEventWorkspace };
