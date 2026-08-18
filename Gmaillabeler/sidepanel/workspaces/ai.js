// sidepanel/workspaces/ai.js
// 'AI' 서비스 화면. 예전 Gemini 화면을 대체한다.
//
// 예전 화면은 프롬프트 칩 세 개가 전부였고, 누르면 문구만 바뀔 뿐 AI를 부르지 않았다.
// 타일 세 개(대화시작/프롬프트/대화기록)도 등록된 적 없는 작업을 가리키고 있었다.
//
// 이 화면은 두 가지를 한다: 지금 어떤 키가 살아 있는지 보여주고, 실제로 프롬프트를 보낸다.
// 키 추가·수정은 여기서 하지 않는다 - 옵션 페이지에 이미 제대로 된 편집 화면이 있고,
// 좁은 패널에 같은 편집기를 또 만들면 두 곳의 동작이 갈라진다.

import { escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, statRow, emptyState, tabBar, ask } from "./shell.js";
import { renderKeyRow } from "./activity.js";

const TABS = [
  { id: "run", label: "프롬프트" },
  { id: "status", label: "공급자 상태" },
];

// 자주 쓰는 것을 손이 아니라 눈으로 고르게 한다. 누르면 입력창에 채워지고,
// 보내기 전에 고칠 수 있다 - 칩이 곧바로 실행되면 실수로 할당량을 쓴다.
const PRESETS = [
  { label: "메일 답장 초안", text: "다음 메일에 정중하게 거절하는 답장 초안을 한국어로 써줘:\n\n" },
  { label: "요점 3줄", text: "다음 내용을 핵심만 3줄로 요약해줘:\n\n" },
  { label: "영문 다듬기", text: "다음 영어 문장을 자연스럽고 정중한 비즈니스 영어로 다듬어줘:\n\n" },
  { label: "분류 기준 제안", text: "받은편지함을 정리하려고 한다. 아래 메일 제목들을 보고 라벨 카테고리와 각 기준을 제안해줘:\n\n" },
];

let activeTab = "run";
let lastPrompt = "";
let lastAnswer = null; // { answer, elapsedMs }

function renderAiWorkspace(tab) {
  if (tab) activeTab = tab;

  const wrap = openWorkspace({
    service: "AI",
    title: "AI 어시스턴트",
    desc: "등록한 AI 키로 프롬프트를 실행하고 공급자 상태를 확인합니다.",
  });
  if (!wrap) return;

  tabBar(wrap, TABS, activeTab, (id) => renderAiWorkspace(id));

  const host = document.createElement("div");
  host.className = "ws-tabbody";
  wrap.appendChild(host);

  if (activeTab === "run") renderRunner(host);
  else renderStatus(host);
}

// ---------------------------------------------------------------------------
// 프롬프트 실행기
// ---------------------------------------------------------------------------

