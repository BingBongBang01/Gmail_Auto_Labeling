// calendar/calendar_engine.js

// 캘린더 분류 실행 결과. 예전에는 모듈 전역 하나를 매 실행마다 덮어써서
// 동시 실행이 서로의 집계를 망가뜨렸고, 정작 이 값을 읽는 곳도 없었다.
// 이제는 실행마다 지역 객체를 만들어 그대로 반환한다.
function newCalendarRunResult(calendarId, startDate, endDate) {
  return {
    calendarId,
    range: { start: startDate, end: endDate },
    totalEvents: 0,
    classified: 0,
    unmatched: 0,
    skippedDisabled: 0,
    skippedLowConfidence: 0,
    skippedNoColor: 0,
    unchanged: 0,
    updatedColors: 0,
    failed: 0,
  };
}

async function runCalendarClassification({
  calendarId,
  startDate,
  endDate,
  overwriteExistingColors,
  applyColors,
}) {
  // 예전에는 여기서 선언되지 않은 전역 `appSettings`를 읽었다.
  // 옵셔널 체이닝(appSettings?.calendar)은 미선언 식별자를 막아주지 않으므로
  // 이벤트를 전부 가져온 직후 ReferenceError가 나서 캘린더 분류가 한 번도 성공할 수 없었다.
  const settings = await SettingsStore.getSettings();
  const calendarSettings = settings.calendar || {};
  const classificationSettings = calendarSettings.classification || {};

  const categories = Array.isArray(calendarSettings.categories) ? calendarSettings.categories : [];
  const locale =
    settings.general?.language && settings.general.language !== "system"
      ? settings.general.language
      : typeof i18nCurrentLocale === "function"
      ? i18nCurrentLocale()
      : "en";

  const shouldApplyColors =
    applyColors !== undefined ? !!applyColors : classificationSettings.applyColors !== false;
  const shouldOverwrite =
    overwriteExistingColors !== undefined
      ? !!overwriteExistingColors
      : classificationSettings.overwriteExistingColors === true;

  const result = newCalendarRunResult(calendarId, startDate, endDate);
  const failMessages = [];

  if (categories.length === 0) {
    // 기준이 없으면 아무 일정도 분류할 수 없다. 조용히 0건으로 끝내지 말고 이유를 알린다.
    throw new Error(
      "캘린더 분류 기준이 없습니다. 설정 > 캘린더에서 카테고리를 만들거나 'AI로 카테고리 생성'을 실행하세요."
    );
  }

  const timeMin = new Date(startDate).toISOString();
  const timeMax = new Date(endDate).toISOString();

  // maxEventsPerRun은 스키마와 옵션 UI에 있는데 아무도 읽지 않았다.
  const maxEvents = Math.max(1, parseInt(classificationSettings.maxEventsPerRun, 10) || 100);

  const events = await calendarEventsListAll(calendarId, {
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
    // 취소된 일정에 색을 칠할 이유가 없다.
    showDeleted: false,
  }, maxEvents);

  const targetEvents = events.slice(0, maxEvents);
  result.totalEvents = targetEvents.length;
  if (targetEvents.length === 0) {
    return { ...result, total: 0, success: 0, failMessages, requestsUsed: 0, cancelled: false, quotaExhausted: false };
  }

  const configuredBatch = parseInt(settings.ai?.processing?.batchSize, 10);
  const chunkSize = Math.max(1, Math.min(50, Number.isFinite(configuredBatch) ? configuredBatch : 50));

  let requestsUsed = 0;
  let cancelled = false;

  for (let i = 0; i < targetEvents.length; i += chunkSize) {
    if (typeof isCancelled === "function" && isCancelled()) {
      cancelled = true;
      break;
    }

    const chunk = targetEvents.slice(i, i + chunkSize);

    let classifications;
    try {
      classifications = await classifyCalendarEventsWithAI(chunk, categories, locale);
      requestsUsed += 1;
    } catch (e) {
      // 한 청크가 실패해도 나머지는 계속 처리한다.
      if (typeof isCancellationError === "function" && isCancellationError(e)) {
        cancelled = true;
        break;
      }
      const message = String(e?.message || e);
      failMessages.push(message);
      result.failed += chunk.length;
      if (typeof addLog === "function") {
        await addLog(`[캘린더] 일정 ${chunk.length}건 분류 실패: ${message}`, "error");
      }
      continue;
    }

    for (const entry of classifications) {
      const event = chunk.find((e) => e.id === entry.eventId);
      if (!event) continue;

      const category = categories.find((c) => c.name === entry.category);
      if (!category) {
        // AI가 목록에 없는 이름을 냈다. 우리 요청 문제이지 일정 처리 실패가 아니다.
        result.unmatched += 1;
        continue;
      }

      result.classified += 1;

      if (!category.enabled) {
        result.skippedDisabled += 1;
        continue;
      }
      if (!shouldApplyColors) continue;

      if (entry.confidence === "low") {
        result.skippedLowConfidence += 1;
        continue;
      }
      if (!category.colorId || !isValidCalendarColorId(String(category.colorId))) {
        result.skippedNoColor += 1;
        continue;
      }

      const existingColorId = event.colorId;
      if (existingColorId === String(category.colorId)) {
        result.unchanged += 1;
        continue;
      }
      if (existingColorId && !shouldOverwrite) {
        result.unchanged += 1;
        continue;
      }

      try {
        await calendarEventPatch(calendarId, event.id, { colorId: String(category.colorId) });
        result.updatedColors += 1;
      } catch (e) {
        if (typeof isCancellationError === "function" && isCancellationError(e)) {
          cancelled = true;
          break;
        }
        const message = String(e?.message || e);
        failMessages.push(message);
        result.failed += 1;
      }
    }

    if (cancelled) break;

    if (typeof updateProgress === "function") {
      await updateProgress({
        processed: Math.min(i + chunk.length, targetEvents.length),
        total: targetEvents.length,
        batchIndex: Math.floor(i / chunkSize) + 1,
        batchTotal: Math.ceil(targetEvents.length / chunkSize),
      });
    }
  }

  if (typeof addLog === "function") {
    await addLog(
      `[캘린더] 일정 ${result.totalEvents}건 중 ${result.classified}건 분류, ` +
        `색상 ${result.updatedColors}건 변경, ${result.unchanged}건 유지, ${result.failed}건 실패.`
    );
  }

  // runJob()이 소비하는 필드를 함께 담아 돌려준다.
  return {
    ...result,
    total: result.totalEvents,
    success: result.updatedColors + result.unchanged,
    failMessages,
    requestsUsed,
    cancelled,
    quotaExhausted: false,
  };
}
