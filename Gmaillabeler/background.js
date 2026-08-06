// background.js
// Gmail AI Labeler - Copyright (c) 2026 김태형 (thk7410@gmail.com). All rights reserved.
// See LICENSE file at the extension root for terms. Unauthorized redistribution or resale is prohibited.
importScripts("i18n.js", "crypto-helper.js");

// ---------------- 투명 배경 고시인성 왕 편지봉투 + AI Sparkle 아이콘 드로잉 ----------------
function drawIconCodeData(size) {
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size); // 배경 투명 처리!

  // 1. 대형 이메일 편지봉투 드로잉 (전체 캔버스 영역 85% 대형 렌더링)
  const envW = size * 0.84;
  const envH = size * 0.56;
  const envX = (size - envW) / 2;
  const envY = size * 0.32;

  // 봉투 테두리 및 그림자 (다크 네이비 테두리로 시인성 극대화)
  ctx.fillStyle = "#1e293b";
  ctx.beginPath();
  ctx.roundRect(envX - size * 0.03, envY - size * 0.03, envW + size * 0.06, envH + size * 0.06, size * 0.05);
  ctx.fill();

  // 봉투 본체 (화이트)
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(envX, envY, envW, envH, size * 0.04);
  ctx.fill();

  // Gmail 시그니처 Red V-Shape Flap
  ctx.strokeStyle = "#ea4335";
  ctx.lineWidth = Math.max(1.5, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(envX, envY);
  ctx.lineTo(envX + envW / 2, envY + envH * 0.65);
  ctx.lineTo(envX + envW, envY);
  ctx.stroke();

  // 2. 우측 상단 대형 AI Glowing Sparkle Badge (cx: 0.74, cy: 0.26, r: 0.25)
  const sparkX = size * 0.74;
  const sparkY = size * 0.26;
  const sparkR = size * 0.25;

  // AI 뱃지 테두리
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, sparkR + size * 0.03, 0, Math.PI * 2);
  ctx.fill();

  // AI 뱃지 바디 (Vivid Cyan -> Violet)
  const sparkGrad = ctx.createLinearGradient(sparkX - sparkR, sparkY - sparkR, sparkX + sparkR, sparkY + sparkR);
  sparkGrad.addColorStop(0, "#06b6d4");
  sparkGrad.addColorStop(1, "#7c3aed");

  ctx.fillStyle = sparkGrad;
  ctx.beginPath();
  ctx.arc(sparkX, sparkY, sparkR, 0, Math.PI * 2);
  ctx.fill();

  // ✦ AI 별빛 (화이트)
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold ${Math.round(size * 0.3)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("✦", sparkX, sparkY);

  return ctx.getImageData(0, 0, size, size);
}

function updateDynamicIconFromCode() {
  try {
    const imageData = {
      16: drawIconCodeData(16),
      32: drawIconCodeData(32),
      48: drawIconCodeData(48),
      128: drawIconCodeData(128),
    };
    chrome.action.setIcon({ imageData });
  } catch (e) {
    console.warn("코드 기반 동적 아이콘 드로잉 예외:", e);
  }
}

// 서비스 워커 구동 시 순수 코드로 아이콘 즉시 렌더링 및 적용
try {
  updateDynamicIconFromCode();
} catch (e) {}

// 파이프라인: 인증 -> 메일 수집 -> (배치 단위) AI 분석(필요시 신규 카테고리 생성) -> 라벨 확인/생성 -> 라벨 즉시 적용(배타적) -> 진행도/로그 기록

const GEMINI_MODEL = "gemini-3.1-flash-lite";

const GEMINI_RPM_LIMIT = 15;
const GEMINI_TPM_LIMIT = 250000;
const GEMINI_RPD_LIMIT = 500;

const AVG_TOKENS_PER_EMAIL_ESTIMATE = 220; // Gmail 자동 snippet(약100자) 대신 실제 본문 최대 350자를 사용하므로 상향
const TOKEN_BUDGET_PER_REQUEST = Math.floor((GEMINI_TPM_LIMIT / GEMINI_RPM_LIMIT) * 0.5);
const MAX_BATCH_SIZE_FOR_ACCURACY = 40;
const BATCH_SIZE = Math.max(
  1,
  Math.min(MAX_BATCH_SIZE_FOR_ACCURACY, Math.floor(TOKEN_BUDGET_PER_REQUEST / AVG_TOKENS_PER_EMAIL_ESTIMATE))
);

const MIN_CALL_INTERVAL_MS = Math.ceil(60000 / GEMINI_RPM_LIMIT) + 200;
// 네트워크가 연결된 채 응답을 돌려주지 않는 경우가 있어, 작업이 영구히 running
// 상태로 남지 않도록 Gemini 요청의 상한을 둔다.
const GEMINI_REQUEST_TIMEOUT_MS = 60000;
const MAX_BATCH_COUNT_PER_RUN = 50; // UI 상 설정 가능한 상한. 실제 안전 제한은 computeSafeEmailCount()가 그날 남은 RPD 추정치로 별도 수행
const MAX_EMAIL_COUNT_PER_RUN = BATCH_SIZE * MAX_BATCH_COUNT_PER_RUN;
const MAX_MESSAGES_PER_LABEL_FETCH = 1000; // 라벨 하나에서 메일을 조회할 때 한 번에 가져올 상한 (전체 재작업/라벨 정리용)

const DEFAULT_CATEGORIES = ["보안", "광고", "쇼핑", "공지", "뉴스레터", "업무", "개인", "기타"];

// Gmail 자체 라벨 칩 색상 (콘텐츠 스크립트가 그리는 임시 배지와는 별개, Gmail API로 실제 라벨에 저장됨)
// Gmail API는 backgroundColor/textColor 각각 정해진 팔레트 값만 허용하므로 그 안에서만 골라야 함
const GMAIL_LABEL_COLOR_PALETTE = [
  { backgroundColor: "#f6c5be", textColor: "#ac2b16" }, // red
  { backgroundColor: "#ffdeb5", textColor: "#7a4706" }, // orange
  { backgroundColor: "#fef1d1", textColor: "#684e07" }, // yellow
  { backgroundColor: "#b9e4d0", textColor: "#0b804b" }, // green
  { backgroundColor: "#a0eac9", textColor: "#04502e" }, // teal
  { backgroundColor: "#c9daf8", textColor: "#285bac" }, // blue
  { backgroundColor: "#e4d7f5", textColor: "#653e9b" }, // purple
  { backgroundColor: "#fbd3e0", textColor: "#711a36" }, // pink
];

