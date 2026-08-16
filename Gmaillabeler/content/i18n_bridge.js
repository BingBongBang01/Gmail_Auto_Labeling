// content/i18n_bridge.js
// 콘텐츠 스크립트는 manifest의 content_scripts로 로드되는 classic script라서 ES 모듈이 될 수 없다.
// (import 문을 쓰면 파싱 단계에서 바로 실패한다)
//
// i18n.js는 서비스워커와 확장 페이지에서 ES 모듈로 쓰이므로, 여기서는 동적 import()로 끌어와
// 예전과 똑같은 이름(i18nInit / t / i18nCurrentLocale)의 전역 함수로 다시 노출한다.
// 동적 import는 콘텐츠 스크립트에서도 동작하지만, 대상 파일이 web_accessible_resources에
// 등록되어 있어야 한다(manifest 참고).
//
// 이 파일은 content_scripts 목록에서 반드시 다른 콘텐츠 스크립트보다 먼저 와야 한다.

const __i18nModulePromise = import(chrome.runtime.getURL("i18n.js")).catch((e) => {
  console.warn("[GmailLabeler] i18n 모듈을 불러오지 못했습니다:", e);
  return null;
});

let __i18nModule = null;

// 호출부(ui_detail_card.js 등)는 t()를 쓰기 전에 반드시 이걸 await 한다.
async function i18nInit(force) {
  __i18nModule = await __i18nModulePromise;
  if (!__i18nModule) return "en";
  return __i18nModule.i18nInit(force);
}

// i18nInit이 끝나기 전에 불리면 키를 그대로 돌려준다(i18n.js의 미등록 키 처리와 동일한 동작).
function t(key, subs) {
  return __i18nModule ? __i18nModule.t(key, subs) : key;
}

function i18nCurrentLocale() {
  return __i18nModule ? __i18nModule.i18nCurrentLocale() : "en";
}
