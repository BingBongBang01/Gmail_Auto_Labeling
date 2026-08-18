// sidepanel/workspaces/today.js
// '오늘' 화면. 안 읽은 메일과 오늘 일정을 한 자리에서 보고, 원하면 AI로 3~5줄 브리핑을 받는다.
//
// 이 화면은 아무것도 바꾸지 않는다. 읽어서 보여주기만 한다.
// 그래서 확인 단계가 없고, 열면 곧바로 불러온다 - 다른 화면들이 "먼저 보여주고 확인받는" 것은
// 무언가를 바꾸기 때문이고, 여기엔 바꿀 것이 없다.
//
// 목록과 브리핑을 나눈 이유: 목록은 AI 없이도 뜨고 즉시 쓸모가 있다. 키가 없거나 할당량이
// 소진돼도 "오늘 뭐가 있나"는 봐야 한다. 브리핑은 그 위에 얹는 선택지다.
//
// 브리핑은 화면에 이미 떠 있는 데이터를 그대로 백그라운드에 넘긴다. 거기서 다시 모으면
// 목록과 브리핑이 서로 다른 것을 말할 수 있고, 그러면 어느 쪽을 믿어야 할지 알 수 없다.

import { escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, statRow, emptyState, tabBar, badge, formatWhen, ask } from "./shell.js";

const TABS = [
  { id: "all", label: "전체" },
  { id: "mail", label: "메일" },
  { id: "events", label: "일정" },
];

// 화면을 다시 열었을 때 이만큼 지났으면 알아서 다시 불러온다.
// 탭을 오가는 것만으로 매번 Gmail을 다시 훑지는 않되, 아침에 열어둔 화면을 오후에 다시 눌렀을 때
// 몇 시간 전 목록을 그대로 보여주지도 않는다.
const STALE_MS = 3 * 60 * 1000;

let activeTab = "all";
let data = null; // today.collect 결과
let loading = false;
let loadedAt = 0; // 마지막으로 성공한 시각. 화면에 "N분 전 기준"으로 적는다.
let attemptedAt = 0; // 마지막 시도 시각. 실패해도 갱신한다 - 아니면 다시 그릴 때마다 재요청이 돈다.
let brief = null; // { headline, lines[], focus[] }
let briefAt = 0;
let briefing = false;

function renderTodayWorkspace(tab) {
  if (tab) activeTab = tab;

  const wrap = openWorkspace({
    service: "오늘",
    title: "오늘 브리핑",
    desc: "안 읽은 메일과 오늘 일정을 한눈에 봅니다.",
  });
  if (!wrap) return;

  tabBar(wrap, TABS, activeTab, (id) => {
    activeTab = id;
    renderTodayWorkspace();
  });

  const host = document.createElement("div");
  host.className = "ws-tabbody";
  wrap.appendChild(host);

  if (loading && !data) {
    section(host, { title: "오늘" });
    emptyState(host.lastElementChild, "메일과 일정을 불러오는 중입니다...");
    return;
  }

  renderOverview(host);
  if (activeTab !== "events") renderMails(host);
  if (activeTab !== "mail") renderEvents(host);

  // 처음 열었을 때, 그리고 오래됐을 때 알아서 불러온다.
  // 읽기만 하므로 버튼을 한 번 더 누르게 할 이유가 없다.
  if (!loading && Date.now() - attemptedAt > STALE_MS) load();
}

// ---------------------------------------------------------------------------
// ④ 지표 + 브리핑
// ---------------------------------------------------------------------------