function getGmailLabelColor(labelName, categories) {
  const topLevel = String(labelName).split("/")[0];
  const idx = categories.findIndex((c) => c.split("/")[0] === topLevel);
  const paletteIndex = idx >= 0 ? idx % GMAIL_LABEL_COLOR_PALETTE.length : simpleHash(topLevel) % GMAIL_LABEL_COLOR_PALETTE.length;
  return GMAIL_LABEL_COLOR_PALETTE[paletteIndex];
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// 콘텐츠 스크립트가 그리는 오버레이 배지 색상도 실제 Gmail 라벨 색상과 통일
function getCategoryColor(labelName, categories) {
  const c = getGmailLabelColor(labelName, categories);
  return { bgColor: c.backgroundColor, textColor: c.textColor };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gmail 요청을 하나씩 순서대로 기다리면 메일 수백~수천 건 처리 시 왕복 지연이 그대로 누적된다.
// 사용자당 초당 할당량(250 quota units/s, messages.get = 5 units) 안에서 안전한 수준으로만 동시에 보낸다.
const GMAIL_FETCH_CONCURRENCY = 8;

// Gemini 분류 배치를 몇 개까지 겹쳐서 진행할지.
// 분당 요청 수 상한은 throttleGeminiCall()이 따로 지키므로, 이 값은 "응답 대기 시간을 얼마나
// 겹쳐서 감출지"만 결정한다(값을 올려도 RPM을 더 쓰지는 않는다).
const GEMINI_BATCH_CONCURRENCY = 3;

// items를 최대 concurrency개씩 동시에 worker에 넘긴다. 결과는 입력 순서를 그대로 유지한다.
// worker는 스스로 예외를 처리해야 한다(여기서는 개별 실패를 삼키지 않고 그대로 전파).
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  const runners = [];
  for (let w = 0; w < workerCount; w += 1) {
    runners.push(
      (async () => {
        while (true) {
          const index = nextIndex;
          nextIndex += 1;
          if (index >= items.length) return;
          if (isCancelled()) return; // 중지되면 남은 항목은 손대지 않는다
          results[index] = await worker(items[index], index);
        }
      })()
    );
  }

  await Promise.all(runners);
  return results;
}

class JobCancelledError extends Error {
  constructor() {
    super("Job cancelled by user");
    this.name = "JobCancelledError";
    this.isJobCancelled = true;
  }
}

function isCancellationError(error) {
  return !!(error && (error.isJobCancelled || error.name === "AbortError"));
}

// 로그 표시용으로 긴 제목을 줄여서 보여줌 (저장되는 실제 데이터는 원본 그대로 유지)
function truncateForLog(text, maxLen) {
  const limit = maxLen || 28;
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit)}…`;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function getLocalizedDefaultCategories() {
  const raw = t("defaultCategoriesList");
  if (!raw || raw === "defaultCategoriesList") return DEFAULT_CATEGORIES; // 메시지 로딩 실패 시 최종 안전망
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function getLocalizedDefaultCategoryDefs() {
  return getLocalizedDefaultCategories().map((name) => ({ name, description: "" }));
}

// 카테고리를 "이름 + 분류 기준 설명" 객체 배열로 관리한다(하위 라벨 대신, 사용자가 직접 설명 텍스트로 분류 기준을 지정).
// 예전 버전(문자열 배열)으로 저장된 데이터가 있으면 자동으로 {name, description:""} 형태로 변환해서 반환한다.
async function getCategoryDefinitions() {
  await i18nInit();
  const result = await new Promise((resolve) =>
    chrome.storage.local.get(["categoryDefinitions", "labelCategories"], resolve)
  );
  if (Array.isArray(result.categoryDefinitions) && result.categoryDefinitions.length) {
    return result.categoryDefinitions.map((c) => ({ name: c.name, description: c.description || "", autoLearned: !!c.autoLearned }));
  }
  if (Array.isArray(result.labelCategories) && result.labelCategories.length) {
    // 예전 버전 데이터(이름만 있는 문자열 배열) 마이그레이션
    return result.labelCategories.map((name) => ({ name, description: "" }));
  }
  return getLocalizedDefaultCategoryDefs();
}

async function saveCategoryDefinitions(categoryDefs) {
  await chrome.storage.local.set({ categoryDefinitions: categoryDefs });
}

// 이름만 필요한 곳(라벨 배타 처리, 색상 계산, enum 등)에서 쓰는 헬퍼
function getCategoryNames(categoryDefs) {
  return categoryDefs.map((c) => c.name);
}

// ---------------- 개인 필터 규칙 ----------------
// rule: { id, matchType: "from" | "subject", matchValue, targetLabel }
// AI 분류보다 먼저 확인해서, 매칭되면 AI 호출 없이 바로 그 라벨을 붙인다.
async function getFilterRules() {
  const result = await new Promise((resolve) => chrome.storage.local.get(["filterRules"], resolve));
  return result.filterRules || [];
}

function matchesFilterRule(detail, rule) {
  if (!rule || !rule.matchValue) return false;
  const haystack = rule.matchType === "subject" ? detail.subject : detail.from;
  if (!haystack) return false;
  return haystack.toLowerCase().includes(String(rule.matchValue).toLowerCase());
}

// 설치 시점(최초 1회)에 감지된 브라우저 언어로 라벨 카테고리 기본값을 고정 저장.
// 이후 사용자가 설정에서 언어를 바꾸더라도, 이미 만들어둔 라벨 이름까지 자동으로 바뀌진 않는다(의도된 동작).
chrome.runtime.onInstalled.addListener(async (details) => {
  registerAutoClassifyAlarm();
  delayInitialAutoClassifyCheck();
  if (details.reason !== "install") return;
  await i18nInit(true);
  await chrome.storage.local.set({
    categoryDefinitions: getLocalizedDefaultCategoryDefs(),
    autoClassifyEnabled: true,
    autoClassifyThreshold: 1,
    autoBackupOnChange: true,
  });
});

function normalizeLabelName(name) {
  return String(name).trim().replace(/\s+/g, "").toLowerCase();
}

// 예전 버전은 API 키를 하나만 저장했는데, 이제는 여러 개를 등록해서 한 키의 일일 할당량이 다 차면
// 자동으로 다음 키로 넘어가도록 한다(무료 티어 키 여러 개를 돌려쓰면 사실상 처리량이 늘어남).
async function getGeminiApiKeys() {
  const result = await new Promise((resolve) =>
    chrome.storage.local.get(["geminiApiKeys", "geminiApiKey"], resolve)
  );
  if (Array.isArray(result.geminiApiKeys) && result.geminiApiKeys.length) {
    return result.geminiApiKeys.filter((k) => k && k.key);
  }
  if (result.geminiApiKey) {
    // 예전 단일 키 데이터 마이그레이션
    return [{ key: result.geminiApiKey, label: "" }];
  }
  return [];
}

async function saveGeminiApiKeys(keys) {
  await chrome.storage.local.set({ geminiApiKeys: keys });
}

// ---------------- OAuth (사용자 개인 클라이언트 방식) ----------------
// chrome.identity.getAuthToken()은 manifest에 박혀있는 client_id로만 동작해서, 사용자마다 각자의 GCP
// OAuth 클라이언트를 쓰게 할 수가 없다. 그래서 launchWebAuthFlow + authorization code 교환 + refresh_token
// 방식을 직접 구현해서, 설정 탭에서 입력한 사용자 개인 client_id/secret으로 인증하도록 한다.
const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/drive.file";

async function getOAuthCredentials() {
  const result = await new Promise((resolve) =>
    chrome.storage.local.get(["oauthClientId", "oauthClientSecret"], resolve)
  );
  return { clientId: (result.oauthClientId || "").trim(), clientSecret: (result.oauthClientSecret || "").trim() };
}

async function getStoredOAuthTokens() {
  const result = await new Promise((resolve) => chrome.storage.local.get(["oauthTokens"], resolve));
  return result.oauthTokens || null;
}

async function saveStoredOAuthTokens(tokens) {
  await chrome.storage.local.set({ oauthTokens: tokens });
}

async function clearStoredOAuthTokens() {
  await chrome.storage.local.remove(["oauthTokens"]);
}

function createOAuthReauthRequiredError() {
  const err = new Error("Google sign-in is required. Open the extension and connect your Google account again.");
  err.isOAuthReauthRequired = true;
  return err;
}

async function markOAuthReauthRequired() {
  // Keep OAuth client settings; only remove the expired or revoked login token.
  await clearStoredOAuthTokens();
  await chrome.storage.local.set({ oauthReauthRequired: true });
  throw createOAuthReauthRequiredError();
}

// PKCE(Proof Key for Code Exchange): client_secret 없이도(공개 클라이언트) 안전하게 인증코드를 교환하기 위한
// 표준 방식. "Chrome 확장 프로그램" 유형으로 OAuth 클라이언트를 만들면 Google이 아예 시크릿을 발급하지 않는데,
// 그 경우에도 이 방식으로 인증이 되도록 한다. 시크릿이 있는 경우("웹 애플리케이션" 유형)엔 같이 보내도 무방하다.
function base64UrlEncode(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64UrlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

async function launchOAuthFlow() {
  const { clientId, clientSecret } = await getOAuthCredentials();
  if (!clientId) {
    const err = new Error(t("errNoOAuthClientId"));
    err.isOAuthConfigMissing = true;
    throw err;
  }

  const redirectUri = chrome.identity.getRedirectURL();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_OAUTH_SCOPE,
      access_type: "offline",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        reject(new Error(chrome.runtime.lastError ? chrome.runtime.lastError.message : "OAuth 인증 실패"));
        return;
      }
      resolve(responseUrl);
    });
  });

  const code = new URL(redirectUrl).searchParams.get("code");
  if (!code) throw new Error(t("errOAuthNoCode"));

  const tokenParams = {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: codeVerifier,
  };
  if (clientSecret) tokenParams.client_secret = clientSecret; // 시크릿이 발급된 유형(웹 애플리케이션)이면 함께 전송

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(tokenParams).toString(),
  });
  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(t("errOAuthTokenExchangeFailed", [tokenResponse.status, errText.slice(0, 200)]));
  }
  const tokenData = await tokenResponse.json();
  const prevStored = await getStoredOAuthTokens();
  const tokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || (prevStored && prevStored.refreshToken) || null,
    expiresAt: Date.now() + Math.max(60, (tokenData.expires_in || 3600) - 60) * 1000,
  };
  await saveStoredOAuthTokens(tokens);
  await chrome.storage.local.set({ oauthReauthRequired: false });
  return tokens.accessToken;
}

async function refreshAccessTokenViaRefreshToken() {
  const { clientId, clientSecret } = await getOAuthCredentials();
  const stored = await getStoredOAuthTokens();
  if (!stored || !stored.refreshToken || !clientId) throw createOAuthReauthRequiredError();

  const tokenParams = {
    refresh_token: stored.refreshToken,
    client_id: clientId,
    grant_type: "refresh_token",
  };
  if (clientSecret) tokenParams.client_secret = clientSecret;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(tokenParams).toString(),
  });

  if (!tokenResponse.ok) {
    // refresh_token 자체가 무효화된 경우(예: 사용자가 접근권한 해제) -> 처음부터 재인증
    return await markOAuthReauthRequired();
  }

  const tokenData = await tokenResponse.json();
  const tokens = {
    accessToken: tokenData.access_token,
    refreshToken: stored.refreshToken, // refresh 응답에는 보통 refresh_token이 다시 안 옴 - 기존 것 유지
    expiresAt: Date.now() + Math.max(60, (tokenData.expires_in || 3600) - 60) * 1000,
  };
  await saveStoredOAuthTokens(tokens);
  await chrome.storage.local.set({ oauthReauthRequired: false });
  return tokens.accessToken;
}

// 유효한(=만료 전) 액세스 토큰을 반환. forceRefresh가 true면 캐시된 걸 안 믿고 무조건 새로 받아온다.
async function getValidAccessToken(forceRefresh) {
  const stored = await getStoredOAuthTokens();
  if (!forceRefresh && stored && stored.accessToken && stored.expiresAt > Date.now()) {
    return stored.accessToken;
  }
  if (stored && stored.refreshToken) {
    return await refreshAccessTokenViaRefreshToken();
  }
  throw createOAuthReauthRequiredError();
}

// Gmail API 호출 공용 래퍼. 401(토큰 만료/무효)이 오면 토큰을 강제로 새로 받아 한 번 재시도한다.
// 6000개 넘는 메일을 처리하는 등 오래 걸리는 작업 중간에 액세스 토큰(보통 1시간 유효)이 만료돼서
// 이후 모든 요청이 401로 실패하던 문제를 이 래퍼로 근본적으로 해결한다.
// ---------------- Gemini 프롬프트 언어 처리 ----------------
// 카테고리 설명이 없을 때 쓰는 "일반 참고 기준"은 기본 카테고리 이름(광고/쇼핑/뉴스레터 등)을 직접 언급하기
// 때문에, 현재 UI 언어의 기본 카테고리 이름 기준으로 각각 따로 작성해서 언어에 맞는 걸 골라 쓴다.
const CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE = {
  ko:
    "일반 참고 기준(설명이 없는 카테고리에 한해 참고):\n" +
    "- '뉴스레터'는 실제 구독 중인 서비스의 정보성/편집성 소식(팁, 업데이트, 시즌 소식 등)에만 쓰고, 순수 할인·세일·쿠폰·설문 요청처럼 판매 유도가 목적인 메일은 '광고'로 분류해. 팁이나 노하우가 일부 섞여 있어도 핵심 목적이 제품 구매·업그레이드·유료 구독 유도('Order Now', 'Unlock', 'Upgrade' 같은 CTA)라면 '광고'로 분류해.\n" +
    "- '광고'는 아직 사지 않은 상품/서비스를 사라고 설득하는 메일(할인, 신상품 소개, 재입고 알림, 설문·리뷰 요청, 프로모션)이다. 메일 하단에 'Unsubscribe from Marketing Emails', '수신거부', '구독취소', '프로모션 이메일' 같은 문구가 있으면 그 신호를 강하게 반영해서 '광고'로 분류해.\n" +
    "- '쇼핑'은 이미 결제/주문한 물건의 처리 과정을 알려주는 거래 상태 알림이다(주문 확인, 배송 시작, 배송 조회, 세관 통과, 국가 도착, 배송 완료, 주문 취소, 환불 처리, 고객센터 문의 후속 조치, 결제/청구 확인 포함). 단, 설문조사·리뷰 작성 요청은 상태 알림이 아니라 참여 유도이므로 '광고'로 분류해. 이건 특정 제품을 사라고 설득하는 메일이 아니라 이미 산 것의 상태 보고이므로 '광고'가 아니다.\n" +
    "- 중요: 이미 발생한 거래의 사후 처리(주문 취소, 환불 시작/완료, 고객센터 문의 후속 조치, 자동구매확정 안내, 배송/결제 관련 모든 알림)는 어떤 경우에도 '광고'로 분류하면 안 된다.\n" +
    "- '메시지가 도착했다', '읽지 않은 메시지 N개'처럼 협업툴 알림과 비슷해 보여도 발신자가 쇼핑몰/커머스이고 위 마케팅 신호가 있으면 '광고'로 분류해.\n" +
    "메일은 '주제'가 아니라 '기능'(보안 알림/판매 유도/거래 상태 알림/공지 등) 기준으로 분류해.",
  en:
    "General reference criteria (only for categories with no description):\n" +
    "- 'Newsletters' is only for informational/editorial updates from a service you're actually subscribed to (tips, feature updates, seasonal news). Pure discount/sale/coupon/survey emails meant to drive a purchase belong in 'Ads', even if they include some tips, if the core purpose is a purchase/upgrade/paid-subscription CTA ('Order Now', 'Unlock', 'Upgrade').\n" +
    "- 'Ads' is for emails trying to sell you something you haven't bought yet (discounts, new product announcements, back-in-stock alerts, survey/review requests, promotions). If the email has 'Unsubscribe from Marketing Emails' or similar language, treat that as a strong signal for 'Ads'.\n" +
    "- 'Shopping' is a transaction-status notice for something already purchased/ordered (order confirmation, shipping started, tracking, customs, delivered, cancellation, refund, support follow-up, payment/billing confirmation). Survey/review requests are NOT a status update - they're a call to participate, so classify those as 'Ads' instead. This is a status report on something already bought, not a pitch to buy something, so it is not 'Ads'.\n" +
    "- Important: post-purchase handling of an existing transaction (order cancellation, refund started/completed, support follow-up, auto-confirm notices, any shipping/payment notification) must never be classified as 'Ads'.\n" +
    "- Even if it looks like a collaboration-tool notification ('you have a new message', 'N unread messages'), if the sender is a shopping/commerce platform and shows the marketing signals above, classify it as 'Ads'.\n" +
    "Classify by the email's function (security alert / sales pitch / transaction status / notice), not its topic.",
  ja:
    "一般参考基準(説明がないカテゴリにのみ適用):\n" +
    "- 「ニュースレター」は実際に登録済みのサービスからの情報提供・編集的な内容(ヒント、アップデート、季節のお知らせなど)にのみ使い、割引・セール・クーポン・アンケート依頼など販売誘導が目的のメールは「広告」に分類する。ヒントが多少含まれていても、目的が購入・アップグレード・有料登録の誘導('Order Now'、'Unlock'、'Upgrade'などのCTA)なら「広告」に分類する。\n" +
    "- 「広告」はまだ購入していない商品・サービスを勧めるメール(割引、新商品案内、再入荷通知、アンケート・レビュー依頼、プロモーション)。「配信停止」等の文言があれば強く「広告」のシグナルとして扱う。\n" +
    "- 「ショッピング」はすでに購入・注文した商品の処理状況を知らせる取引状況通知(注文確認、発送開始、追跡、通関、到着、キャンセル、返金、サポート対応、支払い確認を含む)。ただしアンケート・レビュー依頼は状況通知ではなく参加の誘導なので「広告」に分類する。これは商品購入を勧めるメールではなく、すでに買ったものの状況報告なので「広告」ではない。\n" +
    "- 重要: 既存取引の事後処理(注文キャンセル、返金開始・完了、サポート対応、自動確定通知、配送・支払いに関する通知)はいかなる場合も「広告」に分類してはならない。\n" +
    "- コラボレーションツールの通知(「新着メッセージがあります」「未読メッセージN件」)のように見えても、送信者がショッピング・コマースプラットフォームで上記のマーケティングシグナルがあれば「広告」に分類する。\n" +
    "メールは「話題」ではなく「機能」(セキュリティ通知・販売誘導・取引状況通知・お知らせなど)を基準に分類する。",
  zh_CN:
    "通用参考标准(仅适用于没有说明的分类):\n" +
    "- “订阅通讯”仅用于你实际订阅的服务发来的信息性/编辑性内容(小贴士、更新、季节性消息等)，纯粹的折扣/促销/优惠券/问卷请求应归为“广告”，即使掺杂了一些技巧内容，只要核心目的是购买/升级/付费订阅引导('Order Now'、'Unlock'、'Upgrade'等CTA)，就归为“广告”。\n" +
    "- “广告”指推销你尚未购买的商品/服务的邮件(折扣、新品介绍、补货通知、问卷/评价请求、促销)。如果邮件底部有“取消订阅营销邮件”等字样，应强烈视为“广告”信号。\n" +
    "- “购物”指已购买/已下单商品的交易状态通知(订单确认、发货开始、物流跟踪、清关、送达、取消、退款、客服跟进、付款/账单确认)。但问卷调查/评价请求不是状态通知而是参与邀请，应归为“广告”。这不是推销购买的邮件，而是已购买物品的状态报告，因此不是“广告”。\n" +
    "- 重要：对已发生交易的后续处理(订单取消、退款开始/完成、客服跟进、自动确认通知、任何物流/付款通知)在任何情况下都不应归为“广告”。\n" +
    "- 即使看起来像协作工具通知(“您有新消息”“N条未读消息”)，如果发件人是购物/电商平台且带有上述营销信号，也应归为“广告”。\n" +
    "邮件应按“功能”(安全提醒/销售推广/交易状态通知/公告等)分类，而非按主题分类。",
};

const LANGUAGE_NAME_BY_LOCALE = { ko: "한국어", en: "English", ja: "日本語", zh_CN: "简体中文" };

async function gmailFetch(url, options) {
  const opts = options || {};
  const token = await getValidAccessToken();

  // 중지 버튼을 누르면 진행 중인 Gmail 요청도 함께 끊기도록 AbortController를 등록한다.
  // (예전에는 Gemini 요청만 취소돼서, 메일 상세를 수백 건 조회하는 도중 누른 중지가 즉시 반응하지 않았다)
  const controller = new AbortController();
  activeJobAbortControllers.add(controller);
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
    activeJobAbortControllers.delete(controller);
  }
}

// ---------------- Google Drive 설정 백업/복원 ----------------
// drive.file 스코프라 우리가 직접 만든 파일에만 접근 가능(사용자의 다른 드라이브 파일은 전혀 못 봄).
// 백업 파일은 사용자 드라이브 최상위에 평범한 보이는 파일로 저장돼서, 사용자가 직접 열어보거나 지울 수도 있다.
const DRIVE_BACKUP_FILENAME = "gmail-ai-labeler-backup.json";

// 백업에 포함할 전체 사용자 설정 및 데이터 키 목록
const BACKUP_SETTING_KEYS = [
  "categoryDefinitions",
  "filterRules",
  "autoClassifyEnabled",
  "autoClassifyThreshold",
  "themeMode",
  "uiLanguage",
  "showQuotaOnMain",
  "correctionLearningEnabled",
  "importanceCriteria",
  "discordWebhookUrl",
  "discordWebhookUrlHigh",
  "discordWebhookUrlMedium",
  "discordWebhookUrlLow",
  "lastLabelSummary",
  "criteriaScratchpad"
];
const BACKUP_CREDENTIAL_KEYS = ["geminiApiKeys", "oauthClientId", "oauthClientSecret"];

async function findOrCreateDriveBackupFileId() {
  const cached = await new Promise((resolve) => chrome.storage.local.get(["driveBackupFileId"], resolve));
  if (cached.driveBackupFileId) {
    // 캐시된 파일 ID가 여전히 유효한지(사용자가 드라이브에서 직접 지웠을 수도 있음) 확인
    const check = await gmailFetch(
      `https://www.googleapis.com/drive/v3/files/${cached.driveBackupFileId}?fields=id,trashed`
    );
    if (check.ok) {
      const data = await check.json();
      if (!data.trashed) return cached.driveBackupFileId;
    }
  }

  const searchResp = await gmailFetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `name='${DRIVE_BACKUP_FILENAME}' and trashed=false`
    )}&fields=files(id,name)`
  );
  if (searchResp.ok) {
    const searchData = await searchResp.json();
    if (searchData.files && searchData.files.length) {
      const fileId = searchData.files[0].id;
      await chrome.storage.local.set({ driveBackupFileId: fileId });
      return fileId;
    }
  }

  // 없으면 새로 생성 (내용은 비워두고, 바로 이어서 업로드함)
  const createResp = await gmailFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_BACKUP_FILENAME, mimeType: "application/json" }),
  });
  if (!createResp.ok) throw new Error(t("errDriveCreateFailed", [createResp.status]));
  const created = await createResp.json();
  await chrome.storage.local.set({ driveBackupFileId: created.id });
  return created.id;
}

async function processBackupToDrive(includeCredentials, passphrase) {
  await addLog(t("logDriveBackupStart"));
  const stored = await new Promise((resolve) => chrome.storage.local.get([...BACKUP_SETTING_KEYS, ...BACKUP_CREDENTIAL_KEYS], resolve));

  const settings = {};
  const credentials = {};
  for (const key of BACKUP_SETTING_KEYS) if (key in stored) settings[key] = stored[key];
  for (const key of BACKUP_CREDENTIAL_KEYS) if (key in stored) credentials[key] = stored[key];

  const payload = {
    backupVersion: 2,
    createdAt: new Date().toISOString(),
    includesCredentials: !!includeCredentials,
    settings,
  };

  if (includeCredentials && Object.keys(credentials).length) {
    if (passphrase) {
      payload.encryptedCredentials = await encryptWithPassphrase(passphrase, credentials);
    } else {
      payload.settings = { ...payload.settings, ...credentials }; // 암호 없으면 예전처럼 평문 저장
    }
  }

  const fileId = await findOrCreateDriveBackupFileId();
  const uploadResp = await gmailFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload, null, 2),
    }
  );
  if (!uploadResp.ok) {
    const errText = await uploadResp.text();
    throw new Error(t("errDriveUploadFailed", [uploadResp.status, errText.slice(0, 200)]));
  }

  await chrome.storage.local.set({ lastDriveBackupAt: Date.now() });
  await addLog(
    t(payload.encryptedCredentials ? "logDriveBackupDoneEncrypted" : "logDriveBackupDone", [
      Object.keys(payload.settings).length,
    ])
  );
  return { total: 1, success: 1, failMessages: [], requestsUsed: 0, batchSize: 1, cancelled: false, quotaExhausted: false };
}

async function processRestoreFromDrive(passphrase) {
  await addLog(t("logDriveRestoreStart"));
  const fileId = await findOrCreateDriveBackupFileId();
  const downloadResp = await gmailFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  if (!downloadResp.ok) {
    throw new Error(t("errDriveDownloadFailed", [downloadResp.status]));
  }
  const text = await downloadResp.text();
  if (!text.trim()) {
    throw new Error(t("errDriveBackupEmpty"));
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error(t("errDriveBackupInvalid"));
  }

  const settings = { ...(payload.settings || {}) };
  let restoredCount = Object.keys(settings).length;

  if (payload.encryptedCredentials) {
    if (!passphrase) {
      throw new Error(t("errBackupPassphraseNeeded"));
    }
    let credentials;
    try {
      credentials = await decryptWithPassphrase(passphrase, payload.encryptedCredentials);
    } catch (e) {
      throw new Error(t("errBackupPassphraseWrong"));
    }
    Object.assign(settings, credentials);
    restoredCount += Object.keys(credentials).length;
  }

  await chrome.storage.local.set(settings);
  await addLog(t("logDriveRestoreDone", [payload.createdAt || t("logUnknownTime"), restoredCount]));
  return {
    total: 1,
    success: 1,
    failMessages: [],
    requestsUsed: 0,
    batchSize: 1,
    cancelled: false,
    quotaExhausted: false,
    restoredCount,
    backedUpAt: payload.createdAt || null,
  };
}

// Gmail messages.list는 maxResults 상한이 500이라, 그보다 많이 요청해도 500개만 돌아온다.
// 따라서 요청 수량을 500 단위로 쪼개고 nextPageToken을 따라가며 원하는 개수만큼 채운다.
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
const LIGHT_FETCH_METADATA_HEADERS = ["Subject", "From", "Date"];
let lightMailFetchCache = null;

async function isLightMailFetchEnabled() {
  if (lightMailFetchCache !== null) return lightMailFetchCache;
  const stored = await chrome.storage.local.get(["lightMailFetchEnabled"]);
  lightMailFetchCache = stored.lightMailFetchEnabled === true;
  return lightMailFetchCache;
}

// 설정이 바뀌면 캐시를 버려서 다음 작업에 바로 반영되게 한다
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.lightMailFetchEnabled) lightMailFetchCache = null;
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
    date, // 요약 리포트가 메일 날짜를 표시할 수 있도록 함께 반환 (예전에는 누락돼 항상 null이었음)
    labelIds: data.labelIds || [],
  };
}

async function fetchLabelCache(token) {
  const response = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/labels");
  if (!response.ok) {
    const errBody = await response.text();
    console.error("labels.list 실패 응답:", errBody);
    throw new Error(t("errLabelListFailed", [response.status, errBody.slice(0, 300)]));
  }
  const data = await response.json();
  const exact = new Map();
  const normalized = new Map();
  const systemNames = new Set();
  (data.labels || []).forEach((label) => {
    exact.set(label.name, label.id);
    normalized.set(normalizeLabelName(label.name), { id: label.id, name: label.name });
    if (label.type === "system") systemNames.add(label.name);
  });
  return { exact, normalized, systemNames };
}

// 사용자가 Gmail에서 직접 만든(이 확장이 모르는) 최상위 라벨을 찾아서 카테고리 목록에 자동으로 편입한다.
async function syncNewTopLevelLabels(categoryDefs, labelCache) {
  const known = new Set(categoryDefs.map((c) => c.name.split("/")[0]));
  const newTop = [];
  for (const name of labelCache.exact.keys()) {
    if (name.includes("/")) continue; // 혹시 남아있는 예전 하위 라벨은 부모가 알려져 있으면 그걸로 충분
    if (labelCache.systemNames && labelCache.systemNames.has(name)) continue; // 받은편지함/중요 등 시스템 라벨 제외
    if (known.has(name)) continue;
    newTop.push(name);
    known.add(name);
  }
  if (!newTop.length) return categoryDefs;

  const updated = [...categoryDefs, ...newTop.map((name) => ({ name, description: "" }))];
  await saveCategoryDefinitions(updated);
  await addLog(t("logNewLabelsDetected", [newTop.join(", ")]));
  return updated;
}

// 사용자가 Gmail에서 직접 지운 라벨을 감지해서 카테고리 목록에서도 함께 제거한다.
// labelCache가 비정상적으로 비어있는 경우(일시적 API 오류 등)까지 전부 지워버리는 사고를 막기 위해,
// labelCache에 아무 라벨도 없으면(시스템 라벨조차 없으면) 안전하게 건너뛴다.
//
// 중요: "아직 Gmail 라벨이 만들어지지 않은 카테고리"와 "사용자가 Gmail에서 직접 지운 라벨"은
// 둘 다 labelCache에 없어서 구분이 안 된다. 그래서 지난번 조회 때 실제로 존재하는 것을 확인했던
// 라벨 이름 목록(seenGmailLabelNames)을 저장해두고, "예전엔 있었는데 지금은 없는" 것만 삭제로 판단한다.
// 이 구분이 없으면 설치 직후 첫 실행 때(라벨이 하나도 없는 상태) 기본 카테고리 전체가 지워진다.
const SEEN_LABEL_NAMES_KEY = "seenGmailLabelNames";

async function getSeenGmailLabelNames() {
  const stored = await new Promise((resolve) => chrome.storage.local.get([SEEN_LABEL_NAMES_KEY], resolve));
  return new Set(Array.isArray(stored[SEEN_LABEL_NAMES_KEY]) ? stored[SEEN_LABEL_NAMES_KEY] : []);
}

async function saveSeenGmailLabelNames(labelCache) {
  await chrome.storage.local.set({ [SEEN_LABEL_NAMES_KEY]: [...labelCache.exact.keys()] });
}

async function pruneDeletedTopLevelLabels(categoryDefs, labelCache) {
  if (!labelCache.exact || labelCache.exact.size === 0) return categoryDefs;

  const existingNames = new Set(labelCache.exact.keys());
  const seenBefore = await getSeenGmailLabelNames();

  // 지금 없고 + 예전에 있었던 것만 "사용자가 지운 라벨"로 본다.
  const isUserDeleted = (c) => !existingNames.has(c.name) && seenBefore.has(c.name);
  const removed = categoryDefs.filter(isUserDeleted).map((c) => c.name);
  if (!removed.length) return categoryDefs;

  const kept = categoryDefs.filter((c) => !isUserDeleted(c));
  await saveCategoryDefinitions(kept);
  await addLog(t("logDeletedLabelsDetected", [removed.join(", ")]), "warn");
  return kept;
}

async function initGmailOnlyContext() {
  const token = await getValidAccessToken();
  const labelCache = await fetchLabelCache(token);
  return { token, labelCache };
}

async function initGeminiAndGmailContext() {
  const apiKeys = await getGeminiApiKeys();
  if (!apiKeys.length) {
    throw new Error(t("errNoApiKey"));
  }
  let categoryDefs = await getCategoryDefinitions();
  const { token, labelCache } = await initGmailOnlyContext();
  // 사용자가 새로 만든 라벨을 먼저 편입한 뒤에 삭제 감지를 돌린다(순서가 반대면 방금 편입한 라벨이 바로 지워질 수 있음).
  categoryDefs = await syncNewTopLevelLabels(categoryDefs, labelCache);
  categoryDefs = await pruneDeletedTopLevelLabels(categoryDefs, labelCache);
  await saveSeenGmailLabelNames(labelCache); // 다음 실행의 삭제 감지 기준점 갱신

  // 안전망: 카테고리가 하나도 없으면 분류가 성립하지 않는다(빈 enum으로 Gemini 400, fallback 라벨이 undefined).
  // 이 경우 기본 카테고리로 되살려서 작업이 조용히 망가지는 대신 정상 동작하게 한다.
  if (!categoryDefs.length) {
    categoryDefs = getLocalizedDefaultCategoryDefs();
    await saveCategoryDefinitions(categoryDefs);
    await addLog("분류 카테고리가 비어 있어 기본 카테고리로 복원했습니다.", "warn");
  }

  const categories = getCategoryNames(categoryDefs); // 이름만 필요한 기존 로직과의 호환용
  return { categoryDefs, categories, token, labelCache };
}

// Gmail 라벨 이름을 실제로 바꾼 뒤, 메모리에 들고 있는 라벨 캐시도 같이 옮겨준다.
function renameInLabelCache(labelCache, oldName, newName, labelId) {
  if (!labelCache || !labelCache.exact) return;
  labelCache.exact.delete(oldName);
  labelCache.exact.set(newName, labelId);
  if (labelCache.normalized) {
    labelCache.normalized.delete(normalizeLabelName(oldName));
    labelCache.normalized.set(normalizeLabelName(newName), { id: labelId, name: newName });
  }
}

async function getOrCreateLabelId(token, labelName, labelCache, categories) {
  if (labelCache.exact.has(labelName)) {
    return { id: labelCache.exact.get(labelName), name: labelName };
  }

  const normKey = normalizeLabelName(labelName);
  if (labelCache.normalized.has(normKey)) {
    return labelCache.normalized.get(normKey);
  }

  const color = getGmailLabelColor(labelName, categories || [labelName]);

  const response = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: labelName,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
      color,
    }),
  });

  if (!response.ok) {
    const refreshed = await fetchLabelCache(token);
    labelCache.exact = refreshed.exact;
    labelCache.normalized = refreshed.normalized;
    if (refreshed.exact.has(labelName)) {
      return { id: refreshed.exact.get(labelName), name: labelName };
    }
    if (refreshed.normalized.has(normKey)) {
      return refreshed.normalized.get(normKey);
    }
    throw new Error(t("errLabelCreateFailed", [labelName, response.status]));
  }

  const created = await response.json();
  labelCache.exact.set(created.name, created.id);
  labelCache.normalized.set(normKey, { id: created.id, name: created.name });
  return { id: created.id, name: created.name };
}

// 새 라벨을 추가하면서, 이미 붙어있는 "다른 카테고리" 라벨은 함께 제거 (중복 라벨 방지)
// 하위 라벨("부모/자식") 구조를 쓰므로, 각 최상위 카테고리 자신뿐 아니라 그 밑의 모든 하위 라벨도 제거 대상에 포함시킨다.
// Gmail 화면에 배지/카드를 그리는 콘텐츠 스크립트에 넘길 데이터.
// 결과 전체(수천 건)를 storage에 담으면 직렬화 비용과 용량이 커지고, 콘텐츠 스크립트는
// 변경이 있을 때마다 이걸 전부 다시 읽는다. 실제로 화면에 쓰이는 것만 최근 것 위주로 남긴다.
const MAX_AI_DATA_FOR_CONTENT_SCRIPT = 300;

function trimAiDataForContentScript(results) {
  const usable = (results || []).filter((r) => r && r.labelName && !r.error);
  return usable.slice(0, MAX_AI_DATA_FOR_CONTENT_SCRIPT);
}

// messages.batchModify는 한 요청에 최대 1000개의 메일 ID를 받는다.
const GMAIL_BATCH_MODIFY_LIMIT = 1000;

// "우리가 관리하는 카테고리"에 속한 Gmail 라벨 ID 전체.
// 메일마다 labelCache를 다시 순회하던 계산을 한 번만 하기 위해 분리했다.
function collectManagedLabelIds(labelCache, allCategories) {
  const topLevelSet = new Set(allCategories.map((c) => c.split("/")[0]));
  const ids = new Set();
  for (const [name, id] of labelCache.exact.entries()) {
    if (topLevelSet.has(name.split("/")[0])) ids.add(id);
  }
  return ids;
}

// 이 메일에 이미 붙어있는 "다른 카테고리 라벨"들 - 배타 적용을 위해 떼어낼 대상.
// 그룹핑 키로도 쓰이므로 순서를 정렬해서 같은 조합이 항상 같은 키가 되도록 한다.
function computeExclusiveRemovals(detail, newLabel, managedLabelIds) {
  return (detail.labelIds || []).filter((id) => id !== newLabel.id && managedLabelIds.has(id)).sort();
}

async function batchModifyLabels(messageIds, addLabelIds, removeLabelIds) {
  if (!messageIds.length) return;
  const body = { ids: messageIds, addLabelIds };
  if (removeLabelIds && removeLabelIds.length) body.removeLabelIds = removeLabelIds;

  const response = await gmailFetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(t("errLabelApplyFailed", [response.status]));
}

// batchModify가 실패한 묶음을 메일 단위로 다시 시도할 때 쓰는 단건 경로.
async function applyLabelExclusive(token, detail, newLabel, allCategories, labelCache, managedLabelIds) {
  const managed = managedLabelIds || collectManagedLabelIds(labelCache, allCategories);
  const removeLabelIds = computeExclusiveRemovals(detail, newLabel, managed);

  const body = { addLabelIds: [newLabel.id] };
  if (removeLabelIds.length) body.removeLabelIds = removeLabelIds;

  const response = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${detail.id}/modify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!response.ok) throw new Error(t("errLabelApplyFailed", [response.status]));
  return removeLabelIds.length > 0;
}

let lastGeminiCallAt = 0;
let currentCallIntervalMs = MIN_CALL_INTERVAL_MS; // 429를 맞으면 늘어나고, 성공이 이어지면 서서히 기본값으로 회복됨
const MAX_CALL_INTERVAL_MS = MIN_CALL_INTERVAL_MS * 6; // 무한정 늘어나지 않도록 상한
const INTERVAL_BACKOFF_MULTIPLIER = 1.6;
const INTERVAL_RECOVERY_MULTIPLIER = 0.92;
const DAILY_QUOTA_TEXT_PATTERN = /(per\s*day|daily|quota[^"]*day)/i;

// RPM 슬롯 확보는 반드시 한 번에 하나씩 순서대로 이뤄져야 한다.
// (예전 구현은 동시 호출이 모두 같은 lastGeminiCallAt을 읽어서, 병렬로 부르면 간격 제한이 무력화됐다)
let geminiThrottleQueue = Promise.resolve();

async function throttleGeminiCall() {
  const myTurn = geminiThrottleQueue.then(async () => {
    const wait = lastGeminiCallAt + currentCallIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    // 슬롯을 잡은 시각을 기록 - 응답을 기다리는 시간은 포함되지 않으므로,
    // 다음 요청은 앞 요청의 응답을 기다리는 동안 출발할 수 있다(파이프라이닝).
    lastGeminiCallAt = Date.now();
  });
  // 실패해도 뒤에 줄 선 호출이 막히지 않게 체인은 항상 성공으로 이어붙인다
  geminiThrottleQueue = myTurn.then(
    () => {},
    () => {}
  );
  await myTurn;
  if (isCancelled()) throw new JobCancelledError();
}

function increaseThrottleInterval() {
  currentCallIntervalMs = Math.min(MAX_CALL_INTERVAL_MS, Math.round(currentCallIntervalMs * INTERVAL_BACKOFF_MULTIPLIER));
}

function decayThrottleInterval() {
  currentCallIntervalMs = Math.max(MIN_CALL_INTERVAL_MS, Math.round(currentCallIntervalMs * INTERVAL_RECOVERY_MULTIPLIER));
}

// ---------------- API 할당량 추정 (자체 추적, Google 공식 실시간 쿼터 조회가 아님) ----------------
// Gemini API는 API 키만으로는 남은 쿼터를 조회하는 공식 엔드포인트가 없어서,
// 우리가 실제로 보낸 요청 수를 로컬에 자정 기준으로 누적 기록해서 "오늘 RPD 중 얼마나 썼는지"를 추정치로 보여준다.
// Gemini의 RPD는 태평양시(America/Los_Angeles) 자정에 리셋되므로, 로컬 자정이 아니라
// 태평양시 날짜를 기준으로 누적해야 실제 리셋 시점과 어긋나지 않는다.
function getTodayString() {
  try {
    // en-CA 로케일은 YYYY-MM-DD 형식을 준다
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  } catch (e) {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
}

async function recordGeminiUsage(apiKey) {
  const today = getTodayString();
  const stored = await chrome.storage.local.get(["geminiUsageByKey"]);
  const usageByKey = stored.geminiUsageByKey || {};
  const usage = usageByKey[apiKey] && usageByKey[apiKey].date === today ? usageByKey[apiKey] : { date: today, count: 0 };
  usage.count += 1;
  usageByKey[apiKey] = usage;
  await chrome.storage.local.set({ geminiUsageByKey: usageByKey });
}

async function markGeminiKeyExhausted(apiKey) {
  const today = getTodayString();
  const stored = await chrome.storage.local.get(["geminiUsageByKey"]);
  const usageByKey = stored.geminiUsageByKey || {};
  usageByKey[apiKey] = { date: today, count: GEMINI_RPD_LIMIT }; // 한도에 도달한 것으로 표시
  await chrome.storage.local.set({ geminiUsageByKey: usageByKey });
}

async function getGeminiUsageForKey(apiKey) {
  const today = getTodayString();
  const stored = await chrome.storage.local.get(["geminiUsageByKey"]);
  const usageByKey = stored.geminiUsageByKey || {};
  const usage = usageByKey[apiKey];
  return usage && usage.date === today ? usage.count : 0;
}

// 등록된 키 중, 오늘 아직 한도에 여유가 있는 키를 골라 반환한다(가장 적게 쓴 키 우선). 다 소진됐으면 null.
async function pickAvailableGeminiKey(excludeKeys) {
  const keys = await getGeminiApiKeys();
  const excluded = excludeKeys || new Set();
  let best = null;
  let bestUsage = Infinity;
  for (const entry of keys) {
    if (excluded.has(entry.key)) continue;
    const usage = await getGeminiUsageForKey(entry.key);
    if (usage >= GEMINI_RPD_LIMIT) continue; // 이 키는 오늘 소진됨
    if (usage < bestUsage) {
      bestUsage = usage;
      best = entry;
    }
  }
  return best;
}

async function getQuotaUsage() {
  const keys = await getGeminiApiKeys();
  const perKey = [];
  let totalToday = 0;
  for (const entry of keys) {
    const used = await getGeminiUsageForKey(entry.key);
    totalToday += used;
    perKey.push({ label: entry.label || "", requestsToday: used, rpd: GEMINI_RPD_LIMIT, exhausted: used >= GEMINI_RPD_LIMIT });
  }
  return {
    date: getTodayString(),
    requestsToday: totalToday,
    rpd: GEMINI_RPD_LIMIT * Math.max(1, keys.length), // 등록된 키 전체를 합친 사실상의 일일 한도
    rpm: GEMINI_RPM_LIMIT,
    tpm: GEMINI_TPM_LIMIT,
    keyCount: keys.length,
    perKey,
  };
}


// Gmail에 이미 존재하는 "부모/자식" 형태의 라벨 중, 주어진 최상위 카테고리 밑의 자식 이름 목록을 뽑아온다
function getSubLabelCandidates(parentCategory, labelCache) {
  const prefix = `${parentCategory}/`;
  const children = [];
  for (const name of labelCache.exact.keys()) {
    if (name.startsWith(prefix)) children.push(name.slice(prefix.length));
  }
  return children;
}

// Gemini generateContent 호출 공용 래퍼: 429 재시도/속도 적응 조절/일일 한도 감지/사용량 기록을 한 곳에서 처리.
// 등록된 키가 여러 개면, 한 키가 일일 한도에 도달했을 때 자동으로 다음 키로 넘어가서 재시도한다(모든 키 소진 시에만 중단).
// requestBody의 responseSchema에 맞는 파싱된 JSON(배열 또는 객체)을 반환한다.
// Retry-After는 초 단위 정수뿐 아니라 HTTP-date 형식으로도 올 수 있다.
// 예전에는 parseFloat만 써서 HTTP-date인 경우 NaN -> sleep(NaN)으로 백오프가 사라졌다.
function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const raw = String(headerValue).trim();
  if (/^\d+(\.\d+)?$/.test(raw)) {
    return Math.max(0, Math.round(parseFloat(raw) * 1000));
  }
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) {
    return Math.max(0, at - Date.now());
  }
  return null;
}

async function callGeminiForJson(requestBody, triedKeys) {
  const excluded = triedKeys || new Set();
  const keyEntry = await pickAvailableGeminiKey(excluded);
  if (!keyEntry) {
    const err = new Error("등록된 Gemini API 키가 모두 오늘 일일 할당량에 도달했습니다.");
    err.isQuotaExhausted = true;
    throw err;
  }
  const apiKey = keyEntry.key;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const maxRetries = 3;
  let attempt = 0;

  while (true) {
    if (isCancelled()) throw new JobCancelledError();
    await throttleGeminiCall();

    let response;
    try {
      response = await fetchWithJobCancellation(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }, GEMINI_REQUEST_TIMEOUT_MS);
    } catch (err) {
      if (isCancelled() || isCancellationError(err)) throw new JobCancelledError();
      throw err;
    }

    if (response.status === 429) {
      const errText = await response.text();
      increaseThrottleInterval(); // 이 요청 이후부터는 더 넓은 간격으로 호출 (전역 적용)

      if (DAILY_QUOTA_TEXT_PATTERN.test(errText)) {
        await markGeminiKeyExhausted(apiKey);
        excluded.add(apiKey);
        await addLog(
          `Gemini API 키(${keyEntry.label || apiKey.slice(0, 8) + "..."})가 오늘 일일 할당량에 도달한 것으로 보여 다음 키로 전환합니다.`,
          "warn"
        );
        return await callGeminiForJson(requestBody, excluded); // 다른 키로 재시도(전부 소진되면 위에서 throw)
      }

      attempt += 1;
      if (attempt > maxRetries) {
        throw new Error(t("errGemini429Retries", [errText.slice(0, 200)]));
      }
      const backoffMs = parseRetryAfterMs(response.headers.get("Retry-After")) ?? currentCallIntervalMs * attempt;
      await addLog(t("logGemini429Retry", [currentCallIntervalMs, attempt, maxRetries]), "warn");
      await sleep(backoffMs);
      if (isCancelled()) throw new JobCancelledError();
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(t("errGeminiHttpError", [response.status, errText.slice(0, 200)]));
    }

    // 여기까지 왔으면 요청은 실제로 소비됐다. 응답 파싱이 실패해도 할당량 추정에서 누락되지 않게
    // 파싱 전에 사용량을 먼저 기록한다.
    await recordGeminiUsage(apiKey);
    decayThrottleInterval();

    const data = await response.json();
    const textResult = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textResult) throw new Error(t("errGeminiNoResult"));

    const cleaned = textResult.replace(/```json/g, "").replace(/```/g, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (parseErr) {
      // 응답이 중간에 잘리는 경우가 있어, raw 파서 오류 대신 무슨 일인지 알 수 있는 메시지로 감싼다.
      const err = new Error(`Gemini 응답을 JSON으로 해석할 수 없습니다: ${String(parseErr.message || parseErr)} / 응답 앞부분: ${cleaned.slice(0, 200)}`);
      err.isGeminiJsonParseError = true;
      throw err;
    }
  }
}

// ---------------- 1단계: 상위 카테고리만 분류 (신규 상위 카테고리 생성 없음, 고정 목록 중에서만 선택) ----------------
async function classifyTopLevelBatch(items, categoryDefs, correctionHint) {
  const emailListText = items
    .map((it) => `[idx=${it.idx}] 보낸사람: ${it.from} / 제목: ${it.subject} / 본문요약: ${it.snippet}`)
    .join("\n");

  const categoryNames = categoryDefs.map((c) => c.name);
  const categoryListText = categoryDefs
    .map((c) => (c.description && c.description.trim() ? `- ${c.name}: ${c.description.trim()}` : `- ${c.name}`))
    .join("\n");

  const locale = i18nCurrentLocale();
  const referenceCriteria = CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE[locale] || CLASSIFY_REFERENCE_CRITERIA_BY_LOCALE.ko;

  const prompt =
    "아래는 여러 개의 이메일 목록이다. 각 이메일을 아래 카테고리 목록 중 가장 알맞은 것 하나로만 분류해. " +
    "목록에 없는 새 카테고리는 절대 만들지 마라 - 애매하거나 목록에 딱 맞는 게 없으면 '기타'로 분류해.\n" +
    "카테고리 목록과 분류 기준(콜론 뒤에 설명이 있으면 그 설명을 최우선으로 따르고, 설명이 없는 카테고리는 이름과 아래 일반 참고 기준으로 판단해):\n" +
    categoryListText +
    "\n\n" +
    referenceCriteria +
    "\n각 이메일마다 confidence도 함께 판단해: 내용이 명확해서 확신이 높으면 'high', 애매하거나 정보가 부족해서 확신이 낮으면 'low'로 표시해(low인 경우 자동으로 '기타'로 재분류됨)." +
    (correctionHint || "") +
    "\n\n" +
    emailListText;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            idx: { type: "INTEGER" },
            labelName: { type: "STRING", enum: categoryNames },
            confidence: { type: "STRING", enum: ["high", "low"] },
          },
          required: ["idx", "labelName", "confidence"],
        },
      },
    },
  };

  const parsedArray = await callGeminiForJson(requestBody);
  if (!Array.isArray(parsedArray)) throw new Error(t("errGeminiNotArray"));
  return parsedArray.filter((e) => typeof e.idx === "number" && e.labelName);
}

// ---------------- 로그 / 진행도 / 중지 ----------------
// 로그가 수천~수만 줄까지 쌓일 수 있어서(대량 메일 처리 시), chrome.storage.local(매번 전체 배열을 다시 쓰고
// 500개로 잘라내던 방식)은 느리고 오래된 로그가 사라지는 문제가 있었다. 대신 IndexedDB에 한 줄씩 추가(append)
// 저장한다 - 매번 전체를 다시 쓸 필요가 없고, 사실상 용량 제한 없이 전체 로그를 보존할 수 있다.
const LOG_DB_NAME = "gmailLabelerLogs";
const LOG_DB_VERSION = 3; // v3: correctionPatterns 스토어 추가(정정 패턴 누적 학습용)
const LOG_STORE_NAME = "logs";
const HISTORY_STORE_NAME = "labelHistory";
const PATTERN_STORE_NAME = "correctionPatterns";
let cancelRequested = false;
const activeJobAbortControllers = new Set();

// 중지 버튼을 누르면 현재 fetch를 즉시 끊는다. 이전에는 다음 배치 경계까지
// 기다렸기 때문에 Gemini 응답이 멈춘 경우 작업 자체를 끝낼 수 없었다.
async function fetchWithJobCancellation(url, options, timeoutMs) {
  if (isCancelled()) throw new JobCancelledError();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  activeJobAbortControllers.add(controller);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (isCancelled()) throw new JobCancelledError();
    if (err && err.name === "AbortError") {
      const timeoutError = new Error(`Gemini request timed out after ${Math.round(timeoutMs / 1000)} seconds.`);
      timeoutError.isRequestTimeout = true;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    activeJobAbortControllers.delete(controller);
  }
}

function abortActiveJobRequests() {
  for (const controller of activeJobAbortControllers) controller.abort();
}

// IndexedDB 연결은 한 번만 열어 재사용한다.
// 예전에는 로그 한 줄마다 indexedDB.open()을 새로 호출해서, 대량 처리 시 연결 생성 비용이
// 로그 쓰기 자체보다 커지는 문제가 있었다.
let logDbPromise = null;

function openLogDb() {
  if (logDbPromise) return logDbPromise;
  logDbPromise = openLogDbConnection().then((db) => {
    // 다른 컨텍스트가 버전을 올리려 하면 우리 연결을 닫아주고 캐시를 비운다(다음 호출에서 새로 연결)
    db.onversionchange = () => {
      db.close();
      logDbPromise = null;
    };
    db.onclose = () => {
      logDbPromise = null;
    };
    return db;
  });
  logDbPromise.catch(() => {
    logDbPromise = null;
  });
  return logDbPromise;
}

function openLogDbConnection() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(LOG_DB_NAME, LOG_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LOG_STORE_NAME)) {
        db.createObjectStore(LOG_STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        // messageId를 키로 써서 같은 메일은 항상 "우리가 마지막으로 붙인 라벨" 하나만 남도록 함
        db.createObjectStore(HISTORY_STORE_NAME, { keyPath: "messageId" });
      }
      if (!db.objectStoreNames.contains(PATTERN_STORE_NAME)) {
        // key: "fromLabel=>toLabel" - 같은 정정 패턴이 반복된 횟수와 예시를 누적
        db.createObjectStore(PATTERN_STORE_NAME, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// 로그는 한 줄마다 트랜잭션 + storage.local.set을 하지 않고 버퍼에 모아 한 번에 기록한다.
// (메일 수천 건을 처리할 때 로그 쓰기와 storage 변경 브로드캐스트가 전체 처리 시간을 지배했다)
const LOG_FLUSH_INTERVAL_MS = 250;
const LOG_FLUSH_MAX_PENDING = 25;

let pendingLogEntries = [];
let logFlushTimer = null;
let logFlushInFlight = null;

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(() => {
    logFlushTimer = null;
    flushLogs();
  }, LOG_FLUSH_INTERVAL_MS);
}

async function flushLogs() {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  // 동시에 여러 flush가 겹치지 않도록 직렬화
  if (logFlushInFlight) {
    await logFlushInFlight;
    if (!pendingLogEntries.length) return;
  }
  if (!pendingLogEntries.length) return;

  const batch = pendingLogEntries;
  pendingLogEntries = [];

  logFlushInFlight = (async () => {
    try {
      const db = await openLogDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LOG_STORE_NAME, "readwrite");
        const store = tx.objectStore(LOG_STORE_NAME);
        for (const entry of batch) store.add(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      // 팝업/로그창이 "새 로그 있음"을 감지할 수 있도록 가벼운 타임스탬프만 남김(전체 로그는 IndexedDB에)
      await chrome.storage.local.set({ jobLogsUpdatedAt: Date.now() });
      logsWrittenSincePrune += batch.length;
      await pruneOldLogsIfNeeded();
    } catch (e) {
      console.error("로그 저장 실패:", e);
    }
  })();

  await logFlushInFlight;
  logFlushInFlight = null;
}

// 로그는 작업마다 지우지 않고 누적하므로, 무한정 늘어나지 않도록 보존 상한을 둔다.
const MAX_STORED_LOG_ENTRIES = 5000;
const LOG_PRUNE_CHECK_EVERY = 200; // 이만큼 기록될 때마다 한 번씩만 확인(매번 count 하면 낭비)
let logsWrittenSincePrune = 0;

async function pruneOldLogsIfNeeded() {
  if (logsWrittenSincePrune < LOG_PRUNE_CHECK_EVERY) return;
  logsWrittenSincePrune = 0;
  try {
    const db = await openLogDb();
    const total = await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readonly");
      const req = tx.objectStore(LOG_STORE_NAME).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
    const excess = total - MAX_STORED_LOG_ENTRIES;
    if (excess <= 0) return;

    // id가 autoIncrement라 커서 앞쪽이 항상 가장 오래된 로그다
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readwrite");
      const cursorReq = tx.objectStore(LOG_STORE_NAME).openCursor();
      let removed = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || removed >= excess) return;
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    console.log(`[GmailLabeler] 오래된 로그 ${excess}건 정리 (보존 상한 ${MAX_STORED_LOG_ENTRIES}건)`);
  } catch (e) {
    console.error("오래된 로그 정리 실패:", e);
  }
}

async function addLog(message, level, detail) {
  const lvl = level || "info";
  console.log(`[GmailLabeler] ${message}`);
  pendingLogEntries.push({ t: Date.now(), level: lvl, message, detail: !!detail });
  if (pendingLogEntries.length >= LOG_FLUSH_MAX_PENDING) {
    await flushLogs();
    return;
  }
  scheduleLogFlush();
}

async function clearLogs() {
  // 버퍼에 남은 로그가 나중에 되살아나지 않도록 함께 버린다
  pendingLogEntries = [];
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(LOG_STORE_NAME, "readwrite");
      tx.objectStore(LOG_STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("로그 초기화 실패:", e);
  }
}

async function getRecentLogs(limit = 100) {
  // 아직 디스크에 안 내려간 버퍼 로그도 조회 결과에 보이도록 먼저 flush
  await flushLogs();
  try {
    const db = await openLogDb();
    // 전체를 읽어와서 뒤에서 자르는 대신, 최신순 커서로 필요한 개수만 읽는다
    return await new Promise((resolve) => {
      const tx = db.transaction(LOG_STORE_NAME, "readonly");
      const cursorReq = tx.objectStore(LOG_STORE_NAME).openCursor(null, "prev");
      const collected = [];
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor || collected.length >= limit) {
          collected.reverse(); // 오래된 것 -> 최신 순으로 되돌림(기존 반환 순서 유지)
          resolve(collected);
          return;
        }
        const item = cursor.value;
        collected.push({
          timestamp: item.t || Date.now(),
          level: item.level || "info",
          message: item.message || "",
          detail: item.detail || false,
        });
        cursor.continue();
      };
      cursorReq.onerror = () => resolve([]);
    });
  } catch (e) {
    return [];
  }
}

// 진행률도 항목마다 storage에 쓰면(=모든 확장 컨텍스트에 변경 이벤트 브로드캐스트) 비용이 크다.
// 팝업/대시보드가 1~2초 주기로 읽어가므로 그보다 잦게 쓸 이유가 없어 최소 간격을 둔다.
const PROGRESS_WRITE_INTERVAL_MS = 800;
let lastProgressWriteAt = 0;
let pendingProgressValue = null;
let progressFlushTimer = null;

async function updateProgress(progress, options) {
  const force = !!(options && options.force);
  const now = Date.now();

  if (!force && now - lastProgressWriteAt < PROGRESS_WRITE_INTERVAL_MS) {
    // 마지막 값은 반드시 반영되도록, 스킵한 값을 예약해둔다
    pendingProgressValue = progress;
    if (!progressFlushTimer) {
      progressFlushTimer = setTimeout(() => {
        progressFlushTimer = null;
        const queued = pendingProgressValue;
        pendingProgressValue = null;
        if (queued) writeProgress(queued);
      }, PROGRESS_WRITE_INTERVAL_MS - (now - lastProgressWriteAt));
    }
    return;
  }

  pendingProgressValue = null;
  await writeProgress(progress);
}

async function writeProgress(progress) {
  lastProgressWriteAt = Date.now();
  await chrome.storage.local.set({ jobProgress: progress });

  try {
    if (progress && progress.total) {
      const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
      chrome.action.setBadgeText({ text: `${pct}%` });
      chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    } else if (progress && typeof progress.pct === "number") {
      chrome.action.setBadgeText({ text: `${progress.pct}%` });
      chrome.action.setBadgeBackgroundColor({ color: "#2563eb" });
    }
  } catch (e) {
    // Ignore badge error
  }
}

function clearProgressBadge() {
  try {
    chrome.action.setBadgeText({ text: "" });
  } catch (e) {}
}

function isCancelled() {
  return cancelRequested;
}

// ---------------- 수동 정정 학습 ----------------
// 우리가 라벨을 붙일 때마다 "이 메일엔 이 라벨을 붙였다"를 기록해두고, 다음 실행 때 그중 일부를 다시 확인해서
// 사용자가 그 사이 직접 다른 라벨로 바꿔놓았으면("정정") 그 사례를 모아 프롬프트에 참고 예시로 넣는다.
// 히스토리 샘플 확인은 메일 상세를 샘플 수만큼 Gmail에 조회하므로, 매 실행마다 돌리면 낭비가 크다.
// 마지막 확인 후 이 간격이 지났을 때만 다시 확인한다.
const CORRECTION_SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function shouldScanCorrectionHistory() {
  const stored = await chrome.storage.local.get(["lastCorrectionScanAt"]);
  const last = Number(stored.lastCorrectionScanAt) || 0;
  return Date.now() - last >= CORRECTION_SCAN_INTERVAL_MS;
}

async function markCorrectionHistoryScanned() {
  await chrome.storage.local.set({ lastCorrectionScanAt: Date.now() });
}

const MAX_HISTORY_SAMPLE_PER_RUN = 40; // 매 실행마다 확인할 과거 기록 샘플 수 (너무 많으면 API 호출이 늘어남)
const MAX_CORRECTION_EXAMPLES = 15; // 프롬프트에 넣을 정정 사례 최대 개수

// 여러 건의 히스토리를 한 트랜잭션으로 기록한다(건당 트랜잭션은 대량 처리 시 비용이 크다).
async function recordLabelHistoryBatch(entries) {
  if (!entries || !entries.length) return;
  try {
    const db = await openLogDb();
    const now = Date.now();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, "readwrite");
      const store = tx.objectStore(HISTORY_STORE_NAME);
      for (const entry of entries) {
        store.put({
          messageId: entry.messageId,
          subject: (entry.subject || "").slice(0, 120),
          from: (entry.from || "").slice(0, 120),
          labelName: entry.labelName,
          appliedAt: now,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.error("라벨 히스토리 기록 실패:", e);
  }
}

async function getAllLabelHistory() {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, "readonly");
      const req = tx.objectStore(HISTORY_STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

async function updateLabelHistoryEntry(entry) {
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE_NAME, "readwrite");
      tx.objectStore(HISTORY_STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // 무시
  }
}

// 메일 하나의 현재 라벨 목록만 가볍게 조회 (본문/제목 없이 labelIds만)
async function getMessageLabelIdsLight(messageId) {
  const response = await gmailFetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=minimal`
  );
  if (!response.ok) return null;
  const data = await response.json();
  return data.labelIds || [];
}

