// sidepanel/sidepanel.js
const $ = (id) => document.getElementById(id);

const SERVICE_REGISTRY = [
  { id: "gmail", label: "Gmail", icon: "📧", title: "Gmail" },
  { id: "calendar", label: "캘린더", icon: "📅", title: "Calendar" },
  { id: "drive", label: "드라이브", icon: "📁", title: "Drive" },
  { id: "docs", label: "문서", icon: "📄", title: "Docs" },
  { id: "sheets", label: "시트", icon: "📊", title: "Sheets" },
  { id: "slides", label: "슬라이드", icon: "📽️", title: "Slides" },
  { id: "keep", label: "Keep", icon: "💡", title: "Keep" },
  { id: "tasks", label: "Tasks", icon: "☑️", title: "Tasks" },
  { id: "contacts", label: "연락처", icon: "👤", title: "Contacts" },
  { id: "gemini", label: "Gemini", icon: "✨", title: "Gemini" },
  { id: "edit", label: "편집", icon: "✏️", title: "Edit" },
  { id: "settings", label: "설정", icon: "⚙️", title: "Settings" }
];

let currentServiceList = [...SERVICE_REGISTRY];
let activeServiceId = "gmail";
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
      handleServiceChange(service.id);
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

const DEFAULT_SERVICE_ACTIONS = {
  gmail: [
    { id: "gmail_classify", label: "라벨링시작", icon: "▶️", title: "라벨링 시작", handler: () => startJob("gmail_classify") },
    { id: "gmail_auto_settings", label: "자동라벨설정", icon: "🤖", title: "자동 라벨링 설정", handler: () => chrome.runtime.openOptionsPage?.() },
    { id: "gmail_label_settings", label: "라벨설정", icon: "🏷️", title: "라벨 설정", handler: () => chrome.runtime.openOptionsPage?.() },
    { id: "gmail_summarize", label: "메일요약", icon: "📝", title: "메일 전체 요약", handler: () => startJob("gmail_summarize") },
    { id: "gmail_clean", label: "메일정리", icon: "🧹", title: "불필요 메일 정리", handler: () => startJob("gmail_clean") },
    { id: "gmail_filter", label: "필터생성", icon: "🔍", title: "스마트 필터 생성", handler: () => startJob("gmail_filter") },
    { id: "gmail_reply", label: "빠른답장", icon: "⚡", title: "AI 빠른 답장", handler: () => startJob("gmail_reply") },
    { id: "gmail_archive", label: "보관함이동", icon: "📦", title: "읽은 메일 보관", handler: () => startJob("gmail_archive") }
  ],
  calendar: [
    { id: "cal_classify", label: "일정분류", icon: "📅", title: "일정 자동 분류", handler: () => startJob("calendar_classify") },
    { id: "cal_colors", label: "색상적용", icon: "🎨", title: "카테고리 색상 적용", handler: () => startJob("calendar_apply_colors") },
    { id: "cal_new_event", label: "일정생성", icon: "➕", title: "AI 스마트 일정 등록", handler: () => startJob("calendar_new_event") },
    { id: "cal_sync", label: "동기화", icon: "🔄", title: "일정 동기화", handler: () => startJob("calendar_sync") },
    { id: "cal_reminder", label: "알림설정", icon: "⏰", title: "스마트 리마인더", handler: () => startJob("calendar_reminder") },
    { id: "cal_summary", label: "오늘의일정", icon: "📋", title: "오늘 일정 브리핑", handler: () => startJob("calendar_summary") }
  ],
  drive: [
    { id: "drive_search", label: "스마트검색", icon: "🔍", title: "문서 내용 AI 검색", handler: () => startJob("drive_search") },
    { id: "drive_organize", label: "폴더정리", icon: "📁", title: "자동 폴더 정리", handler: () => startJob("drive_organize") },
    { id: "drive_dup", label: "중복검사", icon: "📑", title: "중복 파일 검사", handler: () => startJob("drive_dup") },
    { id: "drive_share", label: "공유관리", icon: "👥", title: "공유 권한 점검", handler: () => startJob("drive_share") },
    { id: "drive_recent", label: "최근파일", icon: "⏱️", title: "최근 작업 요약", handler: () => startJob("drive_recent") }
  ],
  docs: [
    { id: "docs_new", label: "새문서", icon: "📄", title: "새 문서 생성", handler: () => window.open("https://docs.new", "_blank") },
    { id: "docs_proofread", label: "맞춤법검사", icon: "✍️", title: "AI 교정 교열", handler: () => startJob("docs_proofread") },
    { id: "docs_summarize", label: "문서요약", icon: "📝", title: "핵심 요약 생성", handler: () => startJob("docs_summarize") },
    { id: "docs_translate", label: "번역하기", icon: "🌐", title: "다국어 번역", handler: () => startJob("docs_translate") }
  ],
  sheets: [
    { id: "sheets_new", label: "새시트", icon: "📊", title: "새 시트 생성", handler: () => window.open("https://sheets.new", "_blank") },
    { id: "sheets_formula", label: "수식생성", icon: "📐", title: "AI 수식 자동 생성", handler: () => startJob("sheets_formula") },
    { id: "sheets_chart", label: "차트추천", icon: "📈", title: "데이터 시각화 차트", handler: () => startJob("sheets_chart") },
    { id: "sheets_clean", label: "데이터정제", icon: "🧹", title: "결측치 및 중복 제거", handler: () => startJob("sheets_clean") }
  ],
  slides: [
    { id: "slides_new", label: "새슬라이드", icon: "📽️", title: "새 슬라이드 생성", handler: () => window.open("https://slides.new", "_blank") },
    { id: "slides_outline", label: "개요생성", icon: "📑", title: "발표 개요 생성", handler: () => startJob("slides_outline") },
    { id: "slides_theme", label: "테마적용", icon: "🎨", title: "슬라이드 템플릿 적용", handler: () => startJob("slides_theme") }
  ],
  keep: [
    { id: "keep_new", label: "새메모", icon: "💡", title: "빠른 메모 작성", handler: () => startJob("keep_new") },
    { id: "keep_organize", label: "메모분류", icon: "🏷️", title: "태그 및 색상 자동 분류", handler: () => startJob("keep_organize") },
    { id: "keep_todo", label: "체크리스트", icon: "☑️", title: "할 일 목록 변환", handler: () => startJob("keep_todo") }
  ],
  tasks: [
    { id: "tasks_add", label: "작업추가", icon: "➕", title: "새 작업 등록", handler: () => startJob("tasks_add") },
    { id: "tasks_prioritize", label: "우선순위", icon: "⭐", title: "AI 중요도 정렬", handler: () => startJob("tasks_prioritize") },
    { id: "tasks_archive", label: "완료정리", icon: "✔️", title: "완료 작업 정리", handler: () => startJob("tasks_archive") }
  ],
  contacts: [
    { id: "contacts_search", label: "연락처검색", icon: "👤", title: "스마트 검색", handler: () => startJob("contacts_search") },
    { id: "contacts_dedup", label: "중복합치기", icon: "🔗", title: "중복 연락처 병합", handler: () => startJob("contacts_dedup") },
    { id: "contacts_group", label: "그룹생성", icon: "👥", title: "스마트 그룹 생성", handler: () => startJob("contacts_group") }
  ],
  gemini: [
    { id: "gemini_chat", label: "대화시작", icon: "✨", title: "Gemini AI 질의응답", handler: () => startJob("gemini_chat") },
    { id: "gemini_prompt", label: "프롬프트", icon: "💭", title: "추천 프롬프트 실행", handler: () => startJob("gemini_prompt") },
    { id: "gemini_history", label: "대화기록", icon: "📜", title: "지난 대화 기록", handler: () => startJob("gemini_history") }
  ],
  edit: [
    { id: "edit_order", label: "순서편집", icon: "✏️", title: "타일 순서 편집", handler: () => setActionFeedback("타일을 드래그하여 순서를 변경하세요.") },
    { id: "edit_reset", label: "초기화", icon: "🔄", title: "기본 순서로 복원", handler: () => resetCurrentServiceActions() }
  ],
  settings: [
    { id: "settings_oauth", label: "OAuth설정", icon: "🔑", title: "Google OAuth 설정", handler: () => chrome.runtime.openOptionsPage?.() },
    { id: "settings_general", label: "일반설정", icon: "⚙️", title: "확장 프로그램 설정", handler: () => chrome.runtime.openOptionsPage?.() },
    { id: "settings_dashboard", label: "대시보드", icon: "📊", title: "통계 대시보드", handler: () => $("btnDashboard")?.click() }
  ]
};

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
  const sId = serviceId || activeServiceId;
  const key = `actionNavOrder_${sId}`;
  chrome.storage.local.set({ [key]: currentActionList.map((a) => a.id) });
}

