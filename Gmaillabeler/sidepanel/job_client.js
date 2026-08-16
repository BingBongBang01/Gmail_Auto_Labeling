// sidepanel/job_client.js
// 백그라운드에 작업 시작을 요청하는 유일한 통로.
// 화면 코드가 chrome.runtime.sendMessage를 직접 부르지 않게 한다.

import { setActionFeedback } from "./ui/feedback.js";

function startJob(jobType, payload = {}) {
  setActionFeedback(`작업을 요청 중입니다... (${jobType})`);
  chrome.runtime.sendMessage({ action: "job.start", jobType, payload }, (response) => {
    if (chrome.runtime.lastError) {
      setActionFeedback(`작업 요청 실패: ${chrome.runtime.lastError.message}`);
    } else if (response && response.error) {
      setActionFeedback(`오류: ${response.error}`);
    } else {
      setActionFeedback(`작업이 정상적으로 시작되었습니다.`);
    }
  });
}


export {
  startJob,
};