// 최근 기록 중 일부를 다시 확인해서, 사용자가 직접 다른 라벨로 바꿔놓은 사례("정정")를 찾아 프롬프트용 예시로 만든다.
// 스크린샷에서 확인된 패턴처럼, 사용자가 Gmail에서 새 라벨만 "추가"하고 기존 라벨을 안 지운 경우(둘 다 붙어있음)도
// 정확히 잡아내기 위해, 메일에 붙은 "우리가 관리하는 카테고리" 라벨을 전부 모은 뒤 기존 기록과 다른 것을 정정으로 본다.
async function getCorrectionExamples(labelCache, categories) {
  const history = await getAllLabelHistory();
  if (!history.length) return [];

  const idToName = new Map();
  for (const [name, id] of labelCache.exact.entries()) idToName.set(id, name);

  const topLevelSet = new Set(categories.map((c) => c.split("/")[0]));

  // 최근 것 위주로 샘플링 (오래된 것보다 최근 정정이 더 의미 있음)
  const sample = [...history].sort((a, b) => b.appliedAt - a.appliedAt).slice(0, MAX_HISTORY_SAMPLE_PER_RUN);

  // 라벨 ID 조회(읽기 전용)는 병렬로 먼저 끝내고, 기록 갱신은 아래에서 순서대로 처리한다.
  const labelIdsBySampleIndex = await mapWithConcurrency(sample, GMAIL_FETCH_CONCURRENCY, async (entry) => {
    try {
      return await getMessageLabelIdsLight(entry.messageId);
    } catch (e) {
      return null; // 삭제된 메일 등 - 무시
    }
  });

  const examples = [];
  for (let i = 0; i < sample.length; i += 1) {
    const entry = sample[i];
    if (examples.length >= MAX_CORRECTION_EXAMPLES) break;
    const labelIds = labelIdsBySampleIndex[i];
    if (!labelIds) continue;

    // 이 메일에 지금 붙어있는 "우리가 관리하는 카테고리" 라벨을 전부 모은다(기존 라벨을 안 지우고 새 라벨만 추가한 경우 대비)
    const currentManagedLabels = [];
    for (const id of labelIds) {
      const name = idToName.get(id);
      if (name && topLevelSet.has(name.split("/")[0])) currentManagedLabels.push(name);
    }

    // 기록된 라벨 말고 "다른" 관리 라벨이 붙어있으면 그게 사용자가 직접 고른 라벨
    const correctedLabel = currentManagedLabels.find((name) => name !== entry.labelName);

    if (correctedLabel) {
      examples.push({ subject: entry.subject, from: entry.from, correctedLabel });
      await recordCorrectionPattern(entry.labelName, correctedLabel, entry.subject, entry.from);
      // 다음부터는 이미 "학습"한 걸로 보고, 우리 기록도 사용자가 정한 라벨로 갱신(같은 정정을 매번 다시 알려주지 않기 위함)
      await updateLabelHistoryEntry({ ...entry, labelName: correctedLabel, appliedAt: Date.now() });
    }
  }

  return examples;
}

