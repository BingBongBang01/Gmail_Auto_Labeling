// calendar/calendar_api.js
// Calendar API helper wrapper utilizing existing OAuth and fetch logic

import { AIProviderBase } from "../ai/ai_provider_base.js";
import { fetchWithJobCancellation, isCancelled } from "../bg/core/cancellation.js";
import { sleep } from "../bg/core/util.js";
import { getValidAccessToken } from "../bg/platform/google_oauth.js";

const CALENDAR_API_TIMEOUT_MS = 60000;

async function calendarApiRequest(url, options = {}) {
  // getValidAccessToken()은 토큰을 돌려주거나 예외를 던진다. null을 돌려주는 경우는 없다.
  const token = await getValidAccessToken();

  const buildOptions = (accessToken) => ({
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
  });

  const readJson = async (res) => {
    // 오류 페이지(HTML 등)가 오면 res.json()이 불투명한 SyntaxError를 던진다.
    try {
      return await res.json();
    } catch (e) {
      throw new Error(`Calendar API 응답을 해석할 수 없습니다 (HTTP ${res.status}).`);
    }
  };

  const fail = async (res) => {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 300);
    } catch (e) {
      /* 본문을 못 읽어도 상태 코드는 알린다 */
    }
    const err = new Error(`Calendar API Error: ${res.status} - ${detail}`);
    err.status = res.status;
    return err;
  };

  let res = await fetchWithJobCancellation(url, buildOptions(token), CALENDAR_API_TIMEOUT_MS);

  // 401: 액세스 토큰 만료. 강제로 새로 받아 한 번 재시도한다.
  if (res.status === 401) {
    const newToken = await getValidAccessToken(true);
    res = await fetchWithJobCancellation(url, buildOptions(newToken), CALENDAR_API_TIMEOUT_MS);
  }

  // 403: 토큰에 calendar.events 권한이 없는 경우가 대표적이다.
  // (calendar.events 스코프가 추가되기 전에 발급된 refresh token을 그대로 쓰고 있으면 여기로 온다)
  // 예전에는 이 경우가 일반 오류로 떨어져서 사용자가 재인증해야 한다는 걸 알 수 없었다.
  if (res.status === 403) {
    let detail = "";
    try {
      detail = (await res.clone().text()).slice(0, 300);
    } catch (e) {
      /* noop */
    }
    if (/insufficient|scope|permission/i.test(detail)) {
      const err = new Error(
        "캘린더 접근 권한이 없습니다. 설정에서 Google 계정 연결을 해제하고 다시 연결해 캘린더 권한을 허용하세요."
      );
      err.status = 403;
      err.requiresReauth = true;
      throw err;
    }
    throw await fail(res);
  }

  if (res.status === 429) {
    const retryAfterMs = AIProviderBase.parseRetryAfterMs(res.headers) || 2000;
    await sleep(retryAfterMs);
    res = await fetchWithJobCancellation(url, buildOptions(token), CALENDAR_API_TIMEOUT_MS);
  }

  if (!res.ok) throw await fail(res);
  return await readJson(res);
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

async function calendarList(params = {}) {
  const url = new URL(`https://www.googleapis.com/calendar/v3/users/me/calendarList`);
  for (const key of Object.keys(params)) {
    if (params[key] !== undefined && params[key] !== null) {
      url.searchParams.append(key, params[key]);
    }
  }
  return await calendarApiGet(url.toString());
}

async function calendarEventGet(calendarId, eventId) {
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
  return await calendarApiGet(url);
}

// maxEvents에 도달하거나 페이지가 끝나면 멈춘다.
// 예전에는 상한도 중지 확인도 없어서, API가 nextPageToken을 계속 주면 무한히 돌 수 있었다.
async function calendarEventsListAll(calendarId, params = {}, maxEvents = Infinity) {
  const events = [];
  let pageToken = null;
  let pageCount = 0;
  const MAX_PAGES = 40; // 안전장치

  do {
    if (isCancelled()) break;

    const currentParams = { ...params };
    if (pageToken) currentParams.pageToken = pageToken;

    const response = await calendarEventsList(calendarId, currentParams);
    if (Array.isArray(response.items)) events.push(...response.items);

    pageToken = response.nextPageToken;
    pageCount += 1;
  } while (pageToken && events.length < maxEvents && pageCount < MAX_PAGES);

  return events.length > maxEvents ? events.slice(0, maxEvents) : events;
}

export {
  calendarApiRequest,
  calendarApiGet,
  calendarApiPatch,
  calendarEventsList,
  calendarEventPatch,
  calendarColorsGet,
  calendarList,
  calendarEventGet,
  calendarEventsListAll,
};
