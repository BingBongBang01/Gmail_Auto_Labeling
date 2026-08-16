// sidepanel/workspaces/gmail.js
// Gmail 서비스의 기본 워크스페이스.

import { startJob } from "../job_client.js";
import { $ } from "../ui/dom.js";
import { renderGmailAutoSettingsWorkspace } from "./gmail_auto_settings.js";
import { renderGmailLabelSettingsWorkspace } from "./gmail_label_settings.js";

function renderGmailWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">📧</span>
      <h3 class="workspace-title">Gmail AI 스마트 비서</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      현재 메일함의 수신 메일을 AI로 분석하여 자동 라벨링 및 요약을 수행합니다.
    </p>
    <div class="workspace-btn-grid">
      <button class="btn btn-primary" id="btnSpGmailClassify">▶️ 메일 AI 라벨링 시작</button>
      <button class="btn btn-outlined" id="btnSpGmailAutoSettings">🤖 자동 라벨링 규칙 & 주기 설정</button>
      <button class="btn btn-outlined" id="btnSpGmailLabelSettings">🏷️ 라벨 분류기준 관리 & AI 자동생성</button>
      <button class="btn btn-outlined" id="btnSpGmailSummarize">📝 중요 메일 브리핑 요약</button>
    </div>
  `;
  container.appendChild(card);

  $("btnSpGmailClassify")?.addEventListener("click", () => startJob("gmail_classify"));
  $("btnSpGmailAutoSettings")?.addEventListener("click", () => renderGmailAutoSettingsWorkspace());
  $("btnSpGmailLabelSettings")?.addEventListener("click", () => renderGmailLabelSettingsWorkspace());
  $("btnSpGmailSummarize")?.addEventListener("click", () => startJob("gmail_summarize"));
}


export {
  renderGmailWorkspace,
};
