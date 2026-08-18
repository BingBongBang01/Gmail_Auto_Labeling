// sidepanel/workspaces/activity.js
// '작업' 서비스 화면. 지금 무엇이 돌고 있는지, 방금 무엇이 끝났는지, 왜 실패했는지.
//
// 새로 모으는 데이터가 하나도 없다. 전부 이미 쌓이고 있는데 볼 곳이 없었을 뿐이다.
//   진행 상황   chrome.storage.local: jobStatus / jobProgress / jobKind
//   최근 작업   chrome.storage.local: recentJobs  (지금까지 팝업에서만 보였다)
//   로그        bg/core/log_db.js    (지금까지 별도 탭 페이지에서만 보였다)
//   AI 사용량   ai_quota_manager     (지금까지 옵션 페이지에서만 보였다)
//
// 실패한 작업의 원인을 보려고 별도 로그 페이지를 여는 일이 없게 하는 것이 이 화면의 핵심이다.

import { escapeHtml } from "../ui/dom.js";
import { showSettingsToast } from "../ui/feedback.js";
import { openWorkspace, section, statRow, emptyState, tabBar, badge, formatWhen, ask } from "./shell.js";

const TABS = [
  { id: "now", label: "진행" },
  { id: "recent", label: "최근 작업" },
  { id: "logs", label: "로그" },
  { id: "usage", label: "AI 사용량" },
];

const LOG_LIMIT = 200;

// 화면이 파괴돼도 살아남아야 하는 상태가 아니다(사이드패널은 닫히면 통째로 사라진다).
// 다만 탭 사이를 오갈 때 필터는 유지되는 편이 자연스럽다.
let activeTab = "now";
let logLevelFilter = "all";
let logQuery = "";

const STATUS_TONE = {
  running: "info",
  done: "good",
  cancelled: "warn",
  quota_exceeded: "warn",
  error: "bad",
};

const STATUS_LABEL = {
  running: "진행 중",
  done: "완료",
  cancelled: "중지됨",
  quota_exceeded: "할당량 소진",
  error: "오류",
};

function renderActivityWorkspace(tab) {
  if (tab) activeTab = tab;

  const wrap = openWorkspace({
    service: "작업",
    title: "작업 상태",
    desc: "실행 중인 작업과 최근 기록, 로그를 한곳에서 봅니다.",
  });
  if (!wrap) return;

  tabBar(wrap, TABS, activeTab, (id) => renderActivityWorkspace(id));

  const host = document.createElement("div");
  host.className = "ws-tabbody";
  wrap.appendChild(host);

  if (activeTab === "now") renderNow(host);
  else if (activeTab === "recent") renderRecent(host);
  else if (activeTab === "logs") renderLogs(host);
  else renderUsage(host);
}

// ---------------------------------------------------------------------------
// 진행
// ---------------------------------------------------------------------------

