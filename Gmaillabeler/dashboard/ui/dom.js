// dashboard/ui/dom.js
// DOM 접근 헬퍼. 대시보드의 모든 모듈이 공유한다.

// ---------------- 공용 헬퍼 ----------------
function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML.replace(/"/g, "&quot;");
}

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function show(id, visible, displayValue) {
  const el = $(id);
  if (el) el.style.display = visible ? displayValue || "block" : "none";
}


export {
  $,
  escapeHtml,
  setText,
  show,
};
