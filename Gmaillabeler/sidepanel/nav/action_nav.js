// sidepanel/nav/action_nav.js
// 서비스별 액션 타일 내비게이션. 구조는 service_nav.js와 동일하다
// (렌더, 페이지 넘김, 드래그 재정렬, 휠, 높이 조절).
//
// 알려진 중복: service_nav.js와 로직이 거의 같다. 합치는 건 별도 작업이다.

import { DEFAULT_SERVICE_ACTIONS } from "./registry.js";
import {
  MAX_ROWS,
  MIN_ROWS,
  calculateVisibleColumns,
  getActiveServiceId,
  getRowHeight,
} from "./service_nav.js";
import { $ } from "../ui/dom.js";
import { setActionFeedback } from "../ui/feedback.js";
import { runCommand } from "./commands.js";
import { applyToggleStateToTile } from "./toggles.js";
import { getTileState } from "./tile_state.js";

let currentActionList = [...(DEFAULT_SERVICE_ACTIONS.gmail || [])];
let activeActionRowCount = 1;
let activeActionPageIndex = 0;
let draggedActionId = null;
let isActionPageTransitioning = false;
let actionPageTransitionTimer = null;
let isActionWheeling = false;

function getActionPaginationInfo() {
  const container = $("actionNavContainer") || $("actionNavTrack");
  const cols = calculateVisibleColumns(container);
  const rows = activeActionRowCount;
  const pageSize = cols * rows;
  const totalActions = currentActionList.length;
  const totalPages = Math.max(1, Math.ceil(totalActions / pageSize));
  return { cols, rows, pageSize, totalPages };
}

function saveActionOrder(serviceId) {
  const sId = serviceId || getActiveServiceId();
  const key = `actionNavOrder_${sId}`;
  chrome.storage.local.set({ [key]: currentActionList.map((a) => a.id) });
}

function loadActionOrder(serviceId, callback) {
  const sId = serviceId || getActiveServiceId();
  const key = `actionNavOrder_${sId}`;
  const defaultActions = DEFAULT_SERVICE_ACTIONS[sId] || [
    { id: `${sId}_action_1`, label: "작업1", icon: "⚡", title: "작업 1", command: "feedback", arg: "작업 1 실행" },
    { id: `${sId}_action_2`, label: "작업2", icon: "🔍", title: "작업 2", command: "feedback", arg: "작업 2 실행" }
  ];

  chrome.storage.local.get([key], (res) => {
    if (res && Array.isArray(res[key]) && res[key].length > 0) {
      const orderIds = res[key];
      const ordered = [];
      const registryMap = new Map(defaultActions.map((a) => [a.id, a]));

      for (const id of orderIds) {
        if (registryMap.has(id)) {
          ordered.push(registryMap.get(id));
          registryMap.delete(id);
        }
      }
      for (const remaining of registryMap.values()) {
        ordered.push(remaining);
      }
      currentActionList = ordered;
    } else {
      currentActionList = [...defaultActions];
    }
    if (callback) callback();
  });
}

function resetCurrentServiceActions() {
  const defaultActions = DEFAULT_SERVICE_ACTIONS[getActiveServiceId()] || [];
  currentActionList = [...defaultActions];
  saveActionOrder(getActiveServiceId());
  activeActionPageIndex = 0;
  renderActionNav();
  setActionFeedback("액션 타일 순서가 기본값으로 초기화되었습니다.");
}

function goToActionPage(pageIndex) {
  const track = $("actionNavTrack");
  if (!track) return;
  const { totalPages } = getActionPaginationInfo();
  const targetPage = Math.max(0, Math.min(totalPages - 1, pageIndex));

  activeActionPageIndex = targetPage;
  isActionPageTransitioning = true;
  clearTimeout(actionPageTransitionTimer);

  const pageWidth = track.clientWidth;
  track.scrollTo({
    left: activeActionPageIndex * pageWidth,
    behavior: "smooth"
  });

  updateActionIndicatorDots();
  updateActionEdgeZoneStates();

  actionPageTransitionTimer = setTimeout(() => {
    isActionPageTransitioning = false;
  }, 350);
}

function updateActionIndicatorDots() {
  const indicators = $("actionPageIndicators");
  if (!indicators) return;
  const dots = indicators.querySelectorAll(".page-dot");
  dots.forEach((dot, idx) => {
    dot.classList.toggle("active", idx === activeActionPageIndex);
  });
}

function updateActionEdgeZoneStates() {
  const edgeLeft = $("actionDragEdgeLeft");
  const edgeRight = $("actionDragEdgeRight");
  const { totalPages } = getActionPaginationInfo();

  if (edgeLeft) {
    edgeLeft.classList.toggle("disabled", activeActionPageIndex <= 0 || totalPages <= 1);
  }
  if (edgeRight) {
    edgeRight.classList.toggle("disabled", activeActionPageIndex >= totalPages - 1 || totalPages <= 1);
  }
}

