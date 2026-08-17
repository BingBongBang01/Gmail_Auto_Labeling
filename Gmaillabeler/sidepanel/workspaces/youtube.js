// sidepanel/workspaces/youtube.js
// YouTube 전용 워크스페이스: 실시간 댓글 뷰어, 동영상 AI 분석 및 빠른 탐색.

import { $, escapeHtml } from "../ui/dom.js";
import { setActionFeedback, showSettingsToast } from "../ui/feedback.js";

let currentActiveVideo = {
  title: "",
  channel: "",
  url: "",
  isWatch: false,
  isYouTube: false,
  tabId: null,
};

let loadedComments = [];
let currentFilterKeyword = "";
let currentSortOrder = "likes"; // "likes" | "default"
let isFetchingComments = false;
let hasMoreToFetch = true;
let bottomSentinelObserver = null;

function checkActiveTabVideo(onDetected) {
  if (!chrome.tabs || !chrome.tabs.query) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    const url = (activeTab && activeTab.url) || "";
    const title = (activeTab && activeTab.title) || "";
    const tabId = (activeTab && activeTab.id) || null;

    const isWatch = url.includes("youtube.com/watch") || url.includes("youtube.com/shorts");
    const isYouTube = url.includes("youtube.com");

    currentActiveVideo = {
      title: title.replace(/ - YouTube$/i, "").trim(),
      channel: "",
      url,
      isWatch,
      isYouTube,
      tabId,
    };

    if (onDetected) onDetected(currentActiveVideo);
  });
}

// 직접 탭에서 댓글을 추출하는 인젝션 함수 (스크롤 위치 완벽 보존)
function injectAndExtractCommentsDirectly(triggerContinuation = false) {
  const savedX = window.scrollX;
  const savedY = window.scrollY;

  if (triggerContinuation) {
    const continuations = document.querySelectorAll(
      "ytd-comments ytd-continuation-item-renderer, ytd-item-section-renderer ytd-continuation-item-renderer, ytd-continuation-item-renderer"
    );
    if (continuations.length > 0) {
      continuations.forEach((contEl) => {
        const btn = contEl.querySelector("button, #button, ytd-button-renderer");
        if (btn) btn.click();
        if (typeof contEl.onVisible === "function") {
          try { contEl.onVisible(); } catch (_) { }
        }
        if (typeof contEl.fetchData === "function") {
          try { contEl.fetchData(); } catch (_) { }
        }
        try {
          contEl.scrollIntoView({ behavior: "instant", block: "end" });
        } catch (_) { }
      });
    } else {
      const commentsSection = document.querySelector("#comments, ytd-comments");
      if (commentsSection) {
        try {
          commentsSection.scrollIntoView({ behavior: "instant", block: "center" });
        } catch (_) { }
      }
    }
  }

  const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, ytd-reel-player-header-renderer h2");
  const channelEl = document.querySelector("#channel-name #text, ytd-channel-name yt-formatted-string a, ytd-reel-player-header-renderer .ytd-channel-name");

  const rawTitle = titleEl ? titleEl.textContent.trim() : document.title.replace(/ - YouTube$/i, "").trim();
  const channel = channelEl ? channelEl.textContent.trim() : "";

  const commentNodes = document.querySelectorAll("ytd-comment-thread-renderer, ytd-comment-view-model");
  const comments = [];
  const seen = new Set();

  commentNodes.forEach((node, idx) => {
    const authorEl = node.querySelector("#author-text, .ytd-comment-view-model #author-text");
    let author = "시청자";
    let authorUrl = "";

    if (authorEl) {
      authorUrl = authorEl.getAttribute("href") || "";
      const rawText = authorEl.textContent.trim();
      const lines = rawText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

      if (lines.length > 0) {
        author = lines[0];
        if (author === "@" && lines.length > 1) {
          author = lines[1].startsWith("@") ? lines[1] : `@${lines[1]}`;
        }
      }

      if ((author === "@" || !author || author === "시청자") && authorUrl.includes("/@")) {
        const handlePart = authorUrl.split("/@")[1];
        if (handlePart) author = `@${handlePart.split("/")[0].split("?")[0]}`;
      }
    }

    const textEl = node.querySelector("#content-text, #comment-content, yt-attributed-string#content-text");
    const text = textEl ? textEl.textContent.trim() : "";
    if (!text || seen.has(text)) return;
    seen.add(text);

    const thumbEl = node.querySelector("#author-thumbnail img, yt-img-shadow img");
    const authorThumb = thumbEl ? thumbEl.src || thumbEl.getAttribute("src") || "" : "";

    const likeEl = node.querySelector("#vote-count-middle, #vote-count, .ytd-comment-engagement-bar #vote-count-middle");
    const likeCount = likeEl ? likeEl.textContent.trim() : "0";

    const timeEl = node.querySelector("#published-time-text, .published-time-text a, .ytd-comment-view-model #published-time-text a");
    let publishedTime = "";
    if (timeEl) {
      const timeLines = timeEl.textContent.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      publishedTime = timeLines[0] || timeEl.textContent.trim();
    }

    comments.push({
      id: `yt_cmt_${idx}_${Date.now()}`,
      author,
      authorUrl: authorUrl.startsWith("http") ? authorUrl : authorUrl ? `https://www.youtube.com${authorUrl}` : "",
      authorThumb,
      text,
      likeCount: likeCount || "0",
      publishedTime,
    });
  });

  window.scrollTo({ left: savedX, top: savedY, behavior: "instant" });

  return {
    ok: true,
    videoTitle: rawTitle,
    channelName: channel,
    videoUrl: window.location.href,
    totalFound: comments.length,
    comments,
  };
}

