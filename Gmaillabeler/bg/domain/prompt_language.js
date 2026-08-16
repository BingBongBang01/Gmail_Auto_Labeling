// bg/domain/prompt_language.js
// ---------------- AI 프롬프트 언어 처리 ----------------
// 분류·요약·기준 분석·학습이 모두 같은 "답변 언어" 규칙을 쓴다.
// 예전에는 이 데이터가 분류 코드 안에 있어서 요약과 학습이 분류 파일을 import 해야 했다.
// 기능끼리 엮이지 않도록 공유 도메인 데이터로 분리한다.

const LANGUAGE_NAME_BY_LOCALE = { ko: "한국어", en: "English", ja: "日本語", zh_CN: "简体中文" };

export { LANGUAGE_NAME_BY_LOCALE };
