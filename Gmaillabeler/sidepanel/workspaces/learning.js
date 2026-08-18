// sidepanel/workspaces/learning.js
// '학습' 서비스 화면. 내가 고친 분류에서 확장이 무엇을 배웠는지 보여준다.
//
// 이 기능은 원래부터 돌고 있었다. 분류할 때마다 "이 메일에 이 라벨을 붙였다"를 기록하고,
// 나중에 사용자가 Gmail에서 다른 라벨로 바꿔놓았으면 그것을 정정으로 잡아 패턴으로 쌓는다.
// 같은 정정이 threshold번 반복되면 그 카테고리의 분류 기준 설명을 AI가 다듬어 채운다.
// 다만 그 과정이 전부 코드 안에서만 일어나서, 사용자는 "쓸수록 정확해진다"를 볼 수 없었다.
//
// 화면이 하는 일은 두 가지다: 쌓인 것을 보여주고, 기다리지 않고 지금 반영하게 해준다.

import { escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, statRow, emptyState, tabBar, badge, formatWhen, ask } from "./shell.js";

const TABS = [
  { id: "patterns", label: "배운 것" },
  { id: "recent", label: "최근 분류" },
];

let activeTab = "patterns";

function renderLearningWorkspace(tab) {
  if (tab) activeTab = tab;

  const wrap = openWorkspace({
    service: "학습",
    title: "정정 학습",
    desc: "내가 고친 분류에서 무엇을 배웠는지 확인하고 기준에 반영합니다.",
  });
  if (!wrap) return;

  tabBar(wrap, TABS, activeTab, (id) => renderLearningWorkspace(id));

  const host = document.createElement("div");
  host.className = "ws-tabbody";
  wrap.appendChild(host);

  load(host);
}

async function load(host) {
  const loading = section(host, { title: "불러오는 중" });
  emptyState(loading, "기록을 읽고 있습니다...");

  const data = await ask({ action: "learning.overview", limit: 25 });
  host.innerHTML = "";

  if (!data.ok) {
    const body = section(host, { title: "학습 기록" });
    emptyState(body, data.error || "학습 기록을 읽지 못했습니다.");
    return;
  }

  const totalCorrections = (data.patterns || []).reduce((sum, p) => sum + (p.totalCount || 0), 0);
  const statHost = document.createElement("div");
  host.appendChild(statHost);
  statRow(statHost, [
    { label: "기록된 분류", value: data.historyCount || 0 },
    { label: "정정 패턴", value: (data.patterns || []).length },
    { label: "누적 정정", value: totalCorrections, tone: totalCorrections ? "warn" : undefined },
  ]);

  if (activeTab === "patterns") renderPatterns(host, data);
  else renderRecent(host, data);
}

function renderPatterns(host, data) {
  const body = section(host, {
    title: "배운 정정 패턴",
    hint: `${data.threshold}번 반복되면 자동 반영`,
    actions: [{ label: "새로고침", onClick: () => renderLearningWorkspace("patterns") }],
  });

  const patterns = data.patterns || [];
  if (!patterns.length) {
    emptyState(
      body,
      "아직 배운 것이 없습니다. AI가 붙인 라벨을 Gmail에서 직접 다른 라벨로 바꾸면, 다음 분류 때 그 정정을 찾아 여기에 쌓습니다."
    );
    return;
  }

  for (const pattern of patterns) {
    const card = document.createElement("div");
    card.className = "ws-pattern";

    const progress = Math.min(100, Math.round((pattern.count / Math.max(1, data.threshold)) * 100));
    card.innerHTML = `
      <div class="ws-pattern-head">
        <span class="ws-pattern-flow">
          <span class="ws-label-chip is-from">${escapeHtml(pattern.fromLabel || "?")}</span>
          <span class="ws-arrow">→</span>
          <span class="ws-label-chip is-to">${escapeHtml(pattern.toLabel || "?")}</span>
        </span>
        ${badge(`${pattern.totalCount}회`, pattern.totalCount >= data.threshold ? "warn" : "")}
      </div>
      <div class="ws-hint">
        마지막 정정 ${escapeHtml(formatWhen(pattern.updatedAt))} · 자동 반영까지 ${Math.max(
          0,
          data.threshold - pattern.count
        )}회 남음
      </div>
      <div class="ws-mini-track"><div class="ws-mini-fill" style="width:${progress}%"></div></div>
      ${
        pattern.examples && pattern.examples.length
          ? `<ul class="ws-examples">${pattern.examples
              .map((e) => `<li>${escapeHtml(e.subject || "(제목 없음)")}<span>${escapeHtml(e.from || "")}</span></li>`)
              .join("")}</ul>`
          : ""
      }
    `;

    const btnRow = document.createElement("div");
    btnRow.className = "ws-btn-row";
    const apply = document.createElement("button");
    apply.className = "btn btn-small";
    apply.textContent = "지금 기준에 반영";
    apply.title = `"${pattern.toLabel}" 카테고리의 분류 기준 설명을 이 정정들을 근거로 다시 씁니다.`;
    apply.addEventListener("click", async () => {
      apply.disabled = true;
      apply.textContent = "반영 중...";
      const res = await ask({ action: "learning.applyPattern", key: pattern.key });
      if (res.ok) {
        showSettingsToast(`"${res.label}" 분류 기준을 갱신했습니다.`);
        renderLearningWorkspace("patterns");
      } else {
        showSettingsToast(res.error || "반영하지 못했습니다.");
        apply.disabled = false;
        apply.textContent = "지금 기준에 반영";
      }
    });
    btnRow.appendChild(apply);
    card.appendChild(btnRow);

    body.appendChild(card);
  }
}

function renderRecent(host, data) {
  const body = section(host, {
    title: "최근 분류 기록",
    hint: "우리가 마지막으로 붙인 라벨",
    actions: [{ label: "새로고침", onClick: () => renderLearningWorkspace("recent") }],
  });

  const rows = data.recent || [];
  if (!rows.length) {
    emptyState(body, "아직 분류 기록이 없습니다. 메일 라벨링을 한 번 실행하면 여기에 쌓입니다.");
    return;
  }

  body.innerHTML = rows
    .map(
      (row) => `
      <div class="ws-row">
        <div class="ws-row-main">
          <span class="ws-row-title">${escapeHtml(row.subject || "(제목 없음)")}</span>
          <span class="ws-hint">${escapeHtml(row.from || "")} · ${escapeHtml(formatWhen(row.appliedAt))}</span>
        </div>
        <span class="ws-label-chip is-to">${escapeHtml(row.labelName || "")}</span>
      </div>`
    )
    .join("");

  const note = document.createElement("p");
  note.className = "ws-note";
  note.textContent =
    "이 목록의 라벨을 Gmail에서 직접 바꾸면, 다음 분류 때 그 차이를 정정으로 잡아 '배운 것'에 쌓습니다.";
  body.appendChild(note);
}

export { renderLearningWorkspace };
