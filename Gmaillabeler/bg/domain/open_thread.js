// bg/domain/open_thread.js
// "지금 Gmail에서 열려 있는 메일"을 알아내는 공통 헬퍼.
// 분류(스레드 분류)와 요약(스레드 요약)이 똑같이 쓰기 때문에 어느 한 기능에 두지 않는다.

// 콘텐츠 스크립트가 저장해둔 "지금 Gmail에서 열려 있는 메일" 정보를 읽는다.
async function resolveOpenThreadMessageIds() {
  const stored = await new Promise((resolve) => chrome.storage.local.get(["gmailPageContext"], resolve));
  const context = stored.gmailPageContext;
  if (!context || !Array.isArray(context.messageIds) || !context.messageIds.length) return [];
  // 오래된 컨텍스트로 엉뚱한 메일을 건드리지 않도록 유효 시간을 둔다.
  if (!context.at || Date.now() - context.at > 10 * 60 * 1000) return [];
  return context.messageIds;
}

const NO_OPEN_THREAD_ERROR = "열려 있는 메일을 찾지 못했습니다. Gmail에서 메일을 열고 다시 시도하세요.";

async function resolveThreadTargets(payload) {
  return Array.isArray(payload.messageIds) && payload.messageIds.length
    ? payload.messageIds
    : await resolveOpenThreadMessageIds();
}

export { NO_OPEN_THREAD_ERROR, resolveOpenThreadMessageIds, resolveThreadTargets };
