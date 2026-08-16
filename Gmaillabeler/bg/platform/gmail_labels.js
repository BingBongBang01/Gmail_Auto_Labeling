// bg/platform/gmail_labels.js
// 라벨 캐시와 라벨 적용 규칙. 우리가 관리하는 라벨은 서로 배타적이라
// 새 라벨을 붙일 때 같은 계열의 기존 라벨을 떼는 처리가 여기 들어 있다.

import { addLog } from "../core/logger.js";
import { getCategoryDefinitions, getCategoryNames, getGmailLabelColor, getLocalizedDefaultCategoryDefs, saveCategoryDefinitions } from "../domain/categories.js";
import { hasUsableAiCredential } from "./ai_gateway.js";
import { gmailFetch } from "./gmail_api.js";
import { getValidAccessToken } from "./google_oauth.js";
import { t } from "../../i18n.js";

function normalizeLabelName(name) {
  return String(name).trim().replace(/\s+/g, "").toLowerCase();
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

// "부모/자식" 형태로 존재하는 Gmail 라벨에서 자식 부분의 이름만 모아준다.
// 부모 라벨을 이름 변경/삭제할 때 그 아래 하위 라벨까지 함께 처리하기 위해 쓴다.
// 호출부는 반환된 각 값을 `${parent}/${child}`로 다시 조립해 라벨 ID를 찾으므로,
// 2단 이상 깊은 라벨(parent/a/b)도 "a/b" 형태로 그대로 돌려주면 된다.
function getSubLabelCandidates(parentName, labelCache) {
  if (!labelCache || !labelCache.exact) return [];
  const prefix = `${parentName}/`;
  const children = new Set();
  for (const name of labelCache.exact.keys()) {
    if (typeof name !== "string" || !name.startsWith(prefix)) continue;
    const child = name.slice(prefix.length);
    if (child) children.add(child);
  }
  return Array.from(children);
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
  if (!(await hasUsableAiCredential())) {
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

// (예전에는 여기서 lastGeminiCallAt/currentCallIntervalMs로 호출 간 간격을 직접 조절하는
// 선제적 스로틀을 구현했으나, 실제로는 어디서도 참조되지 않는 죽은 코드였다. Rate limit 대응은
// 이제 AIRequestRouter -> AIFailoverManager -> AIQuotaManager가 오류 발생 시 반응적으로 처리한다.)


export {
  MAX_AI_DATA_FOR_CONTENT_SCRIPT,
  SEEN_LABEL_NAMES_KEY,
  applyLabelExclusive,
  batchModifyLabels,
  collectManagedLabelIds,
  computeExclusiveRemovals,
  fetchLabelCache,
  getOrCreateLabelId,
  getSeenGmailLabelNames,
  getSubLabelCandidates,
  initGeminiAndGmailContext,
  initGmailOnlyContext,
  normalizeLabelName,
  pruneDeletedTopLevelLabels,
  renameInLabelCache,
  saveSeenGmailLabelNames,
  syncNewTopLevelLabels,
  trimAiDataForContentScript,
};
