// sidepanel/ui/dom.js
// DOM 접근 헬퍼. 사이드패널의 모든 모듈이 공유한다.

const $ = (id) => document.getElementById(id);


function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


export {
  $,
  escapeHtml,
};