// 탭의 댓글 추출 수행 (실제 웹페이지 스크롤 위치 유지)
function fetchTabComments(scrollMore = false, callback) {
  if (isFetchingComments) return;
  isFetchingComments = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (!activeTab || !activeTab.id || !activeTab.url) {
      isFetchingComments = false;
      if (callback) callback({ ok: false, error: "활성화된 탭을 찾을 수 없습니다." });
      return;
    }

    if (!activeTab.url.includes("youtube.com/watch") && !activeTab.url.includes("youtube.com/shorts")) {
      isFetchingComments = false;
      if (callback) callback({ ok: false, error: "현재 활성 탭이 YouTube 동영상 시청 페이지가 아닙니다." });
      return;
    }

    const action = scrollMore ? "scrollMoreYoutubeComments" : "getYoutubeComments";

    // 1차 시도: 컨텐트 스크립트에 메시지 전송
    chrome.tabs.sendMessage(activeTab.id, { action }, (response) => {
      if (!chrome.runtime.lastError && response && response.ok) {
        isFetchingComments = false;
        if (callback) callback(response);
        return;
      }

      // 2차 시도: chrome.scripting.executeScript로 직접 스크립트 실행
      if (chrome.scripting && chrome.scripting.executeScript) {
        chrome.scripting.executeScript(
          {
            target: { tabId: activeTab.id },
            func: injectAndExtractCommentsDirectly,
            args: [scrollMore],
          },
          (results) => {
            isFetchingComments = false;
            const result = results && results[0] && results[0].result;
            if (callback) callback(result || { ok: false, error: "댓글 추출에 실패했습니다." });
          }
        );
      } else {
        isFetchingComments = false;
        if (callback) callback({ ok: false, error: "스크립팅 권한을 사용할 수 없습니다." });
      }
    });
  });
}

// 좋아요 수 파싱 헬퍼
function parseLikeCount(str) {
  if (!str) return 0;
  let s = str.replace(/,/g, "").trim();
  if (s.includes("만")) return parseFloat(s.replace("만", "")) * 10000;
  if (s.includes("천") || s.includes("K") || s.includes("k")) return parseFloat(s.replace(/천|K|k/g, "")) * 1000;
  if (s.includes("M") || s.includes("m")) return parseFloat(s.replace(/M|m/g, "")) * 1000000;
  const num = parseInt(s, 10);
  return isNaN(num) ? 0 : num;
}

