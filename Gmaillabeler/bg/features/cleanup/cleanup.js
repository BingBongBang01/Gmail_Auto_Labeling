// bg/features/cleanup/cleanup.js
// 받은편지함 정리: 조건에 맞는 메일을 찾아 보여주고(미리보기), 사용자가 고른 것만 처리한다.
//
// 이 기능은 메일을 옮긴다. 그래서 규칙 하나를 정해두고 지킨다:
//   **먼저 보여주고, 사용자가 고른 것만 건드리고, 되돌릴 수 있게 남긴다.**
// 조건만 받아서 바로 실행하는 경로는 아예 만들지 않는다. 잘못 눌러서 수백 통이 사라지는
// 사고는 "확인 다이얼로그 하나"로 막을 수 있는 종류가 아니다.
//
// 영구 삭제는 하지 않는다(할 수도 없다). gmail.modify 권한으로는 휴지통까지만 갈 수 있고,
// 그게 이 기능에 필요한 최대치다 - 휴지통은 사용자가 Gmail에서 30일 안에 되살릴 수 있다.

import { isCancelled } from "../../core/cancellation.js";
import { addLog } from "../../core/logger.js";
import { mapWithConcurrency } from "../../core/util.js";
import { GMAIL_FETCH_CONCURRENCY } from "../../domain/limits.js";
import { buildEmailContentUrl, gmailFetch, listMessagesPaged } from "../../platform/gmail_api.js";
import { batchModifyLabels } from "../../platform/gmail_labels.js";

// 조건에 맞는지 세는 상한. 한 페이지(500)로 끝나므로 요청 한 번이다.
const SCAN_LIMIT = 500;
// 미리보기로 제목까지 받아올 개수. 이 수만큼 Gmail 상세 조회가 일어난다.
const PREVIEW_LIMIT = 60;
// 휴지통/복원은 메일 하나당 요청 하나다(batchModify로 TRASH를 다루는 것은 문서상 보장되지 않는다).
// 그래서 한 번에 처리할 수 있는 양을 따로 제한한다.
const TRASH_LIMIT = 200;
// 되돌리기용으로 기억할 최대 개수.
const UNDO_LIMIT = 1000;

const UNDO_KEY = "cleanupUndo";

// ---------------------------------------------------------------------------
// 규칙 -> Gmail 검색 질의
// ---------------------------------------------------------------------------
// 직접 필터링하지 않고 Gmail 검색에 맡긴다. 수천 통을 확장으로 끌어와 걸러내면
// 요청 수와 시간이 폭발하는데, 같은 판정을 서버가 이미 해준다.
const RULES = {
  read_old: {
    label: "읽은 지 오래된 메일",
    build: (o) => `in:inbox is:read older_than:${o.olderThanDays}d`,
  },
  promotions: { label: "프로모션", build: () => "in:inbox category:promotions" },
  social: { label: "소셜", build: () => "in:inbox category:social" },
  updates: { label: "알림·업데이트", build: () => "in:inbox category:updates" },
  large: {
    label: "큰 첨부파일",
    build: (o) => `has:attachment larger:${o.largerThanMb}M`,
  },
  sender: {
    label: "특정 발신자",
    build: (o) => `from:(${o.sender})`,
    needs: (o) => !!String(o.sender || "").trim(),
  },
  label: {
    label: "특정 라벨",
    build: (o) => `label:"${o.labelName}"`,
    needs: (o) => !!String(o.labelName || "").trim(),
  },
};

