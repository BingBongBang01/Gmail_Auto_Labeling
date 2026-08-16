// bg/features/calendar/calendar.js
// 캘린더 카테고리 생성. 일정 분류 자체는 calendar/calendar_engine.js가 담당한다.

import { addLog } from "../../core/logger.js";
import { hasUsableAiCredential } from "../../platform/ai_gateway.js";
import { calendarEventsListAll } from "../../../calendar/calendar_api.js";
import { initializeCalendarCategoriesWithAI } from "../../../calendar/calendar_categories.js";
import { getAvailableCalendarColors } from "../../../calendar/calendar_colors.js";
import { i18nCurrentLocale, t } from "../../../i18n.js";
import { SettingsStore } from "../../../settings/settings_store.js";

async function processGenerateCalendarCategories(calendarId) {
  if (!(await hasUsableAiCredential())) throw new Error(t("errNoApiKey"));

  const settings = await SettingsStore.getSettings();
  const targetCalendar = calendarId || settings.calendar?.general?.defaultCalendar || "primary";

  // 최근 30일 일정을 표본으로 카테고리 초안을 만든다.
  await addLog("[캘린더] 최근 일정을 분석해 카테고리를 생성합니다...");
  const events = await calendarEventsListAll(
    targetCalendar,
    {
      timeMin: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      timeMax: new Date().toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
    },
    100
  );

  if (!events.length) {
    throw new Error("최근 30일 안에 분석할 일정이 없습니다. 캘린더에 일정을 추가한 뒤 다시 시도하세요.");
  }

  // getAvailableCalendarColors()는 { "1": {background, foreground, name}, ... } 맵을 돌려준다.
  // 예전에는 Object.keys(colorsData.event)로 만든 배열을 넘겨서 colorId가 한 칸씩 밀렸다.
  const availableColors = await getAvailableCalendarColors();
  const generated = await initializeCalendarCategoriesWithAI(events, availableColors, i18nCurrentLocale());

  if (!generated.length) {
    throw new Error("AI가 카테고리를 만들지 못했습니다. 잠시 후 다시 시도하세요.");
  }

  // 사용자가 직접 지정한 색상(colorSource === "user")은 이름이 같은 새 category가 생성되어도
  // AI가 임의로 덮어쓰지 않는다.
  const existingByName = new Map((settings.calendar?.categories || []).map((c) => [c.name, c]));
  const categories = generated.map((c) => {
    const existing = existingByName.get(c.name);
    if (existing && existing.colorSource === "user") {
      return { ...c, colorId: existing.colorId, colorSource: "user" };
    }
    return c;
  });

  await SettingsStore.setSetting("calendar.categories", categories);
  await addLog(`[캘린더] 카테고리 ${categories.length}개를 생성했습니다.`);

  return {
    total: categories.length,
    success: categories.length,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: false,
    quotaExhausted: false,
  };
}


export {
  processGenerateCalendarCategories,
};
