// sidepanel/workspaces/cleanup.js
// '메일정리' 화면. 조건 고르기 → 미리보기 → 고른 것만 적용 → 되돌리기.
//
// 이 화면의 설계 원칙은 하나다: **바꾸기 전에 보여준다.**
// 예전 타일은 command:"job", arg:"gmail_clean"이었는데 그런 잡은 등록된 적이 없었다.
// 잡으로 되살리지 않고 화면으로 만든 이유가 여기 있다 - 무엇을 지울지 고르지 않고
// 클릭 한 번으로 수백 통을 옮기는 버튼은, 되돌리기가 있어도 만들면 안 된다.
//
// 체크박스는 기본으로 전부 켜져 있다. 사용자가 "이건 남긴다"를 빼는 방향이 자연스럽고,
// 하나씩 켜게 하면 60개를 누르게 된다.

import { $, escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, statRow, emptyState, badge, formatWhen, ask } from "./shell.js";

const RULE_CHIPS = [
  { id: "read_old", label: "읽은 지 오래됨", hint: "일수는 아래에서" },
  { id: "promotions", label: "프로모션" },
  { id: "social", label: "소셜" },
  { id: "updates", label: "알림·업데이트" },
  { id: "large", label: "큰 첨부" },
  { id: "sender", label: "특정 발신자" },
  { id: "label", label: "특정 라벨" },
];

const ACTION_LABEL = { archive: "보관", trash: "휴지통으로", label: "라벨만 지정" };

// 화면을 다시 그려도 사용자가 고른 조건은 유지한다. 미리보기를 한 번 돌린 뒤
// 조건을 조금 바꿔 다시 보는 흐름이 흔하다.
let state = {
  rules: ["promotions"],
  olderThanDays: 30,
  largerThanMb: 5,
  sender: "",
  labelName: "",
  protectStarred: true,
  action: "archive",
  targetLabelId: "",
};
let preview = null; // { total, items, allIds, ... }
let excluded = new Set(); // 사용자가 체크를 푼 id
let confirmingAll = false; // "전체 처리" 두 번 누르기 확인 상태
let labelOptions = [];

function renderCleanupWorkspace() {
  const wrap = openWorkspace({
    service: "Gmail",
    title: "메일 정리",
    desc: "조건에 맞는 메일을 먼저 보여주고, 고른 것만 처리합니다.",
  });
  if (!wrap) return;

  renderConditions(wrap);
  renderPreviewSection(wrap);
  renderUndoSection(wrap);
}

// ---------------------------------------------------------------------------
// ② 대상 + ③ 옵션
// ---------------------------------------------------------------------------