function renderRunner(host) {
  const body = section(host, { title: "프롬프트 실행", hint: "등록된 키로 직접 보냅니다" });

  const chips = document.createElement("div");
  chips.className = "ai-chips-row";
  for (const preset of PRESETS) {
    const chip = document.createElement("button");
    chip.className = "ai-chip";
    chip.textContent = preset.label;
    chip.addEventListener("click", () => {
      const input = body.querySelector("#aiPromptInput");
      if (!input) return;
      input.value = preset.text;
      input.focus();
      // 커서를 끝으로 보내 바로 이어 쓸 수 있게 한다.
      input.setSelectionRange(input.value.length, input.value.length);
    });
    chips.appendChild(chip);
  }
  body.appendChild(chips);

  const field = document.createElement("div");
  field.className = "pdf-field";
  field.innerHTML = `
    <textarea class="pdf-input pdf-textarea" id="aiPromptInput" rows="5"
      placeholder="AI에게 보낼 내용을 적으세요.">${escapeHtml(lastPrompt)}</textarea>
  `;
  body.appendChild(field);

  const btnRow = document.createElement("div");
  btnRow.className = "ws-btn-row";
  const send = document.createElement("button");
  send.className = "btn btn-primary";
  send.textContent = "보내기";
  btnRow.appendChild(send);
  body.appendChild(btnRow);

  const result = document.createElement("div");
  result.className = "ws-answer-host";
  body.appendChild(result);

  const paintAnswer = () => {
    result.innerHTML = "";
    if (!lastAnswer) return;
    const card = document.createElement("div");
    card.className = "ws-answer";
    card.innerHTML = `
      <div class="ws-answer-head">
        <span class="ws-hint">응답 · ${Math.round((lastAnswer.elapsedMs || 0) / 100) / 10}초</span>
      </div>
      <div class="ws-answer-body">${escapeHtml(lastAnswer.answer)}</div>
    `;
    const copyRow = document.createElement("div");
    copyRow.className = "ws-btn-row";
    const copy = document.createElement("button");
    copy.className = "btn-small";
    copy.textContent = "복사";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(lastAnswer.answer);
        showSettingsToast("복사했습니다.");
      } catch (e) {
        showSettingsToast("복사하지 못했습니다.");
      }
    });
    copyRow.appendChild(copy);
    card.appendChild(copyRow);
    result.appendChild(card);
  };

  send.addEventListener("click", async () => {
    const input = body.querySelector("#aiPromptInput");
    const prompt = (input && input.value) || "";
    if (!prompt.trim()) {
      showSettingsToast("보낼 내용을 입력하세요.");
      return;
    }

    lastPrompt = prompt;
    send.disabled = true;
    send.textContent = "보내는 중...";
    result.innerHTML = `<div class="ws-empty">AI가 응답을 만들고 있습니다...</div>`;

    const res = await ask({ action: "ai.runPrompt", prompt });

    send.disabled = false;
    send.textContent = "보내기";

    if (!res.ok) {
      lastAnswer = null;
      result.innerHTML = `<div class="ws-error">${escapeHtml(res.error || "실행하지 못했습니다.")}</div>`;
      return;
    }

    lastAnswer = { answer: res.answer, elapsedMs: res.elapsedMs };
    paintAnswer();
  });

  paintAnswer();
}

// ---------------------------------------------------------------------------
// 공급자 상태
// ---------------------------------------------------------------------------

async function renderStatus(host) {
  const body = section(host, {
    title: "공급자 상태",
    actions: [
      { label: "새로고침", onClick: () => renderAiWorkspace("status") },
      { label: "키 관리", onClick: () => chrome.runtime.openOptionsPage?.() },
    ],
  });

  const usage = await ask({ action: "ai.status" });
  if (!usage.ok) {
    emptyState(body, usage.error || "상태를 읽지 못했습니다.");
    return;
  }

  statRow(body, [
    { label: "오늘 요청", value: usage.requestsToday ?? 0 },
    {
      label: "쓸 수 있는 키",
      value: `${usage.usableKeyCount ?? 0}/${usage.keyCount ?? 0}`,
      tone: usage.usableKeyCount ? "good" : "bad",
    },
    { label: "하루 추정 상한", value: usage.rpd ?? "-" },
  ]);

  const keys = usage.perKey || [];
  if (!keys.length) {
    emptyState(body, "등록된 AI 키가 없습니다. '키 관리'를 눌러 설정에서 추가하세요.");
    return;
  }

  const list = document.createElement("div");
  list.className = "ws-keys";
  // 우선순위 순서 그대로 그린다. 라우터가 이 순서로 키를 고르므로,
  // 목록 순서가 곧 "다음에 어떤 키가 쓰일지"다.
  list.innerHTML = keys.map(renderKeyRow).join("");
  body.appendChild(list);

  const note = document.createElement("p");
  note.className = "ws-note";
  note.textContent =
    "위에서부터 순서대로 사용합니다. 쿨다운이나 할당량 소진이 걸린 키는 건너뛰고 다음 키로 넘어갑니다.";
  body.appendChild(note);
}

export { renderAiWorkspace };
