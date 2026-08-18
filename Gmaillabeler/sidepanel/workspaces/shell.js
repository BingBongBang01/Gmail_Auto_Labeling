// sidepanel/workspaces/shell.js
// 본문영역 화면들이 공유하는 조각. 화면마다 카드 마크업을 새로 짜면 같은 것이 조금씩
// 다르게 생기고, 나중에 간격 하나 바꾸려 해도 열 군데를 고쳐야 한다.
//
// 여기 있는 것은 "배치"뿐이다. 무엇을 보여줄지는 각 화면이 정한다.
// 표준 순서: ① 헤더 → ② 대상 → ③ 옵션 → ④ 실행/지표 → ⑤ 결과.
// 필요 없는 블록은 건너뛰되 순서는 바꾸지 않는다.

import { $, escapeHtml } from "../ui/dom.js";
import { updateContextUI } from "../ui/context.js";

/**
 * ① 헤더. 본문을 비우고 컨텍스트 바를 이 화면 것으로 맞춘 뒤, 내용을 담을 컨테이너를 준다.
 * 화면 제목을 본문에 또 찍지 않는다 - 컨텍스트 바가 이미 말하고 있고, 좁은 패널에서
 * 같은 문장을 두 번 쓰면 정작 내용이 밀린다.
 */
function openWorkspace({ service, title, desc }) {
  const container = $("panelContainer");
  if (!container) return null;

  updateContextUI({ service, pageType: "workspace", title, desc });
  container.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "ws";
  container.appendChild(wrap);
  return wrap;
}

/** 섹션 카드 하나. body 요소를 돌려주므로 호출부가 거기에 내용을 채운다. */
function section(parent, { title, hint, actions } = {}) {
  const card = document.createElement("div");
  card.className = "ws-section";

  if (title || hint || actions) {
    const head = document.createElement("div");
    head.className = "ws-section-head";
    head.innerHTML = `
      <span class="ws-section-title">${escapeHtml(title || "")}</span>
      ${hint ? `<span class="ws-hint">${escapeHtml(hint)}</span>` : ""}
    `;
    if (actions) {
      const box = document.createElement("span");
      box.className = "ws-section-actions";
      for (const action of actions) {
        const btn = document.createElement("button");
        btn.className = "btn-small";
        btn.textContent = action.label;
        btn.addEventListener("click", action.onClick);
        box.appendChild(btn);
      }
      head.appendChild(box);
    }
    card.appendChild(head);
  }

  const body = document.createElement("div");
  body.className = "ws-section-body";
  card.appendChild(body);
  parent.appendChild(card);
  return body;
}

/**
 * ④ 지표 행. 숫자를 먼저 보여주고 설명을 아래 붙인다 - 좁은 패널에서 훑을 때
 * 라벨보다 숫자가 먼저 눈에 들어와야 한다.
 * tone: 기본 | "good" | "warn" | "bad"
 */
function statRow(parent, stats) {
  const row = document.createElement("div");
  row.className = "ws-stats";
  row.innerHTML = stats
    .map(
      (s) => `
      <div class="ws-stat${s.tone ? ` is-${s.tone}` : ""}">
        <b>${escapeHtml(String(s.value))}</b>
        <span>${escapeHtml(s.label)}</span>
      </div>`
    )
    .join("");
  parent.appendChild(row);
  return row;
}

/** 목록이 비었을 때. "없음"만 쓰지 않고 왜 비었는지/무엇을 하면 채워지는지 함께 적는다. */
function emptyState(parent, text) {
  const el = document.createElement("div");
  el.className = "ws-empty";
  el.textContent = text;
  parent.appendChild(el);
  return el;
}

/** 화면 안 탭. 타일이 서비스마다 여러 개인데 화면은 하나일 때 쓴다. */
function tabBar(parent, tabs, activeId, onSelect) {
  const bar = document.createElement("div");
  bar.className = "ws-tabs";
  for (const tab of tabs) {
    const btn = document.createElement("button");
    btn.className = "ws-tab" + (tab.id === activeId ? " is-active" : "");
    btn.textContent = tab.label;
    btn.addEventListener("click", () => onSelect(tab.id));
    bar.appendChild(btn);
  }
  parent.appendChild(bar);
  return bar;
}

function badge(text, tone) {
  return `<span class="ws-badge${tone ? ` is-${tone}` : ""}">${escapeHtml(text)}</span>`;
}

/**
 * 시간 표기. 좁은 패널에서는 "2026-08-17 23:41:02"보다 "3분 전"이 훨씬 잘 읽힌다.
 * 하루가 넘어가면 상대 표기가 오히려 불친절해지므로 날짜로 바꾼다.
 */
function formatWhen(ts) {
  const t = Number(ts) || 0;
  if (!t) return "";
  const diff = Date.now() - t;
  if (diff < 0) return new Date(t).toLocaleString();
  if (diff < 60 * 1000) return "방금";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}분 전`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}시간 전`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}일 전`;
  return new Date(t).toLocaleDateString();
}

/** 백그라운드 호출. 화면 코드가 콜백/lastError를 매번 다시 다루지 않게 한다. */
function ask(payload) {
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

export { openWorkspace, section, statRow, emptyState, tabBar, badge, formatWhen, ask };
