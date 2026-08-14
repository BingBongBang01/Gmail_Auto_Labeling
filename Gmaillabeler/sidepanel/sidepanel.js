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
    { id: "settings_oauth", label: "OAuth설정", icon: "🔑", title: "Google OAuth 설정", handler: () => renderSettingsPanel("oauth") },
    { id: "settings_general", label: "테마/언어", icon: "🎨", title: "테마 및 언어 설정", handler: () => renderSettingsPanel("general") },
    { id: "settings_ai", label: "AI/Gemini", icon: "✨", title: "Gemini AI 모델 설정", handler: () => renderSettingsPanel("ai") },
    { id: "settings_labels", label: "라벨/분류", icon: "🏷️", title: "라벨 분류 기준 설정", handler: () => renderSettingsPanel("labels") },
    { id: "settings_automation", label: "자동화", icon: "⚡", title: "자동 실행 및 배치 설정", handler: () => renderSettingsPanel("automation") },
    { id: "settings_notifications", label: "알림", icon: "🔔", title: "작업 완료 알림 설정", handler: () => renderSettingsPanel("notifications") },
    { id: "settings_backup", label: "데이터/백업", icon: "💾", title: "설정 백업 및 초기화", handler: () => renderSettingsPanel("backup") },
    { id: "settings_dashboard", label: "대시보드", icon: "📊", title: "통계 대시보드 열기", handler: () => $("btnDashboard")?.click() },
    { id: "settings_full_options", label: "전체설정창", icon: "↗️", title: "전체 설정 페이지 열기", handler: () => chrome.runtime.openOptionsPage?.() }
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

function setActionFeedback(msg) {
  const desc = $("contextDesc");
  if (desc) desc.textContent = msg;
}

function startJob(jobType, payload = {}) {
  setActionFeedback(`작업을 요청 중입니다... (${jobType})`);
  chrome.runtime.sendMessage({ action: "job.start", jobType, payload }, (response) => {
    if (chrome.runtime.lastError) {
      setActionFeedback(`작업 요청 실패: ${chrome.runtime.lastError.message}`);
    } else if (response && response.error) {
      setActionFeedback(`오류: ${response.error}`);
    } else {
      setActionFeedback(`작업이 정상적으로 시작되었습니다.`);
    }
  });
}

function resetCurrentServiceActions() {
  const defaultList = DEFAULT_SERVICE_ACTIONS[activeServiceId] || [];
  currentActionList = [...defaultList];
  saveActionOrder(activeServiceId);
  renderActionNav();
  setActionFeedback("중간 액션 타일 순서가 기본값으로 초기화되었습니다.");
}

function resetTopServiceOrder() {
  currentServiceList = [...SERVICE_REGISTRY];
  saveServiceOrder();
  renderServiceNav();
  setActionFeedback("상단 서비스 타일 순서가 기본값으로 초기화되었습니다.");
}

function handleServiceChange(serviceId) {
  const service =
    currentServiceList.find((s) => s.id === serviceId) ||
    SERVICE_REGISTRY.find((s) => s.id === serviceId);
  if (service) {
    updateContextUI({
      service: service.label,
      pageType: serviceId === "settings" ? "settings" : "inbox",
      title: service.label,
      desc:
        serviceId === "settings"
          ? "사이드패널에서 즉시 변경할 설정 항목을 선택하세요."
          : `${service.label} 서비스와 연동할 준비가 되었습니다.`
    });
    loadActionOrder(service.id, () => {
      activeActionPageIndex = 0;
      renderActionNav();
      renderServiceWorkspace(service.id);
    });
  }
}

function renderServiceWorkspace(serviceId) {
  const container = $("panelContainer");
  const dynamicActions = $("dynamicActions");
  if (!container) return;

  if (dynamicActions) dynamicActions.innerHTML = "";
  container.innerHTML = "";

  if (serviceId === "settings") {
    renderSettingsPanel(currentSettingsSection || "oauth");
  } else if (serviceId === "gmail") {
    renderGmailWorkspace();
  } else if (serviceId === "calendar") {
    renderCalendarWorkspace();
  } else if (serviceId === "gemini") {
    renderGeminiWorkspace();
  } else if (serviceId === "edit") {
    renderEditWorkspace();
  } else {
    renderGenericServiceWorkspace(serviceId);
  }
}

function renderGmailWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">📧</span>
      <h3 class="workspace-title">Gmail AI 스마트 비서</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      현재 메일함의 수신 메일을 AI로 분석하여 자동 라벨링 및 요약을 수행합니다.
    </p>
    <div class="workspace-btn-grid">
      <button class="btn btn-primary" id="btnSpGmailClassify">▶️ 메일 AI 라벨링 시작</button>
      <button class="btn btn-outlined" id="btnSpGmailSummarize">📝 중요 메일 브리핑 요약</button>
    </div>
  `;
  container.appendChild(card);

  $("btnSpGmailClassify")?.addEventListener("click", () => startJob("gmail_classify"));
  $("btnSpGmailSummarize")?.addEventListener("click", () => startJob("gmail_summarize"));
}

function renderCalendarWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">📅</span>
      <h3 class="workspace-title">Google 캘린더 스마트 일정</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      캘린더 이벤트를 분석하여 카테고리별 색상을 자동 지정하고 일정을 브리핑합니다.
    </p>
    <div class="workspace-btn-grid">
      <button class="btn btn-primary" id="btnSpCalClassify">📅 이번 주 일정 자동 분류</button>
      <button class="btn btn-outlined" id="btnSpCalInit">🎨 카테고리 색상 생성/적용</button>
    </div>
  `;
  container.appendChild(card);

  $("btnSpCalClassify")?.addEventListener("click", () => startJob("calendar_classify"));
  $("btnSpCalInit")?.addEventListener("click", () => startJob("calendar_init_categories"));
}

function renderGeminiWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">✨</span>
      <h3 class="workspace-title">Gemini AI 어시스턴트</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      빠른 프롬프트 칩을 선택하거나 직접 AI 작업을 실행하세요.
    </p>
    <div class="ai-chips-row">
      <button class="ai-chip" data-prompt="오늘 받은 긴급 메일 요약해줘">📬 긴급 메일 요약</button>
      <button class="ai-chip" data-prompt="정중한 거절 메일 답장 초안 작성해줘">✍️ 정중한 답장 초안</button>
      <button class="ai-chip" data-prompt="이번 주 남은 일정 브리핑">📆 이번 주 일정 요약</button>
    </div>
  `;
  container.appendChild(card);

  card.querySelectorAll(".ai-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      setActionFeedback(`Gemini 요청: "${chip.dataset.prompt}"`);
    });
  });
}

function renderEditWorkspace() {
  const container = $("panelContainer");
  if (!container) return;

  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">✏️</span>
      <h3 class="workspace-title">타일 순서 편집 및 초기화</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      상단 서비스 바와 중간 액션 바의 타일을 원하는 위치로 직접 <strong>드래그 & 드롭</strong>하여 순서를 변경할 수 있습니다.
    </p>
    <div class="workspace-btn-grid">
      <button class="btn btn-outlined" id="btnResetTopServices">🔄 상단 서비스 타일 순서 초기화</button>
      <button class="btn btn-outlined" id="btnResetMidActions">🔄 중간 액션 타일 순서 초기화</button>
    </div>
  `;
  container.appendChild(card);

  $("btnResetTopServices")?.addEventListener("click", resetTopServiceOrder);
  $("btnResetMidActions")?.addEventListener("click", resetCurrentServiceActions);
}

function renderGenericServiceWorkspace(serviceId) {
  const container = $("panelContainer");
  if (!container) return;

  const service = SERVICE_REGISTRY.find((s) => s.id === serviceId) || { label: serviceId, icon: "⚡" };
  const card = document.createElement("div");
  card.className = "workspace-card";
  card.innerHTML = `
    <div class="workspace-card-header">
      <span class="workspace-icon">${service.icon}</span>
      <h3 class="workspace-title">${service.label} 서비스</h3>
    </div>
    <p class="body-medium" style="margin-bottom:12px; color:var(--md-sys-color-on-surface-variant);">
      상단 중간바에서 실행할 작업을 클릭하거나 단축키를 이용하세요.
    </p>
  `;
  container.appendChild(card);
}

let currentSettingsSection = "oauth";

