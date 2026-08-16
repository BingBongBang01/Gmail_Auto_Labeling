// bg/platform/google_oauth.js
// ---------------- OAuth (사용자 개인 클라이언트 방식) ----------------
// chrome.identity.getAuthToken()은 manifest에 박혀있는 client_id로만 동작해서, 사용자마다 각자의 GCP
// OAuth 클라이언트를 쓰게 할 수가 없다. 그래서 launchWebAuthFlow + authorization code 교환 + refresh_token
// 방식을 직접 구현해서, 설정 탭에서 입력한 사용자 개인 client_id/secret으로 인증하도록 한다.

import { SettingsStore } from "../../settings/settings_store.js";
import { t } from "../../i18n.js";

// calendar.events는 일정 조회/수정만 허용한다. 캘린더 "목록"(calendarList.list)은
// 포함되지 않아서 대시보드의 캘린더 선택 새로고침이 403을 받는다. 그래서 읽기 전용 스코프를 함께 요청한다.
// 주의: 이 목록이 바뀌면 기존 사용자의 refresh token으로는 새 권한이 없으므로 재연결이 필요하다.
// (bg/platform/calendar_api.js가 403을 감지해 재연결 안내 메시지를 띄운다)
const GOOGLE_OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

// 로그인 창을 두 번 겹쳐 띄우지 않기 위한 플래그. jobStatus와 달리 워커가 죽으면 같이 사라지므로,
// 예전처럼 "작업 중" 상태가 저장소에 남아 재로그인을 영영 막는 일이 없다.
let oauthFlowInProgress = false;

function isOAuthFlowInProgress() {
  return oauthFlowInProgress;
}

function setOAuthFlowInProgress(value) {
  oauthFlowInProgress = !!value;
}

async function getOAuthCredentials() {
  const settings = await SettingsStore.getSettings();
  return {
    clientId: (settings.google.oauth.clientId || "").trim(),
    clientSecret: (settings.google.oauth.clientSecret || "").trim(),
  };
}

async function getStoredOAuthTokens() {
  const result = await new Promise((resolve) => chrome.storage.local.get(["oauthTokens"], resolve));
  return result.oauthTokens || null;
}

async function saveStoredOAuthTokens(tokens) {
  await chrome.storage.local.set({ oauthTokens: tokens });
}

async function clearStoredOAuthTokens() {
  // 계정이 바뀌면 캐시된 내 메일 주소도 같이 버려야 '나와 관련된 메일' 판별이 엉뚱해지지 않는다.
  await chrome.storage.local.remove(["oauthTokens", "myEmailAddress"]);
}

// 옵션 페이지와 사이드패널은 연동 상태를 직접 폴링할 방법이 없다.
// 예전에는 두 화면 모두 이 메시지를 기다리는 리스너를 달아놨는데 정작 보내는 쪽이 없어서,
// 로그인이 실제로 성공해도 몇 초 뒤 한 번 걸어둔 타이머가 지나가면 화면은 계속 "미연결"로 남았다.
// (구글 로그인 창에서 계정 선택 + 동의까지는 보통 그 타이머보다 오래 걸린다)
function broadcastOAuthStatusChanged() {
  try {
    const maybePromise = chrome.runtime.sendMessage({ action: "oauthStatusUpdated" });
    if (maybePromise && typeof maybePromise.catch === "function") maybePromise.catch(() => {});
  } catch (e) {
    // 열려 있는 확장 페이지가 없으면 수신자가 없다. 무해하다.
  }
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
  broadcastOAuthStatusChanged();
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

  // 구글이 거부하면 code 대신 error가 실려서 돌아온다(access_denied, invalid_client 등).
  // 예전에는 그 값을 버리고 "코드 없음"만 알려줘서, 실제 원인(동의 거부인지 클라이언트 설정
  // 문제인지)을 사용자가 알 방법이 없었다.
  const redirectParams = new URL(redirectUrl).searchParams;
  const authError = redirectParams.get("error");
  if (authError) {
    throw new Error(
      `Google OAuth: ${authError}${
        redirectParams.get("error_description") ? ` - ${redirectParams.get("error_description")}` : ""
      }`
    );
  }
  const code = redirectParams.get("code");
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

export {
  GOOGLE_OAUTH_SCOPE,
  getOAuthCredentials,
  getStoredOAuthTokens,
  saveStoredOAuthTokens,
  clearStoredOAuthTokens,
  broadcastOAuthStatusChanged,
  createOAuthReauthRequiredError,
  markOAuthReauthRequired,
  launchOAuthFlow,
  refreshAccessTokenViaRefreshToken,
  getValidAccessToken,
  isOAuthFlowInProgress,
  setOAuthFlowInProgress,
};
