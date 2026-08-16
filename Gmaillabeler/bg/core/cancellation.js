// bg/core/cancellation.js
// 실행 중인 작업의 "중지" 상태와, 그 상태에 반응하는 fetch 래퍼.
//
// 중지 플래그를 export한 변수로 노출하지 않고 함수(isCancelled / requestCancellation)로만
// 여닫는 이유: ES 모듈의 import 바인딩은 읽기 전용이라 다른 모듈에서 `cancelRequested = true`로
// 직접 쓸 수 없다. 상태 변경 경로를 함수 두 개로 고정해두면 누가 언제 중지를 걸었는지도 한곳에서 추적된다.

let cancelRequested = false;
const activeJobAbortControllers = new Set();

class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled by user");
    this.name = "JobCancelledError";
    this.isJobCancelled = true;
  }
}

function isCancellationError(error) {
  return !!(error && (error.isJobCancelled || error.name === "AbortError"));
}

function isCancelled() {
  return cancelRequested;
}

// 진행 중인 fetch를 즉시 끊는다. 이전에는 다음 배치 경계까지 기다렸기 때문에
// AI 응답이 멈춘 경우 작업 자체를 끝낼 수 없었다.
function abortActiveJobRequests() {
  for (const controller of activeJobAbortControllers) controller.abort();
}

// fetchWithJobCancellation을 쓸 수 없는 호출부(재시도 때문에 컨트롤러 수명을 직접 관리해야 하는
// gmailFetch 등)가 자기 AbortController를 중지 대상에 올릴 때 쓴다.
// 반드시 finally에서 unregisterAbortController를 불러야 Set이 무한히 자라지 않는다.
function registerAbortController(controller) {
  activeJobAbortControllers.add(controller);
}

function unregisterAbortController(controller) {
  activeJobAbortControllers.delete(controller);
}

// 중지 요청. 플래그를 세우고 떠 있는 요청을 전부 끊는다.
function requestCancellation() {
  cancelRequested = true;
  abortActiveJobRequests();
}

// 새 작업을 시작할 때 이전 작업의 중지 플래그를 내린다.
function resetCancellation() {
  cancelRequested = false;
}

async function fetchWithJobCancellation(url, options, timeoutMs) {
  if (isCancelled()) throw new JobCancelledError();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  activeJobAbortControllers.add(controller);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (isCancelled()) throw new JobCancelledError();
    if (err && err.name === "AbortError") {
      const timeoutError = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      timeoutError.isRequestTimeout = true;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    activeJobAbortControllers.delete(controller);
  }
}

export {
  JobCancelledError,
  isCancellationError,
  isCancelled,
  requestCancellation,
  resetCancellation,
  abortActiveJobRequests,
  registerAbortController,
  unregisterAbortController,
  fetchWithJobCancellation,
};
