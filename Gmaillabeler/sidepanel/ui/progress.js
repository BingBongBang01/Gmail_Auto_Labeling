// sidepanel/ui/progress.js
// 진행률 바와 중지 버튼.
// 예전에는 이 함수가 라벨 기준 제안 결과까지 함께 처리했다. 그래서 진행률 코드를
// 손대면 라벨 설정 화면이 깨질 수 있었다. 이제 라벨 설정은 자기 저장소 리스너를
// 직접 등록한다(workspaces/gmail_label_settings.js).

import { SettingsStore } from "../../settings/settings_store.js";

import { $ } from "./dom.js";
import { setActionFeedback } from "./feedback.js";
import { applyTheme } from "./theme.js";

function initProgressSection() {
  const progressBar = $("progressBar");
  const progressText = $("progressText");
  const btnPause = $("btnPause");
  const btnForceStop = $("btnForceStop");
  const progressSection = $("progressSection");

  function updateProgressUI(progress, status) {
    if (!progressBar || !progressText) return;
    const isRunning = status === "running";
    if (progressSection) {
      progressSection.classList.toggle("active", isRunning);
    }

    if (!progress || !progress.total) {
      if (status === "done") {
        progressBar.value = 100;
        progressText.textContent = "100%";
      } else {
        progressBar.value = 0;
        progressText.textContent = "0%";
      }
      return;
    }

    const pct = Math.min(100, Math.round((progress.processed / progress.total) * 100));
    progressBar.value = pct;
    progressText.textContent = `${pct}%`;
  }

  chrome.storage.local.get(["jobStatus", "jobProgress"], (res) => {
    if (res) updateProgressUI(res.jobProgress, res.jobStatus);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (changes.jobProgress || changes.jobStatus || changes.jobResult) {
      chrome.storage.local.get(["jobStatus", "jobProgress", "jobResult"], (res) => {
        if (res) updateProgressUI(res.jobProgress, res.jobStatus);
      });
    }
    if (changes.appSettings) {
      SettingsStore.getSetting("general.themeMode").then((mode) => {
        applyTheme(mode || "system");
        const themeSelect = $("spThemeMode");
        if (themeSelect && themeSelect.value !== (mode || "system")) {
          themeSelect.value = mode || "system";
        }
      });
    }
  });

  btnPause?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "cancelJob" }, () => {
      setActionFeedback("작업 일시중지/취소를 요청했습니다.");
    });
  });

  btnForceStop?.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "forceCancelJob" }, () => {
      setActionFeedback("작업을 강제 중지했습니다.");
    });
  });
}


export {
  initProgressSection,
};
