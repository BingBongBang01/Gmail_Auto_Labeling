// calendar/calendar_categories.js

/**
 * Ensures categories don't have exact duplicate names.
 */
function deduplicateCalendarCategories(categories) {
  const seen = new Set();
  const deduped = [];
  for (const cat of categories) {
    const norm = cat.name.toLowerCase().trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      deduped.push(cat);
    }
  }
  return deduped;
}

/**
 * Prompts Gemini to generate initial Calendar Categories based on a sample of events.
 */
async function initializeCalendarCategoriesWithAI(events, availableColors, currentLocale) {
  // Extract summary of events for AI
  const eventSamples = events.slice(0, 50).map(e => e.summary).filter(Boolean);
  
  if (eventSamples.length === 0) {
    return []; // Not enough data to generate categories
  }

  const colorOptions = Object.keys(availableColors).map(k => `${k} (${availableColors[k].name || 'Color ' + k})`).join(", ");

  const prompt = `
You are an intelligent calendar assistant. Generate 3 to 8 useful calendar categories based on these event samples.
Current UI Language: ${currentLocale}

Event Samples:
${JSON.stringify(eventSamples)}

Available Calendar Color IDs: ${colorOptions}

Rules:
1. Provide a short "name" (1-2 words).
2. Provide a descriptive "criteria" explaining what fits this category.
3. Select an appropriate "colorId" from the available colors. Distribute colors so they aren't all the same.
4. Set "priority" starting from 1 (most important).
5. Set "enabled" to true.

Respond strictly in JSON format matching the following schema:
{
  "categories": [
    {
      "name": "Category Name",
      "criteria": "Description of criteria",
      "colorId": "1",
      "priority": 1,
      "enabled": true
    }
  ]
}
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
}
