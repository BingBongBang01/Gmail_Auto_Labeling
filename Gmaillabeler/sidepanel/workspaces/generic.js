// sidepanel/workspaces/generic.js
// 전용 화면이 없는 서비스를 위한 기본 워크스페이스.

import { SERVICE_REGISTRY } from "../nav/registry.js";
import { $ } from "../ui/dom.js";

function renderGenericServiceWorkspace(serviceId) {
  const container = $("panelContainer");
  if (!container) return;

  const service = SERVICE_REGISTRY.find((s) => s.id === serviceId) || { label: serviceId, icon: "⚡" };
  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">${service.icon}</span>
      <h3 class="workspace-title">${service.label} 서비스</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      상단 중간바에서 실행할 작업을 클릭하거나 단축키를 이용하세요.
    </p>
  `;
  container.appendChild(card);
}


export {
  renderGenericServiceWorkspace,
};
