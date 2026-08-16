// sidepanel/workspaces/edit.js
// 타일 편집 워크스페이스.

import { resetCurrentServiceActions } from "../nav/action_nav.js";
import { resetTopServiceOrder } from "../nav/service_nav.js";
import { $ } from "../ui/dom.js";

function renderEditWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">✏️</span>
      <h3 class="workspace-title">타일 순서 편집 및 초기화</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      상단 서비스 바와 중간 액션 바의 타일을 원하는 위치로 직접 <strong>드래그 & 드롭</strong>하여 순서를 변경할 수 있습니다.
    </p>
    <div class="workspace-btn-grid">
      <button class="btn btn-outlined" id="btnResetTopServices">🔄 상단 서비스 타일 순서 초기화</button>
      <button class="btn btn-outlined" id="btnResetMidActions">🔄 중간 액션 타일 순서 초기화</button>
    </div>
  `;
  container.appendChild(card);

  $("btnResetTopServices")?.addEventListener("click", resetTopServiceOrder);
  $("btnResetMidActions")?.addEventListener("click", resetCurrentServiceActions);
}


export {
  renderEditWorkspace,
};
