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

    const categories = appSettings?.calendar?.categories || [];
    const locale = appSettings?.general?.language || "en";

    // Batch process in chunks of 50
    const chunkSize = 50;
    for (let i = 0; i < events.length; i += chunkSize) {
      const chunk = events.slice(i, i + chunkSize);
      
      const results = await classifyCalendarEventsWithAI(chunk, categories, locale);
      
      for (const res of results) {
        const event = chunk.find(e => e.id === res.eventId);
        if (!event) continue;

        const category = categories.find(c => c.name === res.category);
        if (!category) {
          calendarClassificationResult.failed++;
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
    throw error;
  }
}
