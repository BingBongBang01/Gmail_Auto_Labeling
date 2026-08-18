// sidepanel/nav/registry.js
// 사이드패널에 표시할 서비스 목록과, 서비스별 기본 액션 타일 목록.
//
// 이 파일은 순수 데이터다. import가 하나도 없고, 함수도 들어 있지 않다.
// 예전에는 타일마다 handler 클로저가 박혀 있어서 이 목록이 작업 실행 코드와 워크스페이스
// 렌더 코드를 전부 끌어왔다. 그래서 타일 하나를 추가하려 해도 이 파일이 사이드패널의
// 거의 모든 모듈에 의존하게 됐고, 순환 import까지 생겼다.
//
// 이제 타일은 "무엇을 할지"를 command 문자열로만 가리킨다.
// 실제 동작은 sidepanel/nav/commands.js가 들고 있다.
// 타일 추가: 여기에 항목 한 줄 + (새 동작이라면) commands.js에 한 줄.
//
// ---------------------------------------------------------------------------
// status: 이 타일이 지금 실제로 되는 일인가
// ---------------------------------------------------------------------------
// 없음          지금 동작한다.
// "planned"     아직 구현하지 않았다. 회색으로 그리고, 누르면 안내 카드를 띄운다.
// "unavailable" 구현할 계획이 없다(공개 API가 없는 등). 이유를 note에 적는다.
//
// 왜 필요한가: 타일 59개 중 30개가 등록되지도 않은 작업을 가리키고 있었다.
// 누르면 백그라운드가 "지원하지 않는 작업 유형입니다"를 돌려주는데, 그 응답을 표시할
// 자리마저 없어서(컨텍스트 헤더가 HTML에서 빠져 있었다) 화면에는 정말 아무 일도
// 일어나지 않았다. 되는 일과 안 되는 일을 데이터에 적어두고 화면이 그대로 그린다.
//
// note는 그 타일을 눌렀을 때 본문에 뜨는 설명이다. status가 있으면 반드시 함께 적는다.
// needsScope는 그 기능에 필요한 Google OAuth 스코프다. 안내 카드가 이 값을 보여주고,
// 사용자는 "왜 아직 안 되는지"를 권한 문제로 이해할 수 있다.
//
// status가 없는데 가리키는 작업이 등록돼 있지 않으면 nav/tile_state.js가 실행 시점에
// 걸러낸다. 이 표와 실제 백그라운드가 어긋나는 것을 막는 안전망이다.


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
  { id: "youtube", label: "유튜브", icon: "▶️", title: "YouTube" },
  // 작업/학습/AI는 새로 모으는 데이터가 없다. 이미 쌓이고 있는데 볼 곳이 없던 것들이다.
  { id: "activity", label: "작업", icon: "⏱️", title: "Activity" },
  { id: "learning", label: "학습", icon: "🧠", title: "Learning" },
  // 'Gemini'를 대체한다. 예전 타일 3개는 등록된 적 없는 작업을 가리키고 있었다.
  { id: "ai", label: "AI", icon: "✨", title: "AI" },
  { id: "edit", label: "편집", icon: "✏️", title: "Edit" },
  { id: "settings", label: "설정", icon: "⚙️", title: "Settings" }
];