function renderConditions(wrap) {
  const body = section(wrap, { title: "🧹 정리 조건", hint: "여러 개를 고르면 하나라도 맞는 메일" });

  const chips = document.createElement("div");
  chips.className = "clean-chips";
  for (const chip of RULE_CHIPS) {
    const btn = document.createElement("button");
    btn.className = "clean-chip" + (state.rules.includes(chip.id) ? " is-on" : "");
    btn.textContent = chip.label;
    btn.title = chip.hint || chip.label;
    btn.addEventListener("click", () => {
      state.rules = state.rules.includes(chip.id)
        ? state.rules.filter((r) => r !== chip.id)
        : [...state.rules, chip.id];
      // 조건이 바뀌면 이전 미리보기는 더 이상 그 조건의 결과가 아니다. 버린다.
      preview = null;
      confirmingAll = false;
      renderCleanupWorkspace();
    });
    chips.appendChild(btn);
  }
  body.appendChild(chips);

  // 규칙에 딸린 값은 그 규칙을 골랐을 때만 보여준다. 항상 다 보여주면 무엇이
  // 지금 조건에 영향을 주는지 알 수 없다.
  const detail = document.createElement("div");
  detail.className = "pdf-field-grid";
  if (state.rules.includes("read_old")) {
    detail.appendChild(numberField("며칠 지난 메일", "cleanDays", state.olderThanDays, 1, 3650, (v) => (state.olderThanDays = v)));
  }
  if (state.rules.includes("large")) {
    detail.appendChild(numberField("첨부 크기(MB) 이상", "cleanMb", state.largerThanMb, 1, 100, (v) => (state.largerThanMb = v)));
  }
  if (detail.children.length) body.appendChild(detail);

  if (state.rules.includes("sender")) {
    body.appendChild(textField("발신자", "cleanSender", state.sender, "예: news@example.com", (v) => (state.sender = v)));
  }
  if (state.rules.includes("label")) {
    body.appendChild(textField("라벨 이름", "cleanLabelName", state.labelName, "예: 광고", (v) => (state.labelName = v)));
  }

  const protect = document.createElement("label");
  protect.className = "checkbox-label";
  protect.innerHTML = `<input type="checkbox" id="cleanProtect" ${state.protectStarred ? "checked" : ""}>
    <span>별표·중요 표시된 메일은 건드리지 않기</span>`;
  protect.querySelector("input").addEventListener("change", (e) => {
    state.protectStarred = e.currentTarget.checked;
    preview = null;
    renderCleanupWorkspace();
  });
  body.appendChild(protect);

  // 처리 방식
  const actionField = document.createElement("div");
  actionField.className = "pdf-field";
  actionField.innerHTML = `
    <label class="pdf-field-label" for="cleanAction">처리 방식</label>
    <select class="settings-select-compact" id="cleanAction">
      <option value="archive">보관 (받은편지함에서만 내림)</option>
      <option value="trash">휴지통으로 (30일 뒤 자동 삭제)</option>
      <option value="label">라벨만 지정 (옮기지 않음)</option>
    </select>
  `;
  const actionSelect = actionField.querySelector("select");
  actionSelect.value = state.action;
  actionSelect.addEventListener("change", () => {
    state.action = actionSelect.value;
    confirmingAll = false;
    renderCleanupWorkspace();
  });
  body.appendChild(actionField);

  if (state.action === "label") body.appendChild(labelPicker());

  const runRow = document.createElement("div");
  runRow.className = "ws-btn-row";
  const previewBtn = document.createElement("button");
  previewBtn.className = "btn btn-primary";
  previewBtn.id = "cleanPreviewBtn";
  previewBtn.textContent = "미리보기";
  previewBtn.disabled = !state.rules.length;
  previewBtn.addEventListener("click", () => runPreview(previewBtn));
  runRow.appendChild(previewBtn);
  body.appendChild(runRow);
}

function numberField(label, id, value, min, max, onChange) {
  const field = document.createElement("div");
  field.className = "pdf-field";
  field.innerHTML = `<label class="pdf-field-label" for="${id}">${escapeHtml(label)}</label>
    <input type="number" class="pdf-input" id="${id}" min="${min}" max="${max}" value="${value}">`;
  field.querySelector("input").addEventListener("change", (e) => {
    const v = Math.max(min, Math.min(max, Number(e.currentTarget.value) || min));
    e.currentTarget.value = v;
    onChange(v);
    preview = null;
  });
  return field;
}

function textField(label, id, value, placeholder, onChange) {
  const field = document.createElement("div");
  field.className = "pdf-field";
  field.innerHTML = `<label class="pdf-field-label" for="${id}">${escapeHtml(label)}</label>
    <input type="text" class="pdf-input" id="${id}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}">`;
  field.querySelector("input").addEventListener("input", (e) => {
    onChange(e.currentTarget.value);
    preview = null;
  });
  return field;
}

function labelPicker() {
  const field = document.createElement("div");
  field.className = "pdf-field";
  field.innerHTML = `<label class="pdf-field-label" for="cleanTargetLabel">붙일 라벨</label>
    <select class="settings-select-compact" id="cleanTargetLabel">
      <option value="">불러오는 중...</option>
    </select>`;
  const select = field.querySelector("select");

  const fill = () => {
    select.innerHTML =
      `<option value="">라벨을 고르세요</option>` +
      labelOptions.map((l) => `<option value="${escapeHtml(l.id)}">${escapeHtml(l.name)}</option>`).join("");
    select.value = state.targetLabelId;
  };

  if (labelOptions.length) fill();
  else {
    ask({ action: "cleanup.listLabels" }).then((res) => {
      labelOptions = (res.ok && res.labels) || [];
      if (!labelOptions.length) {
        select.innerHTML = `<option value="">${escapeHtml(res.error || "라벨을 불러오지 못했습니다")}</option>`;
        return;
      }
      fill();
    });
  }

  select.addEventListener("change", () => {
    state.targetLabelId = select.value;
  });
  return field;
}

