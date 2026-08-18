// sidepanel/nav/commands.js
// 액션 타일이 가리키는 command 문자열을 실제 동작으로 잇는 표.
//
// registry.js(타일 데이터)와 실제 동작을 갈라놓기 위한 파일이다.
// 덕분에 registry.js는 import가 하나도 없는 순수 데이터가 되고, 타일 목록을 고치는 일과
// 동작을 고치는 일이 서로를 건드리지 않는다.
//
// 새 동작을 추가하려면 여기 항목 하나만 늘리면 된다.

import { startJob } from "../job_client.js";
import { setActionFeedback } from "../ui/feedback.js";
import { renderWorkspaceByName } from "../workspaces/index.js";
import { renderSettingsPanel } from "../workspaces/settings.js";
import { resetCurrentServiceActions } from "./action_nav.js";
import { getTileState } from "./tile_state.js";
import { renderTileNotice } from "../workspaces/notice.js";

const COMMANDS = {
  // 백그라운드 작업 시작. arg는 jobType.
  job: (arg) => startJob(arg),

  // 워크스페이스 전환. arg는 워크스페이스 이름.
  workspace: (arg) => renderWorkspaceByName(arg),

  // 설정 패널의 특정 섹션 열기. arg는 섹션 id.
  settingsSection: (arg) => renderSettingsPanel(arg),

  // 새 탭으로 외부 링크 열기. arg는 URL.
  openUrl: (arg) => window.open(arg, "_blank"),

  // 안내 문구만 표시. arg는 문구.
  feedback: (arg) => setActionFeedback(arg),

  // 진행 중인 작업 중지. '작업' 서비스의 타일에서 바로 누를 수 있어야 하는 동작이라
  // 화면을 열지 않고 실행한다.
  cancelJob: () => {
    chrome.runtime.sendMessage({ action: "cancelJob" }, () => {
      setActionFeedback("중지를 요청했습니다. 진행분까지는 남습니다.");
    });
  },

  openLogPage: () => chrome.tabs.create({ url: chrome.runtime.getURL("log/log.html") }),

  resetActions: () => resetCurrentServiceActions(),
  openOptions: () => chrome.runtime.openOptionsPage?.(),
  openDashboard: () => chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") }),
};

/**
 * 타일 하나를 실행한다. 모르는 command는 조용히 무시하지 않고 콘솔에 남긴다
 * (오타 난 command가 "눌러도 아무 반응 없음"으로만 나타나면 원인을 찾기 어렵다).
 *
 * 아직 못 하는 일이면 실행하지 않고 왜 못 하는지 본문에 띄운다. 실행을 시도해봐야
 * 백그라운드가 "지원하지 않는 작업"이라고 답할 뿐이고, 사용자는 그 이유를 알 수 없다.
 */
function runCommand(action) {
  if (!action || !action.command) return;

  const state = getTileState(action);
  if (!state.available) {
    renderTileNotice(action, state);
    return;
  }

  const fn = COMMANDS[action.command];
  if (!fn) {
    console.warn(`[sidepanel] 알 수 없는 command: "${action.command}" (타일: ${action.id})`);
    return;
  }
  fn(action.arg);
}

export { COMMANDS, runCommand };
