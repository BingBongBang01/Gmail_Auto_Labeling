// bg/features/calendar/index.js
// 캘린더 기능의 등록부.

import { registerAction } from "../../core/message_router.js";
import { registerJob } from "../../core/job_registry.js";
import { calendarList } from "../../../calendar/calendar_api.js";
import { runCalendarClassification } from "../../../calendar/calendar_engine.js";
import { processGenerateCalendarCategories } from "./calendar.js";
import { createEventFromDraft, parseEventFromMail, parseEventText } from "./quick_event.js";
import { resolveThreadTargets } from "../../domain/open_thread.js";

function register() {
  // 설정의 dateRange를 실제 기간으로 바꾼다.
  // 예전에는 이 설정을 아무도 읽지 않고 항상 "오늘 ~ +7일"로 고정돼 있었다.
  function resolveCalendarRange(payload, settings) {
    if (payload.startDate && payload.endDate) {
      return { startDate: payload.startDate, endDate: payload.endDate };
    }

    const range = settings.calendar?.classification?.dateRange || "week";
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);

    if (range === "today") end.setDate(end.getDate() + 1);
    else if (range === "month") end.setMonth(end.getMonth() + 1);
    else end.setDate(end.getDate() + 7); // week, custom(기간 미지정) 기본값

    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }


  // ----- 캘린더 -----
  // calendar_classify와 calendar_apply_colors는 같은 엔진을 다른 옵션으로 부른다.
  function registerCalendarClassifyJob(type, { aliases, forceApplyColors }) {
    registerJob(type, {
      aliases,
      jobKind: "calendarClassify",
      notifyTitleKey: "notifyTitleCalendarClassify",
      resolve: (payload, settings) => {
        const range = resolveCalendarRange(payload, settings);
        const calendarId = payload.calendarId || settings.calendar?.general?.defaultCalendar || "primary";
        // "색상 적용"은 이미 색이 지정된 일정까지 다시 칠하는 것이 사용자 의도다.
        const overwrite = forceApplyColors
          ? true
          : payload.overwriteExistingColors !== undefined
          ? !!payload.overwriteExistingColors
          : undefined;
        return {
          run: () =>
            runCalendarClassification({
              calendarId,
              startDate: range.startDate,
              endDate: range.endDate,
              overwriteExistingColors: overwrite,
              applyColors: forceApplyColors ? true : undefined,
            }),
        };
      },
    });
  }

  registerCalendarClassifyJob("calendar_classify", { aliases: ["calendar.classification"], forceApplyColors: false });
  registerCalendarClassifyJob("calendar_apply_colors", { forceApplyColors: true });

  registerJob("calendar_init_categories", {
    jobKind: "calendarCategories",
    notifyTitleKey: "notifyTitleCalendarCategories",
    resolve: (payload) => ({ run: () => processGenerateCalendarCategories(payload.calendarId) }),
  });

  // ----- 자연어 일정 -----
  // 읽기와 만들기를 다른 액션으로 갈라 둔다. 한 번에 만드는 경로는 만들지 않는다 -
  // AI가 읽어낸 날짜는 틀릴 수 있고, 잘못 만들어진 일정은 한참 뒤에야 발견된다.
  registerAction("calendar.parseText", (request) => parseEventText(request.text));

  registerAction("calendar.parseMail", async (request) => {
    const messageIds = await resolveThreadTargets(request);
    return await parseEventFromMail(messageIds);
  });

  registerAction("calendar.createEvent", (request) =>
    createEventFromDraft({
      draft: request.draft,
      calendarId: request.calendarId,
      withAttendees: request.withAttendees,
    })
  );

  // 대시보드의 캘린더 목록 새로고침. 예전에는 이 액션에 핸들러가 없어서
  // (응답이 undefined) 버튼을 눌러도 조용히 아무 일도 일어나지 않았다.
  registerAction("listCalendars", async () => {
    const data = await calendarList({ minAccessRole: "writer", maxResults: 250 });
    return {
      ok: true,
      calendars: (data.items || []).map((cal) => ({
        id: cal.id,
        summary: cal.summary || cal.id,
        primary: !!cal.primary,
      })),
    };
  });
}

export { register };
