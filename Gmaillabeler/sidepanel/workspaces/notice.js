// sidepanel/workspaces/notice.js
// 아직 못 하는 일을 눌렀을 때 본문영역에 뜨는 안내 카드.
//
// 예전에는 이런 타일을 누르면 정말 아무 일도 일어나지 않았다. 백그라운드는
// "지원하지 않는 작업 유형입니다"를 성실히 돌려줬지만 그 문장을 표시할 자리가 화면에
// 없었기 때문이다. 침묵은 최악의 응답이다 - 사용자는 확장이 고장 났는지, 자기가 잘못
// 눌렀는지, 기다려야 하는지 알 수 없다.
//
// 그래서 세 가지를 반드시 말한다: 무엇을 누른 것인지, 왜 지금은 안 되는지, 대신 무엇을 할 수 있는지.

import { $, escapeHtml } from "../ui/dom.js";
import { updateContextUI } from "../ui/context.js";

const KIND = {
  planned: { badge: "준비 중", icon: "🚧", cls: "is-planned" },
  unavailable: { badge: "지원하지 않음", icon: "🚫", cls: "is-unavailable" },
  missing: { badge: "확장 오류", icon: "⚠️", cls: "is-missing" },
};

function renderTileNotice(action, state) {
  const container = $("panelContainer");
  if (!container) return;

  const kind = KIND[state.status] || KIND.planned;
  const title = action.title || action.label || "이 기능";

  updateContextUI({
    service: kind.badge,
    pageType: "notice",
    title: `${action.icon || ""} ${action.label || ""}`.trim(),
    desc: kind.badge === "준비 중" ? "아직 만들지 않은 기능입니다." : "지금은 사용할 수 없는 기능입니다.",
  });

  container.innerHTML = "";
  const card = document.createElement("div");
  card.className = `workspace-card notice-card ${kind.cls}`;
  card.innerHTML = `
    <div class="notice-head">
      <span class="notice-icon">${kind.icon}</span>
      <span class="notice-badge">${escapeHtml(kind.badge)}</span>
    </div>
    <h3 class="notice-title">${escapeHtml(title)}</h3>
    <p class="notice-body">${escapeHtml(state.note)}</p>
    ${
      state.needsScope
        ? `<div class="notice-scope">
             <span class="notice-scope-label">필요한 권한</span>
             <code class="notice-scope-value">${escapeHtml(state.needsScope)}</code>
           </div>
           <p class="notice-foot">권한을 늘리면 기존 연결로는 부족해 Google 재연결이 한 번 필요합니다. 그래서 기능을 실제로 만들 때 함께 요청합니다.</p>`
        : ""
    }
  `;
  container.appendChild(card);
}

export { renderTileNotice };