async function renderNow(host) {
  const body = section(host, { title: "지금 실행 중", actions: [{ label: "새로고침", onClick: () => renderActivityWorkspace("now") }] });
  const status = await ask({ action: "getJobStatus" });

  const jobStatus = status.jobStatus || "idle";
  const progress = status.jobProgress || {};
  const running = jobStatus === "running";

  if (!running) {
    emptyState(
      body,
      jobStatus === "idle"
        ? "실행 중인 작업이 없습니다. 상단 타일에서 작업을 시작하면 여기에 진행 상황이 표시됩니다."
        : `마지막 작업이 ${STATUS_LABEL[jobStatus] || jobStatus} 상태로 끝났습니다. '최근 작업' 탭에서 결과를 볼 수 있습니다.`
    );
  } else {
    const processed = Number(progress.processed) || 0;
    const total = Number(progress.total) || 0;
    const pct = total > 0 ? Math.round((processed / total) * 100) : 0;

    const card = document.createElement("div");
    card.className = "ws-run";
    card.innerHTML = `
      <div class="ws-run-head">
        <span class="ws-run-name">${escapeHtml(status.jobKind || "작업")}</span>
        ${badge(STATUS_LABEL.running, "info")}
      </div>
      <div class="pdf-progress-track"><div class="pdf-progress-fill" style="width:${pct}%"></div></div>
      <div class="ws-run-meta">
        ${total > 0 ? `${processed}/${total} (${pct}%)` : "진행 중..."}
        ${progress.batchTotal ? ` · 배치 ${progress.batchIndex || 0}/${progress.batchTotal}` : ""}
      </div>
    `;
    body.appendChild(card);

    const stopRow = document.createElement("div");
    stopRow.className = "ws-btn-row";
    const stop = document.createElement("button");
    stop.className = "btn btn-small";
    stop.textContent = "중지";
    stop.addEventListener("click", async () => {
      await ask({ action: "cancelJob" });
      showSettingsToast("중지를 요청했습니다.");
      renderActivityWorkspace("now");
    });
    stopRow.appendChild(stop);
    body.appendChild(stopRow);
  }

  // 마지막 API 오류는 작업 상태와 별개로 남는다. 원인 파악에 가장 먼저 필요한 정보라 위에 둔다.
  if (status.lastApiError) {
    const errBody = section(host, { title: "마지막 API 오류" });
    const box = document.createElement("div");
    box.className = "ws-error";
    box.innerHTML = `<b>${escapeHtml(status.lastApiError.service || "API")}</b> · ${escapeHtml(
      formatWhen(status.lastApiError.at)
    )}<br>${escapeHtml(status.lastApiError.message || "")}`;
    errBody.appendChild(box);
  }
}

// ---------------------------------------------------------------------------
// 최근 작업
// ---------------------------------------------------------------------------

function renderRecent(host) {
  const body = section(host, {
    title: "최근 작업",
    hint: "최대 20건",
    actions: [{ label: "새로고침", onClick: () => renderActivityWorkspace("recent") }],
  });

  chrome.storage.local.get(["recentJobs"], (res) => {
    const jobs = Array.isArray(res.recentJobs) ? res.recentJobs : [];
    if (!jobs.length) {
      emptyState(body, "아직 실행한 작업이 없습니다.");
      return;
    }

    body.innerHTML = jobs
      .slice(0, 20)
      .map((job) => {
        const tone = STATUS_TONE[job.status] || "";
        return `
          <div class="ws-row">
            <div class="ws-row-main">
              <span class="ws-row-title">${escapeHtml(job.name || "작업")}</span>
              <span class="ws-hint">${escapeHtml(formatWhen(job.at))}${
          job.result ? ` · ${escapeHtml(String(job.result).slice(0, 80))}` : ""
        }</span>
            </div>
            ${badge(STATUS_LABEL[job.status] || job.status || "?", tone)}
          </div>`;
      })
      .join("");
  });
}

// ---------------------------------------------------------------------------
// 로그
// ---------------------------------------------------------------------------

