// dashboard/ui/theme.js
// 테마(라이트/다크/시스템) 적용.

// ---------------- 테마 ----------------

import { $ } from "./dom.js";
import { SettingsStore } from "../../settings/settings_store.js";

const darkModeMql = window.matchMedia("(prefers-color-scheme: dark)");

function applyTheme(mode) {
  const effective = mode === "system" ? (darkModeMql.matches ? "dark" : "light") : mode;
  document.documentElement.setAttribute("data-theme", effective);
}

// 테마는 settings.general.themeMode 한 곳에서 읽는다.
// 예전에는 대시보드와 로그 창만 평면 키 themeMode를 쓰고 팝업/사이드패널/옵션은
// settings.general.themeMode를 써서, 대시보드에서 테마를 바꿔도 다른 화면에는
// 전혀 반영되지 않았다(반대 방향도 마찬가지).
function initTheme() {
  SettingsStore.getSetting("general.themeMode").then((mode) => applyTheme(mode || "system"));

  const themeToggleBtn = $("dashThemeToggleBtn");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", async () => {
      const current = (await SettingsStore.getSetting("general.themeMode")) || "system";
      const next = current === "dark" ? "light" : "dark";
      await SettingsStore.setSetting("general.themeMode", next);
      applyTheme(next);
    });
  }

  darkModeMql.addEventListener("change", async () => {
    const mode = (await SettingsStore.getSetting("general.themeMode")) || "system";
    if (mode === "system") applyTheme("system");
  });
}


export {
  darkModeMql,
  applyTheme,
  initTheme,
};
