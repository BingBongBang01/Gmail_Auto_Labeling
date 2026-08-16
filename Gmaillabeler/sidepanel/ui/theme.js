// sidepanel/ui/theme.js
// 테마(라이트/다크/시스템) 적용.

import { SettingsStore } from "../../settings/settings_store.js";

function applyTheme(themeMode) {
  const mode = themeMode || "system";
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (isDark) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}


function initTheme(settings) {
  const theme = settings?.general?.themeMode || "system";
  applyTheme(theme);

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      SettingsStore.getSetting("general.themeMode").then((mode) => {
        if (!mode || mode === "system") applyTheme("system");
      });
    });
  }
}


export {
  applyTheme,
  initTheme,
};