function buildCorrectionHintText(examples) {
  if (!examples.length) return "";
  const lines = examples.map((e) => `- 보낸사람: ${e.from} / 제목: ${e.subject} → 사용자가 "${e.correctedLabel}"로 직접 수정함`);
  return (
    "\n\n참고: 사용자가 예전에 AI 분류 결과를 직접 아래처럼 고친 사례들이 있다. 비슷한 성격의 메일이 있으면 이 사례를 우선 참고해라:\n" +
    lines.join("\n")
  );
}

// ---------------- 정정 패턴 누적 학습 ----------------
// "A 라벨로 분류했는데 사용자가 B로 바꿈"이 반복되는 패턴을 모아뒀다가, 충분히 반복되면(신뢰도 확보)
// B 카테고리의 "분류 기준 설명"을 AI가 요약해서 자동으로 채워넣는다. 우연한 예외 한두 건으로는 반응하지 않는다.
// 분류 파이프라인 도중에는 예산 밖 Gemini 호출이 생기지 않도록 자동 학습을 미뤄둔다.
let deferInlineCategoryLearning = false;
const deferredLearningPatternKeys = new Set();

const CORRECTION_PATTERN_THRESHOLD = 5; // 같은 패턴이 이만큼 쌓이면 자동 학습을 실행
const MAX_PATTERN_EXAMPLES_STORED = 12;

async function getCorrectionPattern(key) {
  try {
    const db = await openLogDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PATTERN_STORE_NAME, "readonly");
      const req = tx.objectStore(PATTERN_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return null;
  }
}

async function saveCorrectionPattern(pattern) {
  try {
    const db = await openLogDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(PATTERN_STORE_NAME, "readwrite");
      tx.objectStore(PATTERN_STORE_NAME).put(pattern);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    // 무시
  }
}

async function recordCorrectionPattern(fromLabel, toLabel, subject, from) {
  const key = `${fromLabel}=>${toLabel}`;
  const existing = (await getCorrectionPattern(key)) || { key, fromLabel, toLabel, count: 0, examples: [] };
  existing.count += 1;
  existing.examples.push({ subject, from });
  if (existing.examples.length > MAX_PATTERN_EXAMPLES_STORED) {
    existing.examples.splice(0, existing.examples.length - MAX_PATTERN_EXAMPLES_STORED);
  }
  existing.updatedAt = Date.now();
  await saveCorrectionPattern(existing);

  if (existing.count >= CORRECTION_PATTERN_THRESHOLD) {
    if (deferInlineCategoryLearning) {
      // 분류 파이프라인 도중에는 Gemini를 추가로 호출하지 않는다.
      // (예산 계산 밖의 호출이라 그대로 두면 일일 할당량을 넘길 수 있음) -> 분류가 끝난 뒤 한 번에 처리
      deferredLearningPatternKeys.add(key);
      return;
    }
    await applyLearnedCategoryDescription(existing);
    // 학습 반영 후 카운트를 초기화(예시는 남겨둠) - 같은 패턴이 더 쌓이면 다시 한번 다듬을 수 있게
    existing.count = 0;
    await saveCorrectionPattern(existing);
  }
}

// 분류 도중에 밀어둔 자동 학습을 분류가 끝난 뒤 실행하고, 실제로 쓴 Gemini 요청 수를 돌려준다.
// 이렇게 해야 requestsUsed 집계에 빠짐없이 반영된다.
async function flushDeferredCategoryLearning() {
  const keys = [...deferredLearningPatternKeys];
  deferredLearningPatternKeys.clear();
  let requestsUsed = 0;

  for (const key of keys) {
    if (isCancelled()) break;
    const pattern = await getCorrectionPattern(key);
    if (!pattern || pattern.count < CORRECTION_PATTERN_THRESHOLD) continue;
    const applied = await applyLearnedCategoryDescription(pattern);
    if (applied) requestsUsed += 1;
    pattern.count = 0;
    await saveCorrectionPattern(pattern);
  }

  return requestsUsed;
}

