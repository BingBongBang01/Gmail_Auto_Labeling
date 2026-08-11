// calendar/calendar_engine.js

let calendarClassificationResult = null;

async function runCalendarClassification({ calendarId, startDate, endDate, overwriteExistingColors }) {
  console.log(`Starting Calendar Classification for ${calendarId} from ${startDate} to ${endDate}`);
  calendarClassificationResult = {
    calendarId,
    range: { start: startDate, end: endDate },
    totalEvents: 0,
    classified: 0,
    skipped: 0,
    updatedColors: 0,
    unchanged: 0,
    unclassified: 0,
    failed: 0
  };

  try {
    const timeMin = new Date(startDate).toISOString();
    const timeMax = new Date(endDate).toISOString();
    
    const events = await calendarEventsListAll(calendarId, {
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime"
    });

    calendarClassificationResult.totalEvents = events.length;
    if (events.length === 0) return calendarClassificationResult;

    const appSettings = await SettingsStore.getSettings();
    const categories = appSettings?.calendar?.categories || [];
    const locale = appSettings?.general?.language || "en";

    // Batch process in chunks of 50
    const chunkSize = appSettings?.ai?.processing?.batchSize || 50;
    for (let i = 0; i < events.length; i += chunkSize) {
      const chunk = events.slice(i, i + chunkSize);
      
      const results = await classifyCalendarEventsWithAI(chunk, categories, locale);
      
      for (const res of results) {
        const event = chunk.find(e => e.id === res.eventId);
        if (!event) continue;

        const category = resolveCalendarCategory(res.category, categories);
        if (!category) {
          // 존재하지 않는 category 이름을 만들어내지 않는다. 매칭되는 category가 전혀 없으면
          // "실패"가 아니라 "미분류"로 남긴다(사용자가 category를 새로 만들거나 나중에 재분류할 수 있음).
          calendarClassificationResult.unclassified++;
          continue;
        }

        calendarClassificationResult.classified++;

        if (!category.enabled) {
          calendarClassificationResult.skipped++;
          continue;
        }

        // Apply colors logic
        if (appSettings?.calendar?.classification?.applyColors) {
          if (res.confidence === "low") {
            calendarClassificationResult.skipped++;
            continue;
          }

          const existingColorId = event.colorId;
          if (existingColorId && !overwriteExistingColors) {
            calendarClassificationResult.unchanged++;
            continue;
          }

          if (existingColorId === category.colorId) {
            calendarClassificationResult.unchanged++;
            continue;
          }

          if (category.colorId) {
            try {
              await calendarEventPatch(calendarId, event.id, { colorId: category.colorId });
              calendarClassificationResult.updatedColors++;
            } catch (e) {
              console.error(`Failed to patch color for event ${event.id}`, e);
              calendarClassificationResult.failed++;
            }
          } else {
             calendarClassificationResult.skipped++;
          }
        }
      }
    }

    console.log("Calendar classification completed", calendarClassificationResult);
    return calendarClassificationResult;

  } catch (error) {
    console.error("Calendar Engine Error:", error);
    // 이미 PATCH가 끝난 이벤트들은 Google Calendar에 실제로 반영된 상태이므로(배치별 즉시 적용),
    // 여기서 rethrow만 하면 "지금까지 완료된 항목"의 집계 결과가 호출자에게 전달되지 않는다.
    // quota 소진 등으로 중단되더라도 지금까지의 결과는 그대로 반환한다.
    calendarClassificationResult.error = error.message || String(error);
    return calendarClassificationResult;
  }
}

/**
 * AI가 반환한 category 이름으로 실제 저장된 category를 찾는다.
 * 정확히 일치하는 게 없다고 해서 존재하지 않는 category("기타" 등)를 임의로 만들어내지 않는다.
 * 1) 이름이 정확히 일치하는 활성 category
 * 2) 그것도 없으면, 명시적으로 fallback으로 지정된 활성 category
 * 3) 그것도 없으면 null (해당 이벤트는 "미분류"로 남긴다)
 */
function resolveCalendarCategory(categoryName, categories) {
  if (!categoryName) return null;
  const exact = categories.find(c => c.name === categoryName && c.enabled !== false);
  if (exact) return exact;
  const fallback = categories.find(c => c.fallback === true && c.enabled !== false);
  if (fallback) return fallback;
  return null;
}