async function renderLogs(host) {
  const body = section(host, {
    title: "로그",
    hint: `최근 ${LOG_LIMIT}줄`,
    actions: [
      { label: "새로고침", onClick: () => renderActivityWorkspace("logs") },
      {
        label: "비우기",
        onClick: async () => {
          await ask({ action: "clearLogs" });
          showSettingsToast("로그를 비웠습니다.");
          renderActivityWorkspace("logs");
        },
      },
    ],
  });

  const controls = document.createElement("div");
  controls.className = "ws-log-controls";
  controls.innerHTML = `
    <select class="settings-select-compact" id="wsLogLevel">
      <option value="all">전체</option>
      <option value="error">오류만</option>
      <option value="warn">경고 이상</option>
    </select>
    <input type="text" class="pdf-input" id="wsLogQuery" placeholder="검색어" value="${escapeHtml(logQuery)}">
  `;
  body.appendChild(controls);

  const viewer = document.createElement("div");
  viewer.className = "ws-logs";
  body.appendChild(viewer);

  const levelSelect = controls.querySelector("#wsLogLevel");
  const querySelect = controls.querySelector("#wsLogQuery");
  levelSelect.value = logLevelFilter;

  const logs = await ask({ action: "getLogs", limit: LOG_LIMIT });
  // getLogs는 배열을 그대로 돌려준다(액션 핸들러가 getRecentLogs 결과를 그대로 반환).
  const all = Array.isArray(logs) ? logs : [];

  const paint = () => {
    const rank = { error: 3, warn: 2, info: 1 };
    const min = logLevelFilter === "error" ? 3 : logLevelFilter === "warn" ? 2 : 0;
    const needle = logQuery.trim().toLowerCase();

    const rows = all.filter((entry) => {
      if ((rank[entry.level] || 1) < min) return false;
      if (needle && !String(entry.message || "").toLowerCase().includes(needle)) return false;
      return true;
    });

    if (!rows.length) {
      viewer.innerHTML = `<div class="ws-empty">${
        all.length ? "조건에 맞는 로그가 없습니다." : "아직 기록된 로그가 없습니다."
      }</div>`;
      return;
    }

    // 최신이 위로 오게 뒤집는다. getRecentLogs는 오래된 것부터 돌려준다.
    viewer.innerHTML = rows
      .slice()
      .reverse()
      .map(
        (entry) => `
        <div class="ws-log is-${escapeHtml(entry.level || "info")}">
          <span class="ws-log-time">${escapeHtml(
            new Date(entry.timestamp || 0).toLocaleTimeString(undefined, { hour12: false })
          )}</span>
          <span class="ws-log-msg">${escapeHtml(entry.message || "")}</span>
        </div>`
      )
      .join("");
  };

  levelSelect.addEventListener("change", () => {
    logLevelFilter = levelSelect.value;
    paint();
  });
  querySelect.addEventListener("input", () => {
    logQuery = querySelect.value;
    paint();
  });

  paint();
}

// ---------------------------------------------------------------------------
// AI 사용량
// ---------------------------------------------------------------------------

async function renderUsage(host) {
  const body = section(host, {
    title: "오늘 AI 사용량",
    actions: [{ label: "새로고침", onClick: () => renderActivityWorkspace("usage") }],
  });

  const usage = await ask({ action: "getQuotaUsage" });
  if (!usage || usage.ok === false) {
    emptyState(body, "사용량을 읽지 못했습니다.");
    return;
  }

  statRow(body, [
    { label: "오늘 요청", value: usage.requestsToday ?? 0 },
    { label: "쓸 수 있는 키", value: `${usage.usableKeyCount ?? 0}/${usage.keyCount ?? 0}`, tone: usage.usableKeyCount ? "good" : "bad" },
    { label: "분당 상한", value: usage.rpm ?? "-" },
  ]);

  const keys = usage.perKey || [];
  if (!keys.length) {
    emptyState(body, "등록된 AI 키가 없습니다. 설정 > AI 공급자에서 추가하세요.");
    return;
  }

  const list = document.createElement("div");
  list.className = "ws-keys";
  list.innerHTML = keys.map(renderKeyRow).join("");
  body.appendChild(list);
}

// AI 화면과 같은 모양으로 그린다. 두 화면이 같은 데이터를 다르게 보여주면
// 사용자가 둘 중 무엇을 믿어야 할지 알 수 없다.
function renderKeyRow(key) {
  const state = key.exhausted
    ? { label: "할당량 소진", tone: "bad" }
    : key.cooldownUntil && key.cooldownUntil > Date.now()
      ? { label: "쿨다운", tone: "warn" }
      : { label: "정상", tone: "good" };

  return `
    <div class="ws-row">
      <div class="ws-row-main">
        <span class="ws-row-title">${escapeHtml(key.label || key.provider || "키")}</span>
        <span class="ws-hint">${escapeHtml(key.provider || "")}${key.model ? ` · ${escapeHtml(key.model)}` : ""} · 오늘 ${
    key.requestsToday || 0
  }회${key.rpd ? ` / ${key.rpd}` : ""}${
    key.cooldownUntil && key.cooldownUntil > Date.now()
      ? ` · ${escapeHtml(new Date(key.cooldownUntil).toLocaleTimeString(undefined, { hour12: false }))}에 해제`
      : ""
  }</span>
      </div>
      ${badge(state.label, state.tone)}
    </div>`;
}

export { renderActivityWorkspace, renderKeyRow };
