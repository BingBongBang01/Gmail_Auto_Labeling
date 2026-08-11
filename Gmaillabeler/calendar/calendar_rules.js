// calendar/calendar_rules.js

let calendarFilterRules = [];

async function loadCalendarFilterRules() {
  const data = await chrome.storage.local.get("calendarFilterRules");
  calendarFilterRules = data.calendarFilterRules || [];
  return calendarFilterRules;
}

async function saveCalendarFilterRules(rules) {
  calendarFilterRules = rules;
  await chrome.storage.local.set({ calendarFilterRules: rules });
}

function matchCalendarRule(event, rules) {
  for (const rule of rules) {
    let match = false;
    const value = rule.value.toLowerCase();
    
    if (rule.type === "title" && event.summary && event.summary.toLowerCase().includes(value)) match = true;
    else if (rule.type === "description" && event.description && event.description.toLowerCase().includes(value)) match = true;
    else if (rule.type === "creator" && event.creator && event.creator.email && event.creator.email.toLowerCase().includes(value)) match = true;
    
    if (match) return rule.categoryId; // categoryName
  }
  return null;
}
