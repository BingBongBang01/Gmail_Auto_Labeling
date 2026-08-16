// calendar/calendar_colors.js

import { calendarColorsGet } from "./calendar_api.js";

// Google 캘린더의 일정 색상은 colorId "1"~"11"로 고정돼 있다.
// /colors API 응답에는 background/foreground만 있고 사람이 읽을 이름이 없어서,
// 프롬프트나 UI에 쓸 이름은 여기서 보완한다.
const CALENDAR_EVENT_COLOR_NAMES = {
  "1": "Lavender",
  "2": "Sage",
  "3": "Grape",
  "4": "Flamingo",
  "5": "Banana",
  "6": "Tangerine",
  "7": "Peacock",
  "8": "Graphite",
  "9": "Blueberry",
  "10": "Basil",
  "11": "Tomato",
};

const CALENDAR_EVENT_COLOR_FALLBACK = {
  "1": { background: "#a4bdfc", foreground: "#1d1d1d" },
  "2": { background: "#7cb342", foreground: "#1d1d1d" },
  "3": { background: "#8e24aa", foreground: "#ffffff" },
  "4": { background: "#e67c73", foreground: "#1d1d1d" },
  "5": { background: "#f6bf26", foreground: "#1d1d1d" },
  "6": { background: "#f4511e", foreground: "#ffffff" },
  "7": { background: "#039be5", foreground: "#ffffff" },
  "8": { background: "#616161", foreground: "#ffffff" },
  "9": { background: "#3f51b5", foreground: "#ffffff" },
  "10": { background: "#0b8043", foreground: "#ffffff" },
  "11": { background: "#d50000", foreground: "#ffffff" },
};

const CALENDAR_VALID_COLOR_IDS = Object.keys(CALENDAR_EVENT_COLOR_NAMES);

let _cachedCalendarColors = null;

function withCalendarColorNames(eventColors) {
  const out = {};
  for (const id of CALENDAR_VALID_COLOR_IDS) {
    const entry = eventColors?.[id] || CALENDAR_EVENT_COLOR_FALLBACK[id];
    out[id] = {
      background: entry.background,
      foreground: entry.foreground,
      name: CALENDAR_EVENT_COLOR_NAMES[id],
    };
  }
  return out;
}

// { "1": {background, foreground, name}, ... } 형태를 돌려준다.
async function getAvailableCalendarColors() {
  if (_cachedCalendarColors) return _cachedCalendarColors;
  try {
    const data = await calendarColorsGet();
    _cachedCalendarColors = withCalendarColorNames(data.event);
  } catch (error) {
    console.warn("[Calendar] 색상 목록을 가져오지 못해 기본 팔레트를 사용합니다:", error?.message || error);
    // 실패해도 캐시해둔다. 예전에는 캐시하지 않아서 호출마다 네트워크 요청을 다시 시도했다.
    _cachedCalendarColors = withCalendarColorNames(null);
  }
  return _cachedCalendarColors;
}

function isValidCalendarColorId(colorId) {
  return typeof colorId === "string" && CALENDAR_VALID_COLOR_IDS.includes(colorId);
}

export {
  CALENDAR_EVENT_COLOR_NAMES,
  CALENDAR_EVENT_COLOR_FALLBACK,
  CALENDAR_VALID_COLOR_IDS,
  withCalendarColorNames,
  getAvailableCalendarColors,
  isValidCalendarColorId,
};
