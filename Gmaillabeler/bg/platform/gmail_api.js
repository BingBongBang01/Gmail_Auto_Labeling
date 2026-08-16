// bg/platform/gmail_api.js
// Gmail REST API 어댑터. 메일 목록/본문 조회와 라벨 수정 호출만 담당하고,
// "어떤 라벨을 붙일지" 같은 판단은 하지 않는다.

import {
  JobCancelledError,
  isCancelled,
  registerAbortController,
  unregisterAbortController,
} from "../core/cancellation.js";
import { getValidAccessToken } from "./google_oauth.js";
import { t } from "../../i18n.js";
import { SettingsStore } from "../../settings/settings_store.js";

async function gmailFetch(url, options) {
  const opts = options || {};
  const token = await getValidAccessToken();

  // 중지 버튼을 누르면 진행 중인 Gmail 요청도 함께 끊기도록 AbortController를 등록한다.
  // (예전에는 Gemini 요청만 취소돼서, 메일 상세를 수백 건 조회하는 도중 누른 중지가 즉시 반응하지 않았다)
  const controller = new AbortController();
  registerAbortController(controller);
  const doFetch = (tk) =>
    fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${tk}` },
    });

  try {
    let response = await doFetch(token);
    if (response.status === 401) {
      const freshToken = await getValidAccessToken(true);
      response = await doFetch(freshToken);
    }
    return response;
  } catch (err) {
    if (isCancelled() || (err && err.name === "AbortError")) throw new JobCancelledError();
    throw err;
  } finally {
    unregisterAbortController(controller);
  }
}


const GMAIL_LIST_PAGE_LIMIT = 500;

async function listMessagesPaged(baseParams, maxResults, errorKey, errorParams) {
  const wanted = Math.max(1, maxResults || 1);
  const collected = [];
  let pageToken = null;

  while (collected.length < wanted) {
    const params = new URLSearchParams(baseParams);
    params.set("maxResults", String(Math.min(GMAIL_LIST_PAGE_LIMIT, wanted - collected.length)));
    if (pageToken) params.set("pageToken", pageToken);

    const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params.toString()}`);
    if (!response.ok) throw new Error(t(errorKey, [...(errorParams || []), response.status]));
    const data = await response.json();
    const page = data.messages || [];
    collected.push(...page);
    pageToken = data.nextPageToken || null;
    // 다음 페이지가 없거나 빈 페이지가 오면 더 가져올 게 없다(무한 루프 방지)
    if (!pageToken || page.length === 0) break;
    if (isCancelled()) break;
  }

  return collected.slice(0, wanted);
}

async function getRecentMessages(token, maxResults, categories) {
  // 카테고리 라벨이 하나라도 이미 붙어있는 메일은 제외 -> 재실행 시 이미 분류된 메일 재연산 방지
  const excludeQuery = (categories || []).map((c) => `-label:"${c}"`).join(" ");
  const params = excludeQuery ? { q: excludeQuery } : {};
  return await listMessagesPaged(params, maxResults, "errMessageListFailed");
}

async function getMessagesByLabelName(token, labelName, maxResults) {
  return await listMessagesPaged({ q: `label:"${labelName}"` }, maxResults, "errLabelMessageListFailed", [labelName]);
}

function decodeBase64Url(data) {
  if (!data) return "";
  try {
    const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (e) {
    return "";
  }
}

// 마케팅 메일은 스팸필터 우회를 위해 &zwnj;(zero-width non-joiner) 같은 "보이지 않는 문자"를
// 본문 앞부분에 수십~수백 개 끼워넣는 경우가 흔하다. 이걸 안 지우면 앞부분 잘라내기(MAX_BODY_CHARS_FOR_AI)
// 창이 전부 이 쓰레기 문자로 채워져서 정작 실제 내용은 AI에게 전달조차 안 되는 문제가 생긴다.
function stripHtml(html) {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ");

  // 숫자 문자 참조(&#46;, &#x2E; 등) 디코딩 - 제로폭 문자가 이 형태로 숨어있는 경우도 처리
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
    try {
      return String.fromCodePoint(parseInt(hex, 16));
    } catch (e) {
      return "";
    }
  });
  text = text.replace(/&#(\d+);/g, (_, dec) => {
    try {
      return String.fromCodePoint(parseInt(dec, 10));
    } catch (e) {
      return "";
    }
  });

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(#39|apos);/gi, "'")
    .replace(/&zwnj;|&zwj;|&shy;|&ZeroWidthSpace;/gi, "");

  // 제로폭 조인/논조인/스페이스, 좌우방향 마크, BOM, 소프트하이픈 등 화면엔 안 보이는 문자 제거
  text = text.replace(/[\u200B-\u200F\u202A-\u202E\uFEFF\u00AD]/g, "");

  return text.replace(/\s+/g, " ").trim();
}

