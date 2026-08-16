// dashboard/panels/labels.js
// 카테고리(라벨) 목록 상태와 그것을 쓰는 화면: 사이드바, 라벨 선택, 라벨 관리 탭.
// 카테고리 목록은 이 모듈이 소유한다. 다른 패널은 getCategoryDefs()로 읽는다.

import { startJob } from "../job_client.js";
import { renderDashAnalysisChecklist } from "./analysis.js";
import { $, escapeHtml, setText } from "../ui/dom.js";
import { t } from "../../i18n.js";
import { SettingsStore } from "../../settings/settings_store.js";

let currentCategoryDefs = [];
let selectedLabelName = "";

// ---------------- 카테고리 / 사이드바 ----------------
// 기본 카테고리는 로케일별 목록(defaultCategoriesList)에서 가져온다.
// 예전에는 한국어 이름을 이 파일에 직접 박아둬서, 다른 언어 사용자가 "기본 라벨 세트 복원"을 누르면
// 한국어 라벨이 설치되고 팝업/백그라운드의 기본값과도 어긋났다.
const DEFAULT_CATEGORIES_FALLBACK = ["보안", "광고", "쇼핑", "공지", "뉴스레터", "업무", "개인", "기타"];

function getLocalizedDefaultCategoryDefs() {
  const raw = t("defaultCategoriesList");
  const names =
    !raw || raw === "defaultCategoriesList"
      ? DEFAULT_CATEGORIES_FALLBACK
      : raw.split(",").map((x) => x.trim()).filter(Boolean);
  return names.map((name) => ({ name, description: "" }));
}

function loadCategories() {
  // 카테고리는 settings.gmail.categories가 유일한 저장 위치다.
  // 예전에는 대시보드가 평면 키 categoryDefinitions를 읽고 썼는데, background.js는
  // settings.gmail.categories를 읽어서 여기서 편집한 카테고리가 분류에 반영되지 않았다.
  return Promise.all([
    SettingsStore.getSettings(),
    new Promise((resolve) => chrome.storage.local.get(["lastSummaryLabel", "lastSummaryCriteria"], resolve)),
  ]).then(([settings, result]) => {
    const stored = settings.gmail && settings.gmail.categories;
    if (Array.isArray(stored) && stored.length) {
      currentCategoryDefs = stored.map((c) => ({
        name: c.name,
        description: c.description || "",
        autoLearned: !!c.autoLearned,
      }));
    } else {
      currentCategoryDefs = getLocalizedDefaultCategoryDefs();
    }

    // 저장된 목록에서 사라진 라벨을 선택 중이었다면 선택을 초기화
    if (selectedLabelName && !currentCategoryDefs.some((c) => c.name === selectedLabelName)) {
      selectedLabelName = "";
    }
    // 마지막으로 요약했던 라벨이 아직 살아 있으면 그것부터 다시 선택해준다.
    if (!selectedLabelName && result.lastSummaryLabel && currentCategoryDefs.some((c) => c.name === result.lastSummaryLabel)) {
      selectedLabelName = result.lastSummaryLabel;
    }
    if (!selectedLabelName && currentCategoryDefs.length) {
      selectedLabelName = currentCategoryDefs[0].name;
    }

    const criteriaInput = $("dashSummaryCriteriaInput");
    if (criteriaInput && !criteriaInput.value && result.lastSummaryCriteria) {
      criteriaInput.value = result.lastSummaryCriteria;
    }

    renderSidebarLabels();
    renderSummaryLabelSelect();
    updateSelectedLabelHeader();
  });
}

function renderSidebarLabels() {
  const sidebarLabelList = $("sidebarLabelList");
  if (!sidebarLabelList) return;

  sidebarLabelList.innerHTML = currentCategoryDefs
    .map((c) => {
      const activeCls = c.name === selectedLabelName ? " active" : "";
      return `<button class="label-item-btn${activeCls}" data-label="${escapeHtml(c.name)}">
        <span>📁 ${escapeHtml(c.name)}</span>
      </button>`;
    })
    .join("");

  sidebarLabelList.querySelectorAll(".label-item-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectLabel(btn.dataset.label);
    });
  });
}