function initActionDragEdgeZones() {
  const edgeLeft = $("actionDragEdgeLeft");
  const edgeRight = $("actionDragEdgeRight");
  if (!edgeLeft || !edgeRight) return;

  let leftTimer = null;
  let rightTimer = null;

  edgeLeft.addEventListener("dragover", (e) => {
    if (!draggedActionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    edgeLeft.classList.add("drag-hover");

    if (!leftTimer && activeActionPageIndex > 0) {
      leftTimer = setTimeout(() => {
        if (draggedActionId && activeActionPageIndex > 0) {
          goToActionPage(activeActionPageIndex - 1);
        }
        leftTimer = null;
      }, 260);
    }
  });

  edgeLeft.addEventListener("dragleave", () => {
    edgeLeft.classList.remove("drag-hover");
    if (leftTimer) {
      clearTimeout(leftTimer);
      leftTimer = null;
    }
  });

  edgeLeft.addEventListener("drop", (e) => {
    e.preventDefault();
    edgeLeft.classList.remove("drag-hover");
    if (leftTimer) {
      clearTimeout(leftTimer);
      leftTimer = null;
    }
  });

  edgeRight.addEventListener("dragover", (e) => {
    if (!draggedActionId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    edgeRight.classList.add("drag-hover");

    const { totalPages } = getActionPaginationInfo();
    if (!rightTimer && activeActionPageIndex < totalPages - 1) {
      rightTimer = setTimeout(() => {
        if (draggedActionId && activeActionPageIndex < totalPages - 1) {
          goToActionPage(activeActionPageIndex + 1);
        }
        rightTimer = null;
      }, 260);
    }
  });

  edgeRight.addEventListener("dragleave", () => {
    edgeRight.classList.remove("drag-hover");
    if (rightTimer) {
      clearTimeout(rightTimer);
      rightTimer = null;
    }
  });

  edgeRight.addEventListener("drop", (e) => {
    e.preventDefault();
    edgeRight.classList.remove("drag-hover");
    if (rightTimer) {
      clearTimeout(rightTimer);
      rightTimer = null;
    }
  });
}

function createActionTileButton(action) {
  const btn = document.createElement("button");
  const isCurrentDragged = action.id === draggedActionId;
  // 아직 못 하는 일은 회색으로 그린다. 클릭은 막지 않는다 - 누르면 왜 안 되는지
  // 본문에 설명이 뜨는 편이, 눌리지도 않아 이유를 알 수 없는 것보다 낫다.
  const state = action.isEmpty ? { available: true } : getTileState(action);
  btn.className =
    "service-btn" +
    (action.isEmpty ? " empty" : "") +
    (state.available ? "" : " is-unavailable") +
    (isCurrentDragged ? " dragging" : "");
  btn.dataset.action = action.id;
  btn.title = state.available
    ? action.title || action.label
    : `${action.title || action.label} — ${state.status === "unavailable" ? "지원하지 않음" : "준비 중"}`;

  const iconSpan = document.createElement("span");
  iconSpan.className = "service-icon";
  iconSpan.textContent = action.icon;

  const labelSpan = document.createElement("span");
  labelSpan.className = "service-label";
  labelSpan.textContent = action.label;

  btn.appendChild(iconSpan);
  btn.appendChild(labelSpan);

  if (!action.isEmpty) {
    // toggleKey가 있는 타일은 켜짐/꺼짐 상태를 눈에 보이게 표시한다.
    // 어떤 기능인지는 여기서도 모른다. 상태 표시는 toggles.js가 맡는다.
    applyToggleStateToTile(action, btn);

    // 타일이 무엇을 하는지는 이 파일이 알지 못한다. command 문자열을 commands.js에 넘길 뿐이다.
    btn.addEventListener("click", () => runCommand(action));

    btn.draggable = true;
    btn.addEventListener("dragstart", (e) => {
      draggedActionId = action.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", action.id);

      const container = $("actionNavContainer");
      if (container) container.classList.add("is-dragging");
      updateActionEdgeZoneStates();

      setTimeout(() => {
        btn.classList.add("dragging");
      }, 0);
    });

    btn.addEventListener("dragend", () => {
      const finishedId = draggedActionId;
      draggedActionId = null;

      const container = $("actionNavContainer");
      if (container) container.classList.remove("is-dragging");

      document.querySelectorAll(".action-nav-track .service-btn").forEach((b) => {
        b.classList.remove("dragging", "drag-over");
      });
      document.querySelectorAll("#actionNavContainer .drag-edge-zone").forEach((z) => {
        z.classList.remove("drag-hover");
      });

      saveActionOrder(getActiveServiceId());
      if (finishedId) {
        const droppedEl = document.querySelector(`[data-action="${finishedId}"]`);
        if (droppedEl) {
          droppedEl.classList.add("just-dropped");
          setTimeout(() => droppedEl.classList.remove("just-dropped"), 300);
        }
      }
    });
  }

  btn.addEventListener("dragover", (e) => {
    if (!draggedActionId || draggedActionId === action.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  btn.addEventListener("dragenter", (e) => {
    if (!draggedActionId || draggedActionId === action.id) return;
    e.preventDefault();

    const srcIndex = currentActionList.findIndex((a) => a.id === draggedActionId);
    if (srcIndex === -1) return;

    let targetIndex;
    if (action.isEmpty) {
      targetIndex = currentActionList.length - 1;
    } else {
      targetIndex = currentActionList.findIndex((a) => a.id === action.id);
    }

    if (targetIndex === -1 || targetIndex === srcIndex) return;

    const prevRectsMap = new Map();
    document.querySelectorAll(".action-nav-track .service-btn").forEach((el) => {
      if (el.dataset.action) {
        prevRectsMap.set(el.dataset.action, el.getBoundingClientRect());
      }
    });

    const [movedItem] = currentActionList.splice(srcIndex, 1);
    currentActionList.splice(targetIndex, 0, movedItem);

    renderActionNav(prevRectsMap);
  });

  btn.addEventListener("dragleave", () => {
    btn.classList.remove("drag-over");
  });

  btn.addEventListener("drop", (e) => {
    e.preventDefault();
    btn.classList.remove("drag-over");
    saveActionOrder(getActiveServiceId());
  });

  return btn;
}

function renderActionNav(prevRects = null) {
  const container = $("actionNavContainer");
  const track = $("actionNavTrack");
  const indicators = $("actionPageIndicators");
  if (!container || !track) return;

  container.style.height = getRowHeight(activeActionRowCount) + "px";

  const { pageSize, totalPages } = getActionPaginationInfo();
  if (activeActionPageIndex >= totalPages) {
    activeActionPageIndex = totalPages - 1;
  }

  track.innerHTML = "";

  for (let p = 0; p < totalPages; p++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "action-page";
    pageDiv.dataset.page = p;

    const startIndex = p * pageSize;
    const endIndex = startIndex + pageSize;

    for (let i = startIndex; i < endIndex; i++) {
      let action;
      if (i < currentActionList.length) {
        action = currentActionList[i];
      } else {
        action = {
          id: `action_empty_${i}`,
          label: "빈칸",
          icon: "❓",
          title: "빈칸",
          isEmpty: true
        };
      }

      const btn = createActionTileButton(action);
      pageDiv.appendChild(btn);
    }

    track.appendChild(pageDiv);
  }

  if (indicators) {
    indicators.innerHTML = "";
    if (totalPages <= 1) {
      indicators.classList.add("hidden");
    } else {
      indicators.classList.remove("hidden");
      for (let p = 0; p < totalPages; p++) {
        const dot = document.createElement("div");
        dot.className = "page-dot" + (p === activeActionPageIndex ? " active" : "");
        dot.dataset.page = p;
        dot.title = `${p + 1} 페이지`;
        dot.addEventListener("click", () => {
          goToActionPage(p);
        });

        dot.addEventListener("dragover", (e) => {
          if (!draggedActionId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          dot.classList.add("drag-over");
        });
        dot.addEventListener("dragleave", () => {
          dot.classList.remove("drag-over");
        });
        dot.addEventListener("dragenter", (e) => {
          if (!draggedActionId) return;
          e.preventDefault();
          dot.classList.add("drag-over");
          goToActionPage(p);
        });
        dot.addEventListener("drop", (e) => {
          e.preventDefault();
          dot.classList.remove("drag-over");
          goToActionPage(p);
        });

        indicators.appendChild(dot);
      }
    }
  }

  updateActionEdgeZoneStates();

  requestAnimationFrame(() => {
    const pageWidth = track.clientWidth;
    if (pageWidth > 0) {
      track.scrollLeft = activeActionPageIndex * pageWidth;
    }
  });

  if (prevRects) {
    const children = track.querySelectorAll(".service-btn");
    children.forEach((el) => {
      const aId = el.dataset.action;
      if (!aId || !prevRects.has(aId) || aId === draggedActionId) return;

      const prev = prevRects.get(aId);
      const curr = el.getBoundingClientRect();
      const dx = prev.left - curr.left;
      const dy = prev.top - curr.top;

      if (dx !== 0 || dy !== 0) {
        el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
        el.style.transition = "none";
        requestAnimationFrame(() => {
          el.style.transition =
            "transform 0.28s cubic-bezier(0.2, 0, 0, 1), opacity 0.2s ease, box-shadow 0.2s ease";
          el.style.transform = "";
        });
      }
    });
  }
}


function initActionNavWheelPagination() {
  const container = $("actionNavContainer");
  const track = $("actionNavTrack");
  if (!container || !track) return;

  container.addEventListener(
    "wheel",
    (e) => {
      const { totalPages } = getActionPaginationInfo();
      if (totalPages <= 1) return;

      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 8) {
        e.preventDefault();
        if (isActionWheeling) return;

        isActionWheeling = true;
        if (e.deltaY > 0) {
          goToActionPage(activeActionPageIndex + 1);
        } else {
          goToActionPage(activeActionPageIndex - 1);
        }

        setTimeout(() => {
          isActionWheeling = false;
        }, 280);
      }
    },
    { passive: false }
  );

  // Track manual trackpad / touch swipe
  track.addEventListener("scroll", () => {
    if (isActionPageTransitioning) return;
    const pageWidth = track.clientWidth;
    if (pageWidth > 0) {
      const newPage = Math.round(track.scrollLeft / pageWidth);
      if (newPage !== activeActionPageIndex) {
        activeActionPageIndex = newPage;
        updateActionIndicatorDots();
        updateActionEdgeZoneStates();
      }
    }
  });
}

function initActionNavResizer() {
  const resizer = $("actionNavResizer");
  const container = $("actionNavContainer");
  if (!resizer || !container) return;

  let isDragging = false;
  let startY = 0;
  let startHeight = 0;

  resizer.addEventListener("pointerdown", (e) => {
    isDragging = true;
    startY = e.clientY;
    startHeight = container.offsetHeight;
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add("dragging");
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  });

  resizer.addEventListener("pointermove", (e) => {
    if (!isDragging) return;
    const deltaY = e.clientY - startY;
    const currentHeight = startHeight + deltaY;
    const newRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round((currentHeight - 7) / 67)));
    if (newRows !== activeActionRowCount) {
      activeActionRowCount = newRows;
      container.style.height = getRowHeight(activeActionRowCount) + "px";
      renderActionNav();
    }
  });

  const stopDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    try {
      resizer.releasePointerCapture(e.pointerId);
    } catch (_) {}
    chrome.storage.local.set({ actionNavRowCount: activeActionRowCount });
  };

  resizer.addEventListener("pointerup", stopDrag);
  resizer.addEventListener("pointercancel", stopDrag);

  // Restore saved row count
  chrome.storage.local.get(["actionNavRowCount"], (res) => {
    if (res && res.actionNavRowCount >= MIN_ROWS && res.actionNavRowCount <= MAX_ROWS) {
      activeActionRowCount = res.actionNavRowCount;
      if (container) container.style.height = getRowHeight(activeActionRowCount) + "px";
      renderActionNav();
    }
  });
}

function initActionNavResize() {
  const container = $("actionNavContainer");
  if (!container) return;
  initActionNavWheelPagination();
  initActionDragEdgeZones();
  loadActionOrder(getActiveServiceId(), () => {
    renderActionNav();
    initActionNavResizer();
  });

  let lastCols = -1;
  const handleResize = () => {
    const cols = calculateVisibleColumns(container);
    if (cols !== lastCols) {
      lastCols = cols;
      renderActionNav();
    }
  };

  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(handleResize);
    });
    ro.observe(container);
    ro.observe(document.body);
  }

  window.addEventListener("resize", () => {
    requestAnimationFrame(handleResize);
  });
}


// 서비스가 바뀌었을 때 액션 타일을 그 서비스 것으로 갈아끼운다.
// 페이지 인덱스 초기화 같은 내부 상태 조작이 밖으로 새어 나가지 않도록 여기서 묶어 둔다.
function showActionsForService(serviceId, onReady) {
  loadActionOrder(serviceId, () => {
    activeActionPageIndex = 0;
    renderActionNav();
    if (onReady) onReady();
  });
}


export {
  showActionsForService,
  actionPageTransitionTimer,
  activeActionPageIndex,
  activeActionRowCount,
  createActionTileButton,
  currentActionList,
  draggedActionId,
  getActionPaginationInfo,
  goToActionPage,
  initActionDragEdgeZones,
  initActionNavResize,
  initActionNavResizer,
  initActionNavWheelPagination,
  isActionPageTransitioning,
  isActionWheeling,
  loadActionOrder,
  renderActionNav,
  resetCurrentServiceActions,
  saveActionOrder,
  updateActionEdgeZoneStates,
  updateActionIndicatorDots,
};