function renderOverview(host) {
  const body = section(host, {
    title: "오늘 한눈에",
    hint: loadedAt ? `${formatWhen(loadedAt)} 기준` : "",
    actions: [{ label: loading ? "불러오는 중..." : "새로고침", onClick: () => load() }],
  });

  const unread = data ? data.unreadTotal : 0;
  const capped = !!data && unread >= (data.scanLimit || 0);
  statRow(body, [
    { value: data ? (capped ? `${unread}+` : unread) : "-", label: "안 읽은 메일", tone: unread > 20 ? "warn" : "" },
    { value: data ? data.events.length : "-", label: "오늘 일정" },
    { value: brief ? "있음" : "없음", label: "AI 브리핑", tone: brief ? "good" : "" },
  ]);

  if (data && data.mailError) warn(body, `메일을 불러오지 못했습니다: ${data.mailError}`);
  if (data && data.calendarError) {
    warn(body, `일정을 불러오지 못했습니다: ${data.calendarError} (캘린더를 연결하지 않았다면 설정 > OAuth를 확인하세요)`);
  }

  if (brief) renderBrief(body);

  const row = document.createElement("div");
  row.className = "ws-btn-row";
  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = briefing ? "요약하는 중..." : brief ? "브리핑 다시 받기" : "AI 브리핑 받기";
  btn.disabled = briefing || !data || (!data.mails.length && !data.events.length);
  btn.addEventListener("click", () => runBrief(btn));
  row.appendChild(btn);
  body.appendChild(row);

  // 버튼을 왜 못 누르는지는 버튼 옆에 적는다. 아래 목록 섹션들이 이미 "없다"고 말하고 있으므로
  // 여기서 같은 말을 또 하면 빈 날에는 화면이 안내문 세 줄이 된다.
  if (data && btn.disabled && !briefing) {
    const note = document.createElement("p");
    note.className = "ws-note";
    note.textContent = "요약할 메일도 일정도 없습니다.";
    body.appendChild(note);
  }
}