// 반복된 정정 패턴을 근거로, toLabel 카테고리의 분류 기준 설명을 Gemini로 요약해서 자동 채워넣는다.
// Gemini 요청을 실제로 소비했으면 true를 돌려준다(호출자가 requestsUsed에 합산).
async function applyLearnedCategoryDescription(pattern) {
  let requestConsumed = false;
  try {
    const apiKeys = await getGeminiApiKeys();
    if (!apiKeys.length) return false;

    const exampleText = pattern.examples
      .slice(-CORRECTION_PATTERN_THRESHOLD)
      .map((e) => `- 보낸사람: ${e.from} / 제목: ${e.subject}`)
      .join("\n");

    const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
    const prompt =
      `사용자가 "${pattern.fromLabel}" 카테고리로 분류된 메일들을 반복적으로 "${pattern.toLabel}" 카테고리로 직접 옮겼다. ` +
      "아래는 그 메일 예시들이다. 이 예시들의 공통점을 근거로, 앞으로 비슷한 메일을 '" +
      pattern.toLabel +
      `' 카테고리로 분류하기 위한 아주 짧은 분류 기준 설명을 1문장으로 ${langName}로 작성해라(메일 하나만을 위한 설명이 아니라 일반화된 기준으로).\n\n` +
      exampleText;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: { description: { type: "STRING" } },
          required: ["description"],
        },
      },
    };

    const result = await callGeminiForJson(requestBody);
    requestConsumed = true;
    const newNote = (result && result.description && result.description.trim()) || "";
    if (!newNote) return requestConsumed;

    const categoryDefs = await getCategoryDefinitions();
    const existingIdx = categoryDefs.findIndex((c) => c.name === pattern.toLabel);

    if (existingIdx >= 0) {
      const current = categoryDefs[existingIdx];
      const alreadyHasNote = (current.description || "").includes(newNote);
      if (!alreadyHasNote) {
        const combined = current.description ? `${current.description} / ${newNote}` : newNote;
        categoryDefs[existingIdx] = { ...current, description: combined, autoLearned: true };
      }
    } else {
      categoryDefs.push({ name: pattern.toLabel, description: newNote, autoLearned: true });
    }

    await saveCategoryDefinitions(categoryDefs);
    await addLog(
      `AI 자동 학습: "${pattern.fromLabel}" → "${pattern.toLabel}" 정정이 ${CORRECTION_PATTERN_THRESHOLD}건 이상 반복되어, "${pattern.toLabel}" 카테고리 분류 기준을 자동으로 업데이트함 ("${newNote}")`
    );
  } catch (e) {
    console.error("정정 패턴 자동 학습 실패:", e);
  }
  return requestConsumed;
}

const MAX_LABEL_ANALYSIS_SAMPLE = 40; // 라벨 분석 시 한 번에 살펴볼 메일 샘플 상한

// 카테고리 이름 + 분류기준 설명을 AI로 번역하고, 실제 Gmail 라벨 이름도 함께 바꾼다.
// (하위 라벨이 남아있는 경우 "부모/자식" 형태의 자식 라벨도 부모 이름 변경에 맞춰 함께 옮긴다.)
async function processTranslateCategories(targetLocale) {
  const langName = LANGUAGE_NAME_BY_LOCALE[targetLocale] || targetLocale;
  const categoryDefs = await getCategoryDefinitions();
  const { token, labelCache } = await initGmailOnlyContext();

  await addLog(t("logTranslateStart", [langName]));

  const itemsForPrompt = categoryDefs.map((c, i) => ({ idx: i, name: c.name, description: c.description || "" }));
  const prompt =
    `다음은 이메일 분류 카테고리의 이름과 분류 기준 설명 목록이다. 각 항목을 ${langName}로 자연스럽게 번역해라. ` +
    "name은 아주 짧은 한 단어(또는 그 언어에서 관용적으로 쓰는 짧은 표현)로, description은 자연스러운 문장으로 번역해라. " +
    "description이 빈 문자열이면 번역하지 말고 그대로 빈 문자열로 둬라. 원래 의미와 카테고리 개수, 순서(idx)는 그대로 유지해라.\n\n" +
    JSON.stringify(itemsForPrompt);

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            idx: { type: "INTEGER" },
            name: { type: "STRING" },
            description: { type: "STRING" },
          },
          required: ["idx", "name"],
        },
      },
    },
  };

  const result = await callGeminiForJson(requestBody);
  if (!Array.isArray(result) || !result.length) throw new Error(t("errTranslateNoResult"));

  const translatedDefs = categoryDefs.map((c, i) => {
    const found = result.find((r) => r.idx === i);
    if (!found || !found.name) return c;
    return { ...c, name: found.name, description: found.description || c.description, autoLearned: false };
  });

  // 서로 다른 카테고리가 같은 이름으로 번역되면 Gmail 라벨 이름이 충돌해서 PATCH가 실패한다.
  // 저장 데이터와 실제 라벨이 어긋나지 않도록, 중복 이름은 여기서 미리 구분해둔다.
  const usedNames = new Set();
  for (const def of translatedDefs) {
    let candidate = def.name;
    let suffix = 2;
    while (usedNames.has(normalizeLabelName(candidate))) {
      candidate = `${def.name} ${suffix}`;
      suffix += 1;
    }
    if (candidate !== def.name) {
      await addLog(t("logTranslateNameConflict", [def.name, candidate]), "warn");
      def.name = candidate;
    }
    usedNames.add(normalizeLabelName(candidate));
  }

  // 실제 Gmail 라벨 이름도 함께 변경 (하위 라벨이 남아있으면 "새이름/자식" 형태로 함께 이동)
  for (let i = 0; i < categoryDefs.length; i += 1) {
    const oldName = categoryDefs[i].name;
    const newName = translatedDefs[i].name;
    if (oldName === newName) continue;

    const labelId = labelCache.exact.get(oldName);
    if (labelId) {
      try {
        const resp = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${labelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName }),
        });
        if (resp.ok) {
          // 캐시를 갱신하지 않으면 이후 단계(하위 라벨 처리·다음 작업)가 존재하지 않는 옛 이름을 계속 참조한다.
          renameInLabelCache(labelCache, oldName, newName, labelId);
          await addLog(t("logTranslateLabelRenamed", [oldName, newName]));
        } else {
          const errText = await resp.text();
          // 라벨 이름 변경이 실패했으면 저장 데이터도 옛 이름을 유지해야 실제 Gmail 상태와 어긋나지 않는다.
          translatedDefs[i] = { ...translatedDefs[i], name: oldName };
          await addLog(t("logTranslateLabelRenameFailed", [oldName, newName, errText.slice(0, 150)]), "error");
          continue;
        }
      } catch (e) {
        translatedDefs[i] = { ...translatedDefs[i], name: oldName };
        await addLog(t("logTranslateLabelRenameFailed", [oldName, newName, String(e.message || e)]), "error");
        continue;
      }
    }

    for (const child of getSubLabelCandidates(oldName, labelCache)) {
      const childId = labelCache.exact.get(`${oldName}/${child}`);
      if (!childId) continue;
      try {
        await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${childId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `${newName}/${child}` }),
        });
        renameInLabelCache(labelCache, `${oldName}/${child}`, `${newName}/${child}`, childId);
      } catch (e) {
        // 하위 라벨 개별 실패는 무시하고 계속
      }
    }
  }

  await saveCategoryDefinitions(translatedDefs);
  await addLog(t("logTranslateDone"));

  return {
    total: categoryDefs.length,
    success: categoryDefs.length,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: false,
    quotaExhausted: false,
  };
}

// 사용자가 고른 라벨에 실제로 분류된 메일들 + 현재 분류 기준 설명을 함께 보고,
// 그 라벨에 맞는 분류 기준 텍스트를 새로 제안한다(자동 저장은 안 하고, 팝업의 임시저장 칸에 보여주기만 함).
async function analyzeOneLabelCriteria(token, categoryDefs, labelName) {
  await addLog(t("logLabelAnalysisStart", [labelName]));
  const messages = await getMessagesByLabelName(token, labelName, MAX_MESSAGES_PER_LABEL_FETCH);
  await addLog(t("logLabelAnalysisFoundMail", [labelName, messages.length]));

  if (!messages.length) {
    throw new Error(t("errLabelAnalysisNoMail", [labelName]));
  }

  const sample = messages.slice(0, MAX_LABEL_ANALYSIS_SAMPLE);
  let sampleDone = 0;
  const fetchedSamples = await mapWithConcurrency(sample, GMAIL_FETCH_CONCURRENCY, async (msg) => {
    if (isCancelled()) return null;
    try {
      const detail = await getEmailContent(token, msg.id);
      sampleDone += 1;
      await addLog(t("logAnalysisSampleDone", [sampleDone, sample.length, truncateForLog(detail.subject)]), "info", true);
      return detail;
    } catch (e) {
      if (isCancellationError(e)) return null;
      await addLog(t("logAnalysisSampleFailed", [msg.id, String(e.message || e)]), "error", true);
      return null;
    }
  });
  const details = fetchedSamples.filter(Boolean);

  if (!details.length) {
    throw new Error(t("errAnalysisNoSample"));
  }

  const categoryDef = categoryDefs.find((c) => c.name === labelName);
  const currentDescription = (categoryDef && categoryDef.description) || "";

  const exampleText = details.map((d) => `- 보낸사람: ${d.from} / 제목: ${d.subject}`).join("\n");
  const langName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";
  const prompt =
    `"${labelName}" 카테고리에 실제로 분류된 메일 목록이다(전체 ${messages.length}개 중 ${details.length}개 샘플).\n` +
    (currentDescription ? `현재 이 카테고리에 등록된 분류 기준 설명: "${currentDescription}"\n` : "현재 등록된 분류 기준 설명은 없음.\n") +
    `이 메일들의 공통점을 분석해서, 앞으로 비슷한 메일을 이 카테고리로 분류하기 위한 분류 기준 설명을 2~3문장 이내로 ${langName}로 작성해라. ` +
    "기존 설명이 있다면 실제 사례에 맞게 다듬거나 보완하고, 안 맞는 부분이 있으면 바로잡아라. 메일 하나하나가 아니라 일반화된 기준으로 작성해라.\n\n" +
    exampleText;

  await addLog(t("logAnalysisRequestSent", [labelName]));
  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: { description: { type: "STRING" } },
        required: ["description"],
      },
    },
  };

  const result = await callGeminiForJson(requestBody);
  const suggestion = (result && result.description && result.description.trim()) || "";
  if (!suggestion) throw new Error(t("errAnalysisNoSuggestion"));

  await addLog(t("logAnalysisDone", [labelName, suggestion]));

  return { labelName, suggestion, sampleCount: details.length, totalCount: messages.length };
}

async function processAnalyzeLabelCriteria(labelName) {
  const { categoryDefs, categories, token } = await initGeminiAndGmailContext();
  if (!categories.includes(labelName)) {
    throw new Error(t("errLabelNotInCategories", [labelName]));
  }
  const oneResult = await analyzeOneLabelCriteria(token, categoryDefs, labelName);
  return {
    total: 1,
    success: 1,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: isCancelled(),
    quotaExhausted: false,
    ...oneResult,
  };
}

// 체크박스로 고른 라벨 여러 개를 순서대로 하나씩 분석한다(한 번의 클릭으로 여러 라벨 처리).
async function processAnalyzeMultipleLabelsCriteria(labelNames) {
  const { categoryDefs, categories, token } = await initGeminiAndGmailContext();
  const targets = labelNames.filter((name) => categories.includes(name));
  const skipped = labelNames.filter((name) => !categories.includes(name));
  const suggestions = [];
  const failMessages = [];
  let successCount = 0;

  await addLog(t("logMultiAnalysisStart", [targets.length]));
  if (skipped.length) await addLog(t("logMultiAnalysisSkipped", [skipped.join(", ")]), "warn");

  await updateProgress({ processed: 0, total: targets.length, batchIndex: 0, batchTotal: targets.length });

  for (let i = 0; i < targets.length; i += 1) {
    if (isCancelled()) {
      await addLog(t("logMultiAnalysisCancelled", [i, targets.length]), "warn");
      break;
    }
    const labelName = targets[i];
    await addLog(t("logMultiAnalysisItemStart", [i + 1, targets.length, labelName]));
    try {
      const oneResult = await analyzeOneLabelCriteria(token, categoryDefs, labelName);
      suggestions.push(oneResult);
      successCount += 1;
    } catch (e) {
      const msg = String(e.message || e);
      failMessages.push(`${labelName}: ${msg}`);
      await addLog(t("logMultiAnalysisItemFailed", [i + 1, targets.length, labelName, msg]), "error");
    }
    await updateProgress(
      { processed: i + 1, total: targets.length, batchIndex: i + 1, batchTotal: targets.length },
      { force: i + 1 === targets.length }
    );
  }

  await addLog(t("logMultiAnalysisDone", [successCount, targets.length]));

  return {
    total: targets.length,
    success: successCount,
    failMessages,
    requestsUsed: successCount,
    batchSize: 1,
    cancelled: isCancelled(),
    quotaExhausted: false,
    suggestions,
  };
}

// 선택한 라벨의 메일 목록을 수집하여 Gemini AI로 요약 및 중요 메일 선별 리포트를 생성한다(출력 언어는 현재 UI 언어).
async function processSummarizeLabelEmails(labelName, maxEmails, filterCriteria) {
  const { categoryDefs, categories, token } = await initGeminiAndGmailContext();
  const emailLimit = Math.max(1, Math.min(100, parseInt(maxEmails, 10) || 20));

  await addLog(`[요약] '${labelName}' 라벨 메일 수집 중 (최대 ${emailLimit}개)...`);
  const messages = await getMessagesByLabelName(token, labelName, emailLimit);

  if (!messages || messages.length === 0) {
    const emptyReport = {
      labelName,
      overallSummary: `'${labelName}' 라벨에 수집된 메일이 없습니다.`,
      totalAnalyzed: 0,
      selectedCount: 0,
      selectedEmails: [],
      createdAt: Date.now(),
    };
    await chrome.storage.local.set({ lastLabelSummary: emptyReport });
    return {
      total: 0,
      success: 0,
      failMessages: [],
      requestsUsed: 0,
      summaryReport: emptyReport,
      cancelled: isCancelled(),
      quotaExhausted: false,
    };
  }

  await updateProgress({ processed: 0, total: messages.length, batchIndex: 1, batchTotal: 1 });

  // 본문 조회는 서로 독립적이므로 제한된 동시성으로 병렬 처리한다(순서는 그대로 유지됨).
  let summaryFetchDone = 0;
  const fetchedSummaryDetails = await mapWithConcurrency(messages, GMAIL_FETCH_CONCURRENCY, async (msg, i) => {
    if (isCancelled()) return null;
    try {
      const detail = await getEmailContent(token, msg.id);
      return {
        id: detail.id,
        threadId: detail.threadId,
        idx: i + 1,
        from: detail.from,
        subject: detail.subject,
        date: detail.date,
        snippet: detail.snippet,
      };
    } catch (e) {
      if (isCancellationError(e)) return null;
      await addLog(`메일 본문 읽기 실패 (${msg.id}): ${e.message}`, "warn");
      return null;
    } finally {
      summaryFetchDone += 1;
      await updateProgress(
        { processed: summaryFetchDone, total: messages.length, batchIndex: 1, batchTotal: 1 },
        { force: summaryFetchDone === messages.length }
      );
    }
  });
  if (isCancelled()) throw new JobCancelledError();
  const emailDetails = fetchedSummaryDetails.filter(Boolean);

  if (emailDetails.length === 0) {
    throw new Error("메일 본문을 읽어오지 못했습니다.");
  }

  await addLog(`[요약] Gemini AI로 메일 요약 및 선별 수행 중 (${emailDetails.length}개, 출력 언어: ${LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어"})...`);

  const emailListText = emailDetails
    .map((item) => `[idx=${item.idx}] 발신자: ${item.from} / 제목: ${item.subject} / 내용: ${item.snippet}`)
    .join("\n");

  const filterInstruction = filterCriteria && filterCriteria.trim()
    ? `사용자 특별 필터링 조건: "${filterCriteria.trim()}" (이 조건에 맞는 메일을 최우선으로 선별해라.)\n`
    : "";

  const storedCriteria = await new Promise((resolve) => chrome.storage.local.get(["importanceCriteria"], resolve));
  const criteria = storedCriteria.importanceCriteria || {
    high: "24시간 이내 마감/회신 요구, 결제 실패/서버 오류/계정 보안 경고, 상사의 직접 승인 요청, 법적/비용적 이슈 메일",
    medium: "일주일 이내 미팅/회의 일정, 프로젝트 진행상황 공유, 일반 업무 요청, 주요 회사/서비스 공지사항",
    low: "뉴스레터, 정기 보고서, 마케팅/프로모션 참고용, 회신이나 조치가 필요 없는 순수 정보성 알림"
  };

  const importanceCriteriaInstruction =
    `[중요도(importance) 분류 사용자 정의 기준]\n` +
    `- "상" (긴급/조치 필요): ${criteria.high}\n` +
    `- "중" (공지/일정/업무): ${criteria.medium}\n` +
    `- "하" (정보/참고): ${criteria.low}\n\n`;

  // 요약 결과가 보일 화면의 언어와 맞춰야 하므로, 출력 언어는 현재 UI 언어를 따른다.
  // (예전에는 프롬프트에 "반드시 한국어로"가 박혀 있어서 영어/일본어/중국어 UI에서도 본문만 한국어로 나왔다)
  const summaryLangName = LANGUAGE_NAME_BY_LOCALE[i18nCurrentLocale()] || "한국어";

  const prompt =
    `아래는 '${labelName}' 라벨에 정리된 이메일 목록이다. 이 이메일들 중 중요하거나 사용자에게 필요한 메일만 선별하여 반드시 ${summaryLangName}로 깔끔하게 요약해라.\n\n` +
    filterInstruction +
    importanceCriteriaInstruction +
    `[지침]\n` +
    `1. 스팸, 단순 반복 알림, 불필요한 홍보성 메일은 선별 대상에서 제외해라.\n` +
    `2. 중요하거나 선별된 메일에 대해 핵심 내용 요약, 중요도(상/중/하 - 위 정밀 기준 준수), 그리고 발신자가 요구하거나 사용자가 해야 할 조치 사항(Action Item)을 ${summaryLangName}로 작성해라.\n` +
    `3. 각 메일별로 디스코드(Discord) 채널 알림 전송 필요 여부('discordNotificationNeeded': true/false - 단순 뉴스레터는 false, 중요/긴급/조치 필요 메일은 true)와 디스코드 카테고리('discordCategory': "긴급/조치필요" | "공지/일정" | "일반/리포트"), 및 디스코드 채널 전용 한 줄 핵심 브리핑('discordSummaryText', ${summaryLangName})을 AI 판단으로 자동 분류해라.\n` +
    `4. 전체 메일을 종합한 'overallSummary'(전체 요약 브리핑, ${summaryLangName} 2~4문장)를 작성해라.\n` +
    `5. 선별된 메일 목록 'selectedEmails' 배열에 정보를 담아 반환해라.\n` +
    `6. 조치할 것이 없는 메일은 'actionRequired'를 다른 표현 없이 정확히 "없음"으로만 적어라(화면에서 이 값을 기준으로 조치 항목을 숨긴다).\n\n` +
    `[이메일 목록]\n` +
    emailListText;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          overallSummary: { type: "STRING" },
          selectedEmails: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                idx: { type: "INTEGER" },
                subject: { type: "STRING" },
                sender: { type: "STRING" },
                importance: { type: "STRING", enum: ["상", "중", "하"] },
                summaryPoints: {
                  type: "ARRAY",
                  items: { type: "STRING" },
                },
                actionRequired: { type: "STRING" },
                discordNotificationNeeded: { type: "BOOLEAN" },
                discordCategory: { type: "STRING", enum: ["긴급/조치필요", "공지/일정", "일반/리포트"] },
                discordSummaryText: { type: "STRING" },
              },
              required: [
                "idx",
                "subject",
                "sender",
                "importance",
                "summaryPoints",
                "actionRequired",
                "discordNotificationNeeded",
                "discordCategory",
                "discordSummaryText"
              ],
            },
          },
        },
        required: ["overallSummary", "selectedEmails"],
      },
    },
  };

  const parsedResult = await callGeminiForJson(requestBody);

  const enrichedSelectedEmails = (parsedResult.selectedEmails || []).map((item) => {
    const orig = emailDetails.find((e) => e.idx === item.idx);
    return {
      ...item,
      id: orig ? orig.id : null,
      threadId: orig ? orig.threadId : null,
      date: orig ? orig.date : null,
    };
  });

  const summaryReport = {
    labelName,
    overallSummary: parsedResult.overallSummary || "",
    totalAnalyzed: emailDetails.length,
    selectedCount: enrichedSelectedEmails.length,
    selectedEmails: enrichedSelectedEmails,
    createdAt: Date.now(),
  };

  await chrome.storage.local.set({ lastLabelSummary: summaryReport });
  await addLog(`[요약 완료] ${emailDetails.length}개 중 ${enrichedSelectedEmails.length}개 메일 선별 및 요약 완료.`);

  return {
    total: emailDetails.length,
    success: enrichedSelectedEmails.length,
    failMessages: [],
    requestsUsed: 1,
    batchSize: 1,
    cancelled: isCancelled(),
    quotaExhausted: false,
    summaryReport,
  };
}

