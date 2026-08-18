// calendar/event_draft.js
// AI가 만든 일정 초안을 사람이 고칠 수 있는 형태로 다듬고, Google Calendar가 받는 모양으로 바꾼다.
// 순수 계산만 한다 - chrome.* 도 네트워크도 쓰지 않는다.
//
// 이 파일이 따로 있는 이유: AI가 돌려주는 날짜·시간은 믿을 수 없다.
// "다음 주 화요일"을 지난주로 계산하거나, 끝 시각이 시작보다 앞서거나, 2026년을 2016년으로
// 적는 일이 실제로 일어난다. 그런 값을 그대로 캘린더에 넣으면 사용자는 엉뚱한 날짜에
// 만들어진 일정을 나중에야 발견한다. 여기서 전부 걸러 화면에 "확인이 필요한 항목"으로 띄운다.

const DEFAULT_DURATION_MIN = 60;
const MAX_TITLE_CHARS = 200;
const MAX_TEXT_CHARS = 2000;

// 사람이 실수로 만들 수 있는 범위를 넘어선 날짜는 AI의 착각으로 본다.
// 막지는 않고 경고만 한다 - 5년 뒤 계약 만료일 같은 정당한 일정도 있다.
const FAR_FUTURE_DAYS = 366 * 3;
const FAR_PAST_DAYS = 30;

