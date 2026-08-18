// bg/features/today/today.js
// '오늘' 브리핑: 안 읽은 메일과 오늘 일정을 한 번에 모으고, 필요하면 AI로 요약한다.
//
// 새로 저장하는 데이터가 없다. Gmail 검색과 캘린더 조회를 묶어 보여줄 뿐이다.
// 그래서 이 화면은 언제 열어도 지금 상태를 보여주고, 캐시나 동기화 문제가 생길 여지가 없다.
//
// 모으기(collect)와 요약(brief)을 나눈 이유: 목록은 AI 없이도 쓸모가 있고 즉시 뜬다.
// AI 키가 없거나 할당량이 소진돼도 "오늘 뭐가 있나"는 볼 수 있어야 한다.

import { addLog } from "../../core/logger.js";
import { mapWithConcurrency } from "../../core/util.js";
import { GMAIL_FETCH_CONCURRENCY } from "../../domain/limits.js";
import { buildEmailContentUrl, gmailFetch, listMessagesPaged } from "../../platform/gmail_api.js";
import { callAiForJson, hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { calendarEventsList } from "../../../calendar/calendar_api.js";
import { SettingsStore } from "../../../settings/settings_store.js";

// 안 읽은 메일 개수를 세는 상한(한 페이지). 이보다 많으면 "N+"로 보여준다.
const SCAN_LIMIT = 200;
// 제목까지 받아올 개수. 브리핑은 훑어보는 화면이라 이보다 많으면 오히려 안 읽힌다.
const MAIL_LIMIT = 12;
const EVENT_LIMIT = 20;

const BRIEF_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    lines: { type: "ARRAY", items: { type: "STRING" } },
    focus: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["headline", "lines", "focus"],
};

function headerValue(headers, name) {
  const found = (headers || []).find((h) => String(h.name || "").toLowerCase() === name.toLowerCase());
  return (found && found.value) || "";
}

async function fetchMailRow(messageId) {
  try {
    const response = await gmailFetch(buildEmailContentUrl(messageId, true));
    if (!response.ok) return null;
    const data = await response.json();
    const headers = data.payload?.headers || [];
    const labels = data.labelIds || [];
    return {
      id: messageId,
      threadId: data.threadId || messageId,
      subject: headerValue(headers, "Subject").slice(0, 140) || "(제목 없음)",
      from: headerValue(headers, "From").slice(0, 120),
      date: Date.parse(headerValue(headers, "Date")) || Number(data.internalDate) || 0,
      important: labels.includes("IMPORTANT"),
      starred: labels.includes("STARRED"),
    };
  } catch (e) {
    return null;
  }
}

// 오늘 00:00 ~ 내일 00:00. 지역시각 기준으로 만들고 ISO로 바꾼다 -
// Google은 RFC3339를 받으므로 toISOString()의 UTC 표기가 그대로 맞는 순간을 가리킨다.
function todayRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);
  return { timeMin: start.toISOString(), timeMax: end.toISOString(), start, end };
}

function normalizeEvent(raw) {
  const startRaw = raw.start || {};
  const endRaw = raw.end || {};
  const allDay = !!startRaw.date && !startRaw.dateTime;
  const startAt = Date.parse(startRaw.dateTime || startRaw.date || "") || 0;
  return {
    id: raw.id,
    summary: String(raw.summary || "(제목 없음)").slice(0, 140),
    location: String(raw.location || "").slice(0, 120),
    allDay,
    startAt,
    startText: allDay
      ? "종일"
      : new Date(startAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }),
    endAt: Date.parse(endRaw.dateTime || endRaw.date || "") || 0,
    htmlLink: raw.htmlLink || "",
    attendeeCount: Array.isArray(raw.attendees) ? raw.attendees.length : 0,
  };
}

/**
 * 오늘의 메일과 일정을 모은다. 아무것도 바꾸지 않고, AI도 쓰지 않는다.
 * 한쪽이 실패해도 다른 쪽은 그대로 돌려준다 - 캘린더를 연결하지 않은 사용자도
 * 메일 브리핑은 볼 수 있어야 한다.
 */
