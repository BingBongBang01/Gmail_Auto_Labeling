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
const PDF_DB_VERSION = 1;

const DOC_STORE = "docs";       // docId  -> {docId, name, size, pageCount, blob, addedAt}
const RUN_STORE = "runs";       // runId  -> {runId, docId, status, options, stats, outId, ...}
const OUTPUT_STORE = "outputs"; // outId  -> {outId, runId, name, blob, createdAt}

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

function tx(store, mode, fn) {
  return openPdfDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const result = fn(transaction.objectStore(store));
        transaction.oncomplete = () => resolve(result && result.value !== undefined ? result.value : result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      })
  );
}

function reqValue(request) {
  const box = { value: undefined };
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

async function patchPdfRun(runId, patch) {
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
  newId,
};
