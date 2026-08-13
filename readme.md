# Gmail AI Labeler - 아키텍처 및 업데이트 상세 내역 (v2.0 -> v3.0)

이 문서는 기존 확장 프로그램이 기능별로 분산되고 UI/백엔드 로직이 분리되어 있던 문제를 해결하기 위해 진행된 **전면적인 아키텍처 개편 및 기능 구현 사항**을 상세히 기록한 문서입니다. 향후 유지보수 및 기능 확장을 위해 필독을 권장합니다.

---

## 1. 중앙 집중형 설정(Settings) 아키텍처 및 마이그레이션

이전 버전에서는 설정 데이터가 일관성 없이 여러 곳에 저장되고, UI와 백엔드 간 상태 불일치가 자주 발생했습니다. 이를 해결하기 위해 새로운 중앙 집중형 설정 시스템을 구축했습니다.

*   **`settings_schema.js` 및 `settings_defaults.js`**: 9가지 메인 카테고리(General, Connections, Gmail, Calendar, AI, Automation, Notifications, Data, Advanced)로 구성된 엄격한 스키마를 정의했습니다. 기존의 복잡했던 AI 공급자별 관리 방식을 버리고, 통합된 `ai.credentials` 배열 형태로 스키마를 변경했습니다.
*   **`settings_store.js`**: 단일 진실 공급원(Single Source of Truth) 역할을 하는 스토어입니다. Chrome Storage와 동기화되며, `scheduleSave`를 통해 디바운스된(Debounced) 안전한 비동기 저장을 보장합니다.
*   **`settings_migration.js`**: 사용자가 확장 프로그램을 업데이트할 때, 기존 v1, v2의 낡은 스토리지 데이터를 안전하게 v3 스키마(`ai.credentials` 등)로 변환해주는 마이그레이션 모듈입니다. API 키가 콘솔 로그에 노출되지 않도록 보안 처리도 완료되었습니다.

---

## 2. AI 요청 라우터 및 강력한 페일오버 (AI Request Router & Failover)

Gemini뿐만 아니라 OpenAI, Anthropic 등 다중 LLM을 지원하고 API 호출 제한(Quota/Rate Limit)에 대응하기 위해 AI 엔진을 완전히 재설계했습니다.

*   **`ai_provider_registry.js`**: 사용 가능한 AI 공급자(`google`, `openai`, `anthropic`)와 각 공급자별 세부 모델(예: `gemini-1.5-flash`, `gpt-4o`, `claude-3-haiku-20240307`)을 하드코딩하여 중앙에서 관리합니다.
*   **통합 API 키 관리 (`ai.credentials`)**: 사용자는 우선순위에 따라 여러 공급자의 API 키를 여러 개 등록할 수 있습니다. 
*   **`ai_request_router.js`**: API 요청을 보낼 때 `ai.credentials` 배열을 순회하며 가장 우선순위가 높은(그리고 사용 가능한) API 키를 사용합니다.
*   **`ai_failover_manager.js` 및 `ai_quota_manager.js`**: API 통신 중 `429 Too Many Requests`나 `Quota Exceeded(할당량 초과)` 에러가 발생하면, 즉시 해당 키를 일시 정지(혹은 완전 정지)시키고 다음 우선순위의 API 키(예: Gemini 실패 시 OpenAI로)로 **자동으로 페일오버**하여 백그라운드 작업이 멈추지 않도록 보장합니다.
*   **공급자 어댑터 (`google_provider.js`, `openai_provider.js`, `anthropic_provider.js`)**: 각 LLM의 특성에 맞게 프롬프트와 Structured JSON Output(구조화된 JSON 출력)을 강제하는 어댑터 클래스입니다. 향후 새로운 LLM이 추가되더라도 어댑터만 추가하면 되는 구조입니다.

---

## 3. 캘린더 통합 백엔드 엔진 완성 (Calendar API Integration)

기존에는 캘린더 UI만 존재하고 실제 Google Calendar와의 연동 로직이 미완성 상태였습니다. Gmail 분류와 완전히 독립된 캘린더 전용 데이터 도메인을 구축했습니다.

