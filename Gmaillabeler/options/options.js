// options/options.js
const $ = (id) => document.getElementById(id);

async function initOptions() {
  await i18nInit();
  i18nApplyToDom(document);
  initNav();
  initThemeSettings();
  initConnections();
  // Call other init functions as they get ported
}

function initNav() {
  const navBtns = document.querySelectorAll(".nav-btn");
  navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      // Update active class on nav
      navBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      // Update title
      $("currentSectionTitle").textContent = btn.textContent;
      
      // Update visible panel
      const targetId = btn.getAttribute("data-target");
      document.querySelectorAll(".settings-panel").forEach(p => p.classList.remove("active"));
      const targetPanel = $(targetId);
      if (targetPanel) {
        targetPanel.classList.add("active");
      }
    });
  });
}

function initThemeSettings() {
  const themeBtns = ["themeSystemBtn", "themeLightBtn", "themeDarkBtn"];
  
  chrome.storage.local.get("dashboardTheme", (data) => {
    const theme = data.dashboardTheme || "system";
    updateThemeUI(theme);
  });

  $("themeSystemBtn")?.addEventListener("click", () => setTheme("system"));
  $("themeLightBtn")?.addEventListener("click", () => setTheme("light"));
  $("themeDarkBtn")?.addEventListener("click", () => setTheme("dark"));
}

function setTheme(theme) {
  updateThemeUI(theme);
  chrome.storage.local.set({ dashboardTheme: theme });
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function updateThemeUI(activeTheme) {
  ["system", "light", "dark"].forEach(t => {
    const btn = $(`theme${t.charAt(0).toUpperCase() + t.slice(1)}Btn`);
    if (btn) {
      if (t === activeTheme) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  });
}

function initConnections() {
  // OAuth and API Keys implementation
  const apiKeysList = $("apiKeysList");
  let currentApiKeys = [];

  function renderApiKeysList() {
    if (!apiKeysList) return;
    apiKeysList.innerHTML = currentApiKeys
      .map(
        (entry, idx) => `
        <div class="apikey-row" data-idx="${idx}" style="display:flex; gap:8px; margin-bottom:8px;">
          <input type="text" class="form-input apikey-label" placeholder="Label (e.g. Prod)" value="${entry.label || ""}" style="flex:1;">
          <input type="password" class="form-input apikey-value" placeholder="AIza..." value="${entry.key || ""}" style="flex:2;">
          <button class="btn btn-icon toggle-apikey-btn" type="button">👁</button>
          <button class="btn btn-icon danger delete-apikey-btn" style="color:var(--md-sys-color-error)">✕</button>
        </div>`
      )
      .join("");

    apiKeysList.querySelectorAll(".toggle-apikey-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const input = btn.closest(".apikey-row").querySelector(".apikey-value");
        input.type = input.type === "password" ? "text" : "password";
      });
    });

    apiKeysList.querySelectorAll(".delete-apikey-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        collectApiKeysFromDom();
        const idx = parseInt(btn.closest(".apikey-row").getAttribute("data-idx"), 10);
        currentApiKeys.splice(idx, 1);
        renderApiKeysList();
      });
    });
  }

  function collectApiKeysFromDom() {
    if (!apiKeysList) return;
    const rows = apiKeysList.querySelectorAll(".apikey-row");
    currentApiKeys = Array.from(rows).map((row) => ({
      label: row.querySelector(".apikey-label").value.trim(),
      key: row.querySelector(".apikey-value").value.trim(),
    }));
  }

  $("addApiKeyBtn")?.addEventListener("click", () => {
    collectApiKeysFromDom();
    currentApiKeys.push({ label: "", key: "" });
    renderApiKeysList();
  });

  $("saveKeyBtn")?.addEventListener("click", () => {
    collectApiKeysFromDom();
    const validKeys = currentApiKeys.filter((k) => k.key);
    chrome.storage.local.set({ geminiApiKeys: validKeys }, () => {
      currentApiKeys = validKeys;
      renderApiKeysList();
      alert("API Keys saved."); // TODO: replace with snackbar
    });
  });

  $("openAiStudioBtn")?.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://aistudio.google.com/apikey" });
  });

  // Initial load
  chrome.storage.local.get(["geminiApiKeys"], (result) => {
    if (Array.isArray(result.geminiApiKeys) && result.geminiApiKeys.length) {
      currentApiKeys = result.geminiApiKeys.map((k) => ({ label: k.label || "", key: k.key || "" }));
    } else {
      currentApiKeys = [];
    }
    renderApiKeysList();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOptions);
} else {
  initOptions();
}
