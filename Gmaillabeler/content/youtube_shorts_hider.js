// content/youtube_shorts_hider.js
// YouTube 쇼츠 자동 숨기기: 피드의 쇼츠 선반(Shorts shelf)과 좌측 사이드바의 Shorts 메뉴.
//
// 사이드패널 중간바의 "쇼츠숨기기" 액션 타일이 chrome.storage.local의
// ytHideShortsShelf 값을 켜고 끈다. 이 스크립트는 그 값을 구독하고 있어서,
// 토글하는 순간 열려 있는 모든 유튜브 탭이 새로고침 없이 함께 반응한다.
//
// 숨기기는 CSS 한 장으로 처리한다(요소를 지우지 않는다). 유튜브가 화면을 다시 그려도
// 규칙이 그대로 살아 있고, 기능을 끄면 style 태그만 떼면 원래대로 돌아온다.
// document_start에 실행돼서 선반이 한 번 번쩍였다가 사라지는 일도 없다.

(function () {
  if (window.__yt_shorts_hider_injected__) return;
  window.__yt_shorts_hider_injected__ = true;

  const STORAGE_KEY = "ytHideShortsShelf";
  const STYLE_ID = "gal-yt-shorts-hider";
  const MARK_ATTR = "data-gal-shorts-shelf";
  const SCAN_INTERVAL_MS = 250;

  // 좌측 사이드바(가이드)의 Shorts 메뉴. 펼친 상태(ytd-guide-entry-renderer)와
  // 접힌 상태(ytd-mini-guide-entry-renderer)가 서로 다른 태그다.
  //
  // 두 상태의 링크 생김새가 다르다. 실제 DOM을 뜯어보고 확인한 내용:
  //   접힌 항목: <a id="endpoint" href="/shorts/" title="Shorts">  <- href 있음(끝에 슬래시!)
  //   펼친 항목: <a id="endpoint" title="Shorts">                  <- href가 아예 없음
  // 그래서 href만으로는 펼친 메뉴를 못 잡는다. title도 같이 본다.
  //
  // 다른 메뉴(홈, 구독...)의 title은 번역되지만 Shorts는 브랜드명이라 그대로인 언어가 많다.
  // 번역되는 언어를 위해 markShortsGuideEntries()가 이름 기준으로 한 번 더 훑는다.
  const GUIDE_SELECTORS = [
    'ytd-guide-entry-renderer:has(> a[title="Shorts"])',
    'ytd-guide-entry-renderer:has(> a[href^="/shorts"])',
    'ytd-mini-guide-entry-renderer:has(> a[title="Shorts"])',
    'ytd-mini-guide-entry-renderer:has(> a[href^="/shorts"])',
  ].join(", ");

  // 유튜브는 레이아웃을 여러 번 갈아엎었고 화면마다 쓰는 렌더러가 다르다.
  // 홈/구독(rich shelf), 검색(reel shelf, grid shelf), 채널(reel shelf),
  // 모바일 레이아웃(ytm-)을 모두 잡으려면 구/신 이름을 같이 적어야 한다.
  //
  // grid-shelf-view-model은 쇼츠 말고 다른 곳에도 쓰일 수 있어서
  // 안에 쇼츠 카드가 들어 있는 경우만 숨긴다.
  //
  // 선반을 "감싼 섹션"까지 숨기면 안 된다. ytd-item-section-renderer는 쇼츠 선반만
  // 담고 있는 게 아니라, 시청 페이지에서는 오른쪽 추천 영상 전체를,
  // 검색 페이지에서는 채널/일반 선반/검색 결과를 같은 #contents에 함께 담는다.
  // 섹션째 숨겼더니 추천 영상이 통째로 사라졌다. 그래서 선반 자신만 숨긴다.
  const HIDE_CSS = `
    ytd-reel-shelf-renderer,
    ytm-reel-shelf-renderer,
    ytd-rich-shelf-renderer[is-shorts],
    grid-shelf-view-model:has(ytm-shorts-lockup-view-model),
    ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),
    ytd-rich-section-renderer:has(grid-shelf-view-model ytm-shorts-lockup-view-model),
    ${GUIDE_SELECTORS},
    [${MARK_ATTR}="1"] {
      display: none !important;
    }
  `;

  // 속성으로는 구분이 안 되는 선반(그냥 ytd-shelf-renderer인데 제목만 "Shorts")도 있다.
  // 이런 건 JS로 훑어서 표시해 두고, 위 CSS의 마지막 규칙이 숨긴다.
  const CANDIDATE_SELECTOR =
    "ytd-shelf-renderer, ytd-rich-section-renderer, ytd-rich-shelf-renderer, ytm-shelf-renderer";
  const TITLE_SELECTOR = "#title, #title-text, .shelf-title, h2 span";
  // \b 를 쓰면 안 된다. \b 는 \w(ASCII 낱말 문자) 경계라서, "쇼츠"나 "ショート"처럼
  // 비ASCII로 끝나는 이름 뒤에서는 성립하지 않는다. 즉 지금껏 영어 UI에서만 동작했다.
  const SHORTS_TITLE_RE = /^\s*(shorts|쇼츠|ショート|短视频)/i;    // 선반 제목: 앞부분 일치
  const SHORTS_LABEL_RE = /^\s*(shorts|쇼츠|ショート|短视频)\s*$/i; // 메뉴 이름: 전체 일치

  let enabled = false;
  let observer = null;
  let scanTimer = null;
  // 한 번 판정한 요소는 다시 보지 않는다. 유튜브 피드는 스크롤할 때마다
  // DOM이 계속 바뀌어서, 매번 전부 다시 훑으면 스크롤이 눈에 띄게 무거워진다.
  let judged = new WeakSet();

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = HIDE_CSS;
    // document_start 시점에는 head가 아직 없을 수 있다.
    (document.head || document.documentElement).appendChild(style);
  }

  function removeStyle() {
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
  }

  function clearMarks() {
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((el) => el.removeAttribute(MARK_ATTR));
    judged = new WeakSet();
  }

  // 제목이 "Shorts"라도 실제 쇼츠 링크가 없으면 건드리지 않는다.
  // (제목만 보고 숨기면 "쇼츠 만들기 강좌" 같은 일반 선반까지 사라진다.)
  function isShortsShelf(el) {
    if (!el.querySelector('a[href^="/shorts/"], ytm-shorts-lockup-view-model')) return false;
    const titleEl = el.querySelector(TITLE_SELECTOR);
    const title = titleEl ? titleEl.textContent.trim() : "";
    return SHORTS_TITLE_RE.test(title);
  }

  // 좌측 메뉴 폴백: Shorts라는 이름이 번역되는 언어에서는 위 CSS의 title="Shorts"가 빗나간다.
  // 이름으로 한 번 더 훑되, is-primary 항목(홈/Shorts/구독/내 페이지)으로만 한정한다.
  // 구독 채널도 같은 태그로 그려지기 때문에, 범위를 안 좁히면 이름에 "Shorts"가 들어간
  // 구독 채널까지 목록에서 사라진다.
  function markShortsGuideEntries() {
    document
      .querySelectorAll("ytd-guide-entry-renderer[is-primary], ytd-mini-guide-entry-renderer")
      .forEach((el) => {
        if (el.getAttribute(MARK_ATTR) === "1") return;
        const link = el.querySelector("a");
        if (!link) return;

        const href = link.getAttribute("href") || "";
        const label = (link.getAttribute("title") || el.textContent || "").trim();
        if (href.startsWith("/shorts") || SHORTS_LABEL_RE.test(label)) {
          el.setAttribute(MARK_ATTR, "1");
        }
      });
  }

  function scanAndMark() {
    scanTimer = null;
    if (!enabled) return;

    markShortsGuideEntries();

    document.querySelectorAll(CANDIDATE_SELECTOR).forEach((el) => {
      if (judged.has(el)) return;

      if (isShortsShelf(el)) {
        el.setAttribute(MARK_ATTR, "1");
        judged.add(el);
        return;
      }

      // 제목이 아직 안 붙은 껍데기일 수 있다. 그때는 판정을 미루고 다음 스캔에 다시 본다.
      const titleEl = el.querySelector(TITLE_SELECTOR);
      if (titleEl && titleEl.textContent.trim()) judged.add(el);
    });
  }

  function scheduleScan() {
    if (scanTimer || !enabled) return;
    scanTimer = setTimeout(scanAndMark, SCAN_INTERVAL_MS);
  }

  function startObserving() {
    if (observer) return;
    observer = new MutationObserver(scheduleScan);
    // document_start에는 body가 아직 없다. documentElement를 보면 나중에 생기는
    // body와 그 아래 전부가 subtree로 함께 잡힌다.
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stopObserving() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    clearTimeout(scanTimer);
    scanTimer = null;
  }

  function apply(next) {
    const value = !!next;
    if (value === enabled) return;
    enabled = value;

    if (enabled) {
      ensureStyle();
      startObserving();
      scheduleScan();
    } else {
      stopObserving();
      removeStyle();
      clearMarks();
    }
  }

  // SPA 이동(홈 -> 검색 등)은 DOM 변경으로도 잡히지만, 유튜브가 화면을 통째로
  // 갈아끼우는 경우가 있어 전용 이벤트에서도 한 번 더 훑는다.
  document.addEventListener("yt-navigate-finish", scheduleScan, true);

  chrome.storage.local.get([STORAGE_KEY], (res) => {
    apply(res && res[STORAGE_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    apply(changes[STORAGE_KEY].newValue);
  });
})();