*   **`calendar_api.js`**: Google Calendar REST API(`https://www.googleapis.com/calendar/v3/calendars/...`)와 직접 통신하여 이벤트 조회 및 색상(colorId) 업데이트를 수행합니다.
*   **`calendar_classifier.js`**: AI를 사용하여 사용자의 일정 제목, 설명, 시간 등을 분석해 자동으로 적절한 캘린더 카테고리와 색상을 할당하는 프롬프트 엔진입니다.
*   **`calendar_engine.js`**: 백그라운드에서 일정 기간(오늘, 이번 주, 이번 달)의 캘린더 데이터를 가져와 `calendar_classifier`에 넘기고, 그 결과값으로 `calendar_api`를 호출해 실제 캘린더 일정을 일괄 업데이트하는 스케줄러/배치 엔진입니다.
*   옵션 페이지의 **"Generate AI Categories"** 버튼을 통해 사용자가 클릭 한 번으로 초기 캘린더 분류 기준을 자동 생성할 수 있도록 백그라운드 Job 큐와 연동되었습니다.

---

## 4. 모던 Options UI (설정 페이지) 전면 개편

설정 페이지를 완전히 SPA(Single Page Application) 형태로 개편하여 사용자 경험과 구조를 현대화했습니다.

*   **AI Credential Card UI (`options.html`, `options.js`)**: 기존의 정적인 드롭다운 대신, 여러 개의 API 키를 직관적으로 추가/수정/삭제하고 위아래로 움직여 우선순위를 변경할 수 있는 카드 기반 UI를 도입했습니다.
*   **Test Connection (연결 테스트)**: API 키를 추가할 때, 저장하기 전에 모달창에서 즉시 AI와 통신하여 키가 정상인지 검증하는 기능을 구현했습니다.
*   **i18n 완벽 적용 (`_locales/`)**: UI 템플릿에 하드코딩된 내부 키(예: `aiActiveProvider` 등)를 전부 제거하고, `data-i18n` 속성을 활용해 다국어 처리를 표준화했습니다. 영어(en), 한국어(ko), 일본어(ja), 중국어 간체(zh_CN) 등 4개 국어 번역이 모두 `messages.json`에 반영되었습니다.

---

## 5. 버그 수정 (v3.0 리팩토링 직후 발견된 런타임 버그 수정)

위 리팩토링 직후 실제로 실행하면 죽는 버그들이 다수 발견되어 함께 수정했습니다.

*   **서비스 워커에서 `window` 전역 등록 실패**: `ai/*.js`, `settings/*.js`의 모듈들이 `typeof window !== "undefined"` 조건으로 전역 객체(`AIProviderRegistry`, `SettingsStore`, `migrateToLatestSettings` 등)를 등록하고 있었는데, MV3 백그라운드 서비스 워커에는 `window`가 없어 아무것도 등록되지 않았습니다. AI 라우터/설정 스토어 전체가 백그라운드에서 동작하지 않던 문제로, `self`를 사용하도록 전부 수정했습니다.
*   **AI 공급자 어댑터 미등록**: `google_provider.js`, `openai_provider.js`, `anthropic_provider.js`가 옵션 페이지(`options.html`)에 스크립트로 포함되어 있지 않아 "Test Connection" 기능이 항상 실패했습니다. 스크립트 태그를 추가했습니다.
*   **`ai.geminiApiKeys` → `ai.credentials` 스키마 불일치**: `background.js`의 `getGeminiApiKeys()`가 더 이상 존재하지 않는 옛 설정 경로(`ai.geminiApiKeys`)를 읽고 있어 항상 빈 배열을 반환, 메일 분류가 "API 키 없음" 오류로 실패했습니다. 새 `ai.credentials` 구조를 읽도록 수정했습니다.
*   **설정 마이그레이션 미실행**: `settings_migration.js`가 `background.js`의 `importScripts` 목록에 없었고, 백그라운드 시작 시점에 호출되지도 않아 옵션 페이지를 열지 않은 사용자는 계속 구버전 설정을 사용했습니다. 임포트 목록에 추가하고 `onInstalled`/`onStartup` 시점에 마이그레이션을 실행하도록 했습니다. 또한 `settings_defaults.js`의 `schemaVersion`이 `2`로 남아있어 마이그레이션이 완료돼도 다시 실행되며 설정을 되돌리던 문제도 `3`으로 맞췄습니다.
*   **캘린더 카테고리 자동 생성 기능 전체 오류**: `calendar_init_categories` 핸들러가 존재하지 않는 `fetchCalendarEvents`/`fetchCalendarColors` 함수를 호출하고 있었고(`calendar_api.js`가 export하는 실제 함수명은 `calendarEventsListAll`/`calendarColorsGet`), 색상 목록도 배열이 아닌 맵 형태여야 하는데 `Object.keys(...)`로 변환해 넘기고 있었습니다. 실제 API 함수를 호출하고 올바른 색상 맵을 전달하도록 수정했습니다.
*   **`calendar_engine.js`/`calendar_categories.js`의 미선언 변수 `appSettings`**: 어디에도 선언되지 않은 전역 변수를 참조해 캘린더 분류 실행 시 `ReferenceError`로 즉시 중단되던 문제를 `SettingsStore.getSettings()` 호출로 수정했습니다.
*   **존재하지 않는 `throttleGeminiCall` 호출**: `calendar_categories.js`가 정의된 적 없는 함수를 호출해 캘린더 카테고리 생성이 항상 실패했습니다. 해당 래퍼 호출을 제거했습니다.
*   **캘린더 탭 i18n 키 누락**: 옵션 페이지 Calendar 탭에서 쓰는 13개 번역 키(`optionsMenuCalendar`, `calendarPanelDesc` 등)가 4개 언어 `messages.json`에 전혀 없어 번역 대신 키 이름이 그대로 노출되던 문제를 모든 로케일에 키를 추가해 수정했습니다.
*   **AI 라우터 성공 시 상태 저장 누락**: `ai_request_router.js`가 실패했던 키가 복구됐을 때 상태를 `"Ready"`로 되돌리는 로직이, 저장 시점에 서로 다른 두 번의 설정 조회 결과를 섞어 써서 실제로는 저장되지 않던 문제를 수정했습니다.

