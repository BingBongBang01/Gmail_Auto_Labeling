// content/youtube_content.js
// YouTube 페이지에서 동영상 정보 및 실시간 댓글을 추출하는 컨텐트 스크립트.

(function () {
  if (window.__yt_content_script_injected__) return;
  window.__yt_content_script_injected__ = true;

  function extractVideoDetails() {
    const titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, ytd-reel-player-header-renderer h2");
    const channelEl = document.querySelector("#channel-name #text, ytd-channel-name yt-formatted-string a, ytd-reel-player-header-renderer .ytd-channel-name");

    const rawTitle = titleEl ? titleEl.textContent.trim() : document.title.replace(/ - YouTube$/i, "").trim();
    const channel = channelEl ? channelEl.textContent.trim() : "";

    return {
      title: rawTitle,
      channel: channel,
      url: window.location.href,
    };
  }

  function parseCommentElement(el, index) {
    if (!el) return null;

    // 작성자 파싱
    const authorEl = el.querySelector("#author-text, .ytd-comment-view-model #author-text");
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

    // 아바타
    const thumbEl = el.querySelector("#author-thumbnail img, yt-img-shadow img");
    const authorThumb = thumbEl ? thumbEl.src || thumbEl.getAttribute("src") || "" : "";

    // 댓글 본문
    const textEl = el.querySelector("#content-text, #comment-content, yt-attributed-string#content-text");
    const text = textEl ? textEl.textContent.trim() : "";

    if (!text) return null;

    // 좋아요 수
    const likeEl = el.querySelector("#vote-count-middle, #vote-count, .ytd-comment-engagement-bar #vote-count-middle");
    const likeCount = likeEl ? likeEl.textContent.trim() : "0";

    // 작성 시간
    const timeEl = el.querySelector("#published-time-text, .published-time-text a, .ytd-comment-view-model #published-time-text a");
    let publishedTime = "";
    if (timeEl) {
      const timeLines = timeEl.textContent.trim().split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      publishedTime = timeLines[0] || timeEl.textContent.trim();
    }

    return {
      id: `yt_cmt_${index}_${Date.now()}`,
      author,
      authorUrl: authorUrl.startsWith("http") ? authorUrl : authorUrl ? `https://www.youtube.com${authorUrl}` : "",
      authorThumb,
      text,
      likeCount: likeCount || "0",
      publishedTime,
    };
  }

  function extractAllComments() {
    const videoDetails = extractVideoDetails();
    const commentNodes = document.querySelectorAll("ytd-comment-thread-renderer, ytd-comment-view-model");

    const comments = [];
    const seenTexts = new Set();

    commentNodes.forEach((node, idx) => {
      const parsed = parseCommentElement(node, idx);
      if (parsed && parsed.text && !seenTexts.has(parsed.text)) {
        seenTexts.add(parsed.text);
        comments.push(parsed);
      }
    });

    return {
      ok: true,
      videoTitle: videoDetails.title,
      channelName: videoDetails.channel,
      videoUrl: videoDetails.url,
      totalFound: comments.length,
      comments,
    };
  }

  // 사용자의 스크롤 위치를 100% 보존하면서 유튜브 다음 댓글 배치를 백그라운드에서 트리거
  async function triggerSilentContinuation() {
    const savedX = window.scrollX;
    const savedY = window.scrollY;

    const continuations = document.querySelectorAll(
      "ytd-comments ytd-continuation-item-renderer, ytd-item-section-renderer ytd-continuation-item-renderer, ytd-continuation-item-renderer"
    );

    if (continuations.length > 0) {
      continuations.forEach((contEl) => {
        const btn = contEl.querySelector("button, #button, ytd-button-renderer");
        if (btn) btn.click();

        if (typeof contEl.onVisible === "function") {
          try { contEl.onVisible(); } catch (_) {}
        }
        if (typeof contEl.fetchData === "function") {
          try { contEl.fetchData(); } catch (_) {}
        }

        try {
          contEl.scrollIntoView({ behavior: "instant", block: "end" });
        } catch (_) {}
      });
    } else {
      // 만약 댓글 섹션 자체가 아직 초기화되지 않았다면 댓글 컨테이너 트리거
      const commentsSection = document.querySelector("#comments, ytd-comments");
      if (commentsSection) {
        try {
          commentsSection.scrollIntoView({ behavior: "instant", block: "center" });
        } catch (_) {}
      }
    }

    // 유튜브 뷰포트 위치 즉시 원래 위치로 강제 복원
    window.scrollTo({ left: savedX, top: savedY, behavior: "instant" });

    // 유튜브 내부 비동기 렌더링 대기
    await new Promise((resolve) => setTimeout(resolve, 650));

    // 사용자의 기존 스크롤 위치 재확인 및 보존
    window.scrollTo({ left: savedX, top: savedY, behavior: "instant" });

    return extractAllComments();
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getYoutubeComments") {
      const result = extractAllComments();
      if (result.comments.length === 0) {
        triggerSilentContinuation().then((res) => {
          sendResponse(res);
        });
        return true;
      }
      sendResponse(result);
      return true;
    }

    if (request.action === "scrollMoreYoutubeComments") {
      triggerSilentContinuation().then((res) => {
        sendResponse(res);
      });
      return true;
    }

    if (request.action === "getYoutubeVideoDetails") {
      sendResponse({ ok: true, ...extractVideoDetails() });
      return true;
    }
  });
})();
