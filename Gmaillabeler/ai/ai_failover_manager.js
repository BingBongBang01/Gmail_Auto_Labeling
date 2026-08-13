// ai/ai_failover_manager.js
//
// 공급자 어댑터가 normalizeError()로 표준화한 오류를 받아, 그 키를 어떻게 처리하고
// 라우터가 다음에 무엇을 해야 하는지 결정한다.
//
// 반환하는 action:
//   "retry_same" - 같은 키로 waitMs 뒤 다시 시도(일시적 장애, 응답 파싱 실패)
//   "failover"   - 이 키로는 더 시도하지 않고 다음 키로 넘어간다
//
// rate_limit도 failover를 돌려주지만, 그 전에 markRateLimited로 쉬는 시간을 걸어둔다.
// 그래서 키가 하나뿐이면 라우터가 "쓸 수 있는 키가 없음"을 감지해 그 시간만큼 기다린 뒤
// 다시 시도한다(예전에는 즉시 실패로 끝나서 maxRetries가 무의미했다).

class AIFailoverManager {
  // 표준 오류 구조: { type: "quota"|"rate_limit"|"invalid_key"|"invalid_request"|"server_error"|"unknown",
  //                   retryable: boolean, waitMs?: number, scope?: string }
  //
  // policy: { retryEnabled, failoverEnabled, quotaAware } - settings.ai.requestPolicy에서 그대로 전달됨.
  // 반환값 action:
  //   "retry"          - 같은 Credential로 재시도 (retryEnabled === true일 때만)
  //   "failover"       - 다음 Credential로 이동 (failoverEnabled === true일 때만)
  //   "fail"           - 더 이상 시도하지 않고 실패 처리
  static async handleProviderError(providerId, keyId, errorMeta, policy = {}) {
    const retryEnabled = policy.retryEnabled !== false;
    const failoverEnabled = policy.failoverEnabled !== false;
    const quotaAware = policy.quotaAware !== false;

    // 명백한 인증 실패(잘못된/폐기된 API Key)만 Credential을 자동 비활성화한다.
    // 400(invalid_request), 404(model not found), 5xx, timeout, parse error 등은 Credential을 죽이지 않는다.
    if (errorMeta.type === "invalid_key") {
      await AIKeyManager.markCredentialInvalid(keyId);
      return failoverEnabled ? { action: "failover" } : { action: "fail" };
    }

    if (errorMeta.type === "invalid_request") {
      // 요청 자체가 잘못된 것이므로 같은 요청을 재시도해도 의미가 없다. Credential은 그대로 유지한다.
      return failoverEnabled ? { action: "failover" } : { action: "fail" };
    }

    if (errorMeta.type === "quota") {
      if (quotaAware) AIQuotaManager.markQuotaExhausted(keyId);
      return failoverEnabled ? { action: "failover" } : { action: "fail" };
    }

    if (errorMeta.type === "rate_limit") {
      if (quotaAware) AIQuotaManager.markRateLimited(keyId, errorMeta.waitMs || 10000);
      // 일시적일 수 있으므로 우선 Retry-After 만큼 대기 후 같은 Credential로 재시도한다.
      if (retryEnabled) return { action: "retry", waitMs: errorMeta.waitMs || 10000 };
      return failoverEnabled ? { action: "failover" } : { action: "fail" };
    }

    if (errorMeta.type === "server_error") {
      if (retryEnabled) return { action: "retry", waitMs: 2000 };
      return failoverEnabled ? { action: "failover" } : { action: "fail" };
    }

    // 알 수 없는 오류: 재시도해도 나아질 근거가 없으므로 바로 다음 Credential로 넘어간다.
    return failoverEnabled ? { action: "failover" } : { action: "fail" };
  }
}

if (typeof self !== "undefined") self.AIFailoverManager = AIFailoverManager;
  static async handleProviderError(providerId, keyId, errorMeta) {
    switch (errorMeta.type) {
      case "invalid_key":
        await AIKeyManager.markCredentialInvalid(keyId, errorMeta.message);
        return { action: "failover", disabled: true };

      case "quota":
        AIQuotaManager.markQuotaExhausted(keyId, {
          resetsDaily: errorMeta.resetsDaily === true,
          message: errorMeta.message,
        });
        return { action: "failover" };

      case "rate_limit":
        AIQuotaManager.markRateLimited(keyId, errorMeta.waitMs, errorMeta.message);
        return { action: "failover" };

      case "server_error":
      case "bad_response":
        return { action: "retry_same", waitMs: errorMeta.waitMs || 2000 };

      case "invalid_request":
        // 우리 요청 쪽 문제라서 같은 키로 재시도해도 결과가 같다.
        // 다만 공급자마다 스키마 수용 범위가 달라서 다른 공급자는 성공할 수 있으므로 넘긴다.
        return { action: "failover" };

      default:
        return { action: "failover" };
    }
  }
}

globalThis.AIFailoverManager = AIFailoverManager;