// ---------------------------------------------------------------------------
// ④ 미리보기 + ⑤ 적용
// ---------------------------------------------------------------------------

async function runPreview(btn) {
  btn.disabled = true;
  btn.textContent = "찾는 중...";
  const res = await ask({ action: "cleanup.preview", options: { ...state } });
  btn.disabled = false;
  btn.textContent = "미리보기";

  if (!res.ok) {
    showSettingsToast(res.error || "미리보기에 실패했습니다.");
    return;
  }
  preview = res;
  excluded = new Set();
  confirmingAll = false;
  renderCleanupWorkspace();
}

function renderPreviewSection(wrap) {
  if (!preview) return;

  const kept = preview.items.filter((i) => !excluded.has(i.id));
  const body = section(wrap, {
    title: "미리보기",
    hint: `표시 ${preview.items.length} / 조건 일치 ${preview.total}${preview.total >= preview.scanLimit ? "+" : ""}`,
  });

  if (!preview.total) {
    emptyState(body, "조건에 맞는 메일이 없습니다. 조건을 바꿔 다시 시도해 보세요.");
    return;
  }

  statRow(body, [
    { label: "조건 일치", value: `${preview.total}${preview.total >= preview.scanLimit ? "+" : ""}` },
    { label: "이번에 처리", value: kept.length, tone: kept.length ? "warn" : undefined },
    { label: "제외함", value: excluded.size },
  ]);

  // 목록
  const list = document.createElement("div");
  list.className = "clean-list";
  for (const item of preview.items) {
    const row = document.createElement("label");
    row.className = "clean-row" + (excluded.has(item.id) ? " is-excluded" : "");
    row.innerHTML = `
      <input type="checkbox" ${excluded.has(item.id) ? "" : "checked"}>
      <span class="clean-row-main">
        <span class="clean-row-subject">${escapeHtml(item.subject)}</span>
        <span class="ws-hint">${escapeHtml(item.from)} · ${escapeHtml(formatWhen(item.date))}${
      item.sizeEstimate ? ` · ${Math.round(item.sizeEstimate / 1024)}KB` : ""
    }</span>
      </span>
      ${item.unread ? badge("안읽음", "info") : ""}
      ${item.starred ? badge("별표", "warn") : ""}
    `;
    row.querySelector("input").addEventListener("change", (e) => {
      if (e.currentTarget.checked) excluded.delete(item.id);
      else excluded.add(item.id);
      renderCleanupWorkspace();
    });
    list.appendChild(row);
  }
  body.appendChild(list);

  // 적용
  const actionName = ACTION_LABEL[state.action];
  const applyRow = document.createElement("div");
  applyRow.className = "ws-btn-row";

  const applyShown = document.createElement("button");
  applyShown.className = "btn btn-primary";
  applyShown.id = "cleanApplyShown";
  applyShown.textContent = `표시된 ${kept.length}통 ${actionName}`;
  applyShown.disabled = !kept.length;
  applyShown.addEventListener("click", () => runApply(kept.map((i) => i.id), applyShown));
  applyRow.appendChild(applyShown);
  body.appendChild(applyRow);

  // 표시된 것보다 더 많이 걸렸을 때만 전체 처리를 제안한다.
  // 두 번 눌러야 실행된다 - 사용자가 목록으로 확인하지 못한 분량이라 한 번 더 묻는다.
  if (preview.total > preview.items.length) {
    // 휴지통은 메일당 요청이 하나씩 필요해 상한이 있다. 확실히 실패할 버튼을 두 번 누르게
    // 하는 것은 안내가 아니라 함정이다 - 눌리지 않게 하고 왜 안 되는지 버튼에 적는다.
    const overTrashLimit = state.action === "trash" && preview.total > preview.trashLimit;

    const allRow = document.createElement("div");
    allRow.className = "ws-btn-row";
    const applyAll = document.createElement("button");
    applyAll.id = "cleanApplyAll";
    applyAll.className = confirmingAll ? "btn btn-danger" : "btn btn-small";
    applyAll.disabled = overTrashLimit;
    applyAll.textContent = overTrashLimit
      ? `전체 ${actionName}는 한 번에 ${preview.trashLimit}통까지`
      : confirmingAll
      ? `정말 ${preview.total}통을 ${actionName}? 다시 누르면 실행`
      : `조건에 맞는 ${preview.total}통 전체 ${actionName}`;
    applyAll.addEventListener("click", () => {
      if (applyAll.disabled) return;
      if (!confirmingAll) {
        confirmingAll = true;
        renderCleanupWorkspace();
        return;
      }
      // 제외한 것은 전체 처리에서도 빼준다. 목록에서 일부러 뺀 메일이
      // "전체"라는 말 때문에 다시 포함되면 사용자의 의도를 배신하는 것이다.
      runApply(preview.allIds.filter((id) => !excluded.has(id)), applyAll);
    });
    allRow.appendChild(applyAll);
    body.appendChild(allRow);

    const note = document.createElement("p");
    note.className = "ws-note";
    note.textContent = `목록에는 앞쪽 ${preview.items.length}통만 표시했습니다. 전체 처리는 확인하지 못한 메일까지 포함하므로 두 번 눌러야 실행됩니다.`;
    body.appendChild(note);
  }

  if (state.action === "trash" && preview.total > preview.trashLimit) {
    const warn = document.createElement("div");
    warn.className = "pdf-warn";
    warn.textContent = `휴지통 이동은 한 번에 ${preview.trashLimit}통까지만 됩니다(메일당 요청이 하나씩 필요합니다). 나머지는 다시 실행하세요.`;
    body.appendChild(warn);
  }
}