const DEFAULT_SERVICE_ACTIONS = {
  gmail: [
    { id: "gmail_classify", label: "라벨링시작", icon: "▶️", title: "라벨링 시작", command: "job", arg: "gmail_classify" },
    { id: "gmail_auto_settings", label: "자동설정", icon: "🤖", title: "자동 라벨링 설정", command: "workspace", arg: "gmail_auto_settings" },
    { id: "gmail_label_settings", label: "라벨설정", icon: "🏷️", title: "라벨 설정", command: "workspace", arg: "gmail_label_settings" },
    { id: "gmail_summarize", label: "메일요약", icon: "📝", title: "메일 전체 요약", command: "job", arg: "gmail_summarize" },
    // 아래 셋은 백그라운드에 이미 등록돼 있었는데 사이드패널에 들어갈 문이 없었다.
    // (대시보드에만 있었다) 타일 한 줄이면 되는 일이라 여기에 꺼낸다.
    { id: "gmail_repeat", label: "반복분류", icon: "🔁", title: "미분류 메일을 여러 번 나눠 분류", command: "job", arg: "gmail_repeat_classify" },
    { id: "gmail_dedupe", label: "중복정리", icon: "🧬", title: "한 메일에 여러 라벨이 붙은 것 정리", command: "job", arg: "gmail_dedupe_relabel" },
    { id: "gmail_colors", label: "라벨색상", icon: "🎨", title: "카테고리 색상을 라벨에 일괄 적용", command: "job", arg: "gmail_apply_label_colors" },
    // 잡이 아니라 화면이다. 무엇을 옮길지 고르지 않고 클릭 한 번으로 수백 통을 처리하는
    // 버튼은, 되돌리기가 있어도 만들지 않는다.
    { id: "gmail_clean", label: "메일정리", icon: "🧹", title: "조건에 맞는 메일을 확인하고 정리", command: "workspace", arg: "gmail_cleanup" },
    {
      id: "gmail_filter", label: "필터생성", icon: "🔍", title: "스마트 필터 생성",
      command: "job", arg: "gmail_filter", status: "planned",
      needsScope: "gmail.settings.basic",
      note: "분류 이력에서 '이 발신자는 늘 이 라벨로 갔다'는 패턴을 찾아 Gmail 필터로 굳히는 기능입니다. 그렇게 하면 그 메일들은 앞으로 AI를 쓰지 않고 처리됩니다. 필터를 만들려면 권한이 하나 더 필요합니다."
    },
    {
      id: "gmail_reply", label: "빠른답장", icon: "⚡", title: "AI 빠른 답장",
      command: "job", arg: "gmail_reply", status: "planned",
      needsScope: "gmail.compose",
      note: "답장 초안을 만들어 Gmail 임시보관함에 넣습니다(보내지는 않습니다). 지금 권한(gmail.modify)으로는 초안을 만들 수 없습니다."
    }
  ],
  calendar: [
    { id: "cal_classify", label: "일정분류", icon: "📅", title: "일정 자동 분류", command: "job", arg: "calendar_classify" },
    { id: "cal_colors", label: "색상적용", icon: "🎨", title: "카테고리 색상 적용", command: "job", arg: "calendar_apply_colors" },
    { id: "cal_init", label: "카테고리생성", icon: "🗂️", title: "AI로 일정 카테고리와 색상 만들기", command: "job", arg: "calendar_init_categories" },
    {
      id: "cal_new_event", label: "일정생성", icon: "➕", title: "AI 스마트 일정 등록",
      command: "job", arg: "calendar_new_event", status: "planned",
      note: "\"다음 주 화요일 3시 미팅\" 같은 문장이나 메일 본문에서 일정을 뽑아 만듭니다. 만들기 전에 제목·시간·장소를 확인하는 화면이 필요해 아직 열지 않았습니다."
    },
    {
      id: "cal_summary", label: "오늘의일정", icon: "📋", title: "오늘 일정 브리핑",
      command: "job", arg: "calendar_summary", status: "planned",
      note: "메일과 일정을 함께 보는 '오늘' 화면으로 만들 예정입니다."
    }
  ],
  drive: [
    // 백업/복원은 이미 동작한다. 옵션 페이지에만 있어서 사이드패널에서는 보이지 않았다.
    { id: "drive_backup", label: "설정백업", icon: "💾", title: "설정을 Google Drive에 백업", command: "job", arg: "drive_backup" },
    { id: "drive_restore", label: "설정복원", icon: "♻️", title: "Drive 백업에서 설정 복원", command: "job", arg: "drive_restore" },
    {
      id: "drive_search", label: "스마트검색", icon: "🔍", title: "문서 내용 AI 검색",
      command: "job", arg: "drive_search", status: "planned", needsScope: "drive.readonly",
      note: "지금 가진 drive.file 권한으로는 이 확장이 직접 만든 파일(설정 백업)만 볼 수 있습니다. 내 드라이브 전체를 읽으려면 권한이 더 필요합니다."
    },
    {
      id: "drive_organize", label: "폴더정리", icon: "📁", title: "자동 폴더 정리",
      command: "job", arg: "drive_organize", status: "planned", needsScope: "drive",
      note: "파일을 옮기려면 드라이브 쓰기 권한이 필요합니다."
    },
    {
      id: "drive_dup", label: "중복검사", icon: "📑", title: "중복 파일 검사",
      command: "job", arg: "drive_dup", status: "planned", needsScope: "drive.readonly",
      note: "드라이브 전체를 훑어야 해서 읽기 권한 확대가 필요합니다."
    },
    {
      id: "drive_share", label: "공유관리", icon: "👥", title: "공유 권한 점검",
      command: "job", arg: "drive_share", status: "planned", needsScope: "drive.readonly",
      note: "외부에 공개된 파일을 찾아 알려주는 기능입니다. 드라이브 읽기 권한이 필요합니다."
    },
    {
      id: "drive_recent", label: "최근파일", icon: "⏱️", title: "최근 작업 요약",
      command: "job", arg: "drive_recent", status: "planned", needsScope: "drive.readonly",
      note: "드라이브 읽기 권한이 필요합니다."
    }
  ],
  docs: [
    { id: "docs_new", label: "새문서", icon: "📄", title: "새 문서 생성", command: "openUrl", arg: "https://docs.new" },
    // 예전엔 command:"job", arg:"docs_translate" 였는데 그런 잡은 등록된 적이 없어서
    // 눌러도 아무 일도 일어나지 않는 타일이었다. 실제 번역 화면으로 연결한다.
    { id: "docs_translate", label: "문서번역", icon: "🌐", title: "PDF 문서 번역 (레이아웃 유지)", command: "workspace", arg: "pdf_translate" },
    {
      id: "docs_summary", label: "문서요약", icon: "📋", title: "문서 내용 요약",
      command: "job", arg: "docs_summary", status: "planned", needsScope: "drive.readonly",
      note: "Google 문서를 읽으려면 드라이브 읽기 권한이 필요합니다. PDF는 지금도 '문서번역'에서 처리할 수 있습니다."
    },
    {
      id: "docs_proofread", label: "문장교정", icon: "✏️", title: "맞춤법 및 문장 교정",
      command: "job", arg: "docs_proofread", status: "planned", needsScope: "documents",
      note: "문서를 고쳐 쓰려면 Google Docs API 권한이 필요합니다."
    }
  ],
  sheets: [
    {
      id: "sheets_clean", label: "데이터정제", icon: "🧹", title: "결측치 및 중복 제거",
      command: "job", arg: "sheets_clean", status: "unavailable", needsScope: "spreadsheets",
      note: "Sheets API 연동을 아직 만들지 않았습니다. 지금 계획에는 들어 있지 않습니다."
    }
  ],
  slides: [
    { id: "slides_new", label: "새슬라이드", icon: "📽️", title: "새 슬라이드 생성", command: "openUrl", arg: "https://slides.new" },
    {
      id: "slides_outline", label: "개요생성", icon: "📑", title: "발표 개요 생성",
      command: "job", arg: "slides_outline", status: "unavailable", needsScope: "presentations",
      note: "Slides API 연동을 아직 만들지 않았습니다. 지금 계획에는 들어 있지 않습니다."
    },
    {
      id: "slides_theme", label: "테마적용", icon: "🎨", title: "슬라이드 템플릿 적용",
      command: "job", arg: "slides_theme", status: "unavailable", needsScope: "presentations",
      note: "Slides API 연동을 아직 만들지 않았습니다. 지금 계획에는 들어 있지 않습니다."
    }
  ],
  keep: [
    // Google Keep은 일반 사용자용 공개 API가 없다. Workspace 도메인 위임 전용이라
    // 확장에서는 원리적으로 접근할 수 없다. "준비 중"이 아니라 "안 됨"이 정직하다.
    {
      id: "keep_new", label: "새메모", icon: "💡", title: "빠른 메모 작성",
      command: "job", arg: "keep_new", status: "unavailable",
      note: "Google Keep은 일반 계정용 공개 API가 없습니다(회사 계정의 도메인 위임 전용). 확장에서는 접근할 방법이 없어 만들 수 없습니다."
    },
    {
      id: "keep_organize", label: "메모분류", icon: "🏷️", title: "태그 및 색상 자동 분류",
      command: "job", arg: "keep_organize", status: "unavailable",
      note: "Google Keep은 일반 계정용 공개 API가 없습니다. 확장에서는 접근할 방법이 없습니다."
    },
    {
      id: "keep_todo", label: "체크리스트", icon: "☑️", title: "할 일 목록 변환",
      command: "job", arg: "keep_todo", status: "unavailable",
      note: "Google Keep은 일반 계정용 공개 API가 없습니다. 할 일 관리는 Tasks 쪽으로 만들 예정입니다."
    }
  ],
  tasks: [
    {
      id: "tasks_add", label: "작업추가", icon: "➕", title: "새 작업 등록",
      command: "job", arg: "tasks_add", status: "planned", needsScope: "tasks",
      note: "메일을 할 일로 바로 넘기는 기능으로 만들 예정입니다. Google Tasks 권한이 필요합니다."
    },
    {
      id: "tasks_prioritize", label: "우선순위", icon: "⭐", title: "AI 중요도 정렬",
      command: "job", arg: "tasks_prioritize", status: "planned", needsScope: "tasks",
      note: "Google Tasks 권한이 필요합니다."
    },
    {
      id: "tasks_archive", label: "완료정리", icon: "✔️", title: "완료 작업 정리",
      command: "job", arg: "tasks_archive", status: "planned", needsScope: "tasks",
      note: "Google Tasks 권한이 필요합니다."
    }
  ],
  contacts: [
    {
      id: "contacts_search", label: "연락처검색", icon: "👤", title: "스마트 검색",
      command: "job", arg: "contacts_search", status: "unavailable", needsScope: "contacts",
      note: "연락처 권한까지 받을 만한 쓰임을 아직 찾지 못했습니다. 계획에서 보류한 기능입니다."
    },
    {
      id: "contacts_dedup", label: "중복합치기", icon: "🔗", title: "중복 연락처 병합",
      command: "job", arg: "contacts_dedup", status: "unavailable", needsScope: "contacts",
      note: "연락처 권한까지 받을 만한 쓰임을 아직 찾지 못했습니다. 계획에서 보류한 기능입니다."
    },
    {
      id: "contacts_group", label: "그룹생성", icon: "👥", title: "스마트 그룹 생성",
      command: "job", arg: "contacts_group", status: "unavailable", needsScope: "contacts",
      note: "연락처 권한까지 받을 만한 쓰임을 아직 찾지 못했습니다. 계획에서 보류한 기능입니다."
    }
  ],
  youtube: [
    { id: "yt_comments", label: "댓글불러오기", icon: "💬", title: "현재 영상 댓글 불러오기 및 AI 분석", command: "workspace", arg: "youtube_comments" },
    { id: "yt_summarize", label: "영상요약", icon: "📝", title: "YouTube 영상 AI 요약", command: "workspace", arg: "youtube_workspace" },
    { id: "yt_open", label: "유튜브홈", icon: "🌐", title: "유튜브 홈 바로가기", command: "openUrl", arg: "https://www.youtube.com" },
    { id: "yt_studio", label: "스튜디오", icon: "📊", title: "YouTube 스튜디오 열기", command: "openUrl", arg: "https://studio.youtube.com" },
    { id: "yt_subscriptions", label: "구독채널", icon: "🔔", title: "구독 채널 목록 열기", command: "openUrl", arg: "https://www.youtube.com/feed/subscriptions" },
    { id: "yt_history", label: "시청기록", icon: "📜", title: "시청 기록 열기", command: "openUrl", arg: "https://www.youtube.com/feed/history" },
    { id: "yt_trending", label: "인기급상승", icon: "🔥", title: "인기 급상승 동영상", command: "openUrl", arg: "https://www.youtube.com/feed/trending" },
    { id: "yt_music", label: "YT뮤직", icon: "🎵", title: "YouTube Music 열기", command: "openUrl", arg: "https://music.youtube.com" },
    { id: "yt_search", label: "동영상검색", icon: "🔍", title: "유튜브 동영상 빠른 검색", command: "workspace", arg: "youtube_workspace" }
  ],
  activity: [
    { id: "activity_now", label: "진행중", icon: "▶️", title: "실행 중인 작업 보기", command: "workspace", arg: "activity_now" },
    { id: "activity_recent", label: "최근작업", icon: "🕘", title: "최근 실행한 작업 기록", command: "workspace", arg: "activity_recent" },
    { id: "activity_logs", label: "로그", icon: "📜", title: "실행 로그 보기", command: "workspace", arg: "activity_logs" },
    { id: "activity_usage", label: "AI사용량", icon: "📊", title: "오늘 AI 요청 사용량", command: "workspace", arg: "activity_usage" },
    { id: "activity_stop", label: "중지", icon: "⏹️", title: "실행 중인 작업 중지", command: "cancelJob" },
    { id: "activity_full_log", label: "로그창", icon: "↗️", title: "전체 로그 페이지 열기", command: "openLogPage" }
  ],
  learning: [
    { id: "learning_patterns", label: "배운것", icon: "🧠", title: "정정 패턴 보기", command: "workspace", arg: "learning_patterns" },
    { id: "learning_recent", label: "최근분류", icon: "🏷️", title: "최근 분류 기록", command: "workspace", arg: "learning_recent" },
    { id: "learning_criteria", label: "기준관리", icon: "📋", title: "라벨 분류기준 설정", command: "workspace", arg: "gmail_label_settings" }
  ],
  ai: [
    { id: "ai_run", label: "프롬프트", icon: "💭", title: "AI에게 직접 질문하기", command: "workspace", arg: "ai_run" },
    { id: "ai_status", label: "공급자", icon: "🔑", title: "AI 키와 할당량 상태", command: "workspace", arg: "ai_status" },
    { id: "ai_settings", label: "AI설정", icon: "⚙️", title: "AI 공급자 설정 열기", command: "settingsSection", arg: "ai" },
    { id: "ai_options", label: "키관리", icon: "↗️", title: "전체 설정에서 키 관리", command: "openOptions" }
  ],
  edit: [
    { id: "edit_order", label: "순서편집", icon: "✏️", title: "타일 순서 편집", command: "feedback", arg: "타일을 드래그하여 순서를 변경하세요." },
    { id: "edit_reset", label: "초기화", icon: "🔄", title: "기본 순서로 복원", command: "resetActions" }
  ],
  settings: [
    { id: "settings_oauth", label: "OAuth설정", icon: "🔑", title: "Google OAuth 설정", command: "settingsSection", arg: "oauth" },
    { id: "settings_general", label: "테마/언어", icon: "🎨", title: "테마 및 언어 설정", command: "settingsSection", arg: "general" },
    { id: "settings_ai", label: "AI/Gemini", icon: "✨", title: "Gemini AI 모델 설정", command: "settingsSection", arg: "ai" },
    { id: "settings_labels", label: "라벨/분류", icon: "🏷️", title: "라벨 분류 기준 설정", command: "settingsSection", arg: "labels" },
    { id: "settings_automation", label: "자동화", icon: "⚡", title: "자동 실행 및 배치 설정", command: "settingsSection", arg: "automation" },
    { id: "settings_notifications", label: "알림", icon: "🔔", title: "작업 완료 알림 설정", command: "settingsSection", arg: "notifications" },
    { id: "settings_backup", label: "데이터/백업", icon: "💾", title: "설정 백업 및 초기화", command: "settingsSection", arg: "backup" },
    { id: "settings_dashboard", label: "대시보드", icon: "📊", title: "통계 대시보드 열기", command: "openDashboard" },
    { id: "settings_full_options", label: "전체설정창", icon: "↗️", title: "전체 설정 페이지 열기", command: "openOptions" }
  ]
};


export {
  DEFAULT_SERVICE_ACTIONS,
  SERVICE_REGISTRY,
};