function renderSummaryLabelSelect() {
  const select = $("dashSummaryLabelSelect");
  if (!select) return;
  select.innerHTML = currentCategoryDefs
    .map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`)
    .join("");
  if (selectedLabelName) select.value = selectedLabelName;
}

function selectLabel(name) {
  selectedLabelName = name || "";
  // 다음에 대시보드를 다시 열었을 때도 같은 라벨이 선택돼 있게 기억해둔다(팝업과 같은 값을 공유).
  if (selectedLabelName) chrome.storage.local.set({ lastSummaryLabel: selectedLabelName });
  renderSidebarLabels();
  renderDashAnalysisChecklist();
  const select = $("dashSummaryLabelSelect");
  if (select && selectedLabelName) select.value = selectedLabelName;
  updateSelectedLabelHeader();
}

function updateSelectedLabelHeader() {
  setText(
    "dashSelectedLabelTitle",
    selectedLabelName ? t("dashSummaryTitleForLabel", [selectedLabelName]) : t("dashSummaryNeedLabel")
  );
}

// 중요도 값은 AI 응답 스키마상 "상"/"중"/"하" 문자열로 저장된다(백그라운드/디스코드 라우팅도 이 값을 씀).
// 데이터는 그대로 두고 화면에 보여줄 때만 현재 언어로 바꾼다.


// ---------------- 라벨 관리 탭 ----------------
function renderDashboardCategories() {
  const list = $("dashCategoriesList");
  if (!list) return;

  list.innerHTML = currentCategoryDefs
    .map(
      (cat, idx) => `
      <div class="form-row cat-row" data-idx="${idx}">
        <input type="text" class="cat-name-input" value="${escapeHtml(cat.name)}" placeholder=t("placeholderCategoryName")>
        <input type="text" class="cat-desc-input" value="${escapeHtml(cat.description || "")}" placeholder=t("placeholderCategoryDesc")>
        <button class="dash-btn dash-btn-secondary del-cat-btn" data-idx="${idx}">✕</button>
      </div>`
    )
    .join("") +
    `<div class="btn-row" style="margin-top:12px;">
      <button class="dash-btn dash-btn-secondary" id="dashAddCategoryBtn">➕ ${escapeHtml(t("dashBtnAddCategory"))}</button>
      <button class="dash-btn dash-btn-primary" id="dashSaveCategoriesBtn">💾 ${escapeHtml(t("dashBtnSaveCategories"))}</button>
    </div>`;

  list.querySelectorAll(".del-cat-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      collectCategoriesFromDom();
      currentCategoryDefs.splice(parseInt(btn.getAttribute("data-idx"), 10), 1);
      renderDashboardCategories();
    });
  });

  const addBtn = $("dashAddCategoryBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      collectCategoriesFromDom();
      currentCategoryDefs.push({ name: "", description: "" });
      renderDashboardCategories();
    });
  }

  const saveBtn = $("dashSaveCategoriesBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      collectCategoriesFromDom();
      const validDefs = currentCategoryDefs.filter((c) => c.name);
      if (!validDefs.length) {
        alert(t("msgCategoriesMin"));
        return;
      }
      SettingsStore.setSetting("gmail.categories", validDefs).then(() => {
        currentCategoryDefs = validDefs;
        renderDashboardCategories();
        renderSidebarLabels();
        renderSummaryLabelSelect();
        alert(t("msgCategoriesSaved", [validDefs.length]));
      });
    });
  }
}

function collectCategoriesFromDom() {
  const list = $("dashCategoriesList");
  if (!list) return;
  const rows = list.querySelectorAll(".cat-row");
  if (!rows.length) return;
  currentCategoryDefs = Array.from(rows).map((row, i) => {
    const prev = currentCategoryDefs[i] || {};
    return {
      name: row.querySelector(".cat-name-input").value.trim(),
      description: row.querySelector(".cat-desc-input").value.trim(),
      autoLearned: !!prev.autoLearned,
    };
  });
}



// 이 패널이 쓰는 DOM 이벤트는 이 패널이 직접 연결한다.
function initLabelAdminEvents() {
  // --- 라벨 관리 탭 ---
  const resetCategoriesBtn = $("dashResetCategoriesBtn");
  if (resetCategoriesBtn) {
    resetCategoriesBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmResetCategories"))) return;
      const defs = getLocalizedDefaultCategoryDefs();
      SettingsStore.setSetting("gmail.categories", defs).then(() => {
        currentCategoryDefs = defs;
        renderDashboardCategories();
        renderSidebarLabels();
        renderSummaryLabelSelect();
        alert(t("msgCategoriesReset"));
      });
    });
  }

  const deleteAllLabelsBtn = $("dashDeleteAllLabelsBtn");
  if (deleteAllLabelsBtn) {
    deleteAllLabelsBtn.addEventListener("click", () => {
      if (!confirm(t("dashConfirmDeleteAllLabels"))) return;
      startJob({ action: "startDeleteAllLabels" }, t("dashMsgDeleteLabelsStarted"));
    });
  }
}


// 사용자가 편집 중인 카테고리(라벨) 목록. 이 모듈이 소유한다.
// 밖에서는 이 함수로만 읽는다(import 바인딩에는 대입할 수 없으므로 읽기 경로도 하나로 둔다).
function getCategoryDefs() {
  return currentCategoryDefs;
}

// 사이드바에서 선택된 라벨 이름.
// 밖에서는 이 함수로만 읽는다(import 바인딩에는 대입할 수 없으므로 읽기 경로도 하나로 둔다).
function getSelectedLabelName() {
  return selectedLabelName;
}

export {
  DEFAULT_CATEGORIES_FALLBACK,
  collectCategoriesFromDom,
  getCategoryDefs,
  getLocalizedDefaultCategoryDefs,
  initLabelAdminEvents,
  loadCategories,
  renderDashboardCategories,
  renderSidebarLabels,
  renderSummaryLabelSelect,
  selectLabel,
  getSelectedLabelName,
  updateSelectedLabelHeader,
};