async function runApply(ids, btn) {
  if (!ids.length) return;
  if (state.action === "label" && !state.targetLabelId) {
    showSettingsToast("붙일 라벨을 먼저 고르세요.");
    return;
  }

  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "처리 중...";

  // 처리 방식은 mode로 보낸다. action은 라우터가 쓰는 이름이라 겹칠 수 없다.
  const res = await ask({
    action: "cleanup.apply",
    ids,
    mode: state.action,
    targetLabelId: state.targetLabelId || null,
  });

  btn.disabled = false;
  btn.textContent = original;
  handleApplyResult(res);
}

function handleApplyResult(res) {
  if (!res.ok) {
    showSettingsToast(res.error || "정리하지 못했습니다.");
    return;
  }
  showSettingsToast(`${res.processed}통을 ${ACTION_LABEL[res.action] || "처리"}했습니다. 되돌릴 수 있습니다.`);
  preview = null;
  confirmingAll = false;
  renderCleanupWorkspace();
}

// ---------------------------------------------------------------------------
// 되돌리기
// ---------------------------------------------------------------------------

function renderUndoSection(wrap) {
  const body = section(wrap, { title: "되돌리기" });
  emptyState(body, "확인 중...");

  ask({ action: "cleanup.undoInfo" }).then((res) => {
    body.innerHTML = "";
    const undo = res.ok && res.undo;
    if (!undo) {
      emptyState(body, "되돌릴 정리 작업이 없습니다. 정리를 실행하면 바로 여기서 되돌릴 수 있습니다.");
      return;
    }

    const info = document.createElement("div");
    info.className = "ws-row";
    info.innerHTML = `
      <div class="ws-row-main">
        <span class="ws-row-title">${escapeHtml(ACTION_LABEL[undo.action] || undo.action)} ${undo.count}통</span>
        <span class="ws-hint">${escapeHtml(formatWhen(undo.at))}</span>
      </div>`;
    body.appendChild(info);

    const row = document.createElement("div");
    row.className = "ws-btn-row";
    const btn = document.createElement("button");
    btn.className = "btn btn-small";
    btn.id = "cleanUndoBtn";
    btn.textContent = "되돌리기";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "되돌리는 중...";
      const result = await ask({ action: "cleanup.undo" });
      if (result.ok) {
        showSettingsToast(`${result.restored}통을 되돌렸습니다.`);
        preview = null;
        renderCleanupWorkspace();
      } else {
        showSettingsToast(result.error || "되돌리지 못했습니다.");
        btn.disabled = false;
        btn.textContent = "되돌리기";
      }
    });
    row.appendChild(btn);
    body.appendChild(row);
  });
}

export { renderCleanupWorkspace };
