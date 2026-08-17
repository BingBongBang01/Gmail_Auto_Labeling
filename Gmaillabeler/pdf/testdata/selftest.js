// pdf/testdata/selftest.js
// M0 확인용 화면. 정식 기능이 아니라 진단 도구다(사이드패널 UI는 나중 단계에서 붙는다).

const $ = (id) => document.getElementById(id);

const FIELDS = [
  ["wasmLoadMs", "WASM 로드 시간", (v) => `${v} ms`],
  ["pageCount", "페이지 수", (v) => v],
  ["pageBounds", "페이지 경계", (v) => `[${v.map((n) => Math.round(n)).join(", ")}]`],
  ["blockCount", "추출된 블록", (v) => `${v}개`],
  ["textItemCount", "텍스트 블록", (v) => `${v}개`],
  ["redacted", "지운 원문 영역", (v) => `${v}개`],
  ["drawn", "삽입한 번역문", (v) => `${v}개`],
  ["overflowCount", "상자를 넘친 항목", (v) => `${v}개`],
  ["saveMode", "저장 방식", (v) => (v === "incremental" ? "증분 저장" : "전체 저장")],
  ["outputBytes", "결과 크기", (v) => `${v.toLocaleString()} bytes`],
];

function sendMessage(action) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "응답이 없습니다." });
    });
  });
}

function base64ToBlob(b64, type) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

let lastUrl = null;

function renderResult(res) {
  const box = $("result");
  box.innerHTML = "";

  if (!res.ok) {
    $("status").className = "fail";
    $("status").textContent = "실패: " + (res.error || "원인 불명");
    if (res.stack) {
      const pre = document.createElement("pre");
      pre.textContent = res.stack;
      box.appendChild(pre);
    }
    return;
  }

  $("status").className = "ok";
  $("status").textContent = "통과 — 열기/추출/지우기/삽입/저장이 모두 동작했습니다.";

  const table = document.createElement("table");
  for (const [key, label, fmt] of FIELDS) {
    if (res[key] === undefined) continue;
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = String(fmt(res[key]));
    tr.append(th, td);
    table.appendChild(tr);
  }
  box.appendChild(table);

  if (Array.isArray(res.firstTexts) && res.firstTexts.length) {
    const h = document.createElement("p");
    h.innerHTML = "<strong>추출된 원문 미리보기</strong>";
    const pre = document.createElement("pre");
    pre.textContent = res.firstTexts.join("\n---\n");
    box.append(h, pre);
  }

  if (res.outputBase64) {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = URL.createObjectURL(base64ToBlob(res.outputBase64, "application/pdf"));

    const p = document.createElement("p");
    const a = document.createElement("a");
    a.href = lastUrl;
    a.download = "selftest_output.pdf";
    a.textContent = "결과 PDF 내려받기";
    p.append(
      document.createTextNode("아래 미리보기에서 빨간 한글이 원문 자리에 보이면 성공이다. "),
      a
    );
    box.appendChild(p);

    const frame = document.createElement("iframe");
    frame.src = lastUrl;
    box.appendChild(frame);
  }
}

$("run").addEventListener("click", async () => {
  $("run").disabled = true;
  $("status").className = "";
  $("status").textContent = "엔진을 띄우고 점검하는 중... (WASM 최초 로드에 몇 초 걸립니다)";
  $("result").innerHTML = "";
  try {
    renderResult(await sendMessage("pdf.selftest"));
  } finally {
    $("run").disabled = false;
  }
});

$("shutdown").addEventListener("click", async () => {
  await sendMessage("pdf.shutdownEngine");
  $("status").className = "";
  $("status").textContent = "엔진(오프스크린 문서)을 종료했습니다.";
});
