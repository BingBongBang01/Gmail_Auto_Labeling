// shared/glossary_store.js
// 용어집 프로필 저장소. 사이드패널(편집)과 서비스워커(번역 시 읽기)가 함께 쓰기 때문에
// shared/ 에 둔다(shared/pdf_db.js와 같은 이유).
//
// IndexedDB가 아니라 chrome.storage.local을 쓴다. 용어집은 수백 줄짜리 텍스트라
// 통째로 읽고 통째로 쓰는 게 자연스럽고, 두 컨텍스트에서 동시에 편집될 일이 없다.
//
// 프로필을 나누는 이유: 같은 사용자라도 기술문서와 계약서의 용어 규칙이 다르다.
// 하나로 합치면 "이 문서에는 해당 없는 규칙"이 프롬프트에 계속 실려 토큰만 쓴다.

import { parseGlossaryText, renderGlossaryForPrompt } from "../pdf/text/glossary.js";

const STORAGE_KEY = "pdfGlossaries";
const MAX_PROFILES = 20;
const MAX_TEXT_CHARS = 40000;

function newProfileId() {
  return `gl-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function emptyState() {
  return { profiles: [], activeId: "" };
}

async function loadGlossaries() {
  const stored = await chrome.storage.local.get([STORAGE_KEY]);
  const raw = stored[STORAGE_KEY];
  if (!raw || !Array.isArray(raw.profiles)) return emptyState();

  const profiles = raw.profiles
    .filter((p) => p && typeof p.id === "string")
    .slice(0, MAX_PROFILES)
    .map((p) => ({
      id: p.id,
      name: String(p.name || "이름 없는 용어집").slice(0, 60),
      text: String(p.text || "").slice(0, MAX_TEXT_CHARS),
      updatedAt: Number(p.updatedAt) || 0,
    }));

  // 지워진 프로필을 계속 가리키고 있으면 활성 표시를 비운다.
  const activeId = profiles.some((p) => p.id === raw.activeId) ? raw.activeId : "";
  return { profiles, activeId };
}

async function saveGlossaries(state) {
  const safe = {
    profiles: (state.profiles || []).slice(0, MAX_PROFILES).map((p) => ({
      id: p.id,
      name: String(p.name || "").slice(0, 60),
      text: String(p.text || "").slice(0, MAX_TEXT_CHARS),
      updatedAt: Number(p.updatedAt) || Date.now(),
    })),
    activeId: state.activeId || "",
  };
  await chrome.storage.local.set({ [STORAGE_KEY]: safe });
  return safe;
}

/**
 * 번역 실행 시점에 프로필을 프롬프트용 문자열로 바꾼다.
 *
 * 주의: 이 문자열은 번역 캐시 키에 들어간다(pdf/text/cache_key.js).
 * 용어집을 고치면 다음 실행에서 그 조건의 문단이 전부 다시 번역된다 - 의도된 동작이다.
 * 용어가 바뀌었는데 옛 번역문을 캐시에서 꺼내 쓰면 용어집을 고친 의미가 없다.
 */
async function resolveGlossaryText(profileId) {
  if (!profileId) return "";
  const { profiles } = await loadGlossaries();
  const profile = profiles.find((p) => p.id === profileId);
  if (!profile) return "";
  return renderGlossaryForPrompt(parseGlossaryText(profile.text).entries);
}

export {
  MAX_PROFILES,
  MAX_TEXT_CHARS,
  STORAGE_KEY,
  loadGlossaries,
  newProfileId,
  resolveGlossaryText,
  saveGlossaries,
};