function findMimePart(parts, mimeType) {
  for (const part of parts) {
    if (part.mimeType === mimeType && part.body && part.body.data) return part;
    if (part.parts) {
      const found = findMimePart(part.parts, mimeType);
      if (found) return found;
    }
  }
  return null;
}

// Gmail의 자동 snippet(약 100자, 본문 맨 앞부분만)만으로는 하단 푸터에 있는
// "수신거부/프로모션 이메일" 같은 결정적 신호를 놓치기 때문에, 실제 본문 텍스트를 뽑아서 사용한다.
function extractEmailText(payload) {
  if (!payload) return "";
  if (payload.body && payload.body.data && payload.mimeType) {
    const decoded = decodeBase64Url(payload.body.data);
    return payload.mimeType === "text/html" ? stripHtml(decoded) : decoded;
  }
  if (payload.parts) {
    const plainPart = findMimePart(payload.parts, "text/plain");
    if (plainPart) return decodeBase64Url(plainPart.body.data);
    const htmlPart = findMimePart(payload.parts, "text/html");
    if (htmlPart) return stripHtml(decodeBase64Url(htmlPart.body.data));
  }
  return "";
}

const PROMO_FOOTER_PATTERN = /(수신\s*거부|구독\s*취소|프로모션\s*이메일|마케팅\s*(이메일|메일)|marketing\s*emails?|unsubscribe)/i;
const MAX_BODY_CHARS_FOR_AI = 350;

// 빠른 모드: 본문 전체(format=full)를 받지 않고 필요한 헤더 3개 + Gmail 자동 미리보기(snippet)만 받는다.
// 전송량이 메일당 수십 KB에서 1KB 안쪽으로 줄지만, 본문 하단의 "수신거부/프로모션" 신호를 못 보므로
// 광고성 메일 판별 정확도가 떨어질 수 있다. 그래서 기본값은 꺼짐이고 사용자가 직접 켜야 한다.
// To/Cc는 "나와 관련된 메일" 판별(개인 관련성)에 쓰이므로 가벼운 조회 모드에서도 함께 받아온다.
const LIGHT_FETCH_METADATA_HEADERS = ["Subject", "From", "Date", "To", "Cc"];
let lightMailFetchCache = null;

async function isLightMailFetchEnabled() {
  if (lightMailFetchCache !== null) return lightMailFetchCache;
  const settings = await SettingsStore.getSettings();
  lightMailFetchCache = settings.gmail.fetching.lightweight === true;
  return lightMailFetchCache;
}

// 설정이 바뀌면 캐시를 버려서 다음 작업에 바로 반영되게 한다.
// 예전에는 평면 키 lightMailFetchEnabled가 바뀌는지 보고 있었는데, 그 키는 v3 스키마로 옮기면서
// 아무도 쓰지 않게 됐다. 그래서 옵션에서 "가벼운 조회"를 켜고 꺼도 캐시가 절대 비워지지 않았고,
// 서비스워커가 재시작될 때까지 이전 값이 그대로 쓰였다. 실제 설정 경로를 보도록 고친다.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.appSettings) return;
  const before = changes.appSettings.oldValue?.gmail?.fetching?.lightweight;
  const after = changes.appSettings.newValue?.gmail?.fetching?.lightweight;
  if (before !== after) lightMailFetchCache = null;
});