function renderBrief(body) {
  const card = document.createElement("div");
  card.className = "ws-answer today-brief";
  card.innerHTML = `
    <div class="ws-answer-head">
      <span class="ws-row-title">${escapeHtml(brief.headline || "오늘 브리핑")}</span>
      ${badge(formatWhen(briefAt), "info")}
    </div>
    ${
      brief.lines.length
        ? `<ul class="today-brief-lines">${brief.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`
        : ""
    }
    ${
      brief.focus.length
        ? `<div class="today-focus">
             <span class="ws-hint">먼저 할 일</span>
             <ol>${brief.focus.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ol>
           </div>`
        : ""
    }`;
  body.appendChild(card);

  // AI가 쓴 문장이라는 것을 화면에 남긴다. 요약은 원문을 줄이면서 반드시 무언가를 버린다.
  const note = document.createElement("p");
  note.className = "ws-note";
  note.textContent = "AI가 위 목록만 보고 쓴 요약입니다. 중요한 건은 원문을 직접 확인하세요.";
  body.appendChild(note);
}

// ---------------------------------------------------------------------------
// ⑤ 목록
// ---------------------------------------------------------------------------

function renderMails(host) {
  const mails = (data && data.mails) || [];
  const shown = data && data.unreadTotal > mails.length ? `${mails.length} / ${data.unreadTotal}건` : "";
  const body = section(host, {
    title: "안 읽은 메일",
    hint: shown,
    actions: [{ label: "받은편지함 열기", onClick: () => openTab("https://mail.google.com/mail/u/0/#inbox") }],
  });

  if (!data) {
    emptyState(body, "불러오는 중입니다...");
    return;
  }
  if (!mails.length) {
    emptyState(body, data.mailError ? "메일을 불러오지 못했습니다." : "받은편지함에 안 읽은 메일이 없습니다.");
    return;
  }

  const list = document.createElement("div");
  list.className = "clean-list";
  for (const mail of mails) list.appendChild(mailRow(mail));
  body.appendChild(list);

  if (data.unreadTotal > mails.length) {
    const note = document.createElement("p");
    note.className = "ws-note";
    note.textContent = `안 읽은 메일 ${data.unreadTotal}통 중 중요·최신 ${mails.length}통만 보여줍니다. 전체는 받은편지함에서 확인하세요.`;
    body.appendChild(note);
  }
}

function mailRow(mail) {
  const row = document.createElement("div");
  row.className = "clean-row today-row";
  row.innerHTML = `
    <div class="clean-row-main">
      <span class="clean-row-subject">${escapeHtml(mail.subject)}</span>
      <span class="ws-hint">${escapeHtml(senderName(mail.from))}${mail.date ? ` · ${escapeHtml(formatWhen(mail.date))}` : ""}</span>
    </div>
    ${mail.important ? badge("중요", "warn") : ""}
    ${mail.starred ? badge("별표", "info") : ""}`;
  row.title = "Gmail에서 열기";
  row.addEventListener("click", () => openTab(`https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(mail.threadId)}`));
  return row;
}

function renderEvents(host) {
  const events = (data && data.events) || [];
  const body = section(host, {
    title: "오늘 일정",
    actions: [{ label: "캘린더 열기", onClick: () => openTab("https://calendar.google.com/calendar/r/day") }],
  });

  if (!data) {
    emptyState(body, "불러오는 중입니다...");
    return;
  }
  if (!events.length) {
    emptyState(
      body,
      data.calendarError ? "일정을 불러오지 못했습니다." : "오늘 등록된 일정이 없습니다."
    );
    return;
  }

  const list = document.createElement("div");
  list.className = "clean-list";
  for (const event of events) list.appendChild(eventRow(event));
  body.appendChild(list);
}

function eventRow(event) {
  const row = document.createElement("div");
  row.className = "clean-row today-row";
  const meta = [event.location, event.attendeeCount ? `참석 ${event.attendeeCount}명` : ""].filter(Boolean).join(" · ");
  row.innerHTML = `
    <span class="today-time${event.allDay ? " is-allday" : ""}">${escapeHtml(event.startText)}</span>
    <div class="clean-row-main">
      <span class="clean-row-subject">${escapeHtml(event.summary)}</span>
      ${meta ? `<span class="ws-hint">${escapeHtml(meta)}</span>` : ""}
    </div>`;
  if (event.htmlLink) {
    row.title = "캘린더에서 열기";
    row.addEventListener("click", () => openTab(event.htmlLink));
  } else {
    row.style.cursor = "default";
  }
  return row;
}

// ---------------------------------------------------------------------------
// 동작
// ---------------------------------------------------------------------------

async function load() {
  if (loading) return;
  loading = true;
  renderTodayWorkspace();

  const res = await ask({ action: "today.collect" });

  loading = false;
  attemptedAt = Date.now();
  if (!res.ok) {
    data = { mails: [], events: [], unreadTotal: 0, scanLimit: 0, mailError: res.error || "불러오지 못했습니다.", calendarError: null };
    showSettingsToast(res.error || "오늘 정보를 불러오지 못했습니다.");
  } else {
    data = res;
    loadedAt = Date.now();
    // 목록이 바뀌면 예전 브리핑은 더 이상 이 목록을 설명하지 않는다. 지우는 편이 정직하다.
    brief = null;
    briefAt = 0;
  }
  renderTodayWorkspace();
}

async function runBrief(btn) {
  if (briefing || !data) return;
  briefing = true;
  btn.disabled = true;
  btn.textContent = "요약하는 중...";

  const res = await ask({
    action: "today.brief",
    data: { mails: data.mails, events: data.events, unreadTotal: data.unreadTotal },
  });

  briefing = false;
  if (!res.ok) {
    showSettingsToast(res.error || "브리핑을 만들지 못했습니다.");
  } else {
    brief = res.brief;
    briefAt = res.at || Date.now();
  }
  renderTodayWorkspace();
}

function senderName(from) {
  const text = String(from || "");
  const match = text.match(/^\s*"?([^"<]*?)"?\s*</);
  const name = (match && match[1].trim()) || text.replace(/[<>]/g, "").trim();
  return name || "(보낸 사람 없음)";
}

function warn(body, text) {
  const el = document.createElement("div");
  el.className = "pdf-warn";
  el.textContent = text;
  body.appendChild(el);
}

function openTab(url) {
  window.open(url, "_blank");
}

export { renderTodayWorkspace };