// 댓글 목록 렌더링
function renderCommentsList(preserveScroll = false) {
  const container = $("ytCommentsListContainer");
  const mainScrollContainer = $("mainContent") || document.querySelector(".sidepanel-content");
  if (!container) return;

  const prevScrollTop = mainScrollContainer ? mainScrollContainer.scrollTop : container.scrollTop;

  if (!loadedComments || loadedComments.length === 0) {
    if (isFetchingComments) {
      container.innerHTML = `
        <div class="yt-loading-indicator">
          <div class="yt-spinner"></div>
          <span>YouTube 영상에서 댓글을 불러오는 중입니다...</span>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="yt-empty-comments">
        <span class="yt-empty-icon">💬</span>
        <p>불러온 댓글이 없습니다.</p>
        <span class="yt-empty-sub">YouTube 동영상 탭이 활성화되어 있는지 확인해 주세요.</span>
      </div>`;
    return;
  }

  let filtered = loadedComments;
  if (currentFilterKeyword) {
    const kw = currentFilterKeyword.toLowerCase();
    filtered = loadedComments.filter(
      (c) => c.text.toLowerCase().includes(kw) || c.author.toLowerCase().includes(kw)
    );
  }

  if (currentSortOrder === "likes") {
    filtered = [...filtered].sort((a, b) => parseLikeCount(b.likeCount) - parseLikeCount(a.likeCount));
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="yt-empty-comments">
        <span class="yt-empty-icon">🔍</span>
        <p>'${escapeHtml(currentFilterKeyword)}' 검색 결과가 없습니다.</p>
      </div>`;
    return;
  }

  const itemsHtml = filtered
    .map((c) => {
      const likesDisplay = c.likeCount && c.likeCount !== "0" ? `👍 ${escapeHtml(c.likeCount)}` : "";
      const initial = (c.author || "U").replace(/^@/, "").charAt(0).toUpperCase() || "U";

      return `
        <div class="yt-comment-card" data-id="${escapeHtml(c.id)}">
          <div class="yt-comment-header">
            <div class="yt-comment-author-info">
              ${c.authorThumb
          ? `<img class="yt-comment-avatar" src="${escapeHtml(c.authorThumb)}" alt="${escapeHtml(c.author)}" onerror="this.style.display='none'" />`
          : `<span class="yt-comment-avatar-initial">${escapeHtml(initial)}</span>`
        }
              <div class="yt-comment-author-meta">
                <span class="yt-comment-author-name" title="${escapeHtml(c.author)}">${escapeHtml(c.author)}</span>
                ${c.publishedTime ? `<span class="yt-comment-time">${escapeHtml(c.publishedTime)}</span>` : ""}
              </div>
            </div>
            <div class="yt-comment-actions">
              ${likesDisplay ? `<span class="yt-comment-like-badge">${likesDisplay}</span>` : ""}
              <button class="btn-small yt-comment-btn-copy" data-text="${escapeHtml(c.text)}" title="댓글 복사">📋</button>
            </div>
          </div>
          <div class="yt-comment-body">${escapeHtml(c.text)}</div>
        </div>
      `;
    })
    .join("");

  const bottomHtml = `
    <!-- 바닥 감지 센티넬 및 로딩 인디케이터 -->
    <div class="yt-bottom-sentinel-wrapper" id="ytBottomSentinelWrapper">
      ${isFetchingComments
      ? `<div class="yt-bottom-loading"><div class="yt-spinner-small"></div><span>추가 댓글 불러오는 중...</span></div>`
      : hasMoreToFetch
        ? `<div class="yt-bottom-sentinel" id="ytCommentsBottomSentinel"></div>`
        : `<div class="yt-bottom-end">모든 댓글(${loadedComments.length}개)을 불러왔습니다.</div>`
    }
    </div>
  `;

  container.innerHTML = itemsHtml + bottomHtml;

  // 복사 버튼 이벤트 바인딩
  container.querySelectorAll(".yt-comment-btn-copy").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const text = btn.dataset.text || "";
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          showSettingsToast("댓글이 복사되었습니다.");
        });
      }
    });
  });

  if (preserveScroll && mainScrollContainer) {
    mainScrollContainer.scrollTop = prevScrollTop;
  }

  // IntersectionObserver 등록
  setupBottomSentinelObserver();
}

// 바닥 감지 IntersectionObserver 설정 (바닥에 닿으면 자동 추가 로딩)
function setupBottomSentinelObserver() {
  if (bottomSentinelObserver) {
    bottomSentinelObserver.disconnect();
    bottomSentinelObserver = null;
  }

  const sentinel = $("ytCommentsBottomSentinel");
  if (!sentinel || !hasMoreToFetch || isFetchingComments) return;

  const scrollRoot = $("mainContent") || document.querySelector(".sidepanel-content");

  bottomSentinelObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (
        entry &&
        entry.isIntersecting &&
        !isFetchingComments &&
        hasMoreToFetch &&
        loadedComments.length > 0 &&
        !currentFilterKeyword
      ) {
        loadMoreComments();
      }
    },
    {
      root: scrollRoot,
      rootMargin: "200px", // 바닥 200px 전에 미리 다음 배치 요청
      threshold: 0.05,
    }
  );

  bottomSentinelObserver.observe(sentinel);
}

// 추가 댓글 연속 로딩 함수
function loadMoreComments() {
  if (isFetchingComments || !hasMoreToFetch) return;
  const prevCount = loadedComments.length;

  // 로딩 상태 갱신
  const sentinelWrapper = $("ytBottomSentinelWrapper");
  if (sentinelWrapper) {
    sentinelWrapper.innerHTML = `
      <div class="yt-bottom-loading">
        <div class="yt-spinner-small"></div>
        <span>추가 댓글 불러오는 중...</span>
      </div>`;
  }

  fetchTabComments(true, (res) => {
    if (!res || !res.ok || !res.comments) {
      hasMoreToFetch = false;
      renderCommentsList(true);
      return;
    }

    const seenTexts = new Set(loadedComments.map((c) => c.text));
    const newItems = res.comments.filter((c) => !seenTexts.has(c.text));

    if (newItems.length > 0) {
      loadedComments = [...loadedComments, ...newItems];
      setActionFeedback(`댓글 ${loadedComments.length}개 로드됨 (+${newItems.length})`);
    } else if (res.comments.length > prevCount) {
      loadedComments = res.comments;
    } else {
      hasMoreToFetch = false;
    }

    renderCommentsList(true);
  });
}

/**
 * 사용자 요청 전용 댓글 워크스페이스:
 * 검색창 + 정렬 기준 + 실제 댓글 목록만 표시 (상단 헤더/서브탭/감지배지/툴바 버튼 없음)
 * 바닥까지 스크롤 시 자동으로 추가 댓글 로딩
 */
function renderYoutubeCommentsWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  hasMoreToFetch = true;
  container.innerHTML = "";

  const wrapper = document.createElement("div");
  wrapper.className = "yt-comments-standalone-view";
  wrapper.innerHTML = `
    <!-- 댓글 검색 & 정렬 바 -->
    <div class="yt-comments-filter-row">
      <div class="yt-input-wrapper yt-filter-wrapper">
        <span class="yt-input-icon">🔍</span>
        <input type="text" id="ytCommentFilterInput" class="yt-input yt-filter-input" placeholder="수집된 댓글 검색 (작성자 또는 내용)..." />
        <button class="yt-btn-clear" id="btnYtClearFilter" title="검색 초기화">✕</button>
      </div>
      <select id="ytCommentSortSelect" class="yt-sort-select" title="정렬 기준">
        <option value="likes" ${currentSortOrder === "likes" ? "selected" : ""}>👍 좋아요 순</option>
        <option value="default" ${currentSortOrder === "default" ? "selected" : ""}>⏱️ 수집 순</option>
      </select>
    </div>

    <!-- 댓글 목록 컨테이너 -->
    <div class="yt-comments-list-container" id="ytCommentsListContainer">
      <div class="yt-loading-indicator">
        <div class="yt-spinner"></div>
        <span>YouTube 영상에서 댓글을 불러오는 중입니다...</span>
      </div>
    </div>
  `;

  container.appendChild(wrapper);

  // 검색창 입력 이벤트
  const filterInput = $("ytCommentFilterInput");
  filterInput?.addEventListener("input", (e) => {
    currentFilterKeyword = e.target.value.trim();
    renderCommentsList(false);
  });

  $("btnYtClearFilter")?.addEventListener("click", () => {
    if (filterInput) {
      filterInput.value = "";
      currentFilterKeyword = "";
      renderCommentsList(false);
      filterInput.focus();
    }
  });

  // 정렬 기준 셀렉트 이벤트
  $("ytCommentSortSelect")?.addEventListener("change", (e) => {
    currentSortOrder = e.target.value || "likes";
    renderCommentsList(false);
  });

  // 스크롤 이벤트 리스너 (IntersectionObserver 외 보조 백업 트리거)
  const scrollContainer = $("mainContent") || document.querySelector(".sidepanel-content");
  if (scrollContainer) {
    let scrollTimeout = null;
    scrollContainer.onscroll = () => {
      if (
        scrollContainer.scrollTop + scrollContainer.clientHeight >= scrollContainer.scrollHeight - 100 &&
        !isFetchingComments &&
        hasMoreToFetch &&
        loadedComments.length > 0 &&
        !currentFilterKeyword
      ) {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
          loadMoreComments();
        }, 120);
      }
    };
  }

  // 진입 시 활성 탭 댓글 즉시 불러오기
  fetchTabComments(false, (res) => {
    if (!res || !res.ok) {
      const msg = (res && res.error) || "댓글을 가져오지 못했습니다.";
      setActionFeedback(`오류: ${msg}`);
      renderCommentsList();
      return;
    }

    if (res.comments) {
      loadedComments = res.comments;
      setActionFeedback(`댓글 ${loadedComments.length}개를 불러왔습니다.`);
    }

    renderCommentsList();
  });
}

// AI 영상 분석 워크스페이스
function renderYoutubeWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  container.innerHTML = "";

  const card = document.createElement("div");
  card.className = "workspace-card yt-workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header yt-header">
      <div class="yt-header-title-row">
        <span class="workspace-icon yt-icon">▶️</span>
        <div>
          <h3 class="workspace-title">YouTube 스마트 어시스턴트</h3>
          <span class="yt-subtitle">AI 동영상 요약 및 바로가기</span>
        </div>
      </div>
    </div>

    <!-- URL 및 검색어 입력창 -->
    <div class="yt-search-section">
      <div class="yt-input-wrapper">
        <span class="yt-input-icon">🔍</span>
        <input type="text" id="ytInputUrl" class="yt-input" placeholder="YouTube 영상 URL 또는 제목 입력..." />
        <button class="yt-btn-clear" id="btnYtClearInput" title="입력 초기화">✕</button>
      </div>
      <div class="yt-search-btn-group">
        <button class="btn btn-secondary yt-btn-action" id="btnYtSearchWeb" title="YouTube에서 검색">
          🔍 유튜브 검색
        </button>
        <button class="btn btn-primary yt-btn-action" id="btnYtQuickAnalyze" title="입력된 영상 AI 분석">
          ⚡ AI 분석 시작
        </button>
      </div>
    </div>

    <!-- AI 빠른 프롬프트 칩 -->
    <div class="yt-prompt-section">
      <span class="yt-section-label">AI 빠른 분석 칩:</span>
      <div class="ai-chips-row yt-chips-row">
        <button class="ai-chip yt-chip" id="chipYtSummary3" data-type="summary3">
          📌 3줄 핵심 요약
        </button>
        <button class="ai-chip yt-chip" id="chipYtTimeline" data-type="timeline">
          ⏱️ 타임라인 & 구조
        </button>
        <button class="ai-chip yt-chip" id="chipYtKeywords" data-type="keywords">
          🏷️ 키워드 & 태그 추출
        </button>
        <button class="ai-chip yt-chip" id="chipYtQA" data-type="qa">
          ❓ 핵심 Q&A 분석
        </button>
      </div>
    </div>

    <!-- AI 분석 결과 카드 (기본 숨김) -->
    <div class="yt-result-card" id="ytResultCard" style="display: none;">
      <div class="yt-result-header">
        <div class="yt-result-title-row">
          <span class="yt-result-badge">AI 영상 분석</span>
          <span class="yt-video-badge" id="ytVideoTitleBadge">-</span>
        </div>
        <div class="yt-result-actions">
          <button class="btn-small yt-action-btn" id="btnCopyYtResult" title="결과 복사">📋 복사</button>
          <button class="btn-small yt-action-btn" id="btnCloseYtResult" title="닫기">✕</button>
        </div>
      </div>

      <div class="yt-loading-indicator" id="ytLoadingIndicator" style="display: none;">
        <div class="yt-spinner"></div>
        <span>Gemini AI가 동영상을 분석 중입니다...</span>
      </div>

      <div class="yt-result-body" id="ytResultBody"></div>
    </div>

    <!-- 빠른 바로가기 그리드 -->
    <div class="yt-quick-links-section">
      <span class="yt-section-label">YouTube 서비스 바로가기:</span>
      <div class="yt-links-grid">
        <a href="https://www.youtube.com" target="_blank" class="yt-link-tile" title="YouTube 홈">
          <span class="yt-tile-icon">🌐</span>
          <span class="yt-tile-label">유튜브 홈</span>
        </a>
        <a href="https://studio.youtube.com" target="_blank" class="yt-link-tile" title="YouTube 스튜디오">
          <span class="yt-tile-icon">📊</span>
          <span class="yt-tile-label">스튜디오</span>
        </a>
        <a href="https://www.youtube.com/feed/subscriptions" target="_blank" class="yt-link-tile" title="구독 채널 목록">
          <span class="yt-tile-icon">🔔</span>
          <span class="yt-tile-label">구독 채널</span>
        </a>
        <a href="https://www.youtube.com/feed/history" target="_blank" class="yt-link-tile" title="시청 기록">
          <span class="yt-tile-icon">📜</span>
          <span class="yt-tile-label">시청 기록</span>
        </a>
        <a href="https://www.youtube.com/feed/trending" target="_blank" class="yt-link-tile" title="인기 급상승 동영상">
          <span class="yt-tile-icon">🔥</span>
          <span class="yt-tile-label">인기 급상승</span>
        </a>
        <a href="https://music.youtube.com" target="_blank" class="yt-link-tile" title="YouTube Music">
          <span class="yt-tile-icon">🎵</span>
          <span class="yt-tile-label">YT Music</span>
        </a>
      </div>
    </div>
  `;

  container.appendChild(card);

  checkActiveTabVideo((info) => {
    const inputUrl = $("ytInputUrl");
    if (inputUrl && !inputUrl.value && info.url) {
      inputUrl.value = info.url;
    }
  });

  // 검색 버튼
  $("btnYtSearchWeb")?.addEventListener("click", () => {
    const query = ($("ytInputUrl")?.value || "").trim();
    if (!query) {
      window.open("https://www.youtube.com", "_blank");
    } else if (query.startsWith("http://") || query.startsWith("https://")) {
      window.open(query, "_blank");
    } else {
      window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank");
    }
  });

  $("ytInputUrl")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = ($("ytInputUrl")?.value || "").trim();
      if (val.startsWith("http://") || val.startsWith("https://")) {
        runYouTubeAiAnalysis("summary3");
      } else if (val) {
        window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(val)}`, "_blank");
      }
    }
  });

  $("btnYtClearInput")?.addEventListener("click", () => {
    const input = $("ytInputUrl");
    if (input) {
      input.value = "";
      input.focus();
    }
  });

  $("btnYtQuickAnalyze")?.addEventListener("click", () => {
    runYouTubeAiAnalysis("summary3");
  });

  card.querySelectorAll(".yt-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const promptType = chip.dataset.type || "summary3";
      runYouTubeAiAnalysis(promptType);
    });
  });

  $("btnCloseYtResult")?.addEventListener("click", () => {
    const resultCard = $("ytResultCard");
    if (resultCard) resultCard.style.display = "none";
  });
}

function runYouTubeAiAnalysis(promptType = "summary3", customQuery = "") {
  const inputEl = $("ytInputUrl");
  const resultCard = $("ytResultCard");
  const resultBody = $("ytResultBody");
  const loadingIndicator = $("ytLoadingIndicator");
  const videoTitleEl = $("ytVideoTitleBadge");

  let targetTitle = "";
  let targetUrl = "";

  const inputValue = (inputEl && inputEl.value.trim()) || "";

  if (inputValue.startsWith("http://") || inputValue.startsWith("https://")) {
    targetUrl = inputValue;
    targetTitle = (currentActiveVideo.url === targetUrl && currentActiveVideo.title) || inputValue;
  } else if (inputValue.length > 0) {
    targetTitle = inputValue;
    targetUrl = currentActiveVideo.url || "";
  } else if (currentActiveVideo.isYouTube) {
    targetTitle = currentActiveVideo.title || "YouTube 동영상";
    targetUrl = currentActiveVideo.url || "";
  } else {
    setActionFeedback("분석할 YouTube 동영상 URL 또는 제목을 입력해 주세요.");
    inputEl?.focus();
    return;
  }

  if (videoTitleEl) {
    videoTitleEl.textContent = targetTitle;
    videoTitleEl.title = targetUrl || targetTitle;
  }

  if (resultCard) resultCard.style.display = "block";
  if (loadingIndicator) loadingIndicator.style.display = "flex";
  if (resultBody) resultBody.innerHTML = "";

  setActionFeedback("YouTube AI 분석을 요청 중입니다...");

  chrome.runtime.sendMessage(
    {
      action: "analyzeYouTubeVideo",
      videoTitle: targetTitle,
      videoUrl: targetUrl,
      promptType,
      customPrompt: customQuery,
    },
    (response) => {
      if (loadingIndicator) loadingIndicator.style.display = "none";

      if (chrome.runtime.lastError) {
        setActionFeedback(`오류: ${chrome.runtime.lastError.message}`);
        if (resultBody) {
          resultBody.innerHTML = `
            <div class="yt-error-msg">
              ⚠️ 분석 실패: ${escapeHtml(chrome.runtime.lastError.message)}
            </div>`;
        }
        return;
      }

      if (!response || !response.ok) {
        const errMsg = (response && response.error) || "분석 결과를 가져오지 못했습니다.";
        setActionFeedback(`오류: ${errMsg}`);
        if (resultBody) {
          resultBody.innerHTML = `
            <div class="yt-error-msg">
              ⚠️ ${escapeHtml(errMsg)}
            </div>`;
        }
        return;
      }

      setActionFeedback("YouTube 동영상 AI 분석이 완료되었습니다.");
      renderAnalysisResult(response);
    }
  );
}

function renderAnalysisResult(data) {
  const resultBody = $("ytResultBody");
  if (!resultBody) return;

  const keyPointsHtml = (data.keyPoints || [])
    .map((point) => `<li>${escapeHtml(point)}</li>`)
    .join("");

  const tagsHtml = (data.tags || [])
    .map((tag) => `<span class="yt-tag-pill">#${escapeHtml(tag.replace(/^#/, ""))}</span>`)
    .join(" ");

  const takeawaysHtml = (data.takeaways || [])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  resultBody.innerHTML = `
    <div class="yt-result-section">
      <div class="yt-result-heading">
        <span class="yt-bullet-icon">📌</span>
        <strong>핵심 개요</strong>
      </div>
      <p class="yt-overview-text">${escapeHtml(data.overview || "요약 정보가 없습니다.")}</p>
    </div>

    ${keyPointsHtml
      ? `
      <div class="yt-result-section">
        <div class="yt-result-heading">
          <span class="yt-bullet-icon">📋</span>
          <strong>주요 핵심 포인트</strong>
        </div>
        <ul class="yt-points-list">${keyPointsHtml}</ul>
      </div>`
      : ""
    }

    ${takeawaysHtml
      ? `
      <div class="yt-result-section">
        <div class="yt-result-heading">
          <span class="yt-bullet-icon">💡</span>
          <strong>핵심 시사점 & 추천 대상</strong>
        </div>
        <ul class="yt-points-list">${takeawaysHtml}</ul>
      </div>`
      : ""
    }

    ${tagsHtml
      ? `
      <div class="yt-result-section">
        <div class="yt-result-heading">
          <span class="yt-bullet-icon">🏷️</span>
          <strong>관련 키워드 및 태그</strong>
        </div>
        <div class="yt-tags-container">${tagsHtml}</div>
      </div>`
      : ""
    }
  `;

  const fullTextToCopy = [
    `[YouTube 동영상 AI 분석: ${data.videoTitle}]`,
    data.videoUrl ? `URL: ${data.videoUrl}` : "",
    "",
    "■ 핵심 개요:",
    data.overview,
    "",
    data.keyPoints && data.keyPoints.length ? "■ 주요 핵심 포인트:\n- " + data.keyPoints.join("\n- ") : "",
    "",
    data.takeaways && data.takeaways.length ? "■ 핵심 시사점:\n- " + data.takeaways.join("\n- ") : "",
    "",
    data.tags && data.tags.length ? "■ 키워드: #" + data.tags.join(" #") : ""
  ]
    .filter(Boolean)
    .join("\n");

  const btnCopy = $("btnCopyYtResult");
  if (btnCopy) {
    btnCopy.onclick = () => {
      navigator.clipboard.writeText(fullTextToCopy).then(() => {
        showSettingsToast("분석 결과가 클립보드에 복사되었습니다.");
      });
    };
  }
}

export {
  renderYoutubeWorkspace,
  renderYoutubeCommentsWorkspace,
  runYouTubeAiAnalysis
};