---

## 6. 통합 오류 수정 (AI Credential 일원화 / Calendar Router 우회 제거 / Failover 정책 정교화)

README에 "완료"라고 적혀 있던 내용을 실제 코드 기준으로 재검증하여 발견한 구조적 불일치와 런타임 결함을 수정했습니다. 상세 내역은 커밋 로그를 참고하세요.

*   **AI Credential 구조 일원화**: `popup.js`, `dashboard.js`가 여전히 구형 `ai.geminiApiKeys` / flat `geminiApiKeys` storage key를 읽고 쓰던 문제를 중앙 `ai.credentials` 구조로 통일했습니다. Popup은 이제 활성 Credential 수·Provider·모델·상태를 함께 표시합니다.
*   **Calendar Category 생성이 AI Router를 완전히 우회하던 문제 수정**: `calendar_categories.js`가 Gemini API를 직접 `fetch()`하던 코드를 제거하고, Gmail 분류와 동일하게 `AIRequestRouter.generateStructured()`를 통해 Provider/모델 선택·재시도·Failover·Quota 정책을 공유하도록 했습니다. AI가 생성한 카테고리는 저장 전 스키마/허용 색상 검증을 거칩니다.
*   **Failover 정책이 실제로 반영되지 않던 문제 수정**: `ai.requestPolicy`의 `retryEnabled`/`failoverEnabled`/`quotaAware`가 라우터 동작에 반영되지 않던 것을 고쳤습니다. Rate Limit은 이제 무조건 다음 키로 넘어가지 않고 우선 Retry-After만큼 대기 후 재시도하며, Credential별 재시도 횟수가 다음 Credential에 누적되지 않습니다.
*   **오류 분류 정교화**: HTTP 429/400을 무조건 quota/API Key 오류로 단정하던 로직을 응답 본문의 명시적 신호를 우선 확인하도록 바꾸고, 400은 `invalid_request`로 분리해 정상 Credential이 잘못 비활성화되지 않게 했습니다.
*   **Provider별 Structured Output 형식 차이 대응**: 저장소 전체가 공유하는 schema(Gemini 스타일 대문자 타입)를 OpenAI strict `json_schema`(표준 소문자 JSON Schema)로 자동 변환하는 정규화 로직을 추가했습니다. Anthropic 응답은 코드펜스/설명 텍스트가 섞여도 JSON을 추출할 수 있도록 파싱을 강화했습니다.
*   **Quota 상태의 서비스 워커 재시작 대응**: 메모리에만 있던 Quota/Rate-limit 상태를 `chrome.storage.local`에도 최소 정보로 백업해, 서비스 워커가 재시작되어도 이미 소진된 Credential을 곧바로 재시도하지 않도록 했습니다.
*   **Calendar Category 매칭 fallback 수정**: AI가 알 수 없는 카테고리명을 반환하면(과거엔 존재하지 않는 "기타" 카테고리를 하드코딩해서 항상 실패 처리) 이제 `unclassified`로 별도 집계하고, 존재하지 않는 카테고리를 만들어내지 않습니다. 실행 중 오류가 나도 이미 반영된 색상 변경분(부분 성공)은 그대로 결과에 남습니다.
*   **사용자 지정 캘린더 색상 보호**: 사용자가 옵션 페이지에서 카테고리 색상을 직접 바꾸면 `colorSource: "user"`로 표시되고, 이후 AI로 카테고리를 다시 생성해도 그 색상은 덮어쓰지 않습니다.
*   **Google Drive 백업/복원이 새 중앙 설정을 반영하지 않던 문제 수정**: v1/v2 시절 flat key만 백업하던 로직을 `appSettings`(ai.credentials, google.oauth 포함) 전체를 백업하도록 확장했습니다. API Key/Client Secret 등 민감 정보는 기본 백업본에서는 제거되고, "자격 증명 포함" 옵션을 켰을 때만 암호화 대상에 포함됩니다.
*   **문구 수정**: 언어 선택 드롭다운에서 "System Default" 항목을 제거했습니다(언어는 4개 지원 언어 중 하나로 저장되며, 마이그레이션/최초 설치 시 브라우저 언어로 자동 결정됩니다). "Client Secret (Optional)"을 "Client Secret"으로 수정했습니다.