async function collectToday() {
  const settings = await SettingsStore.getSettings();
  const calendarId = settings.calendar?.general?.defaultCalendar || "primary";
  const { timeMin, timeMax } = todayRange();

  const result = { ok: true, mails: [], events: [], unreadTotal: 0, scanLimit: SCAN_LIMIT, mailError: null, calendarError: null };

  // ---- 메일 ----
  try {
    const messages = await listMessagesPaged({ q: "in:inbox is:unread" }, SCAN_LIMIT, "errMessageListFailed");
    result.unreadTotal = messages.length;
    const rows = await mapWithConcurrency(
      messages.slice(0, MAIL_LIMIT).map((m) => m.id),
      GMAIL_FETCH_CONCURRENCY,
      (id) => fetchMailRow(id)
    );
    // 중요/별표를 위로, 그 다음 최신순. 훑어보는 화면이라 순서가 곧 우선순위다.
    result.mails = rows
      .filter(Boolean)
      .sort((a, b) => Number(b.important || b.starred) - Number(a.important || a.starred) || b.date - a.date);
  } catch (e) {
    result.mailError = String((e && e.message) || e);
  }

  // ---- 일정 ----
  try {
    const data = await calendarEventsList(calendarId, {
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: EVENT_LIMIT,
    });
    result.events = (data.items || [])
      .filter((e) => e.status !== "cancelled")
      .map(normalizeEvent)
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startAt - b.startAt);
  } catch (e) {
    // 캘린더 권한이 없거나 연결하지 않은 경우가 대부분이다. 메일 쪽은 그대로 살린다.
    result.calendarError = String((e && e.message) || e);
  }

  return result;
}

/** 모아둔 내용을 3~5줄로 요약한다. 목록을 이미 본 사람이 "그래서 뭘 먼저?"를 묻는 자리다. */
async function buildBrief(data) {
  if (!(await hasUsableAiCredential())) {
    return { ok: false, error: "쓸 수 있는 AI 키가 없습니다. 설정 > AI 공급자에서 키를 추가하세요." };
  }

  const mails = (data && data.mails) || [];
  const events = (data && data.events) || [];
  if (!mails.length && !events.length) {
    return { ok: false, error: "요약할 메일과 일정이 없습니다." };
  }

  const mailText = mails
    .map((m) => `- ${m.important || m.starred ? "[중요] " : ""}${m.subject} (${m.from})`)
    .join("\n");
  const eventText = events.map((e) => `- ${e.startText} ${e.summary}${e.location ? ` @ ${e.location}` : ""}`).join("\n");

  const prompt = `당신은 개인 비서다. 아래 오늘의 메일과 일정을 보고 한국어로 짧게 브리핑하라. JSON으로만 답한다.

규칙:
- headline: 오늘 하루를 한 문장으로.
- lines: 3~5줄. 각 줄은 한 문장. 목록을 그대로 옮기지 말고 묶어서 말한다.
- focus: 먼저 처리할 일 1~3개. 없으면 빈 배열.
- 내용에 없는 것을 지어내지 않는다.

안 읽은 메일${data.unreadTotal > mails.length ? ` (총 ${data.unreadTotal}통 중 ${mails.length}통)` : ""}:
${mailText || "(없음)"}

오늘 일정:
${eventText || "(없음)"}`;

  try {
    const parsed = await callAiForJson({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseSchema: BRIEF_SCHEMA },
    });
    const brief = {
      headline: String((parsed && parsed.headline) || "").slice(0, 200),
      lines: ((parsed && parsed.lines) || []).slice(0, 6).map((l) => String(l).slice(0, 300)),
      focus: ((parsed && parsed.focus) || []).slice(0, 5).map((l) => String(l).slice(0, 200)),
    };
    if (!brief.headline && !brief.lines.length) {
      return { ok: false, error: "브리핑이 비어 있습니다. 다시 시도해 보세요." };
    }
    await addLog(`[오늘] 브리핑 생성: 메일 ${mails.length}건, 일정 ${events.length}건`);
    return { ok: true, brief, at: Date.now() };
  } catch (e) {
    const message = String((e && e.message) || e);
    await addLog(`[오늘] 브리핑 실패: ${message}`, "error");
    return { ok: false, error: message };
  }
}

export { BRIEF_SCHEMA, EVENT_LIMIT, MAIL_LIMIT, SCAN_LIMIT, buildBrief, collectToday, normalizeEvent, todayRange };
