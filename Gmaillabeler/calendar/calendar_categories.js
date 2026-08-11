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

  const appSettings = await SettingsStore.getSettings();
  const apiKeys = await getGeminiApiKeys();
  const activeKeyObj = apiKeys.find(k => k.provider === "google") || apiKeys[0];
  if (!activeKeyObj || !activeKeyObj.apiKey) throw new Error("No Gemini API Key available");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${activeKeyObj.model || appSettings?.ai?.model || 'gemini-1.5-flash'}:generateContent?key=${activeKeyObj.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    })
  });

  if (!response.ok) throw new Error(`Gemini API Error: ${response.status}`);

  const data = await response.json();
  try {
    const text = data.candidates[0].content.parts[0].text;
    const parsed = JSON.parse(text);
    return deduplicateCalendarCategories(parsed.categories || []);
  } catch (e) {
    console.error("Failed to parse Gemini response for Calendar Categories", e);
    return [];
  }
}