// Discord embed 제약: 필드 25개, name 256자, value 1024자, embed 전체 6000자.
// 선별 메일이 많으면 이 제한을 넘겨 전송이 통째로 실패하므로, 여러 메시지로 쪼개 보낸다.
const DISCORD_MAX_FIELDS_PER_EMBED = 25;
const DISCORD_MAX_EMBED_CHARS = 5800; // 6000에서 약간 여유를 둔 값

function normalizeDiscordFields(fields) {
  return (fields || []).map((f) => ({
    name: String(f.name || "-").slice(0, 256),
    value: String(f.value || "-").slice(0, 1024),
    inline: !!f.inline,
  }));
}

// 필드를 embed 문자 총량과 필드 개수 제한에 맞춰 여러 묶음으로 나눈다.
function chunkDiscordFields(fields, baseChars) {
  const chunks = [];
  let current = [];
  let currentChars = baseChars;

  for (const field of fields) {
    const fieldChars = field.name.length + field.value.length;
    const wouldOverflow =
      current.length >= DISCORD_MAX_FIELDS_PER_EMBED || currentChars + fieldChars > DISCORD_MAX_EMBED_CHARS;
    if (wouldOverflow && current.length) {
      chunks.push(current);
      current = [];
      currentChars = baseChars;
    }
    current.push(field);
    currentChars += fieldChars;
  }
  if (current.length) chunks.push(current);
  return chunks.length ? chunks : [[]];
}

async function postDiscordEmbed(url, embed) {
  const payload = {
    username: "Gmail AI Labeler",
    avatar_url: "https://mail.google.com/favicon.ico",
    embeds: [embed],
  };
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Discord Webhook (${embed.title}) 전송 실패: ${errText.slice(0, 100)}`);
  }
}

async function sendSingleDiscordEmbed(url, title, description, color, fields) {
  if (!url || !url.startsWith("http")) return;

  const safeTitle = String(title || "").slice(0, 256);
  const safeDescription = String(description || "").slice(0, 4096);
  const normalized = normalizeDiscordFields(fields);
  const baseChars = safeTitle.length + safeDescription.length + 80; // footer 등 고정 문자 여유
  const chunks = chunkDiscordFields(normalized, baseChars);

  for (let i = 0; i < chunks.length; i += 1) {
    const pageSuffix = chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : "";
    await postDiscordEmbed(url, {
      title: `${safeTitle}${pageSuffix}`.slice(0, 256),
      // 종합 브리핑은 첫 메시지에만 넣어서 뒤 페이지가 불필요하게 길어지지 않게 한다
      description: i === 0 ? safeDescription : "",
      color,
      fields: chunks[i],
      footer: { text: "Gmail AI Labeler • Discord Routing Sync" },
      timestamp: new Date().toISOString(),
    });
  }
}

// 중요도별 웹훅 중 일부만 설정된 경우, 나머지 등급 메일이 아무 곳에도 안 가고 조용히 사라지지 않도록
// 기본 웹훅으로 흘려보낸다.
function resolveDiscordTargetUrl(webhooks, tier) {
  const specific = webhooks[`${tier}Url`];
  if (specific && specific.startsWith("http")) return specific;
  if (webhooks.defaultUrl && webhooks.defaultUrl.startsWith("http")) return webhooks.defaultUrl;
  return null;
}

// 요약 리포트를 지정한 Discord Webhook URL(또는 중요도별 분리 채널)로 전송한다.
async function sendSummaryToDiscord(webhookInput, summaryReport) {
  if (!summaryReport) throw new Error("전송할 요약 리포트 데이터가 없습니다.");

  let webhooks = {};
  if (typeof webhookInput === "string") {
    webhooks = { defaultUrl: webhookInput };
  } else if (webhookInput && typeof webhookInput === "object") {
    webhooks = webhookInput;
  }

  const hasSpecificChannel = webhooks.highUrl || webhooks.mediumUrl || webhooks.lowUrl;

  if (!hasSpecificChannel && (!webhooks.defaultUrl || !webhooks.defaultUrl.startsWith("http"))) {
    throw new Error(t("errDiscordWebhookMissing"));
  }

  // 중요도별/AI카테고리별 웹훅이 설정되어 있으면 해당 디스코드 채널로 자동 분기 전송!
  if (hasSpecificChannel) {
    const highEmails = (summaryReport.selectedEmails || []).filter((e) => e.importance === "상" || e.discordCategory === "긴급/조치필요");
    const medEmails = (summaryReport.selectedEmails || []).filter((e) => (e.importance === "중" || e.discordCategory === "공지/일정") && e.importance !== "상");
    const lowEmails = (summaryReport.selectedEmails || []).filter((e) => (e.importance === "하" || e.discordCategory === "일반/리포트") && e.importance !== "상" && e.importance !== "중");

    let sentCount = 0;

    if (resolveDiscordTargetUrl(webhooks, "high") && highEmails.length) {
      const fields = highEmails.map((item, idx) => ({
        name: `${idx + 1}. 🔴 [긴급/조치] ${item.subject.slice(0, 200)}`,
        value: `${item.discordSummaryText ? `💬 **AI 브리핑**: ${item.discordSummaryText}\n` : ""}**발신자**: ${item.sender || ""}\n${(item.summaryPoints || []).map(p => `• ${p}`).join("\n")}\n⚡ **조치**: ${item.actionRequired || "필요"}${item.id ? `\n🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})` : ""}`.slice(0, 1024),
        inline: false,
      }));
      await sendSingleDiscordEmbed(resolveDiscordTargetUrl(webhooks, "high"), `🚨 [${summaryReport.labelName}] 긴급/상 메일 알림 (${highEmails.length}건)`, summaryReport.overallSummary || "", 0xf43f5e, fields);
      sentCount += 1;
    }

    if (resolveDiscordTargetUrl(webhooks, "medium") && medEmails.length) {
      const fields = medEmails.map((item, idx) => ({
        name: `${idx + 1}. 🟡 [공지/일정] ${item.subject.slice(0, 200)}`,
        value: `${item.discordSummaryText ? `💬 **AI 브리핑**: ${item.discordSummaryText}\n` : ""}**발신자**: ${item.sender || ""}\n${(item.summaryPoints || []).map(p => `• ${p}`).join("\n")}${item.actionRequired && item.actionRequired !== "없음" ? `\n⚡ **조치**: ${item.actionRequired}` : ""}${item.id ? `\n🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})` : ""}`.slice(0, 1024),
        inline: false,
      }));
      await sendSingleDiscordEmbed(resolveDiscordTargetUrl(webhooks, "medium"), `📢 [${summaryReport.labelName}] 공지/일정(중) 메일 리포트 (${medEmails.length}건)`, summaryReport.overallSummary || "", 0xf59e0b, fields);
      sentCount += 1;
    }

    if (resolveDiscordTargetUrl(webhooks, "low") && lowEmails.length) {
      const fields = lowEmails.map((item, idx) => ({
        name: `${idx + 1}. 🟢 [정보/리포트] ${item.subject.slice(0, 200)}`,
        value: `${item.discordSummaryText ? `💬 **AI 브리핑**: ${item.discordSummaryText}\n` : ""}**발신자**: ${item.sender || ""}\n${(item.summaryPoints || []).map(p => `• ${p}`).join("\n")}${item.id ? `\n🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})` : ""}`.slice(0, 1024),
        inline: false,
      }));
      await sendSingleDiscordEmbed(resolveDiscordTargetUrl(webhooks, "low"), `ℹ️ [${summaryReport.labelName}] 정보성(하) 메일 요약 (${lowEmails.length}건)`, summaryReport.overallSummary || "", 0x10b981, fields);
      sentCount += 1;
    }

    if (sentCount === 0 && webhooks.defaultUrl) {
      return await sendSummaryToDiscord(webhooks.defaultUrl, summaryReport);
    }

    return { ok: true };
  }

  // 기본 단일 채널 전송
  const fields = [];
  if (summaryReport.overallSummary) {
    fields.push({ name: "💡 AI 종합 브리핑", value: summaryReport.overallSummary.slice(0, 1024), inline: false });
  }

  const hasHigh = (summaryReport.selectedEmails || []).some((e) => e.importance === "상");
  const hasMedium = (summaryReport.selectedEmails || []).some((e) => e.importance === "중");
  const embedColor = hasHigh ? 0xf43f5e : hasMedium ? 0xf59e0b : 0x10b981;

  if (Array.isArray(summaryReport.selectedEmails) && summaryReport.selectedEmails.length) {
    // embed 제한은 sendSingleDiscordEmbed가 여러 메시지로 쪼개 처리하므로 선별 메일을 잘라내지 않는다
    const list = summaryReport.selectedEmails;
    list.forEach((item, idx) => {
      const imp = item.importance || "중";
      const impIcon = imp === "상" ? "🔴" : imp === "중" ? "🟡" : "🟢";

      // 디스코드 문법 코드블록을 활용한 색상 박스 및 AI 한줄 브리핑 연출
      const colorBox = imp === "상"
        ? "```diff\n- 🔴 [AI 판단: 긴급 조치 필요]\n```"
        : imp === "중"
        ? "```yaml\n🟡 [AI 판단: 주요 공지 및 일정]\n```"
        : "```bash\n🟢 [AI 판단: 일반 참고 알림]\n```";

      let val = `${colorBox}\n${item.discordSummaryText ? `💬 **AI 요약**: ${item.discordSummaryText}\n` : ""}**발신자**: ${item.sender || "정보 없음"}\n`;
      if (Array.isArray(item.summaryPoints)) {
        item.summaryPoints.forEach((pt) => { val += `• ${pt}\n`; });
      }
      if (item.actionRequired && item.actionRequired !== "없음") {
        val += `⚡ **조치 사항**: ${item.actionRequired}\n`;
      }
      if (item.id) {
        val += `🔗 [Gmail에서 메일 보기](https://mail.google.com/mail/u/0/#inbox/${item.id})`;
      }
      fields.push({
        name: `${idx + 1}. ${impIcon} [AI분류: ${item.discordCategory || imp}] ${item.subject.slice(0, 200)}`,
        value: val.slice(0, 1024),
        inline: false,
      });
    });
  }

  await sendSingleDiscordEmbed(
    webhooks.defaultUrl,
    `📋 [${summaryReport.labelName}] 라벨 메일 요약 리포트`,
    `총 ${summaryReport.totalAnalyzed || 0}개 메일 중 ${summaryReport.selectedCount || 0}개 주요 메일 선별`,
    embedColor,
    fields
  );

  return { ok: true };
}


