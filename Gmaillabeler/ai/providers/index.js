// ai/providers/index.js
// 공급자 어댑터는 로드되는 순간 AIProviderRegistry.register()로 자기 자신을 등록한다.
// ES 모듈에서는 아무도 import 하지 않은 파일이 실행되지 않으므로, "등록되어야 하는 공급자"
// 목록은 여기 한 곳에 모은다. 공급자를 추가/제거할 때 손댈 곳은 이 파일뿐이다.
//
// 라우터나 옵션 화면처럼 실제 공급자 인스턴스가 필요한 쪽은 ai_provider_registry.js가 아니라
// 이 파일을 import 해야 한다. 레지스트리만 import 하면 클래스 정의가 로드되지 않아
// getProvider()가 항상 undefined를 돌려준다.

import "./google_provider.js";
import "./openai_provider.js";
import "./anthropic_provider.js";

export { GoogleProvider } from "./google_provider.js";
export { OpenAIProvider } from "./openai_provider.js";
export { AnthropicProvider } from "./anthropic_provider.js";
