// calendar/calendar_api.js
// Calendar API helper wrapper utilizing existing OAuth and fetch logic

async function calendarApiRequest(url, options = {}) {
  const token = await getValidAccessToken();
  if (!token) throw new Error("No valid access token available");

  options.headers = options.headers || {};
  options.headers.Authorization = `Bearer ${token}`;
  
  try {
    const res = await fetchWithJobCancellation(url, options, 60000);
    
    if (res.status === 401) {
      const newToken = await getValidAccessToken(true);
      options.headers.Authorization = `Bearer ${newToken}`;
      const retryRes = await fetchWithJobCancellation(url, options, 60000);
      if (!retryRes.ok) throw new Error(`Calendar API Error: ${retryRes.status}`);
      return await retryRes.json();
    }
    
    if (res.status === 410) {
      const error = new Error("Sync token is no longer valid");
      error.status = 410;
      throw error;
    }
    
    if (res.status === 429) {
      let retryAfterMs = 2000;
      if (typeof parseRetryAfterMs === "function") {
          retryAfterMs = parseRetryAfterMs(res.headers.get("Retry-After")) || 2000;
      }
      await sleep(retryAfterMs);
      const retryRes = await fetchWithJobCancellation(url, options, 60000);
      if (!retryRes.ok) throw new Error(`Calendar API Error: ${retryRes.status}`);
      return await retryRes.json();
    }
    
    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Calendar API Error: ${res.status} - ${errorText}`);
      err.status = res.status;
      throw err;
    }
    
    return await res.json();
  } catch (error) {
    if (typeof isCancellationError === "function" && isCancellationError(error)) {
        throw error;
    }
    throw error;
  }
}

async function calendarApiGet(url) {
  return await calendarApiRequest(url, { method: "GET" });
}

async function calendarApiPatch(url, body) {
  return await calendarApiRequest(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function calendarEventsList(calendarId, params = {}) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  for (const key of Object.keys(params)) {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, params[key]);
    }
  }
  return await calendarApiGet(url.toString());
}

async function calendarEventPatch(calendarId, eventId, updates) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`;
  return await calendarApiPatch(url, updates);
}

async function calendarColorsGet() {
  const url = "https://www.googleapis.com/calendar/v3/colors";
  return await calendarApiGet(url);
}
