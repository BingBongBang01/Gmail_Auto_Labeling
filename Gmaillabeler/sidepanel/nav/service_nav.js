// sidepanel/nav/service_nav.js
// 상단 서비스 타일 내비게이션: 렌더, 페이지 넘김, 드래그 재정렬, 휠, 높이 조절.
//
// 이 모듈의 상태(activePageIndex, activeRowCount 등)를 만지는 코드는 전부 이 파일 안에 있다.
// 예전에는 리사이즈/휠 처리가 파일 맨 끝에 따로 떨어져 있으면서 같은 변수를 건드렸다.
//
// 알려진 중복: action_nav.js가 거의 같은 구조를 한 벌 더 갖고 있다.
// 둘을 하나의 타일 내비 컴포넌트로 합치는 건 별도 작업으로 남겨둔다.

import { SERVICE_REGISTRY } from "./registry.js";
import { $ } from "../ui/dom.js";
import { setActionFeedback } from "../ui/feedback.js";
import { emit, SERVICE_SELECTED } from "../ui/bus.js";

let currentServiceList = [...SERVICE_REGISTRY];
let activeServiceId = "gmail";

// 다른 모듈은 이 값을 직접 읽지 않고 이 함수를 쓴다.
// (ES 모듈의 import 바인딩은 읽기 전용이라 밖에서 대입할 수 없고, 읽기 경로도 하나로 두는 편이 낫다)
function getActiveServiceId() {
  return activeServiceId;
}

// Gmail 페이지 컨텍스트를 감지해 화면이 알아서 서비스를 바꿔야 할 때 쓴다.
// activeServiceId는 이 모듈의 상태이므로, 밖에서 대입하지 않고 이 함수를 거친다
// (ES 모듈에서 import한 바인딩에 대입하면 ReferenceError/TypeError가 난다).
function syncActiveServiceTile(serviceId) {
  if (!serviceId || serviceId === activeServiceId) return false;
  activeServiceId = serviceId;
  document.querySelectorAll(".service-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.service === activeServiceId);
  });
  return true;
}

// 사용자가 재정렬한 현재 서비스 목록.
function getServiceList() {
  return currentServiceList;
}
let lastTileCount = -1;
let activeRowCount = 1;
let activePageIndex = 0;
let draggedServiceId = null;
let autoScrollInterval = null;
let isWheeling = false;
const MIN_ROWS = 1;
const MAX_ROWS = 5;

function getRowHeight(rows) {
  return rows * 60 + (rows - 1) * 7 + 14;
}

function calculateVisibleColumns(container) {
  if (!container) return 5;
  const containerWidth = container.clientWidth || window.innerWidth;
  const padding = 14; // 7px left + 7px right
  const gap = 7;
  const itemWidth = 60;
  const availableWidth = containerWidth - padding;
  if (availableWidth <= 0) return 1;
  const fitCols = Math.floor((availableWidth + gap) / (itemWidth + gap));
  return Math.max(1, fitCols);
}

function getPaginationInfo() {
  const container = $("serviceNavContainer") || $("serviceNavTrack");
  const cols = calculateVisibleColumns(container);
  const rows = activeRowCount;
  const pageSize = cols * rows;
  const totalServices = currentServiceList.length;
  const totalPages = Math.max(1, Math.ceil(totalServices / pageSize));
  return { cols, rows, pageSize, totalPages };
}

function saveServiceOrder() {
  chrome.storage.local.set({ serviceNavOrder: currentServiceList.map((s) => s.id) });
}

function loadServiceOrder(callback) {
  chrome.storage.local.get(["serviceNavOrder"], (res) => {
    if (res && Array.isArray(res.serviceNavOrder) && res.serviceNavOrder.length > 0) {
      const orderIds = res.serviceNavOrder;
      const ordered = [];
      const registryMap = new Map(SERVICE_REGISTRY.map((s) => [s.id, s]));

      for (const id of orderIds) {
        if (registryMap.has(id)) {
          ordered.push(registryMap.get(id));
          registryMap.delete(id);
        }
      }
      for (const remaining of registryMap.values()) {
        ordered.push(remaining);
      }
      currentServiceList = ordered;
    }
    if (callback) callback();
  });
}

let isPageTransitioning = false;
let pageTransitionTimer = null;

