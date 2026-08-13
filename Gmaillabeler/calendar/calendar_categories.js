// calendar/calendar_categories.js

/**
 * Ensures categories don't have exact duplicate names.
 */
function deduplicateCalendarCategories(categories) {
  const seen = new Set();
  const deduped = [];
  for (const cat of categories) {
    if (!cat || typeof cat.name !== "string" || !cat.name.trim()) continue;
    const norm = cat.name.toLowerCase().trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      deduped.push(cat);
    }
  }
  return deduped;
}

function newCalendarCategoryId(index) {
  try {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch (e) {
    /* fallthrough */
  }
  return `cal-cat-${Date.now()}-${index}`;
}

/**
 * 일정 샘플을 보고 캘린더 카테고리 초안을 AI로 생성한다.
 *
 * availableColors는 { "1": {background, foreground, name}, ... } 형태를 기대한다
 * (getAvailableCalendarColors()가 돌려주는 모양).
 * 예전 호출부는 Object.keys(colorsData.event)로 만든 배열을 넘겼는데, 이 함수는 맵으로 다뤄서
 * Object.keys가 인덱스 "0"~"10"을 만들었다. 그래서 AI에게 존재하지 않는 colorId "0"을 제시하고
 * 실제로 있는 "11"은 알려주지 않았고, "0"이 배정되면 events.patch가 400을 냈다.
 */
async function initializeCalendarCategoriesWithAI(events, availableColors, currentLocale) {
  const eventSamples = events
    .slice(0, 50)
    .map((e) => e && e.summary)
    .filter(Boolean);

  if (eventSamples.length === 0) {
    return []; // 카테고리를 유추할 근거가 없다
  }

  const colorMap =
    availableColors && !Array.isArray(availableColors) && typeof availableColors === "object"
      ? availableColors
      : null;
  const colorIds = colorMap ? Object.keys(colorMap) : CALENDAR_VALID_COLOR_IDS;
  const colorOptions = colorIds
    .map((id) => `${id} (${colorMap?.[id]?.name || CALENDAR_EVENT_COLOR_NAMES[id] || `Color ${id}`})`)
    .join(", ");

  const prompt = `
You are an intelligent calendar assistant. Generate 3 to 8 useful calendar categories based on these event samples.
Write the "name" and "criteria" values in this language: ${currentLocale}

Event Samples:
${JSON.stringify(eventSamples)}

Available Calendar Color IDs: ${colorOptions}

Rules:
1. Provide a short "name" (1-2 words).
2. Provide a descriptive "criteria" explaining what fits this category.
3. "colorId" MUST be one of the available color IDs listed above, as a string. Distribute colors so they aren't all the same.
4. Set "priority" starting from 1 (most important).
5. Set "enabled" to true.
`;

  const schema = {
    type: "object",
    properties: {
      categories: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            criteria: { type: "string" },
            colorId: { type: "string" },
            priority: { type: "integer" },
            enabled: { type: "boolean" }
          },
          required: ["name", "criteria", "colorId", "priority", "enabled"]
        }
      }
    },
    required: ["categories"]
  };

  // Provider/모델/키 선택, retry, failover, quota는 전부 공통 AIRequestRouter가 담당한다.
  // Calendar Category 생성 전용 fetch/Gemini 직접 호출은 두지 않는다.
  const result = await AIRequestRouter.generateStructured(prompt, schema);
  const validCategories = validateCalendarCategories(result?.categories, availableColors);
  return deduplicateCalendarCategories(validCategories);
}

/**
 * AI가 생성한 카테고리를 실제 저장 가능한 형태로 검증/정규화한다.
 * 유효하지 않은 항목(빈 이름, 허용되지 않는 colorId 등)은 버린다.
 */
function validateCalendarCategories(categories, availableColors) {
  if (!Array.isArray(categories)) return [];
  const allowedColorIds = new Set(Object.keys(availableColors || {}));
  const validated = [];
  for (const cat of categories) {
    if (!cat || typeof cat.name !== "string" || !cat.name.trim()) continue;
    if (typeof cat.criteria !== "string" || !cat.criteria.trim()) continue;
    const colorId = String(cat.colorId ?? "");
    if (allowedColorIds.size > 0 && !allowedColorIds.has(colorId)) continue;
    const priority = Number.isInteger(cat.priority) && cat.priority > 0 ? cat.priority : validated.length + 1;
    validated.push({
      name: cat.name.trim(),
      criteria: cat.criteria.trim(),
      colorId,
      priority,
      enabled: cat.enabled !== false,
      colorSource: "ai"
    });
  }
  return validated;
    type: "OBJECT",
    properties: {
      categories: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING" },
            criteria: { type: "STRING" },
            colorId: { type: "STRING", enum: colorIds },
            priority: { type: "INTEGER" },
            enabled: { type: "BOOLEAN" },
          },
          required: ["name", "criteria", "colorId", "priority", "enabled"],
        },
      },
    },
    required: ["categories"],
  };

  // 라우터를 통해 호출한다. 예전에는 여기서 getGeminiApiKeys() + 생 fetch로 Gemini를 직접 불러서
  // 페일오버/할당량 관리/다른 공급자를 전부 우회했고, 존재하지 않는 throttleGeminiCall()과
  // 선언되지 않은 appSettings를 참조해 항상 ReferenceError로 실패했다.
  const data = await AIRequestRouter.generateStructured(prompt, schema);

  const deduped = deduplicateCalendarCategories(data?.categories || []);
  return deduped.map((cat, index) => ({
    id: newCalendarCategoryId(index),
    name: cat.name.trim(),
    criteria: typeof cat.criteria === "string" ? cat.criteria : "",
    // AI가 목록 밖의 값을 주면 색상을 비워둔다(잘못된 colorId로 patch하면 400).
    colorId: isValidCalendarColorId(String(cat.colorId)) ? String(cat.colorId) : "",
    priority: Number.isFinite(Number(cat.priority)) ? Number(cat.priority) : index + 1,
    enabled: cat.enabled !== false,
    colorSource: "ai",
  }));
}
