// sidepanel/nav/toggles.js
// 켜기/끄기 상태를 가진 액션 타일의 공용 처리.
//
// registry.js의 타일에 toggleKey가 붙어 있으면 그 타일은 "스위치"가 된다.
// 누르면 chrome.storage.local의 해당 키가 true/false로 뒤집히고, 타일에는
// 현재 상태가 표시된다. 어떤 기능인지는 이 파일이 알 필요가 없다 —
// 값을 실제로 쓰는 쪽(컨텐트 스크립트 등)이 같은 키를 구독하면 된다.

import { setActionFeedback } from "../ui/feedback.js";

function readToggle(key, callback) {
  chrome.storage.local.get([key], (res) => callback(!!(res && res[key])));
}

/** 타일 버튼에 현재 on/off 상태를 입힌다. 타일이 그려질 때마다 불린다. */
function applyToggleStateToTile(action, btn) {
  if (!action || !action.toggleKey || !btn) return;

  readToggle(action.toggleKey, (isOn) => {
    btn.classList.toggle("toggle-on", isOn);
    btn.dataset.toggleState = isOn ? "on" : "off";
    btn.title = `${action.title || action.label} (현재: ${isOn ? "켜짐" : "꺼짐"})`;
  });
}

/** 타일을 눌렀을 때: 값을 뒤집고, 화면의 같은 타일을 갱신하고, 안내 문구를 띄운다. */
function toggleActionSetting(action) {
  const key = action && action.toggleKey;
  if (!key) {
    console.warn(`[sidepanel] toggleSetting 타일에 toggleKey가 없다: ${action && action.id}`);
    return;
  }

  readToggle(key, (prev) => {
    const next = !prev;
    chrome.storage.local.set({ [key]: next }, () => {
      document
        .querySelectorAll(`[data-action="${action.id}"]`)
        .forEach((btn) => applyToggleStateToTile(action, btn));

      const message = next
        ? action.onText || `${action.title || action.label}: 켜짐`
        : action.offText || `${action.title || action.label}: 꺼짐`;
      setActionFeedback(message);
    });
  });
}

export { applyToggleStateToTile, toggleActionSetting };