// `Number(x) || 기본값` 꼴을 쓰지 않는다. 0이 falsy라서 사용자가 0을 입력하면
// 최솟값이 아니라 기본값으로 튀어버린다("0MB 이상"이라고 적었는데 5MB가 되는 식).
// 빈 칸/문자쓰레기는 기본값으로, 범위를 벗어난 숫자는 경계값으로 각각 다르게 다룬다.
function clampNumber(value, min, max, fallback) {
  if (value === "" || value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeOptions(raw = {}) {
  const rules = (Array.isArray(raw.rules) ? raw.rules : []).filter((r) => RULES[r]);
  return {
    rules,
    olderThanDays: clampNumber(raw.olderThanDays, 1, 3650, 30),
    largerThanMb: clampNumber(raw.largerThanMb, 1, 100, 5),
    sender: String(raw.sender || "").trim().slice(0, 200),
    labelName: String(raw.labelName || "").trim().slice(0, 200),
    // 별표·중요 표시는 사용자가 "이건 남겨둔다"고 직접 표시한 것이다. 기본으로 제외한다.
    protectStarred: raw.protectStarred !== false,
    action: ["archive", "trash", "label"].includes(raw.action) ? raw.action : "archive",
    targetLabel: String(raw.targetLabel || "").trim().slice(0, 200),
  };
}

/**
 * 선택한 규칙들을 하나의 Gmail 질의로 합친다.
 * 규칙끼리는 OR(하나라도 맞으면 대상), 보호 조건은 AND로 바깥에 붙인다.
 */
function buildQuery(options) {
  const parts = [];
  for (const key of options.rules) {
    const rule = RULES[key];
    if (rule.needs && !rule.needs(options)) continue;
    parts.push(`(${rule.build(options)})`);
  }
  if (!parts.length) return "";

  let query = parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
  if (options.protectStarred) query += " -is:starred -is:important";
  return query;
}

function headerValue(headers, name) {
  const found = (headers || []).find((h) => String(h.name || "").toLowerCase() === name.toLowerCase());
  return (found && found.value) || "";
}

// 미리보기용 한 줄. 본문은 받지 않는다(format=metadata) - 제목·발신자·날짜·크기면 판단할 수 있고,
// 60통의 본문을 받아오면 그것만으로 몇 초가 걸린다.
async function fetchPreviewRow(messageId) {
  try {
    const response = await gmailFetch(buildEmailContentUrl(messageId, true));
    if (!response.ok) return null;
    const data = await response.json();
    const headers = data.payload?.headers || [];
    return {
      id: messageId,
      subject: headerValue(headers, "Subject").slice(0, 140) || "(제목 없음)",
      from: headerValue(headers, "From").slice(0, 120),
      date: Date.parse(headerValue(headers, "Date")) || Number(data.internalDate) || 0,
      sizeEstimate: Number(data.sizeEstimate) || 0,
      unread: (data.labelIds || []).includes("UNREAD"),
      starred: (data.labelIds || []).includes("STARRED"),
    };
  } catch (e) {
    return null; // 그 사이 삭제된 메일 등 - 미리보기에서 빠지는 것으로 충분하다
  }
}

/** 조건에 맞는 메일을 찾아 앞쪽 일부의 제목까지 함께 돌려준다. 아무것도 바꾸지 않는다. */
async function previewCleanup(rawOptions) {
  const options = normalizeOptions(rawOptions);
  const query = buildQuery(options);
  if (!query) {
    return { ok: false, error: "정리 조건을 하나 이상 선택하세요." };
  }

  const messages = await listMessagesPaged({ q: query }, SCAN_LIMIT, "errMessageListFailed");
  const ids = messages.map((m) => m.id);
  if (!ids.length) {
    return { ok: true, query, total: 0, scanLimit: SCAN_LIMIT, previewLimit: PREVIEW_LIMIT, items: [] };
  }

  const previewIds = ids.slice(0, PREVIEW_LIMIT);
  const rows = await mapWithConcurrency(previewIds, GMAIL_FETCH_CONCURRENCY, (id) => fetchPreviewRow(id));
  const items = rows.filter(Boolean).sort((a, b) => (a.date || 0) - (b.date || 0));

  await addLog(`[정리] 미리보기: 조건에 맞는 메일 ${ids.length}${ids.length >= SCAN_LIMIT ? "+" : ""}통`);

  return {
    ok: true,
    query,
    total: ids.length,
    scanned: ids.length,
    scanLimit: SCAN_LIMIT,
    previewLimit: PREVIEW_LIMIT,
    trashLimit: TRASH_LIMIT,
    // 전체 처리를 고를 수 있게 id 목록도 함께 준다. 화면은 이 목록을 보관만 하고,
    // 무엇을 처리할지는 사용자가 누른 버튼이 정한다.
    allIds: ids,
    items,
  };
}

// ---------------------------------------------------------------------------
// 적용
// ---------------------------------------------------------------------------

async function trashEach(ids, path) {
  let done = 0;
  const failures = [];
  await mapWithConcurrency(ids, GMAIL_FETCH_CONCURRENCY, async (id) => {
    if (isCancelled()) return;
    try {
      const response = await gmailFetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}/${path}`,
        { method: "POST" }
      );
      if (response.ok) done += 1;
      else failures.push(`${id}: HTTP ${response.status}`);
    } catch (e) {
      failures.push(`${id}: ${String((e && e.message) || e)}`);
    }
  });
  return { done, failures };
}

/**
 * 사용자가 고른 id에만 적용한다. 조건을 다시 검색하지 않는다 -
 * 미리보기와 적용 사이에 새 메일이 들어와 대상이 달라지는 일이 없어야 한다.
 */
async function applyCleanup({ ids, action, targetLabelId }) {
  const targets = [...new Set((ids || []).filter((id) => typeof id === "string" && id))];
  if (!targets.length) return { ok: false, error: "처리할 메일을 선택하세요." };

  const mode = ["archive", "trash", "label"].includes(action) ? action : "archive";
  if (mode === "label" && !targetLabelId) {
    return { ok: false, error: "붙일 라벨을 먼저 고르세요." };
  }
  if (mode === "trash" && targets.length > TRASH_LIMIT) {
    return {
      ok: false,
      error: `휴지통 이동은 한 번에 ${TRASH_LIMIT}통까지만 할 수 있습니다(메일당 요청이 하나씩 필요합니다). ${targets.length}통을 고르셨습니다.`,
    };
  }

  let processed = 0;
  let failures = [];

  if (mode === "trash") {
    const result = await trashEach(targets, "trash");
    processed = result.done;
    failures = result.failures;
  } else {
    // batchModify는 1000개씩 받는다. 부분 실패를 알려주지 않으므로(전체 성공 아니면 전체 실패)
    // 묶음 단위로 성공을 센다.
    const add = mode === "label" ? [targetLabelId] : [];
    const remove = mode === "archive" ? ["INBOX"] : [];
    for (let i = 0; i < targets.length; i += 1000) {
      const chunk = targets.slice(i, i + 1000);
      try {
        await batchModifyLabels(chunk, add, remove);
        processed += chunk.length;
      } catch (e) {
        failures.push(`${chunk.length}통 묶음 실패: ${String((e && e.message) || e)}`);
      }
    }
  }

  // 되돌리기 정보는 실제로 처리된 것에 대해서만 남긴다.
  if (processed > 0) {
    await chrome.storage.local.set({
      [UNDO_KEY]: {
        action: mode,
        targetLabelId: mode === "label" ? targetLabelId : null,
        ids: targets.slice(0, UNDO_LIMIT),
        count: processed,
        at: Date.now(),
      },
    });
  }

  const actionLabel = mode === "archive" ? "보관" : mode === "trash" ? "휴지통 이동" : "라벨 지정";
  await addLog(
    `[정리] ${actionLabel} ${processed}통${failures.length ? ` (실패 ${failures.length}건)` : ""}`,
    failures.length ? "warn" : "info"
  );

  return { ok: true, processed, action: mode, failures: failures.slice(0, 5), undoable: processed > 0 };
}

// ---------------------------------------------------------------------------
// 되돌리기
// ---------------------------------------------------------------------------
// 되돌릴 수 있는 이유: 여기서 하는 일은 전부 역연산이 있는 것뿐이다.
//   보관   -> INBOX 라벨을 뗐다  -> 다시 붙이면 원래대로
//   휴지통 -> trash              -> untrash
//   라벨   -> 라벨을 붙였다      -> 떼면 원래대로
// 영구 삭제를 하지 않는 진짜 이유가 이것이다. 되돌릴 수 없는 일은 하지 않는다.

async function getUndoInfo() {
  const stored = await chrome.storage.local.get([UNDO_KEY]);
  const undo = stored[UNDO_KEY];
  if (!undo || !undo.ids || !undo.ids.length) return { ok: true, undo: null };
  return {
    ok: true,
    undo: { action: undo.action, count: undo.count || undo.ids.length, at: undo.at || 0 },
  };
}

async function undoCleanup() {
  const stored = await chrome.storage.local.get([UNDO_KEY]);
  const undo = stored[UNDO_KEY];
  if (!undo || !undo.ids || !undo.ids.length) {
    return { ok: false, error: "되돌릴 정리 작업이 없습니다." };
  }

  let restored = 0;
  const failures = [];

  if (undo.action === "trash") {
    const result = await trashEach(undo.ids, "untrash");
    restored = result.done;
    failures.push(...result.failures);
  } else {
    const add = undo.action === "archive" ? ["INBOX"] : [];
    const remove = undo.action === "label" && undo.targetLabelId ? [undo.targetLabelId] : [];
    for (let i = 0; i < undo.ids.length; i += 1000) {
      const chunk = undo.ids.slice(i, i + 1000);
      try {
        await batchModifyLabels(chunk, add, remove);
        restored += chunk.length;
      } catch (e) {
        failures.push(String((e && e.message) || e));
      }
    }
  }

  // 한 번 되돌리면 기록을 지운다. 같은 되돌리기를 두 번 실행해도 의미는 없지만,
  // 남겨두면 "되돌리기" 버튼이 계속 보여서 이미 되돌렸는지 알 수 없다.
  if (restored > 0) await chrome.storage.local.remove([UNDO_KEY]);

  await addLog(`[정리] 되돌리기: ${restored}통 복원${failures.length ? ` (실패 ${failures.length}건)` : ""}`);
  return { ok: true, restored, failures: failures.slice(0, 5) };
}

export {
  PREVIEW_LIMIT,
  clampNumber,
  RULES,
  SCAN_LIMIT,
  TRASH_LIMIT,
  applyCleanup,
  buildQuery,
  getUndoInfo,
  normalizeOptions,
  previewCleanup,
  undoCleanup,
};
