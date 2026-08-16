// bg/core/util.js
// 특정 기능에 속하지 않는 순수 헬퍼. 여기에는 도메인 지식(라벨, 카테고리, Gmail 등)을 넣지 않는다.

import { isCancelled } from "./cancellation.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// 로그 표시용으로 긴 제목을 줄여서 보여줌 (저장되는 실제 데이터는 원본 그대로 유지)
function truncateForLog(text, maxLen) {
  const limit = maxLen || 28;
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}…`;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// items를 최대 concurrency개씩 동시에 worker에 넘긴다. 결과는 입력 순서를 그대로 유지한다.
// worker는 스스로 예외를 처리해야 한다(여기서는 개별 실패를 삼키지 않고 그대로 전파).
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const runners = [];
  for (let w = 0; w < workerCount; w += 1) {
    runners.push(
      (async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= items.length) return;
          if (isCancelled()) return; // 중지되면 남은 항목은 손대지 않는다
          results[index] = await worker(items[index], index);
        }
      })()
    );
  }

  await Promise.all(runners);
  return results;
}

export { sleep, simpleHash, truncateForLog, chunkArray, mapWithConcurrency };
