// sidepanel/sidepanel.js
// 사이드패널 진입점. 하는 일은 모듈을 조립하고 초기화하는 것뿐이다.
//
//   ui/          dom, 피드백, 테마, 진행률, 컨텍스트, 이벤트 버스
//   nav/         상단 서비스 타일 / 하단 액션 타일 내비게이션 + 타일 데이터 + 커맨드 표
//   workspaces/  서비스별 화면. 서로를 import 하지 않고 workspaces/index.js가 분기한다
//   job_client   백그라운드에 작업을 요청하는 유일한 통로
//
// 서비스 타일을 누르면 nav/service_nav.js가 SERVICE_SELECTED 이벤트만 발행하고,
// 그걸 받아 무엇을 그릴지 정하는 것은 이 파일이다. 그래서 내비는 워크스페이스를 모르고,
// 워크스페이스는 내비를 모른다.

import { SettingsStore } from "../settings/settings_store.js";
import { i18nInit, i18nApplyToDom } from "../i18n.js";

import { on, SERVICE_SELECTED } from "./ui/bus.js";
import { initTheme } from "./ui/theme.js";
import { initProgressSection } from "./ui/progress.js";
import { updateContextUI, detectInitialContext, initActionButtons } from "./ui/context.js";
import { SERVICE_REGISTRY } from "./nav/registry.js";
import { initNavResize, getServiceList } from "./nav/service_nav.js";
import { initActionNavResize, showActionsForService } from "./nav/action_nav.js";
import { primeTileCatalog } from "./nav/tile_state.js";
import { renderServiceWorkspace } from "./workspaces/index.js";
import { initLabelSettingsJobListener } from "./workspaces/gmail_label_settings.js";

// 서비스 타일 선택 -> 컨텍스트 갱신 -> 액션 타일 교체 -> 워크스페이스 렌더.
// 이 연결이 사이드패널에서 유일한 "모듈 간 조립" 지점이다.
function handleServiceChange(serviceId) {
  const service =
    getServiceList().find((s) => s.id === serviceId) ||
    SERVICE_REGISTRY.find((s) => s.id === serviceId);
  if (!service) return;

  updateContextUI({
    service: service.label,
    pageType: serviceId === "settings" ? "settings" : "inbox",
    title: service.label,
    desc:
      serviceId === "settings"
        ? "사이드패널에서 즉시 변경할 설정 항목을 선택하세요."
        : `${service.label} 서비스와 연동할 준비가 되었습니다.`,
  });

  showActionsForService(service.id, () => renderServiceWorkspace(service.id));
}

async function initSidePanel() {
  await i18nInit();
  i18nApplyToDom(document);

  SettingsStore.getSettings((settings) => initTheme(settings));

  on(SERVICE_SELECTED, ({ serviceId }) => handleServiceChange(serviceId));

  initProgressSection();
  initLabelSettingsJobListener();

  // 타일을 그리기 전에 "실제로 등록된 작업 목록"을 받아 둔다. 이게 있어야 없는 작업을
  // 가리키는 타일을 회색으로 그릴 수 있다. 실패해도(서비스워커가 자는 중 등) 그냥 진행한다 -
  // 확인하지 못했다는 이유로 멀쩡한 타일을 막으면 그게 더 나쁘다.
  await primeTileCatalog();

  initNavResize();
  initActionNavResize();
  initActionButtons();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "context.update") {
      updateContextUI(msg.context);
    }
  });

  detectInitialContext();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidePanel);
} else {
  initSidePanel();
}
