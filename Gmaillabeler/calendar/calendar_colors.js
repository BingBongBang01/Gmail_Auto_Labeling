// calendar/calendar_colors.js

let _cachedCalendarColors = null;

async function getAvailableCalendarColors() {
  if (_cachedCalendarColors) return _cachedCalendarColors;
  try {
    const data = await calendarColorsGet();
    _cachedCalendarColors = data.event; 
    return _cachedCalendarColors;
  } catch (error) {
    console.error("Failed to fetch calendar colors", error);
    // Fallback if API fails
    return {
      "1": { background: "#a4bdfc", foreground: "#1d1d1d", name: "Lavender" },
      "2": { background: "#7cb342", foreground: "#1d1d1d", name: "Sage" },
      "3": { background: "#8e24aa", foreground: "#ffffff", name: "Grape" },
      "4": { background: "#e67c73", foreground: "#1d1d1d", name: "Flamingo" },
      "5": { background: "#f6bf26", foreground: "#1d1d1d", name: "Banana" },
      "6": { background: "#f4511e", foreground: "#ffffff", name: "Tangerine" },
      "7": { background: "#039be5", foreground: "#ffffff", name: "Peacock" },
      "8": { background: "#616161", foreground: "#ffffff", name: "Graphite" },
      "9": { background: "#3f51b5", foreground: "#ffffff", name: "Blueberry" },
      "10": { background: "#0b8043", foreground: "#ffffff", name: "Basil" },
      "11": { background: "#d50000", foreground: "#ffffff", name: "Tomato" }
    };
  }
}

function getCalendarEventColor(category) {
  if (category && category.colorId) {
    return category.colorId;
  }
  return null;
}
