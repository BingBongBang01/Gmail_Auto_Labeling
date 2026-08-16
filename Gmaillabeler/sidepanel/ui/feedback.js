// sidepanel/ui/feedback.js
// 사용자에게 짧은 상태 메시지를 보여주는 두 가지 수단.
// 어느 모듈에서든 부를 수 있게 화면 상태를 만지는 것 말고는 아무것도 하지 않는다.

import { $ } from "./dom.js";

function setActionFeedback(msg) {
  const desc = $("contextDesc");
  if (desc) desc.textContent = msg;
}


function showSettingsToast(msg) {
  const pill = $("settingsFeedbackPill");
  if (!pill) return;
  pill.textContent = msg;
  pill.classList.add("show");
  clearTimeout(pill._timer);
  pill._timer = setTimeout(() => {
    pill.classList.remove("show");
  }, 2200);
}


export {
  setActionFeedback,
  showSettingsToast,
};