### 알려진 제한 사항 (Known Limitations)

다음 항목은 이번 수정에서 다루지 않았으며, 실제 코드가 아직 요구사항을 완전히 만족하지 못합니다. 향후 별도 작업이 필요합니다.

*   **모델 목록 동적 조회 미구현**: `AIProviderRegistry.SUPPORTED_MODELS`는 여전히 정적 하드코딩 목록입니다. Provider별 `listModels(apiKey)` 같은 동적 조회는 구현되지 않았습니다.
*   **Gmail 분류 배치/스로틀링이 Gemini 전용 상수에 고정**: `background.js`의 `GEMINI_RPM_LIMIT` 등은 여전히 전역 상수로 배치 크기와 호출 간격을 계산합니다. 여러 Provider별로 다른 rate limit을 반영하려면 이 계산을 Provider metadata 기반으로 재설계해야 하는데, 기존 Gmail 자동 분류 동작을 깨뜨릴 위험이 커서 이번 작업 범위에서 제외했습니다.
*   **Side Panel 자동 활성화/비활성화 로직 미검증**: Gmail 탭 감지, SPA 라우팅 대응, `chrome.sidePanel` API 제약 준수 여부는 이번에 별도로 검토하지 않았습니다.
*   **Calendar PATCH 동시성/백오프 미구현**: 이벤트별 색상 PATCH는 여전히 순차 처리이며, 429/5xx에 대한 재시도·동시성 제한은 추가하지 않았습니다.
*   **Options 섹션별 오류 격리(safeInit) 미구현**: 특정 탭 초기화 중 예외가 나면 이후 탭 초기화가 중단될 수 있는 구조가 그대로 남아 있습니다.
*   **API Key 저장 시 암호화 미적용**: `ai.credentials[].apiKey`는 여전히 평문으로 `chrome.storage.local`에 저장됩니다.
*   **실제 Chrome 수동 테스트 미실행**: 이 저장소는 정적 코드 검증(`node --check`, i18n 키 대조)만 수행했으며, 실제 Chrome에 로드해 Settings/AI/Calendar/Side Panel/Popup 전체 시나리오를 수동으로 확인하지 못했습니다. 배포 전 최소한 아래 절차로 수동 검증이 필요합니다: Options의 모든 탭 클릭, 4개 언어 전환, Gemini/OpenAI/Anthropic 각각 키 등록 후 분류 1회 실행, 우선순위 다른 Credential 2개로 Failover 확인, Calendar Category 생성 및 색상 적용, Popup 상태 표시 확인.

---

## 7. 정적 수정 2차 (실제 Chrome 없이 코드로 검증 가능한 구조적 결함 제거)

실제 Chrome/Gmail 접속 없이 코드만으로 검증 가능한 범위에서 추가로 발견한 결함을 수정했습니다.