// categories: 마스터 최상위 카테고리 목록(고정 - 이 파이프라인에서는 새 최상위 카테고리를 만들지 않음)
// excludeLabel: 지정하면 이 라벨은 1단계 분류 후보에서 제외(분할 모드) - 그래도 라벨 배타 제거 대상에는 포함됨
//
// 동작 방식(2단계):
//  1단계: 메일을 가볍게 한 번 훑어서 고정된 최상위 카테고리 중 하나로만 분류(신뢰도 낮으면 자동으로 '기타').
//  2단계: 1단계에서 같은 카테고리로 모인 메일들끼리 다시 모아, 그 안에서 하위 라벨이 필요한지 판단해서
//         있으면 짧은 한 단어 하위 라벨로 재분류(기존 하위 라벨 우선 재사용). 최상위 카테고리는 추가로 생기지 않는다.
// categoryDefs: [{name, description}] 형태의 사용자 정의 카테고리 목록 (하위 라벨 없이 전부 평평한 구조)
// excludeLabel: 지정하면 이 라벨은 분류 후보에서 제외(분할 모드) - 그래도 라벨 배타 제거 대상에는 포함됨
//
// 동작 방식(단일 단계, 하위 라벨 없음):
//  메일 상세 조회 -> 개인 필터 규칙 우선 적용(매칭되면 AI 호출 없이 즉시 확정) -> 남은 메일은 사용자 정의
//  카테고리(이름 + 설명)를 기준으로 AI가 하나씩 배정(신뢰도 낮으면 자동으로 '기타') -> 라벨 실제 적용.
//  세 단계(상세조회/분류/적용) 모두 진행률에 반영해서 "적용" 단계 도중에 100%로 잘못 표시되는 일이 없게 한다.
async function classifyAndLabelMessages(token, categoryDefs, labelCache, messages, excludeLabel) {
  const results = [];
  const failMessages = [];
  let successCount = 0;
  let cancelled = false;
  let quotaExhausted = false;

  if (!messages.length) {
    await addLog(t("logNoMailToProcess"));
    return { results, failMessages, successCount, success: successCount, total: 0, requestsUsed: 0, cancelled, quotaExhausted };
  }

  const categories = categoryDefs.map((c) => c.name);
  const fallbackCategory = categories.includes("기타") ? "기타" : categories[categories.length - 1];

  await addLog(t("logFetchStart", [messages.length]));

  let fetchDone = 0;
  let classifyDone = 0;
  let applyDone = 0;

  // 상세조회 / 분류 / 적용 세 구간을 동일 비중으로 섞어서 전체 진행률을 계산.
  // 분모는 전부 messages.length로 통일해서(단계별로 실제 대상 수가 조금씩 달라도) 마지막 "적용" 단계가
  // 끝나야만 비로소 100%에 도달하도록 만든다 - 그래야 적용 작업이 남았는데 100%로 잘못 보이는 일이 없다.
  function computeCombinedProgress() {
    const p1 = messages.length ? fetchDone / messages.length : 0;
    const p2 = messages.length ? classifyDone / messages.length : 0;
    const p3 = messages.length ? applyDone / messages.length : 0;
    const avg = (p1 + p2 + p3) / 3;
    return Math.min(messages.length, Math.round(avg * messages.length));
  }

  function reportProgress(batchIndex, batchTotal) {
    return updateProgress({ processed: computeCombinedProgress(), total: messages.length, batchIndex, batchTotal });
  }

  // 상세 조회는 서로 독립적이라 순서대로 기다릴 이유가 없다 - 제한된 동시성으로 병렬 처리한다.
  // 결과 순서는 mapWithConcurrency가 입력 순서로 유지해주므로 이후 단계 동작은 그대로다.
  const fetched = await mapWithConcurrency(messages, GMAIL_FETCH_CONCURRENCY, async (msg) => {
    if (isCancelled()) return null;
    try {
      const detail = await getEmailContent(token, msg.id);
      fetchDone += 1;
      await addLog(t("logFetchItemDone", [fetchDone, messages.length, truncateForLog(detail.subject), detail.from]), "info", true);
      await reportProgress(0, 3);
      return { detail };
    } catch (err) {
      if (isCancellationError(err)) return null;
      fetchDone += 1;
      const msgText = String(err.message || err);
      await addLog(t("logFetchItemFailed", [fetchDone, messages.length, msg.id, msgText]), "error", true);
      await reportProgress(0, 3);
      return { error: msgText, id: msg.id };
    }
  });

  const details = [];
  for (const entry of fetched) {
    if (!entry) continue; // 중지되어 처리하지 않은 항목
    if (entry.error) {
      results.push({ id: entry.id, error: entry.error });
      failMessages.push(entry.error);
      continue;
    }
    details.push(entry.detail);
  }

  if (isCancelled()) {
    await addLog(t("logCancelledDuringFetch", [fetchDone, messages.length]), "warn");
    return { results, failMessages, successCount, success: successCount, total: messages.length, requestsUsed: 0, cancelled: true, quotaExhausted: false };
  }
  await addLog(t("logFetchComplete", [fetchDone, messages.length]));

  // ---------------- 개인 필터 규칙 적용 (AI 호출 전에 먼저 확인, 매칭되면 AI 분석 자체를 건너뜀) ----------------
  const filterRules = await getFilterRules();
  const finalLabelById = new Map(); // detail.id -> 최종 라벨명(필터 매칭분은 여기서 바로 채워짐)
  let detailsToClassify = details;
  if (filterRules.length) {
    detailsToClassify = [];
    for (const detail of details) {
      const rule = filterRules.find((r) => matchesFilterRule(detail, r));
      if (rule) {
        finalLabelById.set(detail.id, rule.targetLabel);
        classifyDone += 1;
        await addLog(t("logFilterMatched", [truncateForLog(detail.subject), rule.targetLabel]), "info", true);
      } else {
        detailsToClassify.push(detail);
      }
    }
    if (finalLabelById.size) await addLog(t("logFilterAppliedCount", [finalLabelById.size]));
  }

  // ---------------- 수동 정정 학습: 과거 사례 중 사용자가 직접 고친 게 있으면 프롬프트에 참고로 넣는다 ----------------
  let correctionHint = "";
  try {
    const learningSetting = await new Promise((resolve) =>
      chrome.storage.local.get(["correctionLearningEnabled"], resolve)
    );
    const learningEnabled = learningSetting.correctionLearningEnabled !== false; // 기본값 켜짐
    if (learningEnabled && (await shouldScanCorrectionHistory())) {
      deferInlineCategoryLearning = true;
      try {
        const correctionExamples = await getCorrectionExamples(labelCache, categories);
        if (correctionExamples.length) {
          correctionHint = buildCorrectionHintText(correctionExamples);
          await addLog(t("logCorrectionExamplesUsed", [correctionExamples.length]));
        }
      } finally {
        deferInlineCategoryLearning = false;
      }
      await markCorrectionHistoryScanned();
    }
  } catch (e) {
    deferInlineCategoryLearning = false;
    // 학습 예시 조회 실패는 치명적이지 않으므로 무시하고 계속 진행
  }

  // ---------------- 분류: 사용자 정의 카테고리(이름+설명) 중 하나로 배정 ----------------
  const candidateDefs = excludeLabel ? categoryDefs.filter((c) => c.name !== excludeLabel) : categoryDefs;
  const batches = chunkArray(detailsToClassify, BATCH_SIZE);
  const totalBatches = batches.length;
  let requestsUsed = 0;

  await addLog(t("logClassifyStageStart", [totalBatches, BATCH_SIZE]));
  if (excludeLabel) await addLog(t("logSplitModeExclude", [excludeLabel]));
  await reportProgress(1, 3);

  // 배치끼리는 서로 의존하지 않으므로 겹쳐서 보낸다.
  // RPM 상한은 throttleGeminiCall()이 지키고, 이렇게 하면 앞 요청의 응답 대기 시간 동안
  // 다음 요청이 출발해서 "간격 + 응답지연"이 배치마다 누적되던 것을 없앨 수 있다.
  let stopClassifying = false;
  let fatalClassifyError = null;
  let batchesDone = 0;

  await mapWithConcurrency(batches, GEMINI_BATCH_CONCURRENCY, async (batch, b) => {
    if (stopClassifying) return;
    if (isCancelled()) {
      await addLog(t("logCancelledBeforeBatch", [b + 1, totalBatches]), "warn");
      cancelled = true;
      stopClassifying = true;
      return;
    }

    const items = batch.map((d, i) => ({ idx: i, subject: d.subject, from: d.from, snippet: d.snippet }));

    await addLog(t("logBatchRequesting", [b + 1, totalBatches, batch.length]));

    let rawEntries;
    try {
      rawEntries = await classifyTopLevelBatch(items, candidateDefs, correctionHint);
      requestsUsed += 1;
      batchesDone += 1;
      await addLog(t("logBatchDone", [b + 1, totalBatches]));
    } catch (err) {
      if (isCancelled() || isCancellationError(err)) {
        await addLog(t("logCancelledAfterBatch", [b + 1, totalBatches]), "warn");
        cancelled = true;
        stopClassifying = true;
        return;
      }
      // A hung Gemini request is not a mail-specific classification failure.
      // End the job and surface it instead of spending another timeout per batch.
      if (err && err.isRequestTimeout) {
        fatalClassifyError = err;
        stopClassifying = true;
        return;
      }
      const msgText = String(err.message || err);
      await addLog(t("logBatchFailed", [b + 1, totalBatches, msgText]), "error");
      batch.forEach((d) => {
        results.push({ id: d.id, error: msgText });
        failMessages.push(msgText);
      });
      if (err.isQuotaExhausted) {
        await addLog(t("logQuotaExhaustedStop"), "error");
        quotaExhausted = true;
        stopClassifying = true;
        return;
      }
      classifyDone += batch.length;
      batchesDone += 1;
      await reportProgress(batchesDone, totalBatches);
      return;
    }

    const entryByIdx = new Map(rawEntries.map((e) => [e.idx, e]));
    for (let i = 0; i < batch.length; i += 1) {
      const entry = entryByIdx.get(i);
      let labelName = entry ? entry.labelName : fallbackCategory;
      if (entry && entry.confidence === "low") labelName = fallbackCategory; // 저신뢰도는 무조건 기타
      if (!categories.includes(labelName)) labelName = fallbackCategory; // 안전망
      finalLabelById.set(batch[i].id, labelName);
    }

    classifyDone += batch.length;
    await reportProgress(batchesDone, totalBatches);

    if (isCancelled()) {
      await addLog(t("logCancelledAfterBatch", [b + 1, totalBatches]), "warn");
      cancelled = true;
      stopClassifying = true;
    }
  });

  // 응답이 오지 않아 타임아웃된 경우는 메일별 실패가 아니라 작업 자체의 실패로 올린다.
  if (fatalClassifyError) throw fatalClassifyError;

  // 취소/오류로 분류를 못 거친 메일은 최종 라벨에서 제외(적용 대상에서 빠짐)
  await addLog(t("logClassifyDoneApplyStart", [finalLabelById.size]));

  // ---------------- 라벨 실제 적용 (필터 매칭분 + AI 분류분 전체) ----------------
  // 메일마다 messages.modify를 한 번씩 보내면 수천 번의 왕복이 생긴다.
  // "붙일 라벨 + 뗄 라벨"이 같은 메일끼리 묶어서 messages.batchModify로 한 번에 처리한다.
  let processedCount = 0;
  const totalToApply = finalLabelById.size;
  const managedLabelIds = collectManagedLabelIds(labelCache, categories);

  // 같은 라벨 이름을 메일마다 다시 조회하지 않도록 이름당 한 번만 확인/생성한다.
  const labelByName = new Map();
  async function resolveLabel(labelName) {
    if (labelByName.has(labelName)) return labelByName.get(labelName);
    const label = await getOrCreateLabelId(token, labelName, labelCache, categories);
    labelByName.set(labelName, label);
    return label;
  }

  // groupKey -> { label, removeLabelIds, details }
  const applyGroups = new Map();
  for (const detail of details) {
    const labelName = finalLabelById.get(detail.id);
    if (!labelName) continue;

    let label;
    try {
      label = await resolveLabel(labelName);
    } catch (err) {
      const msgText = String(err.message || err);
      if (isCancellationError(err)) {
        cancelled = true;
        break;
      }
      processedCount += 1;
      applyDone += 1;
      results.push({ id: detail.id, error: msgText });
      failMessages.push(msgText);
      await addLog(t("logApplyItemFailed", [processedCount, totalToApply, truncateForLog(detail.subject), msgText]), "error", true);
      continue;
    }

    const removeLabelIds = computeExclusiveRemovals(detail, label, managedLabelIds);
    const groupKey = `${label.id}|${removeLabelIds.join(",")}`;
    if (!applyGroups.has(groupKey)) applyGroups.set(groupKey, { label, removeLabelIds, details: [] });
    applyGroups.get(groupKey).details.push(detail);
  }

  for (const group of applyGroups.values()) {
    if (isCancelled()) {
      await addLog(t("logCancelledDuringApply", [processedCount, totalToApply]), "warn");
      cancelled = true;
      break;
    }

    for (const chunk of chunkArray(group.details, GMAIL_BATCH_MODIFY_LIMIT)) {
      if (isCancelled()) {
        await addLog(t("logCancelledDuringApply", [processedCount, totalToApply]), "warn");
        cancelled = true;
        break;
      }

      // batchModify는 부분 실패를 알려주지 않으므로(전체 성공 아니면 전체 실패),
      // 실패하면 그 묶음만 메일 단위로 다시 시도해서 어느 메일이 문제인지 남긴다.
      let appliedIds;
      try {
        await batchModifyLabels(
          chunk.map((d) => d.id),
          [group.label.id],
          group.removeLabelIds
        );
        appliedIds = chunk;
      } catch (err) {
        if (isCancellationError(err)) {
          cancelled = true;
          break;
        }
        await addLog(t("logBatchApplyFallback", [chunk.length, String(err.message || err)]), "warn");
        appliedIds = [];
        for (const detail of chunk) {
          if (isCancelled()) {
            cancelled = true;
            break;
          }
          try {
            await applyLabelExclusive(token, detail, group.label, categories, labelCache, managedLabelIds);
            appliedIds.push(detail);
          } catch (itemErr) {
            const msgText = String(itemErr.message || itemErr);
            processedCount += 1;
            applyDone += 1;
            results.push({ id: detail.id, error: msgText });
            failMessages.push(msgText);
            await addLog(
              t("logApplyItemFailed", [processedCount, totalToApply, truncateForLog(detail.subject), msgText]),
              "error",
              true
            );
          }
        }
      }

      const historyEntries = [];
      for (const detail of appliedIds) {
        const color = getCategoryColor(group.label.name, categories);
        historyEntries.push({
          messageId: detail.id,
          subject: detail.subject,
          from: detail.from,
          labelName: group.label.name,
        });

        results.push({
          id: detail.id,
          threadId: detail.threadId,
          subject: detail.subject,
          from: detail.from,
          labelName: group.label.name,
          bgColor: color.bgColor,
          textColor: color.textColor,
        });
        successCount += 1;
        processedCount += 1;
        applyDone += 1;

        await addLog(
          t("logApplyItemDone", [processedCount, totalToApply, truncateForLog(detail.subject), group.label.name]) +
            (group.removeLabelIds.length ? t("logReplacedSuffix") : ""),
          "info",
          true
        );
      }

      // 히스토리도 건당 트랜잭션을 열지 않고 한 번에 기록
      await recordLabelHistoryBatch(historyEntries);
      await reportProgress(totalBatches, totalBatches);
    }

    if (cancelled) break;
  }

  await addLog(t("logApplyComplete", [processedCount, totalToApply]));
  await updateProgress(
    { processed: messages.length, total: messages.length, batchIndex: totalBatches, batchTotal: totalBatches },
    { force: true }
  );

  // 라벨 적용을 묶음으로 처리하면서 결과가 그룹 순서로 쌓이므로, 호출자가 보던 대로 입력 순서로 되돌린다.
  const inputOrderById = new Map(messages.map((m, i) => [m.id, i]));
  results.sort((a, b) => (inputOrderById.get(a.id) ?? 0) - (inputOrderById.get(b.id) ?? 0));

  // 분류 도중 미뤄둔 자동 학습을 여기서 처리하고, 소비한 요청 수를 집계에 합산한다.
  requestsUsed += await flushDeferredCategoryLearning();

  return { results, failMessages, successCount, success: successCount, total: messages.length, requestsUsed, cancelled, quotaExhausted };
}



// 오늘 남은 추정 RPD에 맞춰 요청 개수를 미리 안전하게 축소한다 (배치 1개 = 요청 1회 기준)
async function computeSafeEmailCount(requestedCount) {
  const usage = await getQuotaUsage();
  // 분류 배치 외에도 자동 학습/요약 등 부수적인 Gemini 호출이 몇 건 생길 수 있으므로 여유분을 남겨둔다.
  const QUOTA_RESERVE_REQUESTS = 5;
  const remainingRequests = Math.max(0, usage.rpd - usage.requestsToday - QUOTA_RESERVE_REQUESTS);
  const maxEmailsFromQuota = remainingRequests * BATCH_SIZE;

  if (maxEmailsFromQuota <= 0) {
    throw new Error(
      `오늘 Gemini 요청 추정치(${usage.requestsToday}/${usage.rpd})가 이미 한도에 도달한 것으로 보입니다. 자정 이후 다시 시도하세요.`
    );
  }

  if (requestedCount > maxEmailsFromQuota) {
    return { count: maxEmailsFromQuota, reduced: true, usage, remainingRequests };
  }
  return { count: requestedCount, reduced: false, usage, remainingRequests };
}

