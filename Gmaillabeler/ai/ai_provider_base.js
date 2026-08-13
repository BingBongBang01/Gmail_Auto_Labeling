// ai/ai_provider_base.js
// 세 공급자 어댑터가 공유하는 HTTP/파싱 처리. 이전에는 fetch + 에러 throw + JSON 파싱이
// 파일마다 복사돼 있어서, Retry-After 헤더를 읽지 않는다거나 파싱 실패를 인증 오류로
// 오분류하는 문제가 세 곳에 똑같이 있었다.
//
// 어댑터가 normalizeError()로 만들어내는 오류 타입(AIFailoverManager가 소비한다):
//   rate_limit      - 잠깐 기다리면 되는 429. waitMs 동안 이 키를 쉬게 한다.
//   quota           - 할당량 소진. 리셋 시점까지 이 키를 제외한다.
//   invalid_key     - 키 자체가 틀렸다. 키를 영구 비활성화한다.
//   invalid_request - 우리 요청이 잘못됐다(스키마 오류, 없는 모델 등). 키는 건드리지 않는다.
//   server_error    - 공급자 장애. 같은 키로 재시도한다.
//   bad_response    - 응답이 스키마/JSON을 안 지켰다. 같은 키로 재시도한다.
//   unknown         - 분류 불가. 다음 키로 넘어간다.

class AIProviderBase {
  // Retry-After는 "초" 또는 HTTP 날짜 두 형식이 모두 온다. 없으면 null.
  static parseRetryAfterMs(headers) {
    if (!headers || typeof headers.get !== "function") return null;
    const raw = headers.get("retry-after");
    if (!raw) return null;

    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));

    const asDate = Date.parse(raw);
    if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
    return null;
  }

  async postJson(url, headers, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // 오류 본문이 JSON이 아닐 수도 있다(게이트웨이 HTML 등). 그 경우도 메시지를 살려둔다.
      let raw = null;
      try {
        raw = await res.json();
      } catch (e) {
        try {
          raw = { error: { message: (await res.text()).slice(0, 500) } };
        } catch (e2) {
          raw = null;
        }
      }
      throw {
        status: res.status,
        raw,
        retryAfterMs: AIProviderBase.parseRetryAfterMs(res.headers),
      };
    }

    try {
      return await res.json();
    } catch (e) {
      // 200인데 본문이 JSON이 아니면 공급자 문제다. 인증 오류로 오분류하면 안 된다.
      throw { status: res.status, raw: null, isBadResponse: true };
    }
  }

  // 모델이 돌려준 텍스트를 JSON으로 파싱한다. 실패는 bad_response로 올려서
  // 같은 키로 한 번 더 시도하게 한다(키를 비활성화하면 안 된다).
  parseModelJson(text) {
    if (typeof text !== "string" || !text.trim()) {
      throw { status: 200, raw: null, isBadResponse: true };
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw { status: 200, raw: null, isBadResponse: true };
    }
  }

  // 상태 코드에 의존하지 않는 공통 분기. 각 어댑터가 공급자별 처리를 마친 뒤 마지막에 부른다.
  normalizeCommonError(error) {
    if (error && error.isBadResponse) {
      return { type: "bad_response", retryable: true, waitMs: 500 };
    }
    if (error && typeof error.status === "number") {
      if (error.status >= 500) {
        return { type: "server_error", retryable: true, waitMs: error.retryAfterMs || 2000 };
      }
      if (error.status === 400 || error.status === 404 || error.status === 422) {
        // 스키마 오류나 없는 모델 ID가 여기로 온다. 예전에는 400을 invalid_key로 매핑해서
        // 정상 키를 영구 비활성화시켰다.
        return { type: "invalid_request", retryable: false, message: this.extractMessage(error) };
      }
    }
    return { type: "unknown", retryable: false, message: this.extractMessage(error) };
  }

  extractMessage(error) {
    return (
      error?.raw?.error?.message ||
      error?.raw?.message ||
      error?.message ||
      ""
    );
  }
}

globalThis.AIProviderBase = AIProviderBase;
