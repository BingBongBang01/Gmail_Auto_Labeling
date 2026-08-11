// calendar/calendar_colors.js

const CALENDAR_COLORS = {
  // Calendar Event Colors (1-11)
  // 1: Lavender, 2: Sage, 3: Grape, 4: Flamingo, 5: Banana, 6: Tangerine, 7: Peacock, 8: Graphite, 9: Blueberry, 10: Basil, 11: Tomato
  "보안": "11",
  "광고": "8",
  "쇼핑": "6",
  "공지": "5",
  "뉴스레터": "7",
  "업무": "9",
  "개인": "2",
  "기타": "1"
};

function getCalendarColorId(categoryName) {
  if (!categoryName) return null;
  // Match the base category name before any slash (e.g., "업무/회의" -> "업무")
  const baseCategory = categoryName.split("/")[0].trim();
  
  if (CALENDAR_COLORS[baseCategory]) {
    return CALENDAR_COLORS[baseCategory];
  }
  
  // Fallback hash mapping to colors 1-11 if not predefined
  let hash = 0;
  for (let i = 0; i < baseCategory.length; i++) {
    hash = ((hash << 5) - hash) + baseCategory.charCodeAt(i);
    hash |= 0;
  }
  const ids = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"];
  return ids[Math.abs(hash) % ids.length];
}
