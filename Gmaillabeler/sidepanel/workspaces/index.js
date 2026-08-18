// sidepanel/workspaces/index.js
// 어떤 서비스가 선택됐는지에 따라 해당 워크스페이스를 그린다.
// 서비스를 추가하려면 여기 분기 한 줄과 워크스페이스 파일 하나만 추가하면 된다.

import { $ } from "../ui/dom.js";
import { renderCalendarWorkspace } from "./calendar.js";
import { renderEditWorkspace } from "./edit.js";
import { renderGenericServiceWorkspace } from "./generic.js";
import { renderGmailWorkspace } from "./gmail.js";
import { getCurrentSettingsSection, renderSettingsPanel } from "./settings.js";
import { renderGmailAutoSettingsWorkspace } from "./gmail_auto_settings.js";
import { renderGmailLabelSettingsWorkspace } from "./gmail_label_settings.js";
import { renderYoutubeCommentsWorkspace, renderYoutubeWorkspace } from "./youtube.js";
import { renderPdfWorkspace } from "./pdf.js";
import { renderActivityWorkspace } from "./activity.js";
import { renderLearningWorkspace } from "./learning.js";
import { renderAiWorkspace } from "./ai.js";
import { renderCleanupWorkspace } from "./cleanup.js";
import { renderGlossaryWorkspace } from "./glossary.js";
import { renderQuickEventWorkspace } from "./quick_event.js";

function renderServiceWorkspace(serviceId) {
  const container = $("panelContainer");
  const dynamicActions = $("dynamicActions");
  if (!container) return;

  if (dynamicActions) dynamicActions.innerHTML = "";
  container.innerHTML = "";

  if (serviceId === "settings") {
    renderSettingsPanel(getCurrentSettingsSection() || "oauth");
  } else if (serviceId === "gmail") {
    renderGmailWorkspace();
  } else if (serviceId === "calendar") {
    renderCalendarWorkspace();
  } else if (serviceId === "youtube") {
    renderYoutubeCommentsWorkspace();
  } else if (serviceId === "docs") {
    renderPdfWorkspace();
  } else if (serviceId === "activity") {
    renderActivityWorkspace();
  } else if (serviceId === "learning") {
    renderLearningWorkspace();
  } else if (serviceId === "ai") {
    renderAiWorkspace();
  } else if (serviceId === "edit") {
    renderEditWorkspace();
  } else {
    renderGenericServiceWorkspace(serviceId);
  }
}


// 서비스 워크스페이스가 아니라 "이름으로 지정한 하위 화면"을 그린다.
// 액션 타일의 command: "workspace" 가 이걸 부른다.
// 여기 없는 이름은 조용히 무시하지 않고 콘솔에 남긴다.
const NAMED_WORKSPACES = {
  gmail_auto_settings: renderGmailAutoSettingsWorkspace,
  gmail_label_settings: renderGmailLabelSettingsWorkspace,
  youtube_workspace: () => renderYoutubeWorkspace(),
  youtube_comments: () => renderYoutubeCommentsWorkspace(),
  pdf_translate: () => renderPdfWorkspace(),
  // 한 화면 안의 탭을 타일로 직접 열 수 있게 이름을 따로 준다.
  // 타일은 arg 하나만 넘길 수 있으므로 탭마다 항목을 두는 편이 command 규약을 건드리지 않는다.
  activity_now: () => renderActivityWorkspace("now"),
  activity_recent: () => renderActivityWorkspace("recent"),
  activity_logs: () => renderActivityWorkspace("logs"),
  activity_usage: () => renderActivityWorkspace("usage"),
  learning_patterns: () => renderLearningWorkspace("patterns"),
  learning_recent: () => renderLearningWorkspace("recent"),
  ai_run: () => renderAiWorkspace("run"),
  ai_status: () => renderAiWorkspace("status"),
  gmail_cleanup: () => renderCleanupWorkspace(),
  glossary: () => renderGlossaryWorkspace(),
  calendar_quick_event: () => renderQuickEventWorkspace("text"),
  calendar_from_mail: () => renderQuickEventWorkspace("mail"),
};

function renderWorkspaceByName(name) {
  const render = NAMED_WORKSPACES[name];
  if (!render) {
    console.warn(`[sidepanel] 알 수 없는 워크스페이스: "${name}"`);
    return;
  }
  render();
}

// 타일이 가리키는 화면이 실제로 있는지 nav/tile_state.js가 물어본다.
// NAMED_WORKSPACES를 통째로 내보내지 않는 이유: 밖에서 표를 고칠 수 있게 되면
// "화면 목록은 이 파일이 소유한다"는 규칙이 깨진다.
function hasNamedWorkspace(name) {
  return Object.prototype.hasOwnProperty.call(NAMED_WORKSPACES, name);
}

export { renderServiceWorkspace, renderWorkspaceByName, hasNamedWorkspace };