*   **Router retry 소진 후 failover 실패**: `AIRequestRouter`가 재시도 횟수를 다 쓴 뒤에도(rate_limit/server_error가 "retry" 판정이었다는 이유로) 다음 Credential로 넘어가지 않고 전체 작업을 종료하던 버그를 수정했습니다. 이제 Credential 하나당 `1 + maxRetries`번 시도한 뒤, `failoverEnabled` 정책에 따라 다음 Credential로 넘어가거나 즉시 종료합니다.
*   **AIQuotaManager 초기화 race**: 서비스 워커가 막 재시작된 직후 quota 상태 복원(`chrome.storage.local` 읽기)이 끝나기 전에 `isAvailable()`이 판단을 내릴 수 있던 문제를 수정했습니다. `isAvailable()`을 async로 바꾸고, `AIRequestRouter`가 매 요청 시작 시 `AIQuotaManager.initialize()`를 await하도록 했습니다.
*   **Migration이 존재하지 않는 모델 ID를 생성하던 문제**: v2→v3 마이그레이션이 `${providerId}-default-model` 같은 실제로 존재하지 않는 모델 ID를 만들어낼 수 있었습니다. 이제 `AIProviderRegistry`에 등록된 실제 모델 중에서만 fallback을 선택하고, 유효한 모델이 없으면 `model: null, modelNeedsSelection: true`로 표시합니다. `AIKeyManager.getActiveCredentials()`는 모델이 정해지지 않은 Credential을 활성 목록에서 제외합니다.
*   **Provider 간 schema 표기 불일치**: 저장소 전체가 공유하는 schema가 Gemini 스타일(대문자 "OBJECT"/"STRING")과 표준 JSON Schema(소문자)가 혼용되고 있었습니다. Google Provider가 어떤 표기로 들어와도 대문자로 정규화해 보내도록 수정했습니다(OpenAI 쪽 소문자 정규화는 1차 수정에서 이미 반영).
*   **Options 왼쪽 Navigation 및 각 탭 제목의 i18n 누락**: 왼쪽 메뉴 9개 항목과 Connections/Gmail/Automation/Notifications/Data/Advanced 탭의 카드 제목 다수가 `data-i18n` 없이 영어로 하드코딩되어 있었습니다. 해당 요소에 `data-i18n`을 추가하고 4개 언어 메시지를 채웠습니다. (각 탭 내부의 세부 label/버튼/placeholder 전체를 훑는 완전한 감사는 범위가 커서 이번 라운드에는 다 담지 못했습니다 - 아래 "알려진 제한 사항" 참고)
*   **죽은 코드 정리**: 실제로는 아무 곳에서도 참조되지 않던 `GEMINI_MODEL`, `lastGeminiCallAt`, `currentCallIntervalMs`, `MAX_CALL_INTERVAL_MS`, `INTERVAL_BACKOFF_MULTIPLIER`, `INTERVAL_RECOVERY_MULTIPLIER`, `DAILY_QUOTA_TEXT_PATTERN`, `GEMINI_REQUEST_TIMEOUT_MS`와, 실제로는 존재하지 않는 함수를 가리키던 `throttleGeminiCall()` 주석을 제거했습니다. `callGeminiForJson`은 이미 `AIRequestRouter` wrapper였으므로 `callAiForJson`으로 이름만 정리했습니다.
*   **Credential Test 구조 확인**: 옵션 페이지의 "Test Connection"은 이미 저장 전 form 값으로 Provider를 직접 검증하는 구조였고(Router/Quota를 거치지 않음) 별도 수정이 필요하지 않았습니다.

### 알려진 제한 사항 (2차, MANUAL/E2E REQUIRED 포함)

*   **Dynamic Model Discovery 미구현**: `AIProviderRegistry.SUPPORTED_MODELS`는 여전히 정적 목록입니다. Provider별 `discoverModels(credential)` API 조회, 모델 캐시(TTL), loading/empty/error 상태 UI는 구현하지 않았습니다.
*   **Options i18n 완전 감사 미완료**: 왼쪽 Navigation과 각 탭의 주요 제목은 번역되지만, 세부 label/버튼/placeholder 전체를 훑는 완전한 감사는 하지 않았습니다.
*   **AI Provider fetch에 timeout 없음**: `google_provider.js`/`openai_provider.js`/`anthropic_provider.js`의 `fetch()` 호출에는 명시적 timeout/AbortController가 없어, 네트워크가 응답을 주지 않으면 요청이 무기한 대기할 수 있습니다.
*   **Gmail 분류 배치/스로틀링이 Gemini 전용 상수에 고정** (1차와 동일 - 미해결).
*   **MANUAL/E2E REQUIRED**: 실제 Gmail 접속·OAuth 로그인/해제·Side Panel 자동 열림/닫힘·실제 Gemini/OpenAI/Anthropic API 호출·실제 model discovery·실제 quota/Retry-After 응답은 이 환경에서 검증하지 못했습니다.

---

## 향후 작업 (Next Steps)

현재 백엔드 및 핵심 인프라 공사는 성공적으로 완료되었으며, 향후 다음과 같은 기능들을 추가로 작업할 수 있는 기반이 마련되어 있습니다.

1.  **데이터 백업/복원 기능 완성**: 설정된 JSON 데이터를 Google Drive에 동기화(Sync)하는 로직.
2.  **브라우저 및 Discord 알림 고도화**: 분류 및 요약 결과를 백그라운드에서 Discord 웹훅이나 Chrome 기본 알림으로 전송하는 로직 연결.
3.  **이메일 내용 요약 (Auto-Summary) 자동화 로직**: 새로 수신된 중요 이메일에 대한 백그라운드 요약 및 알림 엔진 구축.