function goToPage(pageIndex) {
  const track = $("serviceNavTrack");
  if (!track) return;
  const { totalPages } = getPaginationInfo();
  const targetPage = Math.max(0, Math.min(totalPages - 1, pageIndex));

  activePageIndex = targetPage;
  isPageTransitioning = true;
  clearTimeout(pageTransitionTimer);

  const pageWidth = track.clientWidth;
  track.scrollTo({
    left: activePageIndex * pageWidth,
    behavior: "smooth"
  });

  updateIndicatorDots();
  updateEdgeZoneStates();

  pageTransitionTimer = setTimeout(() => {
    isPageTransitioning = false;
  }, 350);
}

function updateIndicatorDots() {
  const indicators = $("pageIndicators");
  if (!indicators) return;
  const dots = indicators.querySelectorAll(".page-dot");
  dots.forEach((dot, idx) => {
    dot.classList.toggle("active", idx === activePageIndex);
  });
}

function updateEdgeZoneStates() {
  const edgeLeft = $("dragEdgeLeft");
  const edgeRight = $("dragEdgeRight");
  const { totalPages } = getPaginationInfo();

  if (edgeLeft) {
    edgeLeft.classList.toggle("disabled", activePageIndex <= 0 || totalPages <= 1);
  }
  if (edgeRight) {
    edgeRight.classList.toggle("disabled", activePageIndex >= totalPages - 1 || totalPages <= 1);
  }
}