function showSettingsToast(msg) {
  const pill = $("settingsFeedbackPill");
  if (!pill) return;
  pill.textContent = msg;
  pill.classList.add("show");
  clearTimeout(pill._timer);
  pill._timer = setTimeout(() => {
    pill.classList.remove("show");
  }, 2200);
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bindSettingsPanelEvents(sectionId, settings) {
  if (!settings) return;

  if (sectionId === "oauth") {
    const badge = $("spOAuthStatusBadge");
    const desc = $("spOAuthAccountDesc");
    const btnConnect = $("btnConnectGoogleSP");
    const btnDisconnect = $("btnDisconnectGoogleSP");

    function refreshOAuthStatus() {
      chrome.runtime.sendMessage({ action: "getOAuthStatus" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.connected) {
          if (badge) {
            badge.textContent = "미연결";
            badge.className = "oauth-status-badge error";
          }
          if (desc) desc.textContent = "Google 계정에 로그인하여 AI 자동 라벨링 및 캘린더 기능을 연동하세요.";
          if (btnConnect) {
            btnConnect.textContent = "Google 계정 로그인 / 연결";
            btnConnect.style.display = "inline-flex";
            btnConnect.disabled = false;
          }
          if (btnDisconnect) btnDisconnect.style.display = "none";
        } else {
          if (badge) {
            badge.textContent = "연결됨";
            badge.className = "oauth-status-badge success";
          }
          if (desc) desc.textContent = res.email ? `${res.email} 계정과 연결되어 정상 작동 중입니다.` : "Google 서비스와 정상 연결되어 있습니다.";
          if (btnConnect) {
            btnConnect.textContent = "계정 재연결";
            btnConnect.style.display = "inline-flex";
            btnConnect.disabled = false;
          }
          if (btnDisconnect) btnDisconnect.style.display = "inline-flex";
        }
      });
    }

    refreshOAuthStatus();

    btnConnect?.addEventListener("click", () => {
      const clientId = ($("spOAuthClientId")?.value || "").trim();
      if (!clientId) {
        showSettingsToast("먼저 아래에 Client ID를 입력하고 저장해 주세요.");
        return;
      }
      btnConnect.disabled = true;
      if (desc) desc.textContent = "Google 로그인 창이 열렸습니다. 인증을 완료해 주세요...";
      chrome.runtime.sendMessage({ action: "authorizeOAuth" }, () => {
        if (chrome.runtime.lastError) {
          showSettingsToast(chrome.runtime.lastError.message || "OAuth 시작 실패");
          refreshOAuthStatus();
        } else {
          showSettingsToast("Google 로그인이 시작되었습니다.");
          setTimeout(refreshOAuthStatus, 3500);
        }
      });
    });

    btnDisconnect?.addEventListener("click", () => {
      chrome.runtime.sendMessage({ action: "disconnectOAuth" }, () => {
        showSettingsToast("Google 계정 연동이 해제되었습니다.");
        refreshOAuthStatus();
      });
    });

    const saveBtn = $("btnSaveOAuth");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const clientId = ($("spOAuthClientId")?.value || "").trim();
        const clientSecret = ($("spOAuthClientSecret")?.value || "").trim();
        SettingsStore.updateCategory("google", {
          oauth: { clientId, clientSecret }
        }, () => {
          showSettingsToast("OAuth 설정이 저장되었습니다.");
          refreshOAuthStatus();
        });
      });
    }
    $("btnOAuthOptionsGuide")?.addEventListener("click", () => {
      chrome.runtime.openOptionsPage?.();
    });
  }

  if (sectionId === "general") {
    const themeSelect = $("spThemeMode");
    if (themeSelect) {
      themeSelect.addEventListener("change", (e) => {
        const theme = e.target.value;
        applyTheme(theme);
        SettingsStore.updateCategory("general", { themeMode: theme }, () => {
          showSettingsToast("테마가 변경되었습니다.");
        });
      });
    }

    const langSelect = $("spLanguage");
    if (langSelect) {
      langSelect.addEventListener("change", (e) => {
        const lang = e.target.value;
        SettingsStore.updateCategory("general", { language: lang }, () => {
          showSettingsToast("언어가 저장되었습니다.");
        });
      });
    }

    const openSideCheck = $("spOpenSidePanel");
    const showStatusCheck = $("spShowStatus");
    const saveStartup = () => {
      SettingsStore.updateCategory("general", {
        startupBehavior: {
          openSidePanelOnGmail: !!openSideCheck?.checked,
          showStatusOnGmail: !!showStatusCheck?.checked
        }
      }, () => {
        showSettingsToast("시작 옵션이 저장되었습니다.");
      });
    };
    openSideCheck?.addEventListener("change", saveStartup);
    showStatusCheck?.addEventListener("change", saveStartup);
  }

  if (sectionId === "ai") {
    const saveBtn = $("btnSaveAi");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const apiKey = ($("spGeminiApiKey")?.value || "").trim();
        const model = $("spGeminiModel")?.value || "gemini-2.0-flash";
        const rpmLimit = parseInt($("spRpmLimit")?.value, 10) || 15;

        const credentials = [...(settings.ai?.credentials || [])];
        if (credentials.length === 0) {
          credentials.push({
            id: "cred_gemini_1",
            provider: "gemini",
            name: "Gemini Key",
            apiKey,
            model,
            enabled: true,
            priority: 1,
            status: "active"
          });
        } else {
          credentials[0].apiKey = apiKey;
          credentials[0].model = model;
        }

        SettingsStore.updateCategory("ai", {
          credentials,
          requestPolicy: {
            ...(settings.ai?.requestPolicy || {}),
            rpmLimit
          }
        }, () => {
          showSettingsToast("AI 설정이 저장되었습니다.");
        });
      });
    }
  }

  if (sectionId === "labels") {
    const saveBtn = $("btnSaveLabels");
    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        const enabled = !!$("spClassificationEnabled")?.checked;
        const threshold = parseInt($("spThreshold")?.value, 10) || 1;
        const batchSize = parseInt($("spBatchSize")?.value, 10) || 50;

        SettingsStore.updateCategory("gmail", {
          classification: {
            ...(settings.gmail?.classification || {}),
            enabled,
            threshold,
            batchSize
          }
        }, () => {
          showSettingsToast("라벨 설정이 저장되었습니다.");
        });
      });
    }
  }

  if (sectionId === "automation") {
    const autoCheck = $("spAutoClassify");
    const newMailCheck = $("spNewMailOnly");
    const saveAuto = () => {
      SettingsStore.updateCategory("automation", {
        autoClassify: {
          ...(settings.automation?.autoClassify || {}),
          enabled: !!autoCheck?.checked,
          newMailOnly: !!newMailCheck?.checked
        }
      }, () => {
        showSettingsToast("자동화 설정이 저장되었습니다.");
      });
    };
    autoCheck?.addEventListener("change", saveAuto);
    newMailCheck?.addEventListener("change", saveAuto);
  }

  if (sectionId === "backup") {
    $("btnExportSettings")?.addEventListener("click", () => {
      SettingsStore.exportSettings((jsonStr) => {
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `gmail_labeler_settings_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showSettingsToast("설정 파일이 다운로드되었습니다.");
      });
    });

    const fileInput = $("spImportFileInput");
    $("btnImportSettings")?.addEventListener("click", () => {
      fileInput?.click();
    });

    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const imported = JSON.parse(evt.target.result);
          SettingsStore.saveSettings(imported, () => {
            showSettingsToast("설정이 성공적으로 복원되었습니다.");
            renderSettingsPanel("backup");
          });
        } catch (_) {
          showSettingsToast("올바른 JSON 파일이 아닙니다.");
        }
      };
      reader.readAsText(file);
    });

    $("btnResetSettings")?.addEventListener("click", () => {
      if (confirm("모든 설정을 초기 기본값으로 되돌리시겠습니까?")) {
        SettingsStore.resetToDefaults(() => {
          showSettingsToast("설정이 초기화되었습니다.");
          renderSettingsPanel("backup");
        });
      }
    });
  }
}

function renderSettingsPanel(sectionId) {
  currentSettingsSection = sectionId || "oauth";
  const container = $("panelContainer");
  const dynamicActions = $("dynamicActions");
  if (!container) return;

  if (dynamicActions) dynamicActions.innerHTML = "";
  container.innerHTML = "";

  document.querySelectorAll(".action-nav-track .service-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.action === `settings_${currentSettingsSection}`);
  });

  const wrapper = document.createElement("div");
  wrapper.className = "settings-panel-wrapper";

  if (typeof SettingsStore === "undefined") {
    wrapper.innerHTML = `<div class="card"><p class="body-medium">SettingsStore를 불러올 수 없습니다.</p></div>`;
    container.appendChild(wrapper);
    return;
  }

  SettingsStore.getSettings((settings) => {
    let title = "";
    let icon = "";
    let contentHtml = "";

    switch (currentSettingsSection) {
      case "oauth":
        title = "Google OAuth 설정";
        icon = "🔑";
        const clientId = settings?.google?.oauth?.clientId || "";
        const clientSecret = settings?.google?.oauth?.clientSecret || "";

        contentHtml = `
          <div class="oauth-account-card" id="spOAuthAccountCard">
            <div class="oauth-account-header">
              <span class="oauth-account-title">Google 계정 연동 상태</span>
              <span class="oauth-status-badge" id="spOAuthStatusBadge">확인 중...</span>
            </div>
            <div class="oauth-account-desc" id="spOAuthAccountDesc">계정 연동 상태를 확인하고 있습니다.</div>
            <div class="oauth-btn-group">
              <button class="btn btn-primary" id="btnConnectGoogleSP">Google 계정 로그인 / 연결</button>
              <button class="btn btn-outlined danger" id="btnDisconnectGoogleSP" style="display:none;">연동 해제</button>
            </div>
          </div>
          <div class="form-group" style="margin-top: 14px;">
            <label class="settings-label">Client ID</label>
            <input type="text" id="spOAuthClientId" class="settings-input" placeholder="Google Cloud OAuth Client ID" value="${escapeHtml(clientId)}">
          </div>
          <div class="form-group">
            <label class="settings-label">Client Secret</label>
            <input type="password" id="spOAuthClientSecret" class="settings-input" placeholder="Client Secret" value="${escapeHtml(clientSecret)}">
          </div>
          <div class="settings-btn-row">
            <button class="btn btn-primary" id="btnSaveOAuth">OAuth 정보 저장</button>
            <button class="btn btn-outlined" id="btnOAuthOptionsGuide">전체 설정 열기</button>
          </div>
        `;
        break;

      case "general":
        title = "테마 및 언어 설정";
        icon = "🎨";
        const theme = settings?.general?.themeMode || "system";
        const lang = settings?.general?.language || "en";
        const openSidePanel = !!settings?.general?.startupBehavior?.openSidePanelOnGmail;
        const showStatus = !!settings?.general?.startupBehavior?.showStatusOnGmail;

        contentHtml = `
          <div class="form-group">
            <label class="settings-label">테마 모드 (Theme)</label>
            <select id="spThemeMode" class="settings-select">
              <option value="system" ${theme === "system" ? "selected" : ""}>시스템 기본값 (System)</option>
              <option value="light" ${theme === "light" ? "selected" : ""}>라이트 모드 (Light)</option>
              <option value="dark" ${theme === "dark" ? "selected" : ""}>다크 모드 (Dark)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="settings-label">언어 (Language)</label>
            <select id="spLanguage" class="settings-select">
              <option value="ko" ${lang === "ko" ? "selected" : ""}>한국어 (Korean)</option>
              <option value="en" ${lang === "en" ? "selected" : ""}>English</option>
              <option value="ja" ${lang === "ja" ? "selected" : ""}>日本語 (Japanese)</option>
              <option value="zh_CN" ${lang === "zh_CN" ? "selected" : ""}>简体中文 (Chinese)</option>
            </select>
          </div>
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="spOpenSidePanel" ${openSidePanel ? "checked" : ""}>
              <span>Gmail 열릴 때 사이드패널 자동 열기</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" id="spShowStatus" ${showStatus ? "checked" : ""}>
              <span>Gmail 상단에 확장 프로그램 상태 배지 표시</span>
            </label>
          </div>
        `;
        break;

      case "ai":
        title = "Gemini AI 모델 설정";
        icon = "✨";
        const cred = (settings?.ai?.credentials && settings.ai.credentials[0]) || {};
        const apiKey = cred.apiKey || "";
        const model = cred.model || "gemini-2.0-flash";
        const rpm = settings?.ai?.requestPolicy?.rpmLimit || 15;

        contentHtml = `
          <div class="form-group">
            <label class="settings-label">Gemini API 키</label>
            <input type="password" id="spGeminiApiKey" class="settings-input" placeholder="AI Studio API Key" value="${escapeHtml(apiKey)}">
          </div>
          <div class="form-group">
            <label class="settings-label">AI 모델</label>
            <select id="spGeminiModel" class="settings-select">
              <option value="gemini-2.0-flash" ${model === "gemini-2.0-flash" ? "selected" : ""}>Gemini 2.0 Flash (빠르고 권장)</option>
              <option value="gemini-1.5-flash" ${model === "gemini-1.5-flash" ? "selected" : ""}>Gemini 1.5 Flash</option>
              <option value="gemini-1.5-pro" ${model === "gemini-1.5-pro" ? "selected" : ""}>Gemini 1.5 Pro</option>
            </select>
          </div>
          <div class="form-group">
            <label class="settings-label">분당 요청 한도 (RPM Limit)</label>
            <input type="number" id="spRpmLimit" class="settings-input" min="1" max="60" value="${rpm}">
          </div>
          <div class="settings-btn-row">
            <button class="btn btn-primary" id="btnSaveAi">AI 설정 저장</button>
          </div>
        `;
        break;

      case "labels":
        title = "라벨 및 분류 설정";
        icon = "🏷️";
        const classificationEnabled = settings?.gmail?.classification?.enabled !== false;
        const threshold = settings?.gmail?.classification?.threshold || 1;
        const batchSize = settings?.gmail?.classification?.batchSize || 50;

        contentHtml = `
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="spClassificationEnabled" ${classificationEnabled ? "checked" : ""}>
              <span>AI 자동 분류 활성화</span>
            </label>
          </div>
          <div class="form-group">
            <label class="settings-label">분류 트리거 기준 (신규 메일 수)</label>
            <input type="number" id="spThreshold" class="settings-input" min="1" max="20" value="${threshold}">
          </div>
          <div class="form-group">
            <label class="settings-label">1회 배치 처리량 (Batch Size)</label>
            <input type="number" id="spBatchSize" class="settings-input" min="10" max="100" value="${batchSize}">
          </div>
          <div class="settings-btn-row">
            <button class="btn btn-primary" id="btnSaveLabels">라벨 설정 저장</button>
          </div>
        `;
        break;

      case "automation":
        title = "자동화 실행 설정";
        icon = "⚡";
        const autoEnabled = settings?.automation?.autoClassify?.enabled !== false;
        const newMailOnly = settings?.automation?.autoClassify?.newMailOnly !== false;

        contentHtml = `
          <div class="form-group checkbox-group">
            <label class="checkbox-label">
              <input type="checkbox" id="spAutoClassify" ${autoEnabled ? "checked" : ""}>
              <span>백그라운드 자동 라벨링 활성화</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" id="spNewMailOnly" ${newMailOnly ? "checked" : ""}>
              <span>읽지 않은 신규 메일만 처리</span>
            </label>
          </div>
        `;
        break;

      case "notifications":
        title = "알림 설정";
        icon = "🔔";
        contentHtml = `
          <div class="settings-status-banner info">
            <span>🔔 라벨링 작업 완료 및 상태 변경 알림이 브라우저 알림으로 전달됩니다.</span>
          </div>
        `;
        break;

      case "backup":
        title = "데이터 및 백업";
        icon = "💾";
        contentHtml = `
          <div class="settings-btn-column">
            <button class="btn btn-outlined" id="btnExportSettings">📥 설정 JSON 내보내기 (백업)</button>
            <button class="btn btn-outlined" id="btnImportSettings">📤 설정 JSON 가져오기 (복원)</button>
            <input type="file" id="spImportFileInput" accept=".json" style="display:none;">
            <button class="btn btn-outlined danger" id="btnResetSettings">⚠️ 전체 설정 초기화</button>
          </div>
        `;
        break;

      default:
        title = "설정";
        icon = "⚙️";
        contentHtml = `<p class="body-medium">원하는 설정 타일을 상단 중간바에서 선택해 주세요.</p>`;
    }

    wrapper.innerHTML = `
      <div class="settings-card">
        <div class="settings-header">
          <span class="settings-header-icon">${icon}</span>
          <h3 class="settings-header-title">${title}</h3>
          <span class="settings-feedback-pill" id="settingsFeedbackPill"></span>
        </div>
        <div class="settings-body">
          ${contentHtml}
        </div>
      </div>
    `;

    container.appendChild(wrapper);
    bindSettingsPanelEvents(currentSettingsSection, settings);
  });
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

  initProgressSection();
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
    if (changes.jobProgress || changes.jobStatus) {
      chrome.storage.local.get(["jobStatus", "jobProgress"], (res) => {
        if (res) updateProgressUI(res.jobProgress, res.jobStatus);
      });
    }
    if (changes.appSettings && typeof SettingsStore !== "undefined") {
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

const CONTEXT_FRESHNESS_MS = 10 * 60 * 1000;

function detectInitialContext() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    const url = (activeTab && activeTab.url) || "";

    if (url.includes("mail.google.com")) {
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
      title: (activeTab && activeTab.title) || "Page",
      desc: "No specific AI actions available for this page.",
    });
  });
}

function initTheme(settings) {
  const theme = settings?.general?.themeMode || "system";
  applyTheme(theme);

  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (typeof SettingsStore !== "undefined") {
        SettingsStore.getSetting("general.themeMode").then((mode) => {
          if (!mode || mode === "system") applyTheme("system");
        });
      }
    });
  }
}

// 지금 표시 중인 컨텍스트
let currentContext = {};

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
