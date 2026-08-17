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
  { id: "gemini", label: "Gemini", icon: "✨", title: "Gemini" },
  { id: "edit", label: "편집", icon: "✏️", title: "Edit" },
  { id: "settings", label: "설정", icon: "⚙️", title: "Settings" }
];


const DEFAULT_SERVICE_ACTIONS = {
  gmail: [
    { id: "gmail_classify", label: "라벨링시작", icon: "▶️", title: "라벨링 시작", command: "job", arg: "gmail_classify" },
    { id: "gmail_auto_settings", label: "자동설정", icon: "🤖", title: "자동 라벨링 설정", command: "workspace", arg: "gmail_auto_settings" },
    { id: "gmail_label_settings", label: "라벨설정", icon: "🏷️", title: "라벨 설정", command: "workspace", arg: "gmail_label_settings" },
    { id: "gmail_summarize", label: "메일요약", icon: "📝", title: "메일 전체 요약", command: "job", arg: "gmail_summarize" },
    { id: "gmail_clean", label: "메일정리", icon: "🧹", title: "불필요 메일 정리", command: "job", arg: "gmail_clean" },
    { id: "gmail_filter", label: "필터생성", icon: "🔍", title: "스마트 필터 생성", command: "job", arg: "gmail_filter" },
    { id: "gmail_reply", label: "빠른답장", icon: "⚡", title: "AI 빠른 답장", command: "job", arg: "gmail_reply" },
    { id: "gmail_archive", label: "보관함이동", icon: "📦", title: "읽은 메일 보관", command: "job", arg: "gmail_archive" }
  ],
  calendar: [
    { id: "cal_classify", label: "일정분류", icon: "📅", title: "일정 자동 분류", command: "job", arg: "calendar_classify" },
    { id: "cal_colors", label: "색상적용", icon: "🎨", title: "카테고리 색상 적용", command: "job", arg: "calendar_apply_colors" },
    { id: "cal_new_event", label: "일정생성", icon: "➕", title: "AI 스마트 일정 등록", command: "job", arg: "calendar_new_event" },
    { id: "cal_sync", label: "동기화", icon: "🔄", title: "일정 동기화", command: "job", arg: "calendar_sync" },
    { id: "cal_reminder", label: "알림설정", icon: "⏰", title: "스마트 리마인더", command: "job", arg: "calendar_reminder" },
    { id: "cal_summary", label: "오늘의일정", icon: "📋", title: "오늘 일정 브리핑", command: "job", arg: "calendar_summary" }
  ],
  drive: [
    { id: "drive_search", label: "스마트검색", icon: "🔍", title: "문서 내용 AI 검색", command: "job", arg: "drive_search" },
    { id: "drive_organize", label: "폴더정리", icon: "📁", title: "자동 폴더 정리", command: "job", arg: "drive_organize" },
    { id: "drive_dup", label: "중복검사", icon: "📑", title: "중복 파일 검사", command: "job", arg: "drive_dup" },
    { id: "drive_share", label: "공유관리", icon: "👥", title: "공유 권한 점검", command: "job", arg: "drive_share" },
    { id: "drive_recent", label: "최근파일", icon: "⏱️", title: "최근 작업 요약", command: "job", arg: "drive_recent" }
  ],
  docs: [
    { id: "docs_new", label: "새문서", icon: "📄", title: "새 문서 생성", command: "openUrl", arg: "https://docs.new" },
    { id: "docs_summary", label: "문서요약", icon: "📋", title: "문서 내용 요약", command: "job", arg: "docs_summary" },
    { id: "docs_proofread", label: "문장교정", icon: "✏️", title: "맞춤법 및 문장 교정", command: "job", arg: "docs_proofread" },
    { id: "docs_translate", label: "문서번역", icon: "🌐", title: "다국어 번역", command: "job", arg: "docs_translate" }
  ],
  sheets: [
    { id: "sheets_clean", label: "데이터정제", icon: "🧹", title: "결측치 및 중복 제거", command: "job", arg: "sheets_clean" }
  ],
  slides: [
    { id: "slides_new", label: "새슬라이드", icon: "📽️", title: "새 슬라이드 생성", command: "openUrl", arg: "https://slides.new" },
    { id: "slides_outline", label: "개요생성", icon: "📑", title: "발표 개요 생성", command: "job", arg: "slides_outline" },
    { id: "slides_theme", label: "테마적용", icon: "🎨", title: "슬라이드 템플릿 적용", command: "job", arg: "slides_theme" }
  ],
  keep: [
    { id: "keep_new", label: "새메모", icon: "💡", title: "빠른 메모 작성", command: "job", arg: "keep_new" },
    { id: "keep_organize", label: "메모분류", icon: "🏷️", title: "태그 및 색상 자동 분류", command: "job", arg: "keep_organize" },
    { id: "keep_todo", label: "체크리스트", icon: "☑️", title: "할 일 목록 변환", command: "job", arg: "keep_todo" }
  ],
  tasks: [
    { id: "tasks_add", label: "작업추가", icon: "➕", title: "새 작업 등록", command: "job", arg: "tasks_add" },
    { id: "tasks_prioritize", label: "우선순위", icon: "⭐", title: "AI 중요도 정렬", command: "job", arg: "tasks_prioritize" },
    { id: "tasks_archive", label: "완료정리", icon: "✔️", title: "완료 작업 정리", command: "job", arg: "tasks_archive" }
  ],
  contacts: [
    { id: "contacts_search", label: "연락처검색", icon: "👤", title: "스마트 검색", command: "job", arg: "contacts_search" },
    { id: "contacts_dedup", label: "중복합치기", icon: "🔗", title: "중복 연락처 병합", command: "job", arg: "contacts_dedup" },
    { id: "contacts_group", label: "그룹생성", icon: "👥", title: "스마트 그룹 생성", command: "job", arg: "contacts_group" }
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
  gemini: [
    { id: "gemini_chat", label: "대화시작", icon: "✨", title: "Gemini AI 질의응답", command: "job", arg: "gemini_chat" },
    { id: "gemini_prompt", label: "프롬프트", icon: "💭", title: "추천 프롬프트 실행", command: "job", arg: "gemini_prompt" },
    { id: "gemini_history", label: "대화기록", icon: "📜", title: "지난 대화 기록", command: "job", arg: "gemini_history" }
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
