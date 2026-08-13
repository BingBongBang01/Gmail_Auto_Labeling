// ai/ai_request_router.js

function aiRouterSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

// 공급자별 요청 간격 조절.
// 예전 background.js에는 throttleGeminiCall()로 분당 요청 수를 지키는 장치가 있었는데,
// 라우터를 도입하면서 그 함수가 삭제되고 관련 상수만 남았다(주석은 아직 그 함수를 언급한다).
// 그래서 지금은 배치 루프가 허용하는 속도로 그냥 다 쏘고 있어서 무료 티어에서 429가 쏟아진다.
// 여기서 다시 세운다.
class AIPacer {
  static _states = new Map(); // providerId -> { baseInterval, interval, last, tail }

  static _state(providerId, baseInterval) {
    let state = this._states.get(providerId);
    if (!state) {
      state = { baseInterval, interval: baseInterval, last: 0, tail: Promise.resolve() };
      this._states.set(providerId, state);
    } else if (state.baseInterval !== baseInterval) {
      // 설정에서 RPM을 바꾸면 즉시 반영한다.
      const wasBackedOff = state.interval > state.baseInterval;
      state.baseInterval = baseInterval;
      if (!wasBackedOff) state.interval = baseInterval;
    }
    return state;
  }

  // 슬롯 확보는 반드시 한 번에 하나씩 순서대로 이뤄져야 한다.
  // 확보가 끝나면 바로 다음 대기자를 풀어주므로, 요청은 interval 간격으로 출발하면서
  // 각자의 응답 대기 시간은 서로 겹친다(배치마다 "간격 + 응답지연"이 누적되지 않는다).
  static async acquire(providerId, baseInterval) {
    const state = this._state(providerId, baseInterval);
    if (state.interval <= 0) return;

    const previous = state.tail;
    let release;
    state.tail = new Promise((resolve) => {
      release = resolve;
    });

    try {
      await previous;
      const wait = state.last + state.interval - Date.now();
      if (wait > 0) await aiRouterSleep(wait);
      state.last = Date.now();
    } finally {
      release();
    }
  }

  // 429를 맞으면 간격을 늘리고, 성공이 이어지면 기준값으로 서서히 회복한다.
  static onRateLimited(providerId) {
    const state = this._states.get(providerId);
    if (!state) return;
    state.interval = Math.min(state.baseInterval * 6, Math.max(state.interval, 500) * 1.6);
  }

  static onSuccess(providerId) {
    const state = this._states.get(providerId);
    if (!state) return;
    state.interval = Math.max(state.baseInterval, state.interval * 0.92);
  }
}

