// sidepanel/workspaces/calendar.js
// 캘린더 서비스 워크스페이스.

import { startJob } from "../job_client.js";
import { $ } from "../ui/dom.js";

function renderCalendarWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">📅</span>
      <h3 class="workspace-title">Google 캘린더 스마트 일정</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      캘린더 이벤트를 분석하여 카테고리별 색상을 자동 지정하고 일정을 브리핑합니다.
    </p>
    <div class="workspace-btn-grid">
      <button class="btn btn-primary" id="btnSpCalClassify">📅 이번 주 일정 자동 분류</button>
      <button class="btn btn-outlined" id="btnSpCalInit">🎨 카테고리 색상 생성/적용</button>
    </div>
  `;
  container.appendChild(card);

  $("btnSpCalClassify")?.addEventListener("click", () => startJob("calendar_classify"));
  $("btnSpCalInit")?.addEventListener("click", () => startJob("calendar_init_categories"));
}


export {
  renderCalendarWorkspace,
};
