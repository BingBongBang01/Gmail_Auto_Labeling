// bg/features/calendar/quick_event.js
// 자연어 한 줄이나 메일 본문에서 일정을 읽어내고, 사용자가 확인한 뒤 캘린더에 만든다.
//
// 흐름은 메일 정리와 같은 원칙을 따른다: **먼저 보여주고, 사용자가 확인한 것만 만든다.**
// AI가 읽어낸 날짜는 틀릴 수 있고(연도를 잘못 적거나 "다음 주"를 지난주로 계산한다),
// 잘못 만들어진 일정은 사용자가 한참 뒤에야 발견한다. 그래서 읽기(parse)와
// 만들기(create)를 아예 다른 액션으로 갈라 둔다 - 한 번에 만드는 경로는 없다.

import { callAiForJson, hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { addLog } from "../../core/logger.js";
import { getEmailContent } from "../../platform/gmail_api.js";
import { calendarEventInsert } from "../../../calendar/calendar_api.js";
import { normalizeDraft, toCalendarEvent } from "../../../calendar/event_draft.js";
import { SettingsStore } from "../../../settings/settings_store.js";

const MAX_INPUT_CHARS = 2000;
const MAX_MAIL_CHARS = 4000;
const MAX_DRAFTS = 5;

const EVENT_SCHEMA = {
  type: "OBJECT",
  properties: {
    events: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          startDateTime: { type: "STRING" },
          endDateTime: { type: "STRING" },
          allDay: { type: "BOOLEAN" },
          location: { type: "STRING" },
          description: { type: "STRING" },
          attendees: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["title", "startDateTime", "endDateTime", "allDay", "location", "description", "attendees"],
      },
    },
  },
  required: ["events"],
};

// 서비스워커가 도는 곳의 시간대. 사용자의 "3시"는 이 시간대의 3시다.
function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (e) {
    return "UTC";
  }
}

// AI에게 "지금"을 알려주지 않으면 "다음 주 화요일"을 계산할 수 없다.
// 요일까지 적어주는 이유: 모델이 날짜에서 요일을 잘못 역산하는 일이 흔하다.
function nowContext(now) {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())} (${days[now.getDay()]}요일, ${localTimeZone()})`
  );
}

function buildPrompt(body, now) {
  return `당신은 일정 추출기다. 아래 내용에서 캘린더에 등록할 일정을 찾아 JSON으로만 답하라.

지금 시각: ${nowContext(now)}

규칙:
- startDateTime/endDateTime은 반드시 "YYYY-MM-DDTHH:MM:SS" 형식의 지역시각으로 적는다. 타임존 표기나 Z를 붙이지 않는다.
- "내일", "다음 주 화요일" 같은 표현은 위의 지금 시각을 기준으로 실제 날짜로 바꾼다. 연도를 반드시 확인한다.
- 끝 시각을 알 수 없으면 시작 +1시간으로 한다.
- 하루 종일 일정이면 allDay를 true로 하고 날짜만 "YYYY-MM-DD"로 적는다.
- 장소/설명/참석자를 알 수 없으면 빈 문자열이나 빈 배열로 둔다. 지어내지 않는다.
- attendees에는 이메일 주소만 넣는다. 이름만 아는 사람은 description에 적는다.
- 일정이 여러 개면 events 배열에 모두 넣는다. 하나도 없으면 빈 배열로 답한다.

내용:
${body}`;
}

async function runExtraction(body, source) {
  if (!(await hasUsableAiCredential())) {
    return { ok: false, error: "쓸 수 있는 AI 키가 없습니다. 설정 > AI 공급자에서 키를 추가하세요." };
  }

  const now = new Date();
  let parsed;
  try {
    parsed = await callAiForJson({
      contents: [{ parts: [{ text: buildPrompt(body, now) }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: EVENT_SCHEMA },
    });
  } catch (e) {
    const message = String((e && e.message) || e);
    await addLog(`[캘린더] 일정 읽기 실패: ${message}`, "error");
    return { ok: false, error: message };
  }

  const raw = (parsed && Array.isArray(parsed.events) ? parsed.events : []).slice(0, MAX_DRAFTS);
  const drafts = raw.map((item) => {
    const { draft, warnings } = normalizeDraft({ ...item, source }, now);
    return { draft, warnings };
  });

  await addLog(`[캘린더] 일정 ${drafts.length}건을 읽었습니다.`);
  return { ok: true, drafts, timeZone: localTimeZone() };
}

/** 자연어 한 줄에서 일정을 읽는다. 아무것도 만들지 않는다. */
async function parseEventText(text) {
  const body = String(text || "").trim().slice(0, MAX_INPUT_CHARS);
  if (!body) return { ok: false, error: "일정 내용을 입력하세요." };
  return await runExtraction(body, "");
}

/** 열어 둔 메일에서 일정을 읽는다. 아무것도 만들지 않는다. */
async function parseEventFromMail(messageIds) {
  const ids = (messageIds || []).slice(0, 3);
  if (!ids.length) {
    return { ok: false, error: "열려 있는 메일을 찾지 못했습니다. Gmail에서 메일을 열고 다시 시도하세요." };
  }

  const parts = [];
  let subject = "";
  for (const id of ids) {
    try {
      const mail = await getEmailContent(null, id);
      if (!subject) subject = mail.subject || "";
      parts.push(
        `제목: ${mail.subject}\n보낸사람: ${mail.from}\n받는사람: ${mail.to}\n날짜: ${mail.date || ""}\n본문: ${mail.snippet}`
      );
    } catch (e) {
      // 한 통을 못 읽어도 나머지로 계속한다.
    }
  }
  if (!parts.length) return { ok: false, error: "메일 내용을 읽지 못했습니다." };

  const body = parts.join("\n\n---\n\n").slice(0, MAX_MAIL_CHARS);
  return await runExtraction(body, subject ? `메일: ${subject}` : "메일");
}

/**
 * 사용자가 확인·수정한 초안으로 일정을 만든다.
 * 여기서는 다시 AI를 부르지 않는다 - 화면에서 본 그대로가 만들어져야 한다.
 */
async function createEventFromDraft({ draft, calendarId, withAttendees }) {
  if (!draft || !draft.start) return { ok: false, error: "일정 정보가 올바르지 않습니다." };

  const settings = await SettingsStore.getSettings();
  const target = calendarId || settings.calendar?.general?.defaultCalendar || "primary";

  let body;
  try {
    body = toCalendarEvent(draft, { timeZone: localTimeZone(), withAttendees: !!withAttendees });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }

  try {
    const created = await calendarEventInsert(target, body);
    await addLog(`[캘린더] 일정 생성: ${body.summary}`);
    return {
      ok: true,
      eventId: created.id,
      htmlLink: created.htmlLink || "",
      summary: body.summary,
      calendarId: target,
    };
  } catch (e) {
    const message = String((e && e.message) || e);
    await addLog(`[캘린더] 일정 생성 실패: ${message}`, "error");
    return { ok: false, error: message, requiresReauth: !!e.requiresReauth };
  }
}

export {
  EVENT_SCHEMA,
  MAX_DRAFTS,
  MAX_INPUT_CHARS,
  buildPrompt,
  createEventFromDraft,
  localTimeZone,
  nowContext,
  parseEventFromMail,
  parseEventText,
};
