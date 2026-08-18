// sidepanel/nav/tile_state.js
// "이 타일을 지금 누를 수 있는가"를 판정하는 한 곳.
//
// 판정은 두 층이다.
//   1. registry.js에 적어둔 status  - 사람이 선언한 것("아직 안 만들었다", "만들 수 없다")
//   2. 백그라운드에 실제로 등록된 작업 목록 - 코드가 확인한 것
//
// 2번이 필요한 이유: 1번은 손으로 적는 값이라 코드와 어긋날 수 있다. 실제로 타일 59개 중
// 30개가 등록되지도 않은 작업을 가리키고 있었고, 그 사실을 아무도 몰랐다. 화면 쪽에서
// 한 번 대조해두면 같은 일이 다시 생겨도 "준비 중"으로 표시될 뿐 사용자를 속이지 않는다.
//
// 작업 목록은 사이드패널이 뜰 때 한 번만 받아 온다. 못 받아 오면(서비스워커가 자는 중 등)
// 검사를 건너뛴다 - 확인하지 못했다는 이유로 멀쩡한 타일을 막으면 그게 더 나쁘다.

import { hasNamedWorkspace } from "../workspaces/index.js";

let knownJobTypes = null; // Set | null(아직 못 받음)

function primeTileCatalog() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: "job.listTypes" }, (response) => {
      if (chrome.runtime.lastError || !response || !Array.isArray(response.types)) {
        knownJobTypes = null;
        resolve(false);
        return;
      }
      knownJobTypes = new Set(response.types);
      resolve(true);
    });
  });
}

/**
 * @returns {{available: boolean, status: string|null, note: string, needsScope: string|null}}
 *   available=false 이면 타일을 회색으로 그리고, 눌렀을 때 note를 안내한다.
 */
function getTileState(action) {
  if (!action) return { available: false, status: "unavailable", note: "알 수 없는 타일입니다.", needsScope: null };

  if (action.status) {
    return {
      available: false,
      status: action.status,
      note: action.note || "아직 사용할 수 없는 기능입니다.",
      needsScope: action.needsScope || null,
    };
  }

  // 여기부터는 "된다"고 선언된 타일을 실제와 대조하는 안전망이다.
  if (action.command === "job" && knownJobTypes && !knownJobTypes.has(action.arg)) {
    return {
      available: false,
      status: "missing",
      note: `이 타일이 가리키는 작업(${action.arg})이 백그라운드에 등록되어 있지 않습니다. 확장 버그이니 개발자에게 알려주세요.`,
      needsScope: null,
    };
  }

  if (action.command === "workspace" && !hasNamedWorkspace(action.arg)) {
    return {
      available: false,
      status: "missing",
      note: `이 타일이 가리키는 화면(${action.arg})이 없습니다. 확장 버그이니 개발자에게 알려주세요.`,
      needsScope: null,
    };
  }

  return { available: true, status: null, note: "", needsScope: null };
}

export { primeTileCatalog, getTileState };
