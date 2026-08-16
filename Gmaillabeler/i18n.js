// i18n.js
// UI 페이지(<script type="module">)와 백그라운드 서비스워커(import) 양쪽에서 공용으로 쓰는
// 최소 구현 i18n 로더. chrome.i18n.getMessage()는 브라우저 언어만 따르고 수동 전환이 안 되므로,
// 사용자가 설정에서 언어를 직접 바꿀 수 있도록 직접 메시지 파일을 읽어와 치환하는 방식으로 구현한다.
// 콘텐츠 스크립트는 ES 모듈을 직접 로드할 수 없으므로 content/i18n_bridge.js가 이 파일을
// 동적 import 해서 쓴다.

const I18N_SUPPORTED_LOCALES = ["en", "ko", "ja", "zh_CN"];

let __i18nMessages = null;
let __i18nLocale = null;

function i18nMapBrowserLangToSupported(lang) {
  const l = (lang || "en").toLowerCase();
  if (l.startsWith("ko")) return "ko";
  if (l.startsWith("ja")) return "ja";
  if (l.startsWith("zh")) return "zh_CN";
  return "en";
}

function i18nResolveLocale() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["appSettings", "uiLanguage"], (result) => {
      const pref = result.appSettings?.general?.language || result.uiLanguage;
      if (pref && pref !== "system" && I18N_SUPPORTED_LOCALES.includes(pref)) {
        resolve(pref);
        return;
      }
      let browserLang = "en";
      try {
        browserLang = chrome.i18n.getUILanguage();
      } catch (e) {
        // ignore, fallback to en
      }
      resolve(i18nMapBrowserLangToSupported(browserLang));
    });
  });
}

// Watch for language changes and re-render the UI dynamically
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && changes.appSettings) {
      const oldSettings = changes.appSettings.oldValue || {};
      const newSettings = changes.appSettings.newValue || {};
      const oldLang = oldSettings.general?.language;
      const newLang = newSettings.general?.language;
      if (newLang && newLang !== oldLang && newLang !== "system") {
        i18nInit(true).then(() => {
          if (typeof document !== "undefined") {
            i18nApplyToDom(document);
          }
        });
      }
    }
  });
}

// 언어가 바뀌었을 때 재로딩할 수 있도록 force 옵션 제공
async function i18nInit(force) {
  const locale = await i18nResolveLocale();
  if (!force && __i18nLocale === locale && __i18nMessages) return locale;
  try {
    const url = chrome.runtime.getURL(`_locales/${locale}/messages.json`);
    const res = await fetch(url);
    __i18nMessages = await res.json();
    __i18nLocale = locale;
  } catch (e) {
    __i18nMessages = __i18nMessages || {};
    __i18nLocale = locale;
  }
  return locale;
}

// 지금 적용 중인 로케일을 동기적으로 조회 (i18nInit이 이미 한 번 실행된 뒤에 씀 - Gemini 프롬프트 언어 결정용)
function i18nCurrentLocale() {
  return __i18nLocale || "ko";
}

function t(key, subs) {
  const entry = __i18nMessages && __i18nMessages[key];
  if (!entry) return key;
  let msg = entry.message;
  if (entry.placeholders) {
    Object.keys(entry.placeholders).forEach((name) => {
      const content = (entry.placeholders[name] && entry.placeholders[name].content) || "";
      // placeholder content은 Chrome 표준 형식인 "$1"과, 이 저장소에 함께 쓰이는 "$1$" 두 가지가 있다.
      // 예전에는 "$1$"만 인식해서, "$1"로 적힌 61개 placeholder(오류 메시지/진행률/할당량/실행 결과 등)가
      // 전부 빈 문자열로 치환돼 숫자와 상세 내용이 사라졌다. 두 형식을 모두 받아준다.
      const m = content.match(/^\$(\d+)\$?$/);
      let value = "";
      if (m && subs) {
        const idx = parseInt(m[1], 10) - 1;
        value = subs[idx] !== undefined ? String(subs[idx]) : "";
      }
      const token = new RegExp(`\\$${name.toUpperCase()}\\$`, "gi");
      msg = msg.replace(token, value);
    });
  }
  return msg;
}

// data-i18n / data-i18n-placeholder 속성이 붙은 요소들을 일괄 번역 (팝업/로그 창 전용, DOM 필요)
function i18nApplyToDom(root) {
  const scope = root || document;
  scope.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  // 아이콘 버튼처럼 툴팁만 있는 요소를 위한 처리
  scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
  });
}

export {
  I18N_SUPPORTED_LOCALES,
  i18nMapBrowserLangToSupported,
  i18nResolveLocale,
  i18nInit,
  i18nCurrentLocale,
  i18nApplyToDom,
  t,
};