function initDragEdgeZones() {
  const edgeLeft = $("dragEdgeLeft");
  const edgeRight = $("dragEdgeRight");
  if (!edgeLeft || !edgeRight) return;

  let leftTimer = null;
  let rightTimer = null;

  edgeLeft.addEventListener("dragover", (e) => {
    if (!draggedServiceId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    edgeLeft.classList.add("drag-hover");

    if (!leftTimer && activePageIndex > 0) {
      leftTimer = setTimeout(() => {
        if (draggedServiceId && activePageIndex > 0) {
          goToPage(activePageIndex - 1);
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
    if (!draggedServiceId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    edgeRight.classList.add("drag-hover");

    const { totalPages } = getPaginationInfo();
    if (!rightTimer && activePageIndex < totalPages - 1) {
      rightTimer = setTimeout(() => {
        if (draggedServiceId && activePageIndex < totalPages - 1) {
          goToPage(activePageIndex + 1);
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

function createServiceTileButton(service) {
  const btn = document.createElement("button");
  const isCurrentDragged = service.id === draggedServiceId;
  btn.className =
    "service-btn" +
    (service.id === activeServiceId ? " active" : "") +
    (service.isEmpty ? " empty" : "") +
    (isCurrentDragged ? " dragging" : "");
  btn.dataset.service = service.id;
  btn.title = service.title;

  const iconSpan = document.createElement("span");
  iconSpan.className = "service-icon";
  iconSpan.textContent = service.icon;

  const labelSpan = document.createElement("span");
  labelSpan.className = "service-label";
  labelSpan.textContent = service.label;

  btn.appendChild(iconSpan);
  btn.appendChild(labelSpan);

  // Click handler for selection
  if (!service.isEmpty) {
    btn.addEventListener("click", () => {
      activeServiceId = service.id;
      document.querySelectorAll(".service-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      // 무엇을 선택했는지만 알린다. 그 다음에 어떤 화면을 그릴지는 이 모듈의 관심사가 아니다.
      emit(SERVICE_SELECTED, { serviceId: service.id });
    });

    // Draggable setup
    btn.draggable = true;
    btn.addEventListener("dragstart", (e) => {
      draggedServiceId = service.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", service.id);

      const container = $("serviceNavContainer");
      if (container) container.classList.add("is-dragging");
      updateEdgeZoneStates();

      setTimeout(() => {
        btn.classList.add("dragging");
      }, 0);
    });

    btn.addEventListener("dragend", () => {
      const finishedId = draggedServiceId;
      draggedServiceId = null;

      const container = $("serviceNavContainer");
      if (container) container.classList.remove("is-dragging");

      document.querySelectorAll(".service-btn").forEach((b) => {
        b.classList.remove("dragging", "drag-over");
      });
      document.querySelectorAll(".drag-edge-zone").forEach((z) => {
        z.classList.remove("drag-hover");
      });

      saveServiceOrder();
      if (finishedId) {
        const droppedEl = document.querySelector(`[data-service="${finishedId}"]`);
        if (droppedEl) {
          droppedEl.classList.add("just-dropped");
          setTimeout(() => droppedEl.classList.remove("just-dropped"), 300);
        }
      }
    });
  }

  // Drop target handlers with live FLIP sliding
  btn.addEventListener("dragover", (e) => {
    if (!draggedServiceId || draggedServiceId === service.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  });

  btn.addEventListener("dragenter", (e) => {
    if (!draggedServiceId || draggedServiceId === service.id) return;
    e.preventDefault();

    const srcIndex = currentServiceList.findIndex((s) => s.id === draggedServiceId);
    if (srcIndex === -1) return;

    let targetIndex;
    if (service.isEmpty) {
      targetIndex = currentServiceList.length - 1;
    } else {
      targetIndex = currentServiceList.findIndex((s) => s.id === service.id);
    }

    if (targetIndex === -1 || targetIndex === srcIndex) return;

    // Capture before positions for FLIP
    const prevRectsMap = new Map();
    document.querySelectorAll(".service-btn").forEach((el) => {
      if (el.dataset.service) {
        prevRectsMap.set(el.dataset.service, el.getBoundingClientRect());
      }
    });

    // Move item in array
    const [movedItem] = currentServiceList.splice(srcIndex, 1);
    currentServiceList.splice(targetIndex, 0, movedItem);

    // Re-render with smooth FLIP slide
    renderServiceNav(prevRectsMap);
  });

  btn.addEventListener("dragleave", () => {
    btn.classList.remove("drag-over");
  });

  btn.addEventListener("drop", (e) => {
    e.preventDefault();
    btn.classList.remove("drag-over");
    saveServiceOrder();
  });

  return btn;
}

function renderServiceNav(prevRects = null) {
  const container = $("serviceNavContainer");
  const track = $("serviceNavTrack");
  const indicators = $("pageIndicators");
  if (!container || !track) return;

  container.style.height = getRowHeight(activeRowCount) + "px";

  const { pageSize, totalPages } = getPaginationInfo();
  if (activePageIndex >= totalPages) {
    activePageIndex = totalPages - 1;
  }

  track.innerHTML = "";

  for (let p = 0; p < totalPages; p++) {
    const pageDiv = document.createElement("div");
    pageDiv.className = "service-page";
    pageDiv.dataset.page = p;

    const startIndex = p * pageSize;
    const endIndex = startIndex + pageSize;

    for (let i = startIndex; i < endIndex; i++) {
      let service;
      if (i < currentServiceList.length) {
        service = currentServiceList[i];
      } else {
        service = {
          id: `empty_${i}`,
          label: "빈칸",
          icon: "❓",
          title: "빈칸",
          isEmpty: true
        };
      }

      const btn = createServiceTileButton(service);
      pageDiv.appendChild(btn);
    }

    track.appendChild(pageDiv);
  }

  // Render Page Indicators (Dots)
  if (indicators) {
    indicators.innerHTML = "";
    if (totalPages <= 1) {
      indicators.classList.add("hidden");
    } else {
      indicators.classList.remove("hidden");
      for (let p = 0; p < totalPages; p++) {
        const dot = document.createElement("div");
        dot.className = "page-dot" + (p === activePageIndex ? " active" : "");
        dot.dataset.page = p;
        dot.title = `${p + 1} 페이지`;
        dot.addEventListener("click", () => {
          goToPage(p);
        });

        // Drag hover over dots to jump pages
        dot.addEventListener("dragover", (e) => {
          if (!draggedServiceId) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          dot.classList.add("drag-over");
        });
        dot.addEventListener("dragleave", () => {
          dot.classList.remove("drag-over");
        });
        dot.addEventListener("dragenter", (e) => {
          if (!draggedServiceId) return;
          e.preventDefault();
          dot.classList.add("drag-over");
          goToPage(p);
        });
        dot.addEventListener("drop", (e) => {
          e.preventDefault();
          dot.classList.remove("drag-over");
          goToPage(p);
        });

        indicators.appendChild(dot);
      }
    }
  }

  updateEdgeZoneStates();

  // Ensure track scrolls to the active page
  requestAnimationFrame(() => {
    const pageWidth = track.clientWidth;
    if (pageWidth > 0) {
      track.scrollLeft = activePageIndex * pageWidth;
    }
  });

  // Apply FLIP inversion and play transitions
  if (prevRects) {
    const children = track.querySelectorAll(".service-btn");
    children.forEach((el) => {
      const sId = el.dataset.service;
      if (!sId || !prevRects.has(sId) || sId === draggedServiceId) return;

      const prev = prevRects.get(sId);
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


function initNavWheelPagination() {
  const container = $("serviceNavContainer");
  const track = $("serviceNavTrack");
  if (!container || !track) return;

  container.addEventListener(
    "wheel",
    (e) => {
      const { totalPages } = getPaginationInfo();
      if (totalPages <= 1) return;

      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 8) {
        e.preventDefault();
        if (isWheeling) return;

        isWheeling = true;
        if (e.deltaY > 0) {
          goToPage(activePageIndex + 1);
        } else {
          goToPage(activePageIndex - 1);
        }

        setTimeout(() => {
          isWheeling = false;
        }, 280);
      }
    },
    { passive: false }
  );

  // Track manual trackpad / touch swipe
  track.addEventListener("scroll", () => {
    if (isPageTransitioning) return;
    const pageWidth = track.clientWidth;
    if (pageWidth > 0) {
      const newPage = Math.round(track.scrollLeft / pageWidth);
      if (newPage !== activePageIndex) {
        activePageIndex = newPage;
        updateIndicatorDots();
        updateEdgeZoneStates();
      }
    }
  });
}

function initNavResizer() {
  const resizer = $("navResizer");
  const container = $("serviceNavContainer");
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
    // Quantized midpoint threshold snapping formula: Math.round((currentHeight - 7) / 67)
    const newRows = Math.max(MIN_ROWS, Math.min(MAX_ROWS, Math.round((currentHeight - 7) / 67)));
    if (newRows !== activeRowCount) {
      activeRowCount = newRows;
      container.style.height = getRowHeight(activeRowCount) + "px";
      renderServiceNav();
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
    chrome.storage.local.set({ serviceNavRowCount: activeRowCount });
  };

  resizer.addEventListener("pointerup", stopDrag);
  resizer.addEventListener("pointercancel", stopDrag);

  // Restore saved row count
  chrome.storage.local.get(["serviceNavRowCount"], (res) => {
    if (res && res.serviceNavRowCount >= MIN_ROWS && res.serviceNavRowCount <= MAX_ROWS) {
      activeRowCount = res.serviceNavRowCount;
      if (container) container.style.height = getRowHeight(activeRowCount) + "px";
      renderServiceNav();
    }
  });
}

function initNavResize() {
  const container = $("serviceNavContainer");
  if (!container) return;
  initNavWheelPagination();
  initDragEdgeZones();
  loadServiceOrder(() => {
    renderServiceNav();
    initNavResizer();
  });

  let lastCols = -1;
  const handleResize = () => {
    const cols = calculateVisibleColumns(container);
    if (cols !== lastCols) {
      lastCols = cols;
      renderServiceNav();
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


// 상단 서비스 타일 순서를 기본값으로 되돌린다. 편집 워크스페이스가 부른다.
function resetTopServiceOrder() {
  currentServiceList = [...SERVICE_REGISTRY];
  saveServiceOrder();
  renderServiceNav();
  setActionFeedback("상단 서비스 타일 순서가 기본값으로 초기화되었습니다.");
}

export {
  resetTopServiceOrder,
  MAX_ROWS,
  MIN_ROWS,
  activePageIndex,
  activeRowCount,
  getActiveServiceId,
  syncActiveServiceTile,
  getServiceList,
  autoScrollInterval,
  calculateVisibleColumns,
  createServiceTileButton,
  currentServiceList,
  draggedServiceId,
  getPaginationInfo,
  getRowHeight,
  goToPage,
  initDragEdgeZones,
  initNavResize,
  initNavResizer,
  initNavWheelPagination,
  isPageTransitioning,
  isWheeling,
  lastTileCount,
  loadServiceOrder,
  pageTransitionTimer,
  renderServiceNav,
  saveServiceOrder,
  updateEdgeZoneStates,
  updateIndicatorDots,
};
