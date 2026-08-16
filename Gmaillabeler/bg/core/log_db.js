// bg/core/log_db.js
// IndexedDB 연결 하나를 로그 / 라벨 히스토리 / 정정 패턴 세 스토어가 공유한다.
// 세 스토어가 같은 DB에 있으므로 스키마(onupgradeneeded)도 여기 한 곳에서만 정의한다.
// 스토어를 추가하려면 LOG_DB_VERSION을 올리고 아래 onupgradeneeded에 한 줄 추가하면 된다.
//
// 예전에는 로그 한 줄마다 indexedDB.open()을 새로 호출해서, 대량 처리 시 연결 생성 비용이
// 로그 쓰기 자체보다 커지는 문제가 있었다. 연결은 한 번만 열어 재사용한다.

const LOG_DB_NAME = "gmailLabelerLogs";
const LOG_DB_VERSION = 3; // v3: correctionPatterns 스토어 추가(정정 패턴 누적 학습용)
const LOG_STORE_NAME = "logs";
const HISTORY_STORE_NAME = "labelHistory";
const PATTERN_STORE_NAME = "correctionPatterns";

let logDbPromise = null;

function openLogDbConnection() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        db.createObjectStore(LOG_STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        // messageId를 키로 써서 같은 메일은 항상 "우리가 마지막으로 붙인 라벨" 하나만 남도록 함
        db.createObjectStore(HISTORY_STORE_NAME, { keyPath: "messageId" });
      }
      if (!db.objectStoreNames.contains(PATTERN_STORE_NAME)) {
        // key: "fromLabel=>toLabel" - 같은 정정 패턴이 반복된 횟수와 예시를 누적
        db.createObjectStore(PATTERN_STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openLogDb() {
  if (logDbPromise) return logDbPromise;
  logDbPromise = openLogDbConnection().then((db) => {
    // 다른 컨텍스트가 버전을 올리려 하면 우리 연결을 닫아주고 캐시를 비운다(다음 호출에서 새로 연결)
    db.onversionchange = () => {
      db.close();
      logDbPromise = null;
    };
    db.onclose = () => {
      logDbPromise = null;
    };
    return db;
  });
  logDbPromise.catch(() => {
    logDbPromise = null;
  });
  return logDbPromise;
}

export { openLogDb, LOG_STORE_NAME, HISTORY_STORE_NAME, PATTERN_STORE_NAME };
