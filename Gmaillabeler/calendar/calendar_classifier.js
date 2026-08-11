// calendar/calendar_classifier.js

async function classifyCalendarEventsWithAI(events, categories, currentLocale) {
  if (!events || events.length === 0) return [];

  const enabledCategories = (categories || []).filter((c) => c && c.enabled && c.name);
  // 분류 기준이 없으면 AI를 부를 이유가 없다.
  // 예전에는 하드코딩된 한국어 "기타"를 돌려줬는데, 그런 카테고리는 목록에 없으니
  // 엔진이 전부 '실패'로 집계했다.
  if (enabledCategories.length === 0) return [];

  const categoryNames = enabledCategories.map((c) => c.name);
  const categoryContext = enabledCategories
    .map((c) => `- ${c.name}: ${c.criteria || "(기준 설명 없음)"}`)
    .join("\n");

  const batchData = events.map((e) => ({
    id: e.id,
    summary: e.summary || "",
    description: (e.description || "").substring(0, 500),
    location: e.location || "",
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || "",
  }));

  const prompt = `
You are an intelligent calendar assistant. Classify each calendar event into exactly one of the categories below.
Answer language: ${currentLocale}

Available Categories:
${categoryContext}

Rules:
- "category" MUST be one of the exact category names listed above. Never invent a new name.
- If an event does not clearly fit any category, still pick the closest one but set "confidence" to "low".
- Return one entry for every event, using the event's "id" as "eventId".

Events to classify:
${JSON.stringify(batchData)}
`;

  const schema = {
    type: "OBJECT",
    properties: {
      results: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            eventId: { type: "STRING" },
            // enum으로 묶어두면 모델이 목록에 없는 카테고리를 만들어낼 수 없다.
            category: { type: "STRING", enum: categoryNames },
            confidence: { type: "STRING", enum: ["high", "medium", "low"] },
          },
          required: ["eventId", "category", "confidence"],
        },
      },
    },
    required: ["results"],
  };

  // 오류를 여기서 삼키면(예전 동작) 사용자는 "0건 분류"만 보고 이유를 알 수 없다.
  // 호출부(엔진)가 청크 단위로 잡아서 실패 건수와 메시지를 기록한다.
  const data = await AIRequestRouter.generateStructured(prompt, schema);
  return Array.isArray(data?.results) ? data.results : [];
}