class AIRequestRouter {
  static async generateStructured(prompt, schema, options = {}) {
    // Quota 상태 복원이 끝나기 전에 quota 판단을 내리면(서비스 워커 재시작 직후) 이미 소진된
    // Credential을 다시 호출하게 된다. Router 진입 시 반드시 초기화를 기다린다.
    await AIQuotaManager.initialize();

    const settings = await SettingsStore.getSettings();
    const credentials = await AIKeyManager.getActiveCredentials();

    if (!credentials || credentials.length === 0) {
      throw new Error("No enabled AI credentials found. Please configure them in Settings.");
    }

    const policy = {
      retryEnabled: settings.ai?.requestPolicy?.retryEnabled !== false,
      failoverEnabled: settings.ai?.requestPolicy?.failoverEnabled !== false,
      quotaAware: settings.ai?.requestPolicy?.quotaAware !== false
    };
    // maxRetries = "재시도 횟수"이며 총 시도 횟수는 1 + maxRetries다 (최초 시도 1회 + 재시도 maxRetries회).
    const maxRetries = settings.ai?.requestPolicy?.maxRetries ?? 3;
    const maxAttemptsPerCredential = 1 + maxRetries;

    let lastError = null;

    for (const cred of credentials) {
      // quotaAware === false면 예전에 quota/rate-limit로 표시된 Credential이라도 다시 시도한다.
      if (policy.quotaAware && !(await AIQuotaManager.isAvailable(cred.id))) continue;

      const provider = AIProviderRegistry.getProvider(cred.provider);
      if (!provider) continue;

      // 이 Credential 하나에 대한 attempts. 다음 Credential로 넘어가면 0부터 다시 센다
      // (Credential A의 retry 횟수가 Credential B에 누적되지 않는다).
      let attempts = 0;
      let credentialOutcome = null; // "success" | "failover" | "fail"

      while (attempts < maxAttemptsPerCredential) {
        attempts++;
        try {
          const result = await provider.generateStructured(cred.apiKey, cred.model, prompt, schema);

          // 실패했다가 복구된 Credential이면 상태를 Ready로 되돌려 저장한다.
          if (cred.status !== "Ready") {
            const latest = await SettingsStore.getSettings();
            const latestCreds = (latest.ai?.credentials || []).map((c) =>
              c.id === cred.id ? { ...c, status: "Ready" } : c
            );
            await SettingsStore.setSetting("ai.credentials", latestCreds);
          }

          return result;
        } catch (error) {
          const errorMeta = provider.normalizeError(error);
          lastError = errorMeta;
          const decision = await AIFailoverManager.handleProviderError(cred.provider, cred.id, errorMeta, policy);

          if (decision.action === "retry") {
            if (attempts < maxAttemptsPerCredential) {
              await new Promise((r) => setTimeout(r, decision.waitMs || 2000));
              continue; // 같은 Credential로 재시도
            }
            // 재시도 횟수를 다 썼다 - retry 성격의 오류였더라도 이 Credential은 여기서 끝내고
            // failoverEnabled 정책에 따라 다음 Credential로 넘어갈지 결정한다.
            credentialOutcome = policy.failoverEnabled ? "failover" : "fail";
            break;
          }
          if (decision.action === "failover") {
            credentialOutcome = "failover";
          } else {
            credentialOutcome = "fail";
    // 서비스워커가 재시작됐을 수 있으므로 보존된 할당량 상태를 먼저 되살린다.
    await AIQuotaManager.load();

    const settings = await SettingsStore.getSettings();
    const policy = settings.ai?.requestPolicy || {};
    const retryEnabled = policy.retryEnabled !== false;
    const failoverEnabled = policy.failoverEnabled !== false;
    const maxRetries = Number.isFinite(policy.maxRetries) ? Math.max(0, policy.maxRetries) : 3;
    const rpmLimit = Number(policy.rpmLimit) > 0 ? Number(policy.rpmLimit) : 15;
    const baseInterval = Math.ceil(60000 / rpmLimit);

    const activeCredentials = await AIKeyManager.getActiveCredentials();
    if (!activeCredentials.length) {
      throw new Error(
        "등록된 AI API 키가 없습니다. 설정 > AI 공급자에서 키를 추가하세요."
      );
    }

    if (AIProviderRegistry.getAllProviders().length === 0) {
      // 공급자 어댑터가 등록되지 않았다는 건 스크립트 로딩 문제다.
      // 이걸 "모든 키 실패"로 뭉개면 사용자가 키를 계속 의심하게 된다.
      throw new Error(
        "AI 공급자 어댑터가 로드되지 않았습니다. 확장 프로그램을 새로 고친 뒤 다시 시도하세요."
      );
    }

    // failover가 꺼져 있으면 우선순위가 가장 높은 키만 쓴다.
    const credentials = failoverEnabled ? activeCredentials : activeCredentials.slice(0, 1);

    // 이번 호출에서 더 시도할 의미가 없는 키(잘못된 요청, 비활성화됨 등).
    // 할당량/레이트리밋으로 "쉬는 중"인 키와 달리 기다려도 풀리지 않는다.
    const excluded = new Set();
    let lastErrorMessage = "";

    const rounds = retryEnabled ? maxRetries + 1 : 1;

    for (let round = 0; round < rounds; round += 1) {
      for (const cred of credentials) {
        if (excluded.has(cred.id)) continue;
        if (!AIQuotaManager.isAvailable(cred.id)) continue;

        const provider = AIProviderRegistry.getProvider(cred.provider);
        if (!provider) {
          lastErrorMessage = `지원하지 않는 AI 공급자입니다: ${cred.provider}`;
          excluded.add(cred.id);
          continue;
        }

        const model = cred.model || AIProviderRegistry.getDefaultModel(cred.provider);
        if (!model) {
          lastErrorMessage = `${cred.name || cred.provider}에 사용할 모델이 지정되지 않았습니다.`;
          excluded.add(cred.id);
          continue;
        }

        // 같은 키로 재시도할 가치가 있는 오류(공급자 장애, 응답 파싱 실패)는 여기서 짧게 반복한다.
        const sameKeyAttempts = retryEnabled ? 2 : 1;
        for (let attempt = 0; attempt < sameKeyAttempts; attempt += 1) {
          await AIPacer.acquire(cred.provider, baseInterval);

          try {
            AIQuotaManager.recordRequest(cred.id);
            const result = await provider.generateStructured(cred.apiKey, model, prompt, schema);

            AIPacer.onSuccess(cred.provider);
            AIQuotaManager.clear(cred.id);
            if (cred.status !== "Ready") {
              await AIKeyManager.setCredentialStatus(cred.id, "Ready");
            }
            return result;
          } catch (error) {
            const meta = provider.normalizeError(error);
            lastErrorMessage = meta.message || meta.type || "원인 불명";
            if (meta.type === "rate_limit") AIPacer.onRateLimited(cred.provider);

            const decision = await AIFailoverManager.handleProviderError(cred.provider, cred.id, meta);

            if (decision.action === "retry_same" && attempt + 1 < sameKeyAttempts) {
              await aiRouterSleep(decision.waitMs || 2000);
              continue;
            }
            if (decision.disabled || meta.type === "invalid_request" || meta.type === "unknown") {
              excluded.add(cred.id);
            }
            break; // 다음 키로 넘어간다
          }
          break;
        }
      }

      if (credentialOutcome !== "failover") {
        // failoverEnabled === false이거나 명시적으로 "fail" 판정을 받은 경우, 다음 Credential로 넘어가지 않는다.
        break;
      }
      // credentialOutcome === "failover" → for 루프가 자연스럽게 다음 credential로 이동한다.
    }

    const err = new Error(
      `All active AI credentials failed or exhausted their quotas. Please check your AI Settings.` +
      (lastError ? ` (last error: ${lastError.type})` : "")
    );
    err.code = "ALL_CREDENTIALS_EXHAUSTED";
    err.lastError = lastError;
    throw err;
  }
}

if (typeof self !== "undefined") self.AIRequestRouter = AIRequestRouter;
      if (round + 1 >= rounds) break;

      // 이번 라운드에 쓸 수 있는 키가 없었다. 쉬는 중인 키가 곧 풀리면 그만큼만 기다린다.
      const waitMs = this._msUntilAnyAvailable(credentials, excluded);
      if (waitMs === null) break; // 남은 키가 전부 영구 실패 상태
      await aiRouterSleep(Math.min(waitMs, 60000));
    }

    throw new Error(`AI 요청이 실패했습니다. 마지막 오류: ${lastErrorMessage || "원인 불명"}`);
  }

  // 쉬는 중인 키 중 가장 빨리 풀리는 시간(ms). 지금 바로 쓸 수 있으면 0,
  // 쓸 수 있게 될 키가 아예 없으면 null.
  static _msUntilAnyAvailable(credentials, excluded) {
    let soonest = null;
    for (const cred of credentials) {
      if (excluded.has(cred.id)) continue;
      const state = AIQuotaManager.getState(cred.id);
      if (!state) return 0;
      const remaining = state.until - Date.now();
      if (remaining <= 0) return 0;
      if (soonest === null || remaining < soonest) soonest = remaining;
    }
    return soonest;
  }
}

globalThis.AIPacer = AIPacer;
globalThis.AIRequestRouter = AIRequestRouter;
