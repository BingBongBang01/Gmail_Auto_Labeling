// bg/core/logger.js
// 로그가 수천~수만 줄까지 쌓일 수 있어서(대량 메일 처리 시), chrome.storage.local(매번 전체 배열을 다시 쓰고
// 500개로 잘라내던 방식)은 느리고 오래된 로그가 사라지는 문제가 있었다. 대신 IndexedDB에 한 줄씩 추가(append)
// 저장한다 - 매번 전체를 다시 쓸 필요가 없고, 사실상 용량 제한 없이 전체 로그를 보존할 수 있다.
//
// 로그는 한 줄마다 트랜잭션 + storage.local.set을 하지 않고 버퍼에 모아 한 번에 기록한다.
// (메일 수천 건을 처리할 때 로그 쓰기와 storage 변경 브로드캐스트가 전체 처리 시간을 지배했다)

import { openLogDb, LOG_STORE_NAME } from "./log_db.js";

const LOG_FLUSH_INTERVAL_MS = 250;
const LOG_FLUSH_MAX_PENDING = 25;

// 로그는 작업마다 지우지 않고 누적하므로, 무한정 늘어나지 않도록 보존 상한을 둔다.
const MAX_STORED_LOG_ENTRIES = 5000;
const LOG_PRUNE_CHECK_EVERY = 200; // 이만큼 기록될 때마다 한 번씩만 확인(매번 count 하면 낭비)

let pendingLogEntries = [];
let logFlushTimer = null;
let logFlushInFlight = null;
let logsWrittenSincePrune = 0;

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    flushLogs();
  }, LOG_FLUSH_INTERVAL_MS);
}

async function pruneOldLogsIfNeeded() {
  if (logsWrittenSincePrune < LOG_PRUNE_CHECK_EVERY) return;
  logsWrittenSincePrune = 0;
  try {
    const db = await openLogDb();
    const total = await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readonly");
      const req = tx.objectStore(LOG_STORE_NAME).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
    const excess = total - MAX_STORED_LOG_ENTRIES;
    if (excess <= 0) return;

    // id가 autoIncrement라 커서 앞쪽이 항상 가장 오래된 로그다
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readwrite");
      const cursorReq = tx.objectStore(LOG_STORE_NAME).openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= excess) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    console.log(`[GmailLabeler] 오래된 로그 ${excess}건 정리 (보존 상한 ${MAX_STORED_LOG_ENTRIES}건)`);
  } catch (e) {
    console.error("오래된 로그 정리 실패:", e);
  }
}

async function flushLogs() {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  // 동시에 여러 flush가 겹치지 않도록 직렬화
  if (logFlushInFlight) {
    await logFlushInFlight;
    if (!pendingLogEntries.length) return;
  }
  if (!pendingLogEntries.length) return;

  const batch = pendingLogEntries;
  pendingLogEntries = [];

  logFlushInFlight = (async () => {
    try {
      const db = await openLogDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOG_STORE_NAME, "readwrite");
        const store = tx.objectStore(LOG_STORE_NAME);
        for (const entry of batch) store.add(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      // 팝업/로그창이 "새 로그 있음"을 감지할 수 있도록 가벼운 타임스탬프만 남김(전체 로그는 IndexedDB에)
      await chrome.storage.local.set({ jobLogsUpdatedAt: Date.now() });
      logsWrittenSincePrune += batch.length;
      await pruneOldLogsIfNeeded();
    } catch (e) {
      console.error("로그 저장 실패:", e);
    }
  })();

  await logFlushInFlight;
  logFlushInFlight = null;
}

async function addLog(message, level, detail) {
  const lvl = level || "info";
  console.log(`[GmailLabeler] ${message}`);
  pendingLogEntries.push({ t: Date.now(), level: lvl, message, detail: !!detail });
  if (pendingLogEntries.length >= LOG_FLUSH_MAX_PENDING) {
    await flushLogs();
    return;
  }
  scheduleLogFlush();
}

async function clearLogs() {
  // 버퍼에 남은 로그가 나중에 되살아나지 않도록 함께 버린다
  pendingLogEntries = [];
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readwrite");
      tx.objectStore(LOG_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("로그 초기화 실패:", e);
  }
}

async function getRecentLogs(limit = 100) {
  // 아직 디스크에 안 내려간 버퍼 로그도 조회 결과에 보이도록 먼저 flush
  await flushLogs();
  try {
    const db = await openLogDb();
    // 전체를 읽어와서 뒤에서 자르는 대신, 최신순 커서로 필요한 개수만 읽는다
    return await new Promise((resolve) => {
      const tx = db.transaction(LOG_STORE_NAME, "readonly");
      const cursorReq = tx.objectStore(LOG_STORE_NAME).openCursor(null, "prev");
      const collected = [];
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || collected.length >= limit) {
          collected.reverse(); // 오래된 것 -> 최신 순으로 되돌림(기존 반환 순서 유지)
          resolve(collected);
          return;
        }
        const item = cursor.value;
        collected.push({
          timestamp: item.t || Date.now(),
          level: item.level || "info",
          message: item.message || "",
          detail: item.detail || false,
        });
        cursor.continue();
      };
      cursorReq.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

export { addLog, flushLogs, clearLogs, getRecentLogs };