function buildEmailContentUrl(messageId, lightMode) {
  const base = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`;
  if (lightMode) {
    const headerParams = LIGHT_FETCH_METADATA_HEADERS.map((h) => `metadataHeaders=${h}`).join("&");
    return `${base}?format=metadata&${headerParams}`;
  }
  return `${base}?format=full`;
}

async function getEmailContent(token, messageId) {
  const lightMode = await isLightMailFetchEnabled();
  const response = await gmailFetch(buildEmailContentUrl(messageId, lightMode));
  if (!response.ok) throw new Error(t("errMessageContentFailed", [response.status]));
  const data = await response.json();

  const headers = (data.payload && data.payload.headers) || [];
  const subject = headers.find((h) => h.name === "Subject")?.value || "(제목 없음)";
  const from = headers.find((h) => h.name === "From")?.value || "";
  const date = headers.find((h) => h.name === "Date")?.value || null;
  const to = headers.find((h) => h.name === "To")?.value || "";
  const cc = headers.find((h) => h.name === "Cc")?.value || "";

  let bodyText = "";
  try {
    bodyText = extractEmailText(data.payload).replace(/\s+/g, " ").trim();
  } catch (e) {
    bodyText = "";
  }

  let contentForAI = bodyText ? bodyText.slice(0, MAX_BODY_CHARS_FOR_AI) : data.snippet || "";
  // 본문 앞부분만 잘라서 보내더라도, 전체 본문(푸터 포함) 어딘가에 프로모션/수신거부 문구가 있으면
  // 그 사실만 짧게 덧붙여서 강한 신호로 전달 (본문 전체를 다 보내지 않아도 됨)
  if (bodyText && PROMO_FOOTER_PATTERN.test(bodyText)) {
    contentForAI += " [발신자표기: 수신거부/프로모션 이메일 문구 있음]";
  }

  return {
    id: data.id,
    threadId: data.threadId,
    snippet: contentForAI || "",
    subject,
    from,
    to,
    cc,
    date, // 요약 리포트가 메일 날짜를 표시할 수 있도록 함께 반환 (예전에는 누락돼 항상 null이었음)
    labelIds: data.labelIds || [],
  };
}

// "나와 관련된 메일" 판별에는 내 메일 주소가 있어야 한다.
// users/me/profile은 자주 바뀌지 않으므로 한 번 받아 storage에 캐시해두고 재사용한다.
async function getMyEmailAddress() {
  const cached = await new Promise((resolve) => chrome.storage.local.get(["myEmailAddress"], resolve));
  if (cached.myEmailAddress) return cached.myEmailAddress;
  try {
    const response = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/profile");
    if (!response.ok) return "";
    const data = await response.json();
    const address = data.emailAddress || "";
    if (address) await chrome.storage.local.set({ myEmailAddress: address });
    return address;
  } catch (e) {
    return "";
  }
}


const GMAIL_BATCH_MODIFY_LIMIT = 1000;

// "우리가 관리하는 카테고리"에 속한 Gmail 라벨 ID 전체.
// 메일마다 labelCache를 다시 순회하던 계산을 한 번만 하기 위해 분리했다.


async function modifyMessageLabels(token, messageId, addIds, removeIds) {
  const body = {};
  if (addIds && addIds.length) body.addLabelIds = addIds;
  if (removeIds && removeIds.length) body.removeLabelIds = removeIds;
  const response = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) throw new Error(t("errLabelMoveFailed", [response.status]));
}

async function getMessagesByLabelId(token, labelId, maxResults) {
  return await listMessagesPaged({ labelIds: labelId }, maxResults, "errLabelIdMessageListFailed");
}

async function patchLabelColor(token, labelId, color) {
  const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${labelId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ color }),
  });
  if (!response.ok) throw new Error(t("errLabelColorApplyFailed", [response.status]));
}

// 기존에 색상 없이 생성된 라벨들에도 카테고리 색상을 일괄 적용 (신규 생성 라벨은 생성 시점에 이미 색상이 들어감)


export {
  GMAIL_BATCH_MODIFY_LIMIT,
  GMAIL_LIST_PAGE_LIMIT,
  LIGHT_FETCH_METADATA_HEADERS,
  MAX_BODY_CHARS_FOR_AI,
  PROMO_FOOTER_PATTERN,
  buildEmailContentUrl,
  decodeBase64Url,
  extractEmailText,
  findMimePart,
  getEmailContent,
  getMessagesByLabelId,
  getMessagesByLabelName,
  getMyEmailAddress,
  getRecentMessages,
  gmailFetch,
  isLightMailFetchEnabled,
  lightMailFetchCache,
  listMessagesPaged,
  modifyMessageLabels,
  patchLabelColor,
  stripHtml,
};
