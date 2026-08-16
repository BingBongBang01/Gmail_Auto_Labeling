// dashboard/panels/classify.js
// 분류 탭.

import { startJob } from "../job_client.js";
import { $ } from "../ui/dom.js";
import { pollStatus } from "../ui/status.js";

let dashBatchSize = 37; // getConfig로 실제 값을 받아 갱신한다(반복 분류 힌트 계산용)


// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.
function initClassifyEvents() {
  // --- 분류 탭 ---
  const startClassifyBtn = $("dashStartClassifyBtn");
  if (startClassifyBtn) {
    startClassifyBtn.addEventListener("click", () => {
      // background.js는 request.count를 읽는다(파라미터 이름을 반드시 맞춰야 함)
      chrome.runtime.sendMessage({ action: "getConfig" }, (config) => {
        const count = config && config.batchSize ? config.batchSize : 20;
        startJob({ action: "startClassification", count });
      });
    });
  }

  const stopClassifyBtn = $("dashStopClassifyBtn");
  if (stopClassifyBtn) {
    stopClassifyBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "cancelJob" }, () => pollStatus());
    });
  }
}


// background에서 받아온 실제 배치 크기(반복 분류 힌트 계산용).
// 밖에서는 이 함수로만 읽는다(import 바인딩에는 대입할 수 없으므로 읽기 경로도 하나로 둔다).
function getDashBatchSize() {
  return dashBatchSize;
}

// background의 getConfig 응답으로 실제 값을 채운다.
function setDashBatchSize(size) {
  const n = Number(size);
  if (Number.isFinite(n) && n > 0) dashBatchSize = n;
}

export {
  setDashBatchSize,
  getDashBatchSize,
  initClassifyEvents,
};
