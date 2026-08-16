// sidepanel/workspaces/gemini.js
// AI(Gemini) 서비스 워크스페이스.

import { $ } from "../ui/dom.js";
import { setActionFeedback } from "../ui/feedback.js";

function renderGeminiWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">✨</span>
      <h3 class="workspace-title">Gemini AI 어시스턴트</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      빠른 프롬프트 칩을 선택하거나 직접 AI 작업을 실행하세요.
    </p>
    <div class="ai-chips-row">
      <button class="ai-chip" data-prompt="오늘 받은 긴급 메일 요약해줘">📬 긴급 메일 요약</button>
      <button class="ai-chip" data-prompt="정중한 거절 메일 답장 초안 작성해줘">✍️ 정중한 답장 초안</button>
      <button class="ai-chip" data-prompt="이번 주 남은 일정 브리핑">📆 이번 주 일정 요약</button>
    </div>
  `;
  container.appendChild(card);

  card.querySelectorAll(".ai-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      setActionFeedback(`Gemini 요청: "${chip.dataset.prompt}"`);
    });
  });
}


export {
  renderGeminiWorkspace,
};