function clampText(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** "2026-08-25T15:00:00" 같은 지역시각 문자열을 파싱한다. 타임존 표기가 붙어 있어도 받는다. */
function parseLocalDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  // Date 생성자는 "2026-08-25"를 UTC 자정으로 읽는다(지역시각이 아니라).
  // 날짜만 온 경우 하루가 밀려 보이는 문제가 생기므로 직접 조립한다.
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (local) {
    return new Date(
      Number(local[1]), Number(local[2]) - 1, Number(local[3]),
      Number(local[4]), Number(local[5]), Number(local[6] || 0)
    );
  }
  const parsed = new Date(text);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Date -> "YYYY-MM-DDTHH:MM" (datetime-local 입력과 Calendar API가 함께 쓰는 모양) */
function toLocalInputValue(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

function toDateValue(date) {
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 아주 단순한 형태만 본다. 사람이 고칠 수 있는 화면이 뒤에 있으므로 여기서 완벽할 필요는 없고,
// 명백히 주소가 아닌 것을 참석자로 넣지 않기만 하면 된다.
function isEmailLike(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

/**
 * AI 초안 하나를 다듬는다.
 * @returns {{draft, warnings: string[]}} draft는 화면이 그대로 폼에 채울 수 있는 모양이다.
 */
function normalizeDraft(raw, now = new Date()) {
  const warnings = [];
  const allDay = !!(raw && raw.allDay);

  let start = parseLocalDateTime(raw && raw.startDateTime);
  let end = parseLocalDateTime(raw && raw.endDateTime);

  if (!start) {
    // 시작 시각을 못 읽었으면 다음 정시로 놓고 사용자가 고치게 한다.
    start = new Date(now.getTime());
    start.setMinutes(0, 0, 0);
    start.setHours(start.getHours() + 1);
    warnings.push("시작 시각을 알아내지 못해 임시로 채웠습니다. 확인해 주세요.");
  }

  if (!end || end.getTime() <= start.getTime()) {
    if (end && end.getTime() <= start.getTime()) {
      warnings.push("끝 시각이 시작보다 빨라서 다시 계산했습니다.");
    }
    end = new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
  }

  const daysFromNow = (start.getTime() - now.getTime()) / 86400000;
  if (daysFromNow > FAR_FUTURE_DAYS) warnings.push("날짜가 너무 먼 미래입니다. 연도를 확인해 주세요.");
  if (daysFromNow < -FAR_PAST_DAYS) warnings.push("날짜가 이미 지났습니다. 연도를 확인해 주세요.");

  const title = clampText(raw && raw.title, MAX_TITLE_CHARS);
  if (!title) warnings.push("제목을 알아내지 못했습니다.");

  const attendees = [];
  const rejected = [];
  for (const value of (raw && raw.attendees) || []) {
    const email = String(value || "").trim();
    if (isEmailLike(email)) attendees.push(email);
    else if (email) rejected.push(email);
  }
  if (rejected.length) {
    // 이름만 알아낸 경우다. 참석자로는 못 넣지만 버리지도 않는다 - 설명에 남겨 사용자가 판단한다.
    warnings.push(`참석자 이메일을 알 수 없는 사람: ${rejected.slice(0, 3).join(", ")}`);
  }

  return {
    draft: {
      title: title || "(제목 없음)",
      allDay,
      start: allDay ? toDateValue(start) : toLocalInputValue(start),
      end: allDay ? toDateValue(end) : toLocalInputValue(end),
      location: clampText(raw && raw.location, MAX_TITLE_CHARS),
      description: clampText(raw && raw.description, MAX_TEXT_CHARS),
      attendees,
      unresolvedAttendees: rejected.slice(0, 10),
      source: clampText(raw && raw.source, MAX_TITLE_CHARS),
    },
    warnings,
  };
}

/**
 * 화면에서 고친 초안을 Google Calendar events.insert 본문으로 바꾼다.
 * @param {object} draft  normalizeDraft가 만든 모양(사용자가 고친 뒤)
 * @param {object} options { timeZone, withAttendees }
 */
function toCalendarEvent(draft, options = {}) {
  const timeZone = options.timeZone || "UTC";
  const start = parseLocalDateTime(draft.start);
  const end = parseLocalDateTime(draft.end);
  if (!start) throw new Error("시작 시각이 올바르지 않습니다.");

  const body = {
    summary: clampText(draft.title, MAX_TITLE_CHARS) || "(제목 없음)",
  };
  if (draft.location) body.location = clampText(draft.location, MAX_TITLE_CHARS);

  const descriptionParts = [];
  if (draft.description) descriptionParts.push(clampText(draft.description, MAX_TEXT_CHARS));
  // 이메일을 못 알아낸 참석자는 본문에 남긴다. 참석자 필드에 이름을 넣으면 API가 거부한다.
  if (draft.unresolvedAttendees && draft.unresolvedAttendees.length) {
    descriptionParts.push(`참석(이메일 미확인): ${draft.unresolvedAttendees.join(", ")}`);
  }
  if (draft.source) descriptionParts.push(`출처: ${draft.source}`);
  if (descriptionParts.length) body.description = descriptionParts.join("\n");

  if (draft.allDay) {
    // 종일 일정의 end.date는 "다음 날"이다(끝나는 날의 다음 날을 배타적으로 적는다).
    const endDate = end && end.getTime() > start.getTime() ? end : start;
    const exclusiveEnd = new Date(endDate.getTime());
    exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
    body.start = { date: toDateValue(start) };
    body.end = { date: toDateValue(exclusiveEnd) };
  } else {
    const realEnd = end && end.getTime() > start.getTime()
      ? end
      : new Date(start.getTime() + DEFAULT_DURATION_MIN * 60 * 1000);
    body.start = { dateTime: `${toLocalInputValue(start)}:00`, timeZone };
    body.end = { dateTime: `${toLocalInputValue(realEnd)}:00`, timeZone };
  }

  // 참석자는 기본으로 넣지 않는다. 넣는 순간 남의 캘린더에 일정이 생기는 바깥으로 나가는
  // 동작이라, 화면에서 사용자가 명시적으로 켰을 때만 싣는다.
  if (options.withAttendees && draft.attendees && draft.attendees.length) {
    body.attendees = draft.attendees.filter(isEmailLike).map((email) => ({ email }));
  }

  return body;
}

export {
  DEFAULT_DURATION_MIN,
  FAR_FUTURE_DAYS,
  FAR_PAST_DAYS,
  isEmailLike,
  normalizeDraft,
  parseLocalDateTime,
  toCalendarEvent,
  toDateValue,
  toLocalInputValue,
};
