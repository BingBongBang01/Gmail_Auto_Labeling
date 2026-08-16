// bg/features/appearance/index.js
// 확장의 겉모습(툴바 아이콘, 사이드패널 노출)을 담당하는 기능.
//
// 다른 기능은 이 파일을 import 하지 않는다. 작업 실행 중 아이콘을 바꾸는 것도
// core가 직접 부르는 게 아니라 job.runningChanged 이벤트를 여기서 구독해 처리한다.
// 그래서 background.js에서 이 기능의 import 한 줄을 지우면 아이콘/사이드패널 동작만
// 사라지고 분류·요약 같은 다른 기능은 그대로 돈다.

import { on } from "../../core/events.js";
import { JOB_RUNNING_CHANGED } from "../../core/topics.js";
import { updateDynamicIconFromCode, setActionIconRunning } from "./icon.js";
import { registerSidePanelBehavior } from "./side_panel.js";

function register() {
  // 서비스 워커 구동 시 순수 코드로 아이콘 즉시 렌더링 및 적용
  try {
    updateDynamicIconFromCode();
  } catch (e) {}

  // 워커가 작업 도중 재시작됐다면 "실행 중" 아이콘을 되살린다.
  // 예전에는 이걸 자동화 기능의 onStartup에서 했는데, 브라우저를 켤 때 한 번만 불려서
  // 작업 중 워커가 죽었다 살아난 경우에는 아이콘이 평상시 모양으로 돌아가 있었다.
  chrome.storage.local.get(["jobStatus"], (result) => {
    if (result.jobStatus === "running") setActionIconRunning(true);
  });

  registerSidePanelBehavior();

  on(JOB_RUNNING_CHANGED, ({ running }) => setActionIconRunning(running));
}

export { register };
