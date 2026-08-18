// bg/core/history_db.js
// 라벨 히스토리(우리가 어떤 메일에 어떤 라벨을 붙였는지)와 정정 패턴 스토어의 저수준 접근.
//
// 여기에는 "어떻게 학습에 쓸지" 같은 판단을 넣지 않는다. 그건 features/learning의 몫이다.
// 이 파일은 읽기/쓰기만 담당해서, 분류 기능과 학습 기능이 같은 스토어를 서로를 몰라도 쓸 수 있게 한다.

import { openLogDb, HISTORY_STORE_NAME, PATTERN_STORE_NAME } from "./log_db.js";

// 여러 건의 히스토리를 한 트랜잭션으로 기록한다(건당 트랜잭션은 대량 처리 시 비용이 크다).
async function recordLabelHistoryBatch(entries) {
  if (!entries || !entries.length) return;
  try {
    const db = await openLogDb();
    const now = Date.now();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, "readwrite");
      const store = tx.objectStore(HISTORY_STORE_NAME);
      for (const entry of entries) {
        store.put({
          messageId: entry.messageId,
          subject: (entry.subject || "").slice(0, 120),
          from: (entry.from || "").slice(0, 120),
          labelName: entry.labelName,
          appliedAt: now,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("라벨 히스토리 기록 실패:", e);
  }
}

async function getAllLabelHistory() {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, "readonly");
      const req = tx.objectStore(HISTORY_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function updateLabelHistoryEntry(entry) {
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, "readwrite");
      tx.objectStore(HISTORY_STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // 무시
  }
}

async function getCorrectionPattern(key) {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PATTERN_STORE_NAME, "readonly");
      const req = tx.objectStore(PATTERN_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

// 쌓인 정정 패턴 전체. 학습 화면이 "무엇을 배웠는지" 보여줄 때 쓴다.
// 개별 조회(getCorrectionPattern)는 분류 도중 키 하나를 확인하는 용도라 목록이 필요 없었다.
async function getAllCorrectionPatterns() {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PATTERN_STORE_NAME, "readonly");
      const req = tx.objectStore(PATTERN_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function saveCorrectionPattern(pattern) {
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PATTERN_STORE_NAME, "readwrite");
      tx.objectStore(PATTERN_STORE_NAME).put(pattern);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // 무시
  }
}

export {
  recordLabelHistoryBatch,
  getAllLabelHistory,
  updateLabelHistoryEntry,
  getCorrectionPattern,
  getAllCorrectionPatterns,
  saveCorrectionPattern,
};
