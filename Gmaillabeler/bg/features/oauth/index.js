// bg/features/oauth/index.js
// Google 계정 연결 기능의 등록부. 실제 플로우는 bg/platform/google_oauth.js에 있다.

import { registerAction } from "../../core/message_router.js";
import { isJobRunning } from "../../core/job_runner.js";
import { startKeepAlive, stopKeepAlive } from "../../core/keep_alive.js";
import { addLog } from "../../core/logger.js";
import { t, i18nInit } from "../../../i18n.js";
import {
  broadcastOAuthStatusChanged,
  clearStoredOAuthTokens,
  getOAuthCredentials,
  getStoredOAuthTokens,
  isOAuthFlowInProgress,
  launchOAuthFlow,
  setOAuthFlowInProgress,
} from "../../platform/google_oauth.js";

function register() {
  // ----- OAuth -----
  registerAction("authorizeOAuth", async (request, sender, respond) => {
    // 로그인은 배치 작업이 아니라 사용자의 즉시 조작이다. 예전에는 이걸 runJob으로 감싸고
    // isJobRunning()으로 막았는데, 그 바람에 (1) 다른 작업이 도는 동안 로그인을 아예 할 수 없었고
    // (2) 작업이 비정상 종료돼 jobStatus가 "running"으로 남으면 재로그인 경로가 영구히 막혔다.
    await i18nInit();
    const { clientId } = await getOAuthCredentials();
    if (!clientId) return { ok: false, error: t("errNoOAuthClientId") };
    if (isOAuthFlowInProgress()) return { ok: false, error: "이미 Google 로그인 창이 열려 있습니다." };

    setOAuthFlowInProgress(true);
    // 로그인 창이 떠 있는 동안 서비스워커가 유휴로 종료되면 launchWebAuthFlow 콜백이 사라진다.
    startKeepAlive();

    // Google 로그인 창이 뜨는 순간 팝업이 포커스를 잃고 닫힐 수 있으므로, 인증이 끝날 때까지 기다리지 않고
    // 시작 확인만 바로 응답한다("message port closed" 오류 방지).
    // 완료/실패는 oauthStatusUpdated 브로드캐스트로 알린다.
    respond({ messageKey: "oauthConnectRequesting", ok: true, started: true });

    try {
      await launchOAuthFlow();
      await addLog(t("logJobStarted", [t("notifyTitleOAuthConnect")]) + " → " + t("logJobDone"));
    } catch (e) {
      const message = String(e?.message || e);
      await chrome.storage.local.set({
        lastApiError: { service: "Google OAuth", message: message.slice(0, 400), at: Date.now() },
      });
      await addLog(`Google 로그인 실패: ${message}`, "error");
    } finally {
      setOAuthFlowInProgress(false);
      // 배치 작업이 동시에 돌고 있다면 그쪽 keepalive를 끊으면 안 된다.
      if (!(await isJobRunning())) stopKeepAlive();
      broadcastOAuthStatusChanged();
    }
  });

  registerAction("getOAuthStatus", async () => {
    const [tokens, credentials, cached] = await Promise.all([
      getStoredOAuthTokens(),
      getOAuthCredentials(),
      new Promise((resolve) => chrome.storage.local.get(["myEmailAddress"], resolve)),
    ]);
    const connected = !!(tokens && tokens.refreshToken);
    return {
      connected,
      // 두 설정 화면 모두 res.email을 그려주지만 예전에는 이 필드를 아예 보내지 않았다.
      email: connected ? cached.myEmailAddress || "" : "",
      connecting: isOAuthFlowInProgress(),
      requiresLogin: !connected && !!credentials.clientId,
      hasClientId: !!credentials.clientId,
    };
  });

  registerAction("disconnectOAuth", async () => {
    await clearStoredOAuthTokens();
    await chrome.storage.local.set({ oauthReauthRequired: false });
    broadcastOAuthStatusChanged();
    return { ok: true };
  });
}

export { register };
