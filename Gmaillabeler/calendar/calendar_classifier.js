// calendar/calendar_classifier.js

async function classifyCalendarEventsWithAI(events, categories, currentLocale) {
  if (!events || events.length === 0) return [];
  if (!categories || categories.length === 0) return events.map(e => ({ eventId: e.id, category: "기타", confidence: "low" }));

  // Format categories for prompt
  const categoryContext = categories.filter(c => c.enabled).map(c => `- ${c.name}: ${c.criteria}`).join("\n");
  
  // Prepare batch items
  const batchData = events.map(e => ({
    id: e.id,
    summary: e.summary || "",
    description: (e.description || "").substring(0, 500),
    start: e.start?.dateTime || e.start?.date || "",
    end: e.end?.dateTime || e.end?.date || ""
  }));

  const prompt = `
You are an intelligent calendar assistant. Your task is to classify a list of calendar events into the provided categories.
Current UI Language: ${currentLocale}

Available Categories:
${categoryContext}

Respond strictly in JSON format matching the following schema:
{
  "results": [
    {
      "eventId": "event id here",
      "category": "exact category name here",
      "confidence": "high"
    }
  ]
}
Confidence must be one of: "high", "medium", "low".

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
            category: { type: "STRING" },
            confidence: { type: "STRING" }
          },
          required: ["eventId", "category", "confidence"]
        }
      }
    },
    required: ["results"]
  };

  try {
    const data = await AIRequestRouter.generateStructured(prompt, schema);
    return data.results || [];
  } catch (e) {
    console.error("Failed to parse AI response for Calendar classification", e);
    return [];
  }
}