function loadActionOrder(serviceId, callback) {
  const sId = serviceId || activeServiceId;
  const key = `actionNavOrder_${sId}`;
  const defaultActions = DEFAULT_SERVICE_ACTIONS[sId] || [
    { id: `${sId}_action_1`, label: "작업1", icon: "⚡", title: "작업 1", handler: () => setActionFeedback("작업 1 실행") },
    { id: `${sId}_action_2`, label: "작업2", icon: "🔍", title: "작업 2", handler: () => setActionFeedback("작업 2 실행") }
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
  const defaultActions = DEFAULT_SERVICE_ACTIONS[activeServiceId] || [];
  currentActionList = [...defaultActions];
  saveActionOrder(activeServiceId);
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
  btn.className =
    "service-btn" +
    (action.isEmpty ? " empty" : "") +
    (isCurrentDragged ? " dragging" : "");
  btn.dataset.action = action.id;
  btn.title = action.title || action.label;

  const iconSpan = document.createElement("span");
  iconSpan.className = "service-icon";
  iconSpan.textContent = action.icon;

  const labelSpan = document.createElement("span");
  labelSpan.className = "service-label";
  labelSpan.textContent = action.label;

  btn.appendChild(iconSpan);
  btn.appendChild(labelSpan);

  if (!action.isEmpty) {
    btn.addEventListener("click", () => {
      if (typeof action.handler === "function") {
        action.handler();
      }
    });

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

      saveActionOrder(activeServiceId);
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
    saveActionOrder(activeServiceId);
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

function handleServiceChange(serviceId) {
  if (serviceId === "settings") {
    chrome.runtime.openOptionsPage?.();
    return;
  }
  const service =
    currentServiceList.find((s) => s.id === serviceId) ||
    SERVICE_REGISTRY.find((s) => s.id === serviceId);
  if (service) {
    updateContextUI({
      service: service.label,
      pageType: "inbox",
      title: service.label,
      desc: `${service.label} 서비스와 연동할 준비가 되었습니다.`
    });
    loadActionOrder(service.id, () => {
      activeActionPageIndex = 0;
      renderActionNav();
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
  loadActionOrder(activeServiceId, () => {
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

async function initSidePanel() {
  if (typeof i18nInit === 'function') {
    await i18nInit();
    i18nApplyToDom(document);
  }

  if (typeof SettingsStore !== 'undefined') {
    SettingsStore.getSettings(settings => {
      initTheme(settings);
    });
  } else {
    initTheme();
  }

  initNavResize();
  initActionNavResize();
  initActionButtons();

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "context.update") {
      updateContextUI(msg.context);
    }
  });

  detectInitialContext();
}

const CONTEXT_FRESHNESS_MS = 10 * 60 * 1000;

function detectInitialContext() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    const url = (activeTab && activeTab.url) || "";

    if (url.includes("mail.google.com")) {
      // 콘텐츠 스크립트가 저장해둔 실제 화면 정보를 쓴다.
      // 예전에는 여기서 pageType을 "inbox"로 고정해버려서, 메일을 열어둔 상태로
      // 사이드패널을 열면 스레드 전용 동작이 절대 나타나지 않았다.
      chrome.storage.local.get(["gmailPageContext"], (stored) => {
        const context = stored && stored.gmailPageContext;
        const isFresh = context && context.at && Date.now() - context.at < CONTEXT_FRESHNESS_MS;
        updateContextUI(
          isFresh
            ? context
            : { service: "Gmail", pageType: "inbox", title: "Inbox", desc: "Ready to assist" }
        );
      });
      return;
    }

    if (url.includes("calendar.google.com")) {
      updateContextUI({ service: "Calendar", pageType: "schedule", title: "Schedule", desc: "Ready to assist" });
      return;
    }

    updateContextUI({
      service: "Web",
      pageType: "other",
      // tab.title은 host_permissions가 있어야 채워진다. 없으면 빈 값으로 온다.
      title: (activeTab && activeTab.title) || "Page",
      desc: "No specific AI actions available for this page.",
    });
  });
}

function initTheme(settings) {
  const theme = settings?.general?.themeMode || "system";
  if (theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.setAttribute("data-theme", "dark");
  }
}

// 지금 표시 중인 컨텍스트. 스레드 단위 작업이 대상 메일 ID를 함께 보내야 한다.
let currentContext = {};

function startJob(jobType, payload) {
  chrome.runtime.sendMessage({ action: "job.start", jobType, payload: payload || {} }, (response) => {
    if (chrome.runtime.lastError) {
      setActionFeedback(chrome.runtime.lastError.message);
      return;
    }
    if (!response || response.ok === false) {
      const reason =
        (response && (response.error || (response.messageKey && t(response.messageKey)))) ||
        "작업을 시작할 수 없습니다.";
      setActionFeedback(reason);
      return;
    }
    setActionFeedback("작업을 시작했습니다.");
  });
}

function setActionFeedback(message) {
  const target = $("contextDesc");
  if (target) target.textContent = message;
}

// Action Registry
const ACTION_REGISTRY = {
  "gmail.inbox": [
    { id: "action_classify_visible", label: "sidepanelClassifyVisible", cls: "btn-primary", handler: () => startJob("gmail_classify") },
    { id: "action_summarize_all", label: "sidepanelSummarizeAll", cls: "btn-secondary", handler: () => startJob("gmail_summarize") }
  ],
  "gmail.thread": [
    { id: "action_classify_thread", label: "sidepanelClassifyThread", cls: "btn-primary", handler: () => startJob("gmail_classify_thread", { messageIds: currentContext.messageIds }) },
    { id: "action_summarize_thread", label: "sidepanelSummarizeThread", cls: "btn-secondary", handler: () => startJob("gmail_summarize_thread", { messageIds: currentContext.messageIds }) }
  ],
  "calendar.schedule": [
    { id: "action_classify_schedule", label: "sidepanelClassifySchedule", cls: "btn-primary", handler: () => startJob("calendar_classify") },
    { id: "action_apply_colors", label: "sidepanelApplyColors", cls: "btn-secondary", handler: () => startJob("calendar_apply_colors") }
  ]
};

function translate(key, fallback) {
  // t()는 키를 못 찾으면 키 문자열 자체를 돌려주므로 `t(x) || fallback`은 절대 fallback을 쓰지 않는다.
  if (typeof t !== "function") return fallback || key;
  const value = t(key);
  return value && value !== key ? value : fallback || key;
}

function updateContextUI(context) {
  currentContext = context || {};

  const sEl = $("contextService");
  if (sEl) sEl.textContent = currentContext.service || "Web";
  const tEl = $("contextTitle");
  if (tEl) tEl.textContent = currentContext.title || "Page";
  const dEl = $("contextDesc");
  if (dEl) dEl.textContent = currentContext.desc || "";

  // Update active status in service nav if service matches
  if (currentContext.service) {
    const matched = SERVICE_REGISTRY.find(
      s => s.id.toLowerCase() === currentContext.service.toLowerCase() ||
        s.label.toLowerCase() === currentContext.service.toLowerCase()
    );
    if (matched && matched.id !== activeServiceId) {
      activeServiceId = matched.id;
      document.querySelectorAll(".service-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.service === activeServiceId);
      });
    }
  }

  const actionsContainer = $("dynamicActions");
  if (!actionsContainer) return;
  actionsContainer.innerHTML = "";

  const registryKey = `${(currentContext.service || "Web").toLowerCase()}.${currentContext.pageType || "other"}`;
  const actions = ACTION_REGISTRY[registryKey] || [];

  if (actions.length === 0) {
    // 예전에는 여기서 innerHTML로 버튼을 그렸는데 id도 핸들러도 없어서 아무 동작이 없었다.
    // 눌러도 아무 일이 없는 버튼을 두는 대신 안내 문구만 남긴다.
    const note = document.createElement("p");
    note.className = "label-small";
    note.style.cssText = "opacity:0.7; text-align:center; padding:12px;";
    note.textContent = translate("sidepanelAnalyzePage", "이 페이지에서 사용할 수 있는 작업이 없습니다.");
    actionsContainer.appendChild(note);
    return;
  }

  actions.forEach((act) => {
    const btn = document.createElement("button");
    btn.className = `btn action-btn ${act.cls}`;
    btn.id = act.id;
    btn.textContent = translate(act.label, act.label);
    btn.addEventListener("click", act.handler);
    actionsContainer.appendChild(btn);
  });
}

function initActionButtons() {
  $("btnSettings")?.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  $("btnDashboard")?.addEventListener("click", () => {
    const dashboardUrl = chrome.runtime.getURL("dashboard/dashboard.html");
    chrome.tabs.create({ url: dashboardUrl });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSidePanel);
} else {
  initSidePanel();
}
