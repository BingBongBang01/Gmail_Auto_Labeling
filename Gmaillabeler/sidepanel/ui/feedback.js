// sidepanel/ui/feedback.js
// 사용자에게 짧은 상태 메시지를 보여주는 두 가지 수단.
// 어느 모듈에서든 부를 수 있게 화면 상태를 만지는 것 말고는 아무것도 하지 않는다.

import { $ } from "./dom.js";

// 메시지를 이 시간 동안 보여준 뒤 원래 화면 설명으로 되돌린다.
// 되돌리지 않으면 마지막 작업 메시지가 영구히 남아, "지금 무엇을 보고 있는지"를
// 알려주는 자리를 잡아먹는다.
const FEEDBACK_HOLD_MS = 4000;

function setActionFeedback(msg) {
  const desc = $("contextDesc");
  if (!desc) return;

  // 원래 설명은 updateContextUI가 dataset에 적어둔다. 아직 없으면 지금 값이 원래 값이다.
  if (desc.dataset.baseDesc === undefined) desc.dataset.baseDesc = desc.textContent || "";

  desc.textContent = msg;
  desc.classList.add("is-feedback");

  clearTimeout(desc._restoreTimer);
  desc._restoreTimer = setTimeout(() => {
    desc.textContent = desc.dataset.baseDesc || "";
    desc.classList.remove("is-feedback");
  }, FEEDBACK_HOLD_MS);
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