async function processRecentEmails(count) {
  const { categoryDefs, categories, token, labelCache } = await initGeminiAndGmailContext();

  const safe = await computeSafeEmailCount(count);
  if (safe.reduced) {
    await addLog(t("logQuotaReduced", [count, safe.remainingRequests, safe.count]), "warn");
  }

  await addLog(t("logFetchingUnlabeled", [safe.count]));
  const messages = await getRecentMessages(token, safe.count, categories);
  if (messages.length < safe.count) {
    await addLog(t("logFewerThanRequested", [messages.length]));
  }

  const summary = await classifyAndLabelMessages(token, categoryDefs, labelCache, messages, null);
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

// ---------------- 반복 작업: 한 번에 너무 많이 처리해서 API 할당량을 넘기지 않도록,
// 사용자가 지정한 작은 배치 수만큼씩 여러 라운드로 나눠서 안전하게 반복 처리한다 ----------------
async function processRepeatClassification(batchesPerRound, repeatCount) {
  const perRoundCount = batchesPerRound * BATCH_SIZE;
  let totalSuccess = 0;
  let totalProcessed = 0;
  let totalRequestsUsed = 0;
  const allFailMessages = [];
  let cancelled = false;
  let quotaExhausted = false;

  await addLog(t("logRepeatStart", [batchesPerRound, perRoundCount, repeatCount]));

  for (let round = 1; round <= repeatCount; round += 1) {
    if (isCancelled()) {
      await addLog(t("logRepeatCancelledBefore", [round, repeatCount]), "warn");
      cancelled = true;
      break;
    }

    await addLog(t("logRepeatRoundStart", [round, repeatCount]));

    let roundSummary;
    try {
      roundSummary = await processRecentEmails(perRoundCount);
    } catch (err) {
      await addLog(t("logRepeatRoundFailed", [round, repeatCount, String(err.message || err)]), "error");
      allFailMessages.push(String(err.message || err));
      break;
    }

    totalSuccess += roundSummary.success;
    totalProcessed += roundSummary.total;
    totalRequestsUsed += roundSummary.requestsUsed || 0;
    if (roundSummary.failMessages && roundSummary.failMessages.length) {
      allFailMessages.push(...roundSummary.failMessages);
    }

    await addLog(t("logRepeatRoundDone", [round, repeatCount, roundSummary.success, roundSummary.total]));

    if (roundSummary.cancelled) {
      cancelled = true;
      break;
    }
    if (roundSummary.quotaExhausted) {
      quotaExhausted = true;
      await addLog(t("logRepeatQuotaStop"), "error");
      break;
    }
    if (roundSummary.total === 0) {
      await addLog(t("logRepeatNoMoreMail"));
      break;
    }
  }

  await addLog(t("logRepeatAllDone", [totalSuccess, totalProcessed]));

  return {
    total: totalProcessed,
    success: totalSuccess,
    failMessages: allFailMessages,
    requestsUsed: totalRequestsUsed,
    batchSize: BATCH_SIZE,
    cancelled,
    quotaExhausted,
  };
}

// 이 확장이 관리하는 모든 카테고리 라벨(최상위 + 그 하위 라벨 전부)을 Gmail에서 완전히 삭제한다.
// 라벨을 삭제하면 Gmail이 그 라벨이 붙어있던 모든 메일에서 자동으로 라벨을 떼어주므로, 메일 하나하나 라벨을 뗄 필요는 없다.
async function deleteAllManagedLabels(token, categories, labelCache) {
  let deletedCount = 0;
  for (const cat of categories) {
    const ids = [];
    const flatId = labelCache.exact.get(cat);
    if (flatId) ids.push(flatId);
    for (const child of getSubLabelCandidates(cat, labelCache)) {
      const childId = labelCache.exact.get(`${cat}/${child}`);
      if (childId) ids.push(childId);
    }
    for (const id of ids) {
      try {
        const response = await gmailFetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${id}`, { method: "DELETE" });
        if (response.ok || response.status === 404) deletedCount += 1;
      } catch (e) {
        // 개별 실패는 무시하고 계속
      }
    }
  }
  return deletedCount;
}

// 라벨 전체 삭제: 재분류 없이, 이 확장이 관리하는 모든 라벨만 깨끗이 지운다(Gemini 호출 없음, API 할당량과 무관).
async function processDeleteAllLabels() {
  const categoryDefs = await getCategoryDefinitions();
  const categories = getCategoryNames(categoryDefs);
  const { token, labelCache } = await initGmailOnlyContext();

  await addLog(t("logDeleteAllStart", [categories.length]), "warn");
  const deletedCount = await deleteAllManagedLabels(token, categories, labelCache);
  await addLog(t("logDeleteAllDone", [deletedCount]));

  return {
    total: deletedCount,
    success: deletedCount,
    failMessages: [],
    requestsUsed: 0,
    batchSize: BATCH_SIZE,
    cancelled: false,
    quotaExhausted: false,
  };
}

// 이미 관리 라벨이 붙어있는 메일만 모아서, 라벨을 뗀 뒤 처음부터 다시 분류한다.
// 라벨 정의(카테고리) 자체는 삭제하지 않고, 각 메일에서 현재 붙어있는 관리 라벨들만 제거한다.
// 여러 이유(과거 로직 변경, 재분류 반복 등)로 한 메일에 라벨이 중복/잘못 붙어있는 경우를 정리하는 용도.
async function processDedupeRelabel() {
  const { categoryDefs, categories, token, labelCache } = await initGeminiAndGmailContext();

  const allLabelIds = [];
  for (const cat of categories) {
    const flatId = labelCache.exact.get(cat);
    if (flatId) allLabelIds.push(flatId);
    for (const child of getSubLabelCandidates(cat, labelCache)) {
      const childId = labelCache.exact.get(`${cat}/${child}`);
      if (childId) allLabelIds.push(childId);
    }
  }

  if (!allLabelIds.length) {
    await addLog(t("logDedupeNoLabels"));
    return { total: 0, success: 0, failMessages: [], requestsUsed: 0, batchSize: BATCH_SIZE, cancelled: false, quotaExhausted: false };
  }

  await addLog(t("logDedupeFetchingMail", [allLabelIds.length]));
  const seen = new Set();
  let messages = [];
  for (const id of allLabelIds) {
    if (isCancelled()) break;
    try {
      const msgs = await getMessagesByLabelId(token, id, MAX_MESSAGES_PER_LABEL_FETCH);
      for (const m of msgs) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          messages.push(m);
        }
      }
    } catch (e) {
      await addLog(t("logLabelFetchFailed", [id, String(e.message || e)]), "error");
    }
  }
  await addLog(t("logDedupeFoundMail", [messages.length]));

  const safe = await computeSafeEmailCount(messages.length || 1);
  if (safe.reduced) {
    await addLog(t("logQuotaReducedGeneric", [safe.remainingRequests, safe.count]), "warn");
  }
  const targetMessages = messages.slice(0, safe.count);

  await addLog(t("logDedupeRemovingLabels", [targetMessages.length]));
  for (const msg of targetMessages) {
    if (isCancelled()) break;
    try {
      await modifyMessageLabels(token, msg.id, [], allLabelIds);
    } catch (e) {
      await addLog(t("logRemoveLabelFailed", [msg.id, String(e.message || e)]), "error", true);
    }
  }

  await addLog(t("logDedupeRemovedReclassify"));
  const summary = await classifyAndLabelMessages(token, categoryDefs, labelCache, targetMessages, null);
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

async function processRelabel(labelName, excludeSelf, maxResults) {
  const { categoryDefs, categories, token, labelCache } = await initGeminiAndGmailContext();
  if (!categories.includes(labelName)) {
    throw new Error(t("errLabelNotInCategories", [labelName]));
  }
  if (excludeSelf && categories.filter((c) => c !== labelName).length < 2) {
    throw new Error(t("errTooFewCategoriesAfterExclude"));
  }

  const safe = await computeSafeEmailCount(maxResults);
  if (safe.reduced) {
    await addLog(t("logQuotaReducedGeneric", [safe.remainingRequests, safe.count]), "warn");
  }

  await addLog(t("logRelabelFetchingMail", [labelName]));
  const messages = await getMessagesByLabelName(token, labelName, safe.count);
  await addLog(t("logRelabelFoundMail", [messages.length]));
  if (messages.length < safe.count) {
    await addLog(t("logFewerTargetThanRequested", [messages.length]));
  }

  const summary = await classifyAndLabelMessages(
    token,
    categoryDefs,
    labelCache,
    messages,
    excludeSelf ? labelName : null
  );
  await chrome.storage.local.set({
    latestAiData: trimAiDataForContentScript(summary.results),
    latestAiDataUpdatedAt: Date.now(),
  });
  return { ...summary, batchSize: BATCH_SIZE };
}

// 라벨 병합: fromLabel의 메일을 전부 toLabel로 옮기고 fromLabel 자체를 삭제 (Gemini 호출 없음, Gmail API만 사용)
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
async function processApplyLabelColors() {
  const categories = getCategoryNames(await getCategoryDefinitions());
  const { token, labelCache } = await initGmailOnlyContext();
  await addLog(t("logColorsStart", [categories.length]));
  await updateProgress({ processed: 0, total: categories.length, batchIndex: 1, batchTotal: 1 });

  let successCount = 0;
  const failMessages = [];

  for (let i = 0; i < categories.length; i += 1) {
    const cat = categories[i];
    try {
      const label = await getOrCreateLabelId(token, cat, labelCache, categories);
      const color = getGmailLabelColor(cat, categories);
      await patchLabelColor(token, label.id, color);
      successCount += 1;
      await addLog(t("logColorItemDone", [cat]), "info", true);
    } catch (err) {
      const msgText = String(err.message || err);
      failMessages.push(msgText);
      await addLog(t("logColorItemFailed", [cat, msgText]), "error");
    }
    await updateProgress(
      { processed: i + 1, total: categories.length, batchIndex: 1, batchTotal: 1 },
      { force: i + 1 === categories.length }
    );
  }

  await addLog(t("logColorsDone", [successCount, categories.length]));
  return { total: categories.length, success: successCount, failMessages, requestsUsed: 0, batchSize: 1, cancelled: false };
}

const KEEP_ALIVE_ALARM = "gmailLabelerKeepAlive";
const AUTO_CLASSIFY_CHECK_ALARM = "gmailLabelerAutoClassifyCheck";
const AUTO_CLASSIFY_STARTUP_DELAY_MS = 10000;
const AUTO_CLASSIFY_BLOCKED_UNTIL_KEY = "autoClassifyBlockedUntil";
const AUTO_CLASSIFY_CHECK_PERIOD_MIN = 5; // 새 메일 도착 여부를 이 주기(분)마다 확인

function startKeepAlive() {
  chrome.alarms.create(KEEP_ALIVE_ALARM, { periodInMinutes: 1 });
}

function stopKeepAlive() {
  chrome.alarms.clear(KEEP_ALIVE_ALARM);
}

function registerAutoClassifyAlarm() {
  chrome.alarms.create(AUTO_CLASSIFY_CHECK_ALARM, { periodInMinutes: AUTO_CLASSIFY_CHECK_PERIOD_MIN });
}

// Give storage and OAuth initialization time to settle before the first
// automatic-mail check after Chrome or the extension starts.
async function delayInitialAutoClassifyCheck() {
  const blockedUntil = Date.now() + AUTO_CLASSIFY_STARTUP_DELAY_MS;
  await chrome.storage.local.set({ [AUTO_CLASSIFY_BLOCKED_UNTIL_KEY]: blockedUntil });
  setTimeout(async () => {
    const stored = await chrome.storage.local.get([AUTO_CLASSIFY_BLOCKED_UNTIL_KEY]);
    if (stored[AUTO_CLASSIFY_BLOCKED_UNTIL_KEY] !== blockedUntil) return;
    await chrome.storage.local.remove([AUTO_CLASSIFY_BLOCKED_UNTIL_KEY]);
    checkAutoClassifyTrigger();
  }, AUTO_CLASSIFY_STARTUP_DELAY_MS);
}

chrome.runtime.onStartup.addListener(() => {
  registerAutoClassifyAlarm();
  delayInitialAutoClassifyCheck();
  chrome.storage.local.get(["jobStatus"], (result) => {
    setActionIconRunning(result.jobStatus === "running");
  });
});

// 새 메일 자동 분류: 라벨 없는 메일이 설정한 임계값(1~배치크기) 이상 쌓이면 자동으로 1배치 분류를 시작한다.
async function checkAutoClassifyTrigger() {
  const settings = await new Promise((resolve) =>
    chrome.storage.local.get(["autoClassifyEnabled", "autoClassifyThreshold", AUTO_CLASSIFY_BLOCKED_UNTIL_KEY], resolve)
  );
  if ((settings[AUTO_CLASSIFY_BLOCKED_UNTIL_KEY] || 0) > Date.now()) return;
  // 기본값: 켜짐 / 1개 (사용자가 명시적으로 끈 적이 없다면 새 기본값을 적용)
  const autoClassifyEnabled = settings.autoClassifyEnabled === undefined ? true : settings.autoClassifyEnabled;
  if (!autoClassifyEnabled) return;

  const running = await isJobRunning();
  if (running) return; // 다른 작업이 이미 진행 중이면 이번 주기는 건너뜀

  const threshold = Math.max(1, Math.min(BATCH_SIZE, parseInt(settings.autoClassifyThreshold, 10) || 1));

  try {
    const apiKeys = await getGeminiApiKeys();
    if (!apiKeys.length) return; // API 키 없으면 자동 실행 안 함

    const categories = getCategoryNames(await getCategoryDefinitions());
    const { token } = await initGmailOnlyContext();
    const messages = await getRecentMessages(token, threshold, categories);

    if (messages.length >= threshold) {
      await markJobRunning("classify");
      runJob(() => processRecentEmails(threshold), "notifyTitleClassify");
    }
  } catch (e) {
    console.error("[GmailLabeler] 자동 분류 확인 실패:", e);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEP_ALIVE_ALARM) {
    // 서비스워커 활성 상태 유지 용도
  } else if (alarm.name === AUTO_CLASSIFY_CHECK_ALARM) {
    checkAutoClassifyTrigger();
  }
});

function summaryMessage(summary) {
  if (summary.total === 0) return t("msgNoMailToProcess");
  let base;
  if (summary.quotaExhausted) {
    base = t("msgQuotaExceededSummary", [summary.success, summary.total]);
  } else if (summary.cancelled) {
    base = t("msgCancelledSummary", [summary.success, summary.total]);
  } else {
    base = t("msgSuccessSummary", [summary.success, summary.total]);
  }
  if (summary.failMessages && summary.failMessages.length) {
    return base + t("msgFailSuffix", [summary.failMessages[0]]);
  }
  return base;
}

function notifyCompletion(title, summary) {
  chrome.notifications.create(`gmail-labeler-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title,
    message: summaryMessage(summary),
    priority: 1,
  });
}

function notifyError(title, errMsg) {
  chrome.notifications.create(`gmail-labeler-error-${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icon128.png"),
    title,
    message: errMsg,
    priority: 1,
  });
}

function setActionIconRunning(isRunning) {
  try {
    if (isRunning) {
      chrome.action.setIcon({ path: "icon128-active.png" });
    } else {
      // 평상시 아이콘은 setIcon({path})로 덮어쓰면 시작 시 코드로 그린 동적 아이콘이 사라지므로,
      // 항상 같은 드로잉 코드로 다시 렌더링해서 되돌린다.
      updateDynamicIconFromCode();
    }
  } catch (e) {
    // 아이콘 전환 실패는 치명적이지 않으므로 무시
  }
}

async function markJobRunning(jobKind) {
  cancelRequested = false;
  startKeepAlive();
  setActionIconRunning(true);
  // 로그는 작업마다 지우지 않고 누적 보존한다(사용자가 로그 창에서 직접 "초기화"할 때만 삭제).
  await chrome.storage.local.set({
    jobStatus: "running",
    jobKind: jobKind || "unknown",
    jobStartedAt: Date.now(),
    jobCancelRequested: false,
    jobProgress: { processed: 0, total: 0, batchIndex: 0, batchTotal: 0 },
  });
}

async function runJob(jobFn, notifyTitleKey, notifyTitleParams) {
  await i18nInit();
  const notifyTitle = t(notifyTitleKey, notifyTitleParams);
  await addLog(t("logJobStarted", [notifyTitle]));

  try {
    let summary = await jobFn();
    // 강제 중지는 UI 상태를 먼저 종료시키므로, 이미 진행 중이던 비동기 작업이
    // 뒤늦게 반환해도 완료 상태로 되돌아가지 않게 한다.
    if (isCancelled() && !summary.cancelled) summary = { ...summary, cancelled: true };
    const finalStatus = summary.quotaExhausted ? "quota_exceeded" : summary.cancelled ? "cancelled" : "done";
    await chrome.storage.local.set({ jobStatus: finalStatus, jobResult: summary, jobFinishedAt: Date.now() });
    await chrome.storage.local.remove(["lastApiError"]);
    await addLog(
      summary.quotaExhausted ? t("logJobQuotaExceeded") : summary.cancelled ? t("logJobCancelled") : t("logJobDone")
    );
    notifyCompletion(notifyTitle, summary);
  } catch (err) {
    const errMsg = String(err.message || err);
    const apiService = /gemini/i.test(errMsg) ? "Gemini API" : /oauth|google sign-in/i.test(errMsg) ? "Google OAuth" : /gmail/i.test(errMsg) ? "Gmail API" : "";
    if (apiService) {
      await chrome.storage.local.set({
        lastApiError: { service: apiService, message: errMsg.slice(0, 400), at: Date.now() },
      });
    }
    if (isCancelled() || isCancellationError(err)) {
      const summary = { total: 0, success: 0, failMessages: [], requestsUsed: 0, cancelled: true, quotaExhausted: false };
      await chrome.storage.local.set({ jobStatus: "cancelled", jobResult: summary, jobFinishedAt: Date.now() });
      await addLog(t("logJobCancelled"));
      notifyCompletion(notifyTitle, summary);
    } else {
      await chrome.storage.local.set({ jobStatus: "error", jobError: errMsg, jobFinishedAt: Date.now() });
      await addLog(t("logJobError", [errMsg]), "error");
      notifyError(t("notifyTitleErrorSuffix", [notifyTitle]), errMsg);
    }
  } finally {
    stopKeepAlive();
    setActionIconRunning(false);
    clearProgressBadge(); // 작업이 끝난 뒤 "100%" 배지가 계속 남지 않게 지운다
    await flushLogs(); // 버퍼에 남은 로그를 확실히 기록(서비스 워커가 곧 중단될 수 있음)
  }
}

function isJobRunning() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["jobStatus"], (result) => resolve(result.jobStatus === "running"));
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "authorizeOAuth") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("oauthConnect");
      runJob(async () => {
        await launchOAuthFlow();
        return { total: 1, success: 1, failMessages: [], requestsUsed: 0, batchSize: 1, cancelled: false, quotaExhausted: false };
      }, "notifyTitleOAuthConnect");
      // Google 로그인 창이 뜨는 순간 팝업이 포커스를 잃고 닫힐 수 있으므로, 인증이 끝날 때까지 기다리지 않고
      // 시작 확인만 바로 응답한다("message port closed" 오류 방지). 완료 여부는 팝업이 별도로 폴링해서 확인한다.
      sendResponse({ messageKey: "oauthConnectRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "getOAuthStatus") {
    Promise.all([getStoredOAuthTokens(), getOAuthCredentials()]).then(([tokens, credentials]) => {
      const connected = !!(tokens && tokens.refreshToken);
      sendResponse({ connected, requiresLogin: !connected && !!credentials.clientId });
    });
    return true;
  }

  if (request.action === "disconnectOAuth") {
    clearStoredOAuthTokens().then(() => chrome.storage.local.set({ oauthReauthRequired: false })).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (request.action === "getConfig") {
    sendResponse({
      batchSize: BATCH_SIZE,
      maxBatchCountPerRun: MAX_BATCH_COUNT_PER_RUN,
      maxEmailCountPerRun: MAX_EMAIL_COUNT_PER_RUN,
      rpm: GEMINI_RPM_LIMIT,
      tpm: GEMINI_TPM_LIMIT,
      rpd: GEMINI_RPD_LIMIT,
    });
    return false;
  }

  if (request.action === "getQuotaUsage") {
    getQuotaUsage().then((usage) => sendResponse(usage));
    return true;
  }

  if (request.action === "startRepeatClassification") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      const batchesPerRound = Math.max(1, Math.min(5, parseInt(request.batchesPerRound, 10) || 1));
      const repeatCount = Math.max(1, parseInt(request.repeatCount, 10) || 1);
      await markJobRunning("repeat");
      runJob(() => processRepeatClassification(batchesPerRound, repeatCount), "notifyTitleRepeat");
      sendResponse({ messageKey: "repeatRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startDeleteAllLabels") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("deleteLabels");
      runJob(() => processDeleteAllLabels(), "notifyTitleDeleteLabels");
      sendResponse({ messageKey: "deleteLabelsRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startBackupToDrive") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("driveBackup");
      runJob(() => processBackupToDrive(!!request.includeCredentials, request.passphrase || ""), "notifyTitleDriveBackup");
      sendResponse({ messageKey: "driveBackupRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startRestoreFromDrive") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("driveRestore");
      runJob(() => processRestoreFromDrive(request.passphrase || ""), "notifyTitleDriveRestore");
      sendResponse({ messageKey: "driveRestoreRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startAnalyzeLabelCriteria") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("labelAnalysis");
      runJob(() => processAnalyzeLabelCriteria(request.labelName), "notifyTitleLabelAnalysis");
      sendResponse({ messageKey: "labelAnalysisRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startAnalyzeMultipleLabels") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      const labelNames = Array.isArray(request.labelNames) ? request.labelNames : [];
      if (!labelNames.length) {
        sendResponse({ ok: false, messageKey: "errorGenericPrefix", messageParams: ["선택된 라벨이 없습니다."] });
        return;
      }
      await markJobRunning("labelAnalysisMulti");
      runJob(() => processAnalyzeMultipleLabelsCriteria(labelNames), "notifyTitleLabelAnalysis");
      sendResponse({ messageKey: "labelAnalysisRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startTranslateCategories") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("translateCategories");
      runJob(() => processTranslateCategories(request.targetLocale), "notifyTitleTranslate");
      sendResponse({ ok: true, started: true });
    });
    return true;
  }

  if (request.action === "getLastDriveBackupInfo") {
    chrome.storage.local.get(["lastDriveBackupAt"], (result) => sendResponse({ lastDriveBackupAt: result.lastDriveBackupAt || null }));
    return true;
  }

  if (request.action === "startDedupeRelabel") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("dedupe");
      runJob(() => processDedupeRelabel(), "notifyTitleDedupe");
      sendResponse({ messageKey: "dedupeRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startClassification") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      const count = Math.max(1, Math.min(MAX_EMAIL_COUNT_PER_RUN, parseInt(request.count, 10) || 5));
      await markJobRunning("classify");
      runJob(() => processRecentEmails(count), "notifyTitleClassify");
      sendResponse({ messageKey: "resultRequesting", messageParams: [count], ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startRelabel") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      const label = String(request.label || "").trim();
      const excludeSelf = !!request.excludeSelf;
      if (!label) {
        sendResponse({ messageKey: "errorSelectLabel", ok: false });
        return;
      }
      await markJobRunning("relabel");
      runJob(() => processRelabel(label, excludeSelf, MAX_EMAIL_COUNT_PER_RUN), "notifyTitleRelabel", [label]);
      sendResponse({ messageKey: "relabelRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "startLabelSummary") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      const labelName = String(request.labelName || "").trim();
      if (!labelName) {
        sendResponse({ messageKey: "errorSelectSummaryLabel", ok: false });
        return;
      }
      await markJobRunning("labelSummary");
      runJob(() => processSummarizeLabelEmails(labelName, request.count, request.filterCriteria), "notifyTitleSummary");
      sendResponse({ messageKey: "summaryRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "sendDiscordNotification") {
    sendSummaryToDiscord(request.webhookUrl, request.summaryReport)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (request.action === "applyLabelColors") {
    isJobRunning().then(async (running) => {
      if (running) {
        sendResponse({ messageKey: "errorAlreadyRunning", ok: false });
        return;
      }
      await markJobRunning("colors");
      runJob(() => processApplyLabelColors(), "notifyTitleApplyColors");
      sendResponse({ messageKey: "colorRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "cancelJob") {
    cancelRequested = true;
    abortActiveJobRequests();
    chrome.storage.local.set({ jobCancelRequested: true }).then(async () => {
      await addLog(t("logUserRequestedStop"), "warn");
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request.action === "forceCancelJob") {
    cancelRequested = true;
    abortActiveJobRequests();
    chrome.storage.local.get(["jobResult"], (stored) => {
      const previous = stored.jobResult || {};
      const summary = {
        total: previous.total || 0,
        success: previous.success || 0,
        failMessages: previous.failMessages || [],
        requestsUsed: previous.requestsUsed || 0,
        cancelled: true,
        quotaExhausted: false,
      };
      chrome.storage.local.set({
        jobStatus: "cancelled",
        jobCancelRequested: true,
        jobResult: summary,
        jobFinishedAt: Date.now(),
      }).then(async () => {
        stopKeepAlive();
        setActionIconRunning(false);
        await addLog(t("logUserRequestedStop"), "warn");
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  if (request.action === "getJobStatus") {
    chrome.storage.local.get(["jobStatus", "jobResult", "jobError", "jobProgress", "jobKind", "jobFinishedAt", "lastApiError"], (result) => {
      sendResponse(result);
    });
    return true;
  }

  if (request.action === "getLogs") {
    getRecentLogs(request.limit || 100).then((logs) => sendResponse(logs));
    return true;
  }

  if (request.action === "clearLogs") {
    clearLogs().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (request.action === "relabelExistingEmails") {
    isJobRunning().then(async (running) => {
      if (running) { sendResponse({ messageKey: "errorAlreadyRunning", ok: false }); return; }
      const label = String(request.targetLabel || "").trim();
      await markJobRunning("relabel");
      runJob(() => processRelabel(label, !!request.excludeSelf, MAX_EMAIL_COUNT_PER_RUN), "notifyTitleRelabel", [label]);
      sendResponse({ messageKey: "relabelRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "dedupeAndRelabel") {
    isJobRunning().then(async (running) => {
      if (running) { sendResponse({ messageKey: "errorAlreadyRunning", ok: false }); return; }
      await markJobRunning("dedupe");
      runJob(() => processDedupeRelabel(), "notifyTitleDedupe");
      sendResponse({ messageKey: "dedupeRequesting", ok: true, started: true });
    });
    return true;
  }

  if (request.action === "backupToDrive") {
    isJobRunning().then(async (running) => {
      if (running) { sendResponse({ messageKey: "errorAlreadyRunning", ok: false }); return; }
      await markJobRunning("driveBackup");
      runJob(() => processBackupToDrive(false, ""), "notifyTitleDriveBackup");
      sendResponse({ messageKey: "driveBackupRequesting", ok: true, started: true });
    });
    return true;
  }

  return false;
});
