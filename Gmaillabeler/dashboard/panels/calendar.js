// dashboard/panels/calendar.js
// 캘린더 AI 탭.


// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.

import { startJob } from "../job_client.js";
import { $ } from "../ui/dom.js";
import { pollStatus } from "../ui/status.js";

function initCalendarEvents() {
  // --- Calendar AI ---
  const startCalendarBtn = $("dashStartCalendarBtn");
  if (startCalendarBtn) {
    startCalendarBtn.addEventListener("click", () => {
      const calId = $("dashCalendarSelect")?.value || "primary";
      const startDate = $("dashCalendarStartInput")?.value;
      const endDate = $("dashCalendarEndInput")?.value;
      if (!startDate || !endDate) {
        alert("Please select start and end dates."); // can be localized later
        return;
      }
      // 캘린더 분류도 다른 작업과 같은 job.start 경로를 쓴다.
      // 예전에는 핸들러가 없는 "startCalendarClassification"을 보내서 아무 일도 일어나지 않았고,
      // 파라미터도 payload가 아니라 최상위에 실어 보내서 무시됐다.
      startJob(
        {
          action: "job.start",
          jobType: "calendar_classify",
          payload: {
            calendarId: calId,
            // <input type="date">는 "YYYY-MM-DD"를 준다. 종료일은 그날 전체를 포함시킨다.
            startDate: new Date(`${startDate}T00:00:00`).toISOString(),
            endDate: new Date(`${endDate}T23:59:59`).toISOString(),
          },
        },
        "Calendar classification started"
      );
    });
  }

  const stopCalendarBtn = $("dashStopCalendarBtn");
  if (stopCalendarBtn) {
    stopCalendarBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "cancelJob" }, () => pollStatus());
    });
  }

  const refreshCalendarBtn = $("dashCalendarRefreshBtn");
  if (refreshCalendarBtn) {
    refreshCalendarBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "listCalendars" }, (response) => {
        if (response && response.calendars) {
          const select = $("dashCalendarSelect");
          select.innerHTML = "";
          response.calendars.forEach(cal => {
            const opt = document.createElement("option");
            opt.value = cal.id;
            opt.textContent = cal.summary + (cal.primary ? " (Primary)" : "");
            select.appendChild(opt);
          });
        }
      });
    });
  }
}


export {
  initCalendarEvents,
};
