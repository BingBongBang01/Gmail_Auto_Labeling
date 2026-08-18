// shared/pdf_db.js
// PDF 번역용 IndexedDB. 사이드패널 / 서비스워커 / 오프스크린 문서가 모두 쓰기 때문에
// bg/ 가 아니라 shared/ 에 둔다(shared/event_bus.js와 같은 이유).
//
// 이게 왜 필요한가: chrome.runtime.sendMessage의 페이로드는 구조화 복제가 아니라
// JSON 직렬화다. ArrayBuffer/Blob은 느리게 전달되는 게 아니라 아예 전달되지 않는다
// ({} 또는 {"0":37,...}로 도착한다). 그래서 파일 바이트는 메시지에 싣지 못하고,
// 같은 오리진의 IndexedDB를 공유 버퍼로 쓰고 메시지에는 id만 실어 보낸다.
//
// 로그 DB(bg/core/log_db.js)에 스토어를 얹지 않고 별도 DB를 쓰는 이유:
//   1) 로그 스키마 버전을 올리면 onversionchange가 연결을 끊는데, 그 연결을 세 컨텍스트가
//      잡고 있어서 10분짜리 번역이 트랜잭션 도중에 끊긴다.
//   2) clearLogs()와 5000행 자동 정리기가 도는 DB에 수십 MB PDF를 같이 두면 사고가 난다.

const PDF_DB_NAME = "pdfTranslator";
const PDF_DB_VERSION = 2;

const DOC_STORE = "docs";       // docId  -> {docId, name, size, pageCount, blob, addedAt}
const RUN_STORE = "runs";       // runId  -> {runId, docId, status, options, stats, outId, ...}
const OUTPUT_STORE = "outputs"; // outId  -> {outId, runId, name, blob, createdAt}
const SEG_CACHE_STORE = "segcache"; // key -> {key, translated, docId, updatedAt}

let dbPromise = null;

function openPdfDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      // 스토어를 추가하려면 PDF_DB_VERSION을 올리고 여기에 한 줄 추가한다.
      if (!db.objectStoreNames.contains(DOC_STORE)) {
        db.createObjectStore(DOC_STORE, { keyPath: "docId" });
      }
      if (!db.objectStoreNames.contains(RUN_STORE)) {
        const runs = db.createObjectStore(RUN_STORE, { keyPath: "runId" });
        runs.createIndex("byDoc", "docId");
        runs.createIndex("byUpdatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(OUTPUT_STORE)) {
        const outputs = db.createObjectStore(OUTPUT_STORE, { keyPath: "outId" });
        outputs.createIndex("byRun", "runId");
      }
      // v2: 세그먼트 번역 캐시. 끊긴 작업을 이어할 때 이미 번역한 구간을 두 번 사지 않기 위한 것이다.
      // byUpdatedAt은 정리(prune)에서 오래된 것부터 지우려고 만든다.
      if (!db.objectStoreNames.contains(SEG_CACHE_STORE)) {
        const cache = db.createObjectStore(SEG_CACHE_STORE, { keyPath: "key" });
        cache.createIndex("byUpdatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // 다른 컨텍스트가 버전을 올리려 하면 붙잡고 있지 말고 놓아준다.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });

  return dbPromise;
}

// reqValue가 돌려준 상자를 식별하는 표. `value !== undefined` 로 판단하면 안 된다 -
// 없는 레코드를 조회했을 때(value가 undefined) 상자 자체가 그대로 반환되고,
// 그 상자는 truthy라서 호출부의 `if (!doc) 없음 처리` 가 전부 통과해버린다.
// 그러면 "문서를 찾을 수 없습니다" 대신 몇 줄 뒤에서 엉뚱한 TypeError가 난다.
const VALUE_BOX = Symbol("pdfDbValueBox");

function tx(store, mode, fn) {
  return openPdfDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const result = fn(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(result && result[VALUE_BOX] ? result.value : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

function reqValue(request) {
  const box = { [VALUE_BOX]: true, value: undefined };
  request.onsuccess = () => {
    box.value = request.result;
  };
  return box;
}

// ---------------- 원본 문서 ----------------

async function putPdfDoc(doc) {
  return tx(DOC_STORE, "readwrite", (store) => store.put(doc));
}

async function getPdfDoc(docId) {
  return tx(DOC_STORE, "readonly", (store) => reqValue(store.get(docId)));
}

async function deletePdfDoc(docId) {
  return tx(DOC_STORE, "readwrite", (store) => store.delete(docId));
}

// ---------------- 실행 기록 ----------------

async function putPdfRun(run) {
  return tx(RUN_STORE, "readwrite", (store) => store.put({ ...run, updatedAt: Date.now() }));
}

async function getPdfRun(runId) {
  return tx(RUN_STORE, "readonly", (store) => reqValue(store.get(runId)));
}

// 인자를 하나만 받는다: 갱신할 필드를 담은 객체이고 runId가 그 안에 들어 있어야 한다.
// (runId, patch) 두 인자 꼴로 만들었다가 호출부가 전부 객체 하나를 넘기고 있어서
// store.get(객체)가 IndexedDB의 DataError로 터졌다. 호출부 쪽 표기가 자연스러우니 여기를 맞춘다.
async function patchPdfRun(patch) {
  const runId = patch && patch.runId;
  if (!runId) throw new Error("patchPdfRun: runId가 필요합니다.");
  const current = (await getPdfRun(runId)) || { runId };
  return putPdfRun({ ...current, ...patch });
}

// 최근 실행 목록(최신순). 사이드패널의 "최근 결과"가 읽는다.
async function listPdfRuns(limit = 10) {
  const rows = await tx(RUN_STORE, "readonly", (store) => reqValue(store.getAll()));
  return (rows || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, limit);
}

// ---------------- 결과 문서 ----------------

async function putPdfOutput(output) {
  return tx(OUTPUT_STORE, "readwrite", (store) => store.put(output));
}

async function getPdfOutput(outId) {
  return tx(OUTPUT_STORE, "readonly", (store) => reqValue(store.get(outId)));
}

// 결과물은 원본만큼 크다. 최근 N개만 남기고 지운다.
// (사용자는 이미 내려받았을 것이고, 남겨두면 저장소만 계속 찬다.)
async function prunePdfOutputs(keep = 5) {
  const rows = await tx(OUTPUT_STORE, "readonly", (store) => reqValue(store.getAll()));
  const sorted = (rows || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const doomed = sorted.slice(keep);
  for (const row of doomed) {
    await tx(OUTPUT_STORE, "readwrite", (store) => store.delete(row.outId));
  }
  return doomed.length;
}

// ---------------- 세그먼트 번역 캐시 ----------------
// 키는 (원문 + 번역 조건)의 해시다(pdf/text/cache_key.js). 그래서:
//   - 끊긴 작업을 다시 돌리면 이미 번역한 세그먼트는 API를 쓰지 않고 여기서 나온다.
//   - 같은 문서 안에서 반복되는 머리말/꼬리말도 한 번만 번역한다.
// 값에는 원문을 넣지 않는다. 키가 이미 원문의 해시이고, 수만 건이 쌓이는 스토어라 작게 유지한다.

// 키가 많을 수 있어 트랜잭션을 나눈다. 하나의 트랜잭션에 수천 건의 get을 몰아넣으면
// 그동안 다른 컨텍스트의 쓰기가 전부 대기한다.
const CACHE_LOOKUP_CHUNK = 500;

async function getSegCacheEntries(keys) {
  const found = new Map();
  const list = (keys || []).filter(Boolean);
  for (let i = 0; i < list.length; i += CACHE_LOOKUP_CHUNK) {
    const chunk = list.slice(i, i + CACHE_LOOKUP_CHUNK);
    await tx(SEG_CACHE_STORE, "readonly", (store) => {
      for (const key of chunk) {
        const request = store.get(key);
        request.onsuccess = () => {
          const row = request.result;
          if (row && typeof row.translated === "string") found.set(key, row.translated);
        };
      }
    });
  }
  return found;
}

// entries: [{ key, translated, docId }]
async function putSegCacheEntries(entries) {
  const list = (entries || []).filter((e) => e && e.key && typeof e.translated === "string");
  if (!list.length) return 0;
  const now = Date.now();
  for (let i = 0; i < list.length; i += CACHE_LOOKUP_CHUNK) {
    const chunk = list.slice(i, i + CACHE_LOOKUP_CHUNK);
    await tx(SEG_CACHE_STORE, "readwrite", (store) => {
      for (const entry of chunk) {
        store.put({ key: entry.key, translated: entry.translated, docId: entry.docId || null, updatedAt: now });
      }
    });
  }
  return list.length;
}

async function countSegCache() {
  return (await tx(SEG_CACHE_STORE, "readonly", (store) => reqValue(store.count()))) || 0;
}

async function clearSegCache() {
  return tx(SEG_CACHE_STORE, "readwrite", (store) => store.clear());
}

// 오래된 것부터 지워 상한을 지킨다. byUpdatedAt 커서는 오름차순이라 가장 오래된 항목이 먼저 나온다.
async function pruneSegCache(keep = 20000) {
  const total = await countSegCache();
  if (total <= keep) return 0;
  let remaining = total - keep;
  await tx(SEG_CACHE_STORE, "readwrite", (store) => {
    const request = store.index("byUpdatedAt").openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || remaining <= 0) return;
      cursor.delete();
      remaining -= 1;
      cursor.continue();
    };
  });
  return total - keep;
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export {
  PDF_DB_NAME,
  PDF_DB_VERSION,
  putPdfDoc,
  getPdfDoc,
  deletePdfDoc,
  putPdfRun,
  getPdfRun,
  patchPdfRun,
  listPdfRuns,
  putPdfOutput,
  getPdfOutput,
  prunePdfOutputs,
  getSegCacheEntries,
  putSegCacheEntries,
  countSegCache,
  clearSegCache,
  pruneSegCache,
  newId,
};
