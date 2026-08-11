// 접힌 상태의 창 폭. styles.css의 .container.collapsed-mode 와 같은 값이어야 한다.
const COLLAPSED_WIDTH = 150;

// 화면에 보여줄 날짜 형식들. 저장 형식은 항상 'YYYY-MM-DD HH:mm'으로 고정이고
// 여기 있는 건 표시/입력용일 뿐이다. 그래야 설정을 바꿔도 기존 데이터가 안 깨진다.
const DATE_FORMATS = [
    'YYYY-MM-DD HH:mm',
    'YYYY/MM/DD HH:mm',
    'YYYY.MM.DD HH:mm',
    'YYYYMMDD HHmm',
    'DD/MM/YYYY HH:mm',
    'MM/DD/YYYY hh:mm A',
    'YYYY-MM-DD hh:mm A'
];

const STORAGE_FORMAT = 'YYYY-MM-DD HH:mm';

// 목표 시각 기준 알림 시점(분). 가장 큰 값이 곧 '임박' 판정 기준이다.
// 상태 배지와 알림이 같은 목록을 읽으므로 둘이 어긋날 수 없다.
// 예전에는 getTaskStatus의 1시간과 checkUpcomingTasks의 60·15분이 서로 모르는
// 상수라, 한쪽만 바꾸면 표시와 알림이 따로 놀았다.
const LEAD_MINUTES = [60, 15];

// 보기 전환 버튼의 두 아이콘. 누르면 무엇이 되는지를 그린다.
const CALENDAR_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>';
const LIST_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';

// main.js가 로그 파일에 쓰는 헤더와 같아야 한다
const LOG_HEADER = 'TIMESTAMP\tACTION\tSTATUS\tTASK_ID\tSTART_TIME\tTARGET_TIME\tTAGS\tCONTENT';

// 토큰 하나당 정규식 조각과 값 추출기. 형식 문자열 하나로 출력과 입력을 모두
// 만들어내므로 둘이 어긋날 수 없다.
const DATE_TOKENS = {
    YYYY: { re: '(\\d{4})', get: (d) => String(d.getFullYear()) },
    MM: { re: '(\\d{2})', get: (d) => String(d.getMonth() + 1).padStart(2, '0') },
    DD: { re: '(\\d{2})', get: (d) => String(d.getDate()).padStart(2, '0') },
    HH: { re: '(\\d{2})', get: (d) => String(d.getHours()).padStart(2, '0') },
    hh: { re: '(\\d{2})', get: (d) => String(d.getHours() % 12 || 12).padStart(2, '0') },
    mm: { re: '(\\d{2})', get: (d) => String(d.getMinutes()).padStart(2, '0') },
    A: { re: '([AaPp][Mm])', get: (d) => (d.getHours() < 12 ? 'AM' : 'PM') }
};

const TOKEN_PATTERN = /YYYY|MM|DD|HH|hh|mm|A/g;

const formatWithPattern = (date, pattern) =>
    pattern.replace(TOKEN_PATTERN, (token) => DATE_TOKENS[token].get(date));

// 형식 문자열대로 파싱한다. 형식에 맞지 않으면 null.
const parseWithPattern = (text, pattern) => {
    const order = [];
    let source = '';
    let lastIndex = 0;

    // 토큰은 정규식 그룹으로, 나머지 리터럴은 이스케이프해서 이어붙인다
    for (const match of pattern.matchAll(TOKEN_PATTERN)) {
        source += pattern.slice(lastIndex, match.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        source += DATE_TOKENS[match[0]].re;
        order.push(match[0]);
        lastIndex = match.index + match[0].length;
    }
    source += pattern.slice(lastIndex).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const found = new RegExp(`^${source}$`).exec(String(text).trim());
    if (!found) return null;

    const parts = {};
    order.forEach((token, index) => { parts[token] = found[index + 1]; });

    const year = Number(parts.YYYY);
    const month = Number(parts.MM);
    const day = Number(parts.DD);
    const minute = Number(parts.mm || 0);
    let hour = Number(parts.HH ?? parts.hh ?? 0);

    if (parts.A) {
        const isPm = parts.A.toUpperCase() === 'PM';
        hour = (hour % 12) + (isPm ? 12 : 0);
    }

    const date = new Date(year, month - 1, day, hour, minute);
    // 존재하지 않는 날짜(2월 30일 등)는 다른 달로 굴러가므로 되돌려 확인한다
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }
    return date;
};

class TaskManager {
    constructor() {
        this.tasks = [];
        this.logs = [];
        this.rules = []; // 반복 규칙 (태스크와 별도로 저장)
        this.editingTaskId = null;
        this.isElectron = typeof window.electronAPI !== 'undefined';
        this.locale = this.getSelectedLanguage();
        this.darkMode = localStorage.getItem('darkMode') === 'true';
        this.dateFormat = localStorage.getItem('dateFormat') || DATE_FORMATS[0];
        this.searchQuery = '';
        this.searchColumn = 'all'; // 검색 대상 컬럼
        // 빠른 필터는 검색어와 별개로 산다. 여러 개를 동시에 켤 수 있어야 하는데
        // 검색창 한 칸에 밀어넣으면 하나밖에 담기지 않기 때문이다.
        // 같은 갈래끼리는 OR(태그 A 또는 B), 갈래끼리는 AND(지연이면서 태그 A).
        this.quickFilters = { status: new Set(), tags: new Set() };
        this.selectedTaskIds = new Set(); // 일괄 처리용 선택
        // 이미 알림을 보낸 태스크들. 메모리에만 두면 앱을 껐다 켤 때마다
        // 아직 시간대에 걸린 작업의 알림이 전부 다시 울린다.
        this.notifiedTasks = this.loadNotifiedTasks();
        this.completionCount = 0; // Will be set in init()
        this.isCollapsed = false;
        this.currentPage = 1;
        // 쪽당 개수. 목록을 보면서 바꾸는 값이라 설정 창이 아니라 페이지 넘김
        // 옆에 두고, 고른 값은 기억한다.
        this.tasksPerPage = TaskManager.PAGE_SIZES.includes(Number(localStorage.getItem('tasksPerPage')))
            ? Number(localStorage.getItem('tasksPerPage'))
            : 10;
        this.defaultNotificationEnabled = localStorage.getItem('defaultNotificationEnabled') !== 'false';
        // 창이 포커스를 잃었을 때의 투명도. main.js는 이 값을 메모리에만 들고
        // 있어서, 여기서 저장해 두고 시작할 때 다시 밀어주지 않으면 재시작마다
        // 1.0으로 돌아간다.
        this.unfocusedOpacity = this.loadUnfocusedOpacity();
        // 'list' | 'calendar'. 목록은 무엇이 있는지, 달력은 언제 몰리는지에 강하다.
        this.viewMode = localStorage.getItem('viewMode') === 'calendar' ? 'calendar' : 'list';
        this.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        // 접힘 미니 달력에서 직접 고른 날. null이면 오늘 우선으로 자동 선택한다.
        this.collapsedPickedKey = null;
        this.tagPresets = this.loadTagPresets();
        this.actionThrottleMap = new Map(); // 스로틀링을 위한 맵
        this.init();
    }

    getSystemLocale() {
        return navigator.language || navigator.userLanguage || 'en-US';
    }

    getSelectedLanguage() {
        const savedLanguage = localStorage.getItem('selectedLanguage');
        if (savedLanguage) {
            return savedLanguage;
        }
        
        // Auto-detect based on system locale as fallback
        const systemLocale = this.getSystemLocale();
        if (systemLocale.startsWith('ko')) {
            return 'ko';
        } else if (systemLocale.startsWith('zh')) {
            return 'zh';
        } else if (systemLocale.startsWith('ja')) {
            return 'ja';
        } else if (systemLocale.startsWith('es')) {
            return 'es';
        }
        return 'en'; // Default fallback
    }

    async init() {
        this.completionCount = await this.getTodayCompletionCount();
        this.setupEventListeners();
        this.setupUI();
        this.updateUIText();
        this.applyTheme();
        this.applyLanguageTheme();
        await this.loadTasks();
        await this.loadRules();
        await this.ensureRuleRows();
        this.applyViewMode();
        this.renderTasks();
        this.updateCompletionCounter();
        this.updateCompletionCounterText();
        this.startNotificationCheck();
    }

    setupUI() {
        // Adjust UI based on Electron mode vs browser mode
        if (!this.isElectron) {
            // Browser mode: show info bar and export/import buttons
            const infoBar = document.getElementById('infoBar');
            if (infoBar) infoBar.style.display = 'block';
        }
        
        // Always show export/import buttons (now visible by default in HTML)
        const exportBtn = document.getElementById('exportBtn');
        const importBtn = document.getElementById('importBtn');
        if (exportBtn) exportBtn.style.display = 'inline-block';
        if (importBtn) importBtn.style.display = 'inline-block';

        // main.js는 투명도를 메모리에만 두므로 시작할 때마다 다시 알려줘야 한다
        this.updateOpacityControl();
        if (this.isElectron) window.electronAPI.setUnfocusedOpacity(this.unfocusedOpacity);

        // 정보 창의 버전. 손으로 적어두면 릴리스마다 잊는다.
        const version = document.getElementById('aboutVersionValue');
        if (version && this.isElectron && window.electronAPI.getAppVersion) {
            window.electronAPI.getAppVersion().then(v => { version.textContent = v; });
        }
    }

    updateUIText() {
        // Update all UI text with localized versions
        
        // Header buttons tooltips
        document.getElementById('addTaskBtn').title = this.getLocalizedText('addTask');
        this.updateDateFormatControls();
        this.updateSearchColumnControl();
        document.getElementById('exportBtn').title = this.getLocalizedText('downloadExport');
        document.getElementById('importBtn').title = this.getLocalizedText('uploadImport');
        document.getElementById('statisticsBtn').title = this.getLocalizedText('statistics');
        document.getElementById('settingsBtn').title = this.getLocalizedText('settings');
        document.getElementById('aboutBtn').title = this.getLocalizedText('about');
        document.getElementById('collapseBtn').title = this.getLocalizedText('collapseView');
        document.getElementById('collapsedExpandBtn').title = this.getLocalizedText('expand');
        document.getElementById('clearSearchBtn').title = this.getLocalizedText('clearSearch');
        document.getElementById('dragBar').title = this.getLocalizedText('dragToMove');
        
        // Search input
        document.getElementById('searchInput').placeholder = this.getLocalizedText('search');
        
        // Table headers
        document.getElementById('thNumber').textContent = this.getLocalizedText('number');
        document.getElementById('thStartTime').textContent = this.getLocalizedText('startTime');
        document.getElementById('thTargetTime').textContent = this.getLocalizedText('targetTime');
        document.getElementById('thTags').textContent = this.getLocalizedText('tags');
        document.getElementById('thTaskContent').textContent = this.getLocalizedText('taskContent');
        document.getElementById('thStatus').textContent = this.getLocalizedText('status');
        
        // Modal form labels
        document.getElementById('labelStartTime').textContent = this.getLocalizedText('startTime');
        document.getElementById('labelTargetTime').textContent = this.getLocalizedText('targetTime');
        document.getElementById('labelTags').textContent = this.getLocalizedText('tags');
        document.getElementById('labelTaskContent').textContent = this.getLocalizedText('taskContent');
        this.renderRepeatControls();
        document.getElementById('labelPosition').textContent = this.getLocalizedText('position');
        
        // Modal form placeholders
        document.getElementById('taskTags').placeholder = this.getLocalizedText('tagsPlaceholder');
        document.getElementById('taskContent').placeholder = this.getLocalizedText('taskContentPlaceholder');
        
        // Modal buttons
        document.getElementById('cancelBtn').textContent = this.getLocalizedText('cancel');
        document.getElementById('saveBtn').textContent = this.getLocalizedText('save');
        
        // Confirmation modal buttons
        document.getElementById('confirmCancelBtn').textContent = this.getLocalizedText('cancel');
        
        // Completion counter text
        this.updateCompletionCounterText();
        
        // Settings modal elements
        const settingsTitle = document.getElementById('settingsTitle');
        if (settingsTitle) settingsTitle.textContent = this.getLocalizedText('settingsTitle');
        
        const settingsLanguageLabel = document.getElementById('settingsLanguageLabel');
        if (settingsLanguageLabel) settingsLanguageLabel.textContent = this.getLocalizedText('language');
        
        const settingsThemeModeLabel = document.getElementById('settingsThemeModeLabel');
        if (settingsThemeModeLabel) settingsThemeModeLabel.textContent = this.getLocalizedText('themeMode');
        
        const lightModeBtn = document.getElementById('lightModeBtn');
        if (lightModeBtn) lightModeBtn.title = this.getLocalizedText('lightMode');
        
        const darkModeBtn = document.getElementById('darkModeBtn');
        if (darkModeBtn) darkModeBtn.title = this.getLocalizedText('darkMode');
        
        const settingsDefaultNotificationLabel = document.getElementById('settingsDefaultNotificationLabel');
        if (settingsDefaultNotificationLabel) settingsDefaultNotificationLabel.textContent = this.getLocalizedText('defaultNotification');
        
        const notificationOnBtn = document.getElementById('notificationOnBtn');
        if (notificationOnBtn) notificationOnBtn.title = this.getLocalizedText('notificationsOn');
        
        const notificationOffBtn = document.getElementById('notificationOffBtn');
        if (notificationOffBtn) notificationOffBtn.title = this.getLocalizedText('notificationsOff');
        
        const settingsUnfocusedOpacityLabel = document.getElementById('settingsUnfocusedOpacityLabel');
        if (settingsUnfocusedOpacityLabel) settingsUnfocusedOpacityLabel.textContent = this.getLocalizedText('unfocusedOpacity');
        
        const settingsTagPresetsLabel = document.getElementById('settingsTagPresetsLabel');
        if (settingsTagPresetsLabel) settingsTagPresetsLabel.textContent = this.getLocalizedText('tagPresets');
        
        const settingsUseColorsText = document.getElementById('settingsUseColorsText');
        if (settingsUseColorsText) settingsUseColorsText.childNodes[0].textContent = this.getLocalizedText('useColors') + ' ';
        
        const addTagPresetBtn = document.getElementById('addTagPresetBtn');
        if (addTagPresetBtn) addTagPresetBtn.textContent = this.getLocalizedText('add');
        
        // About modal elements
        const aboutViewHistoryTitle = document.getElementById('aboutViewHistoryTitle');
        if (aboutViewHistoryTitle) aboutViewHistoryTitle.textContent = this.getLocalizedText('viewHistory');
        
        const aboutHowToUseTitle = document.getElementById('aboutHowToUseTitle');
        if (aboutHowToUseTitle) aboutHowToUseTitle.textContent = this.getLocalizedText('howToUse');
        
        const aboutNotificationsTitle = document.getElementById('aboutNotificationsTitle');
        if (aboutNotificationsTitle) aboutNotificationsTitle.textContent = this.getLocalizedText('notifications');
        
        const aboutTaskStatusTitle = document.getElementById('aboutTaskStatusTitle');
        if (aboutTaskStatusTitle) aboutTaskStatusTitle.textContent = this.getLocalizedText('taskStatus');
        
        const aboutKeyboardShortcutsTitle = document.getElementById('aboutKeyboardShortcutsTitle');
        if (aboutKeyboardShortcutsTitle) aboutKeyboardShortcutsTitle.textContent = this.getLocalizedText('keyboardShortcuts');
        
        const aboutAddNewTask = document.getElementById('aboutAddNewTask');
        if (aboutAddNewTask) aboutAddNewTask.textContent = this.getLocalizedText('addNewTaskShortcut');
        
        const aboutCollapseView = document.getElementById('aboutCollapseView');
        if (aboutCollapseView) aboutCollapseView.textContent = this.getLocalizedText('collapseViewShortcut');
        
        const aboutCloseModal = document.getElementById('aboutCloseModal');
        if (aboutCloseModal) aboutCloseModal.textContent = this.getLocalizedText('closeModalShortcut');
        
        // 뒤에 붙인 절들은 표로 묶어 돌린다. 위쪽처럼 한 줄씩 늘어놓으면 번역
        // 키가 늘 때마다 세 줄씩 붙고, 새로 넣은 항목을 여기 등록하는 걸 잊기
        // 쉽다 - 실제로 잊어서 영어로 고정돼 있었다.
        // ':'가 붙는 쪽은 <strong> 제목이다.
        const aboutText = {
            aboutViewsTitle: 'views',
            aboutSearchTitle: 'searchAndFilters',
            aboutRepeatTitle: 'repeatingTasks',
            aboutSelectDesc: 'aboutSelectDesc',
            aboutListViewDesc: 'aboutListViewDesc',
            aboutCalendarViewDesc: 'aboutCalendarViewDesc',
            aboutCollapsedViewDesc: 'aboutCollapsedViewDesc',
            aboutSearchColumnDesc: 'aboutSearchColumnDesc',
            aboutChipFilterDesc: 'aboutChipFilterDesc',
            aboutQuickFilterDesc: 'aboutQuickFilterDesc',
            aboutRepeatRowDesc: 'aboutRepeatRowDesc',
            aboutRepeatStepDesc: 'aboutRepeatStepDesc',
            aboutRepeatDeleteDesc: 'aboutRepeatDeleteDesc',
            aboutRepeatTargetDesc: 'aboutRepeatTargetDesc',
            aboutStandingStatus: 'standing',
            aboutStandingStatusDesc: 'aboutStandingStatusDesc'
        };
        const aboutHeadings = {
            aboutSelectTitle: 'aboutSelectTitle',
            aboutListViewTitle: 'listView',
            aboutCalendarViewTitle: 'calendarView',
            aboutCollapsedViewTitle: 'sideStrip',
            aboutSearchColumnTitle: 'aboutSearchColumnTitle',
            aboutChipFilterTitle: 'aboutChipFilterTitle',
            aboutQuickFilterTitle: 'aboutQuickFilterTitle',
            aboutRepeatRowTitle: 'aboutRepeatRowTitle',
            aboutRepeatStepTitle: 'aboutRepeatStepTitle',
            aboutRepeatDeleteTitle: 'aboutRepeatDeleteTitle',
            aboutRepeatTargetTitle: 'aboutRepeatTargetTitle'
        };
        for (const [id, key] of Object.entries(aboutText)) {
            const element = document.getElementById(id);
            if (element) element.textContent = this.getLocalizedText(key);
        }
        for (const [id, key] of Object.entries(aboutHeadings)) {
            const element = document.getElementById(id);
            if (element) element.textContent = this.getLocalizedText(key) + ':';
        }

        const aboutVersionLabel = document.getElementById('aboutVersionLabel');
        if (aboutVersionLabel) aboutVersionLabel.textContent = this.getLocalizedText('version') + ':';
        
        const aboutLicenseLabel = document.getElementById('aboutLicenseLabel');
        if (aboutLicenseLabel) aboutLicenseLabel.textContent = this.getLocalizedText('license') + ':';
        
        const aboutAuthorLabel = document.getElementById('aboutAuthorLabel');
        if (aboutAuthorLabel) aboutAuthorLabel.textContent = this.getLocalizedText('author') + ':';
        
        // About modal - How to Use instructions
        const aboutAddTaskTitle = document.getElementById('aboutAddTaskTitle');
        if (aboutAddTaskTitle) aboutAddTaskTitle.textContent = this.getLocalizedText('addTask') + ':';
        const aboutAddTaskDesc = document.getElementById('aboutAddTaskDesc');
        if (aboutAddTaskDesc) aboutAddTaskDesc.textContent = this.getLocalizedText('addTaskInstruction');
        const aboutAddTaskDescEnd = document.getElementById('aboutAddTaskDescEnd');
        if (aboutAddTaskDescEnd) aboutAddTaskDescEnd.textContent = this.getLocalizedText('addTaskInstructionEnd');
        
        const aboutEditTitle = document.getElementById('aboutEditTitle');
        if (aboutEditTitle) aboutEditTitle.textContent = this.getLocalizedText('edit') + ':';
        const aboutEditDesc = document.getElementById('aboutEditDesc');
        if (aboutEditDesc) aboutEditDesc.textContent = this.getLocalizedText('editInstruction');
        const aboutEditDescEnd = document.getElementById('aboutEditDescEnd');
        if (aboutEditDescEnd) aboutEditDescEnd.textContent = this.getLocalizedText('editInstructionEnd');
        
        const aboutCompleteTitle = document.getElementById('aboutCompleteTitle');
        if (aboutCompleteTitle) aboutCompleteTitle.textContent = this.getLocalizedText('complete') + ':';
        const aboutCompleteDesc = document.getElementById('aboutCompleteDesc');
        if (aboutCompleteDesc) aboutCompleteDesc.textContent = this.getLocalizedText('completeInstruction');
        const aboutCompleteDescEnd = document.getElementById('aboutCompleteDescEnd');
        if (aboutCompleteDescEnd) aboutCompleteDescEnd.textContent = this.getLocalizedText('completeInstructionEnd');
        
        const aboutDeleteTitle = document.getElementById('aboutDeleteTitle');
        if (aboutDeleteTitle) aboutDeleteTitle.textContent = this.getLocalizedText('delete') + ':';
        const aboutDeleteDesc = document.getElementById('aboutDeleteDesc');
        if (aboutDeleteDesc) aboutDeleteDesc.textContent = this.getLocalizedText('deleteInstruction');
        const aboutDeleteDescEnd = document.getElementById('aboutDeleteDescEnd');
        if (aboutDeleteDescEnd) aboutDeleteDescEnd.textContent = this.getLocalizedText('deleteInstructionEnd');
        
        const aboutHighlightTitle = document.getElementById('aboutHighlightTitle');
        if (aboutHighlightTitle) aboutHighlightTitle.textContent = this.getLocalizedText('highlight') + ':';
        const aboutHighlightDesc = document.getElementById('aboutHighlightDesc');
        if (aboutHighlightDesc) aboutHighlightDesc.textContent = this.getLocalizedText('highlightInstruction');
        const aboutHighlightDescEnd = document.getElementById('aboutHighlightDescEnd');
        if (aboutHighlightDescEnd) aboutHighlightDescEnd.textContent = this.getLocalizedText('highlightInstructionEnd');
        
        const aboutReorderTitle = document.getElementById('aboutReorderTitle');
        if (aboutReorderTitle) aboutReorderTitle.textContent = this.getLocalizedText('moveUp') + '/' + this.getLocalizedText('moveDown') + ':';
        const aboutReorderDesc = document.getElementById('aboutReorderDesc');
        if (aboutReorderDesc) aboutReorderDesc.textContent = this.getLocalizedText('reorderInstruction');
        const aboutReorderDescEnd = document.getElementById('aboutReorderDescEnd');
        if (aboutReorderDescEnd) aboutReorderDescEnd.textContent = this.getLocalizedText('reorderInstructionEnd');
        
        const aboutExportImportTitle = document.getElementById('aboutExportImportTitle');
        if (aboutExportImportTitle) aboutExportImportTitle.textContent = this.getLocalizedText('downloadExport') + '/' + this.getLocalizedText('uploadImport') + ':';
        const aboutExportImportDesc = document.getElementById('aboutExportImportDesc');
        if (aboutExportImportDesc) aboutExportImportDesc.textContent = this.getLocalizedText('exportImportInstruction');
        const aboutExportImportDescEnd = document.getElementById('aboutExportImportDescEnd');
        if (aboutExportImportDescEnd) aboutExportImportDescEnd.textContent = this.getLocalizedText('exportImportInstructionEnd');
        
        const aboutTagsTitle = document.getElementById('aboutTagsTitle');
        if (aboutTagsTitle) aboutTagsTitle.textContent = this.getLocalizedText('tags') + ':';
        const aboutTagsDesc = document.getElementById('aboutTagsDesc');
        if (aboutTagsDesc) aboutTagsDesc.textContent = this.getLocalizedText('tagsInstruction');
        
        const aboutNotificationsInstructionTitle = document.getElementById('aboutNotificationsInstructionTitle');
        if (aboutNotificationsInstructionTitle) aboutNotificationsInstructionTitle.textContent = this.getLocalizedText('notifications') + ':';
        const aboutNotificationsInstructionDesc = document.getElementById('aboutNotificationsInstructionDesc');
        if (aboutNotificationsInstructionDesc) aboutNotificationsInstructionDesc.textContent = this.getLocalizedText('notificationsInstruction');
        const aboutNotificationsInstructionDescEnd = document.getElementById('aboutNotificationsInstructionDescEnd');
        if (aboutNotificationsInstructionDescEnd) aboutNotificationsInstructionDescEnd.textContent = this.getLocalizedText('notificationsInstructionEnd');
        
        // About modal - Notifications section
        const aboutAutoAlertsTitle = document.getElementById('aboutAutoAlertsTitle');
        if (aboutAutoAlertsTitle) aboutAutoAlertsTitle.textContent = this.getLocalizedText('autoAlerts') + ':';
        const aboutAutoAlertsDesc = document.getElementById('aboutAutoAlertsDesc');
        if (aboutAutoAlertsDesc) aboutAutoAlertsDesc.textContent = this.getLocalizedText('autoAlertsDesc');
        
        const aboutOverdueAlertTitle = document.getElementById('aboutOverdueAlertTitle');
        if (aboutOverdueAlertTitle) aboutOverdueAlertTitle.textContent = this.getLocalizedText('overdueAlert') + ':';
        const aboutOverdueAlertDesc = document.getElementById('aboutOverdueAlertDesc');
        if (aboutOverdueAlertDesc) aboutOverdueAlertDesc.textContent = this.getLocalizedText('overdueAlertDesc');
        
        const aboutTogglePerTaskTitle = document.getElementById('aboutTogglePerTaskTitle');
        if (aboutTogglePerTaskTitle) aboutTogglePerTaskTitle.textContent = this.getLocalizedText('togglePerTask') + ':';
        const aboutTogglePerTaskDesc = document.getElementById('aboutTogglePerTaskDesc');
        if (aboutTogglePerTaskDesc) aboutTogglePerTaskDesc.textContent = this.getLocalizedText('togglePerTaskDesc');
        
        const aboutDefaultSettingTitle = document.getElementById('aboutDefaultSettingTitle');
        if (aboutDefaultSettingTitle) aboutDefaultSettingTitle.textContent = this.getLocalizedText('defaultSetting') + ':';
        const aboutDefaultSettingDesc = document.getElementById('aboutDefaultSettingDesc');
        if (aboutDefaultSettingDesc) aboutDefaultSettingDesc.textContent = this.getLocalizedText('defaultSettingDesc');
        const aboutDefaultSettingEnd = document.getElementById('aboutDefaultSettingEnd');
        if (aboutDefaultSettingEnd) aboutDefaultSettingEnd.textContent = this.getLocalizedText('defaultSettingEnd');
        
        // About modal - Task Status descriptions
        const aboutPendingStatus = document.getElementById('aboutPendingStatus');
        if (aboutPendingStatus) aboutPendingStatus.textContent = this.getLocalizedText('pending');
        const aboutPendingStatusDesc = document.getElementById('aboutPendingStatusDesc');
        if (aboutPendingStatusDesc) aboutPendingStatusDesc.textContent = this.getLocalizedText('pendingStatusDesc');
        
        const aboutInProgressStatus = document.getElementById('aboutInProgressStatus');
        if (aboutInProgressStatus) aboutInProgressStatus.textContent = this.getLocalizedText('inprogress');
        const aboutInProgressStatusDesc = document.getElementById('aboutInProgressStatusDesc');
        if (aboutInProgressStatusDesc) aboutInProgressStatusDesc.textContent = this.getLocalizedText('inProgressStatusDesc');
        
        const aboutDueSoonStatus = document.getElementById('aboutDueSoonStatus');
        if (aboutDueSoonStatus) aboutDueSoonStatus.textContent = this.getLocalizedText('urgent');
        const aboutDueSoonStatusDesc = document.getElementById('aboutDueSoonStatusDesc');
        if (aboutDueSoonStatusDesc) aboutDueSoonStatusDesc.textContent = this.getLocalizedText('dueSoonStatusDesc');
        
        const aboutOverdueStatus = document.getElementById('aboutOverdueStatus');
        if (aboutOverdueStatus) aboutOverdueStatus.textContent = this.getLocalizedText('overdue');
        const aboutOverdueStatusDesc = document.getElementById('aboutOverdueStatusDesc');
        if (aboutOverdueStatusDesc) aboutOverdueStatusDesc.textContent = this.getLocalizedText('overdueStatusDesc');
        
        const aboutCompletedStatus = document.getElementById('aboutCompletedStatus');
        if (aboutCompletedStatus) aboutCompletedStatus.textContent = this.getLocalizedText('done');
        const aboutCompletedStatusDesc = document.getElementById('aboutCompletedStatusDesc');
        if (aboutCompletedStatusDesc) aboutCompletedStatusDesc.textContent = this.getLocalizedText('completedStatusDesc');
        
        // About modal - Completion Counter section
        const aboutCompletionCounterTitle = document.getElementById('aboutCompletionCounterTitle');
        if (aboutCompletionCounterTitle) aboutCompletionCounterTitle.textContent = this.getLocalizedText('completionCounterTitle');
        
        const aboutCompletionCounterDesc = document.getElementById('aboutCompletionCounterDesc');
        if (aboutCompletionCounterDesc) aboutCompletionCounterDesc.textContent = this.getLocalizedText('completionCounterDescription');
    }


    applyTheme() {
        if (this.darkMode) {
            document.body.classList.add('dark-mode');
            document.getElementById('darkModeBtn').classList.add('active');
            document.getElementById('lightModeBtn').classList.remove('active');
        } else {
            document.body.classList.remove('dark-mode');
            document.getElementById('lightModeBtn').classList.add('active');
            document.getElementById('darkModeBtn').classList.remove('active');
        }
    }

    applyLanguageTheme() {
        // Remove active class from all language buttons
        document.querySelectorAll('.lang-btn').forEach(btn => btn.classList.remove('active'));
        
        // Add active class to current language button
        const currentLangBtn = document.querySelector(`[data-lang="${this.locale}"]`);
        if (currentLangBtn) {
            currentLangBtn.classList.add('active');
        }
    }

    toggleTheme(isDark) {
        this.darkMode = isDark;
        localStorage.setItem('darkMode', isDark.toString());
        this.applyTheme();
    }

    changeLanguage(languageCode) {
        this.locale = languageCode;
        localStorage.setItem('selectedLanguage', languageCode);
        this.applyLanguageTheme();
        this.updateUIText();
        
        // Re-render tasks to update localized content
        this.renderTasks();
        
        // Update tags help text with new language
        this.updateTagsHelpText();
    }

    toggleDefaultNotification(enabled) {
        this.defaultNotificationEnabled = enabled;
        localStorage.setItem('defaultNotificationEnabled', enabled.toString());
        this.applyNotificationTheme();
    }

    applyNotificationTheme() {
        if (this.defaultNotificationEnabled) {
            document.getElementById('notificationOnBtn').classList.add('active');
            document.getElementById('notificationOffBtn').classList.remove('active');
        } else {
            document.getElementById('notificationOffBtn').classList.add('active');
            document.getElementById('notificationOnBtn').classList.remove('active');
        }
    }

    setupEventListeners() {
        // Add new task button
        document.getElementById('addTaskBtn').addEventListener('click', () => {
            this.showModal();
        });

        // Export/import buttons
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportData();
        });

        document.getElementById('importBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.importData(e.target.files[0]);
        });

        // Settings button
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.showSettingsModal();
        });

        // About button
        document.getElementById('aboutBtn').addEventListener('click', () => {
            this.showAboutModal();
        });

        // Open log folder button
        document.getElementById('openLogFolderBtn').addEventListener('click', async () => {
            if (this.isElectron && window.electronAPI.openLogFolder) {
                try {
                    await window.electronAPI.openLogFolder();
                } catch (error) {
                    console.error('Failed to open log folder:', error);
                }
            }
        });

        // Statistics button
        document.getElementById('statisticsBtn').addEventListener('click', () => {
            this.showStatisticsModal();
        });

        // Collapse button
        document.getElementById('collapseBtn').addEventListener('click', () => {
            this.toggleCollapse();
        });

        // Collapsed expand button
        document.getElementById('collapsedExpandBtn').addEventListener('click', () => {
            this.toggleCollapse();
        });

        // Clear search button
        document.getElementById('clearSearchBtn').addEventListener('click', () => {
            this.clearSearch();
        });

        // Search input events
        document.getElementById('searchInput').addEventListener('input', (e) => {
            const clearBtn = document.getElementById('clearSearchBtn');
            if (e.target.value.trim()) {
                clearBtn.style.display = 'block';
            } else {
                clearBtn.style.display = 'none';
            }
        });

        // Close modals
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                const modalType = e.target.getAttribute('data-modal');
                if (modalType === 'settings') {
                    this.hideSettingsModal();
                } else if (modalType === 'about') {
                    this.hideAboutModal();
                } else if (modalType === 'statistics') {
                    this.hideStatisticsModal();
                } else if (modalType === 'confirm') {
                    this.hideConfirmModal();
                } else {
                    this.hideModal();
                }
            });
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.hideModal();
        });

        // 배경을 눌러도 닫히지 않는다. 작업 내용을 길게 쓰다가 바깥을 한 번
        // 잘못 누르면 입력이 통째로 날아가기 때문이다. 닫는 방법은 X 버튼,
        // 취소 버튼, ESC 세 가지로 충분하다.

        // Form submission
        document.getElementById('taskForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTask();
        });

        // 반복 주기 변경 시 간격/요일 입력 표시 갱신
        document.getElementById('taskRepeat').addEventListener('change', () => {
            this.updateRepeatVisibility();
        });

        // 다중 선택
        document.getElementById('selectAllTasks').addEventListener('change', (e) => {
            this.toggleSelectAll(e.target.checked);
        });
        document.getElementById('tasksTable').addEventListener('change', (e) => {
            const box = e.target.closest('.task-select');
            if (box) this.toggleTaskSelection(box.dataset.taskId, box.checked);
        });
        document.querySelectorAll('[data-bulk]').forEach(button => {
            button.addEventListener('click', () => this.runBulkAction(button.dataset.bulk));
        });


        document.getElementById('pageSizeSelect').addEventListener('change', (e) => {
            this.tasksPerPage = Number(e.target.value);
            localStorage.setItem('tasksPerPage', String(this.tasksPerPage));
            // 20건짜리 3페이지를 보다 100으로 바꾸면 3페이지는 없는 쪽이 된다
            this.currentPage = 1;
            this.renderTasks();
        });

        // 검색 대상 컬럼
        document.getElementById('searchColumn').addEventListener('change', (e) => {
            this.searchColumn = e.target.value;
            this.currentPage = 1;
            this.renderTasks();
        });

        // 날짜 표시 형식
        document.getElementById('dateFormatSelect').addEventListener('change', (e) => {
            this.changeDateFormat(e.target.value);
        });

        // 날짜/시간 선택기
        document.querySelectorAll('.datetime-pick-btn').forEach(button => {
            button.addEventListener('click', () => this.openDateTimePicker(button.dataset.target));
        });
        document.getElementById('dtpPrevMonth').addEventListener('click', () => this.movePickerMonth(-1));
        document.getElementById('dtpNextMonth').addEventListener('click', () => this.movePickerMonth(1));
        document.getElementById('dtpApply').addEventListener('click', () => this.applyDateTimePicker());
        document.getElementById('dtpCancel').addEventListener('click', () => this.closeDateTimePicker());

        // 피커 바깥을 누르면 닫는다 (모달과 달리 선택기는 가벼운 팝오버다)
        document.addEventListener('mousedown', (e) => {
            const picker = document.getElementById('dateTimePicker');
            if (this.pickerTarget && !picker.contains(e.target) && !e.target.closest('.datetime-pick-btn')) {
                this.closeDateTimePicker();
            }

        });

        // 표 안에서는 어디를 눌러도 그 행이 선택된다. 태그·상태 칩도 예외가 아니다.
        // 예전에는 칩을 누르면 검색으로 빠졌는데, 빠른 필터가 같은 일을 늘 같은
        // 자리에서 여러 개까지 걸 수 있게 하면서 쓸모가 없어졌다. 남겨두면 행을
        // 고르려다 칩을 스치기만 해도 목록이 통째로 바뀌어 버린다.
        document.getElementById('tasksTable').addEventListener('click', (e) => {
            // 행 어디를 눌러도 선택된다. 체크박스만 노리기에는 표적이 작다.
            // 체크박스 자체를 누른 경우는 change 이벤트가 이미 처리하므로 뺀다.
            if (e.target.closest('.task-select')) return;

            const row = e.target.closest('#tasksBody tr');
            const box = row && row.querySelector('.task-select');
            if (!box) return;

            box.checked = !box.checked;
            this.toggleTaskSelection(box.dataset.taskId, box.checked);
        });

        // 달력 보기
        document.getElementById('viewModeBtn').addEventListener('click', () => this.toggleViewMode());
        document.getElementById('calPrev').addEventListener('click', () => this.moveCalendarMonth(-1));
        document.getElementById('calNext').addEventListener('click', () => this.moveCalendarMonth(1));
        document.getElementById('calToday').addEventListener('click', () => {
            const now = new Date();
            this.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            this.renderTasks();
        });

        this.setupWindowDrag();

        // 접힘 미니 달력에서 날짜를 누르면 그날 목록으로 바꾼다. 여기만은 눌러야
        // 한다 - 스트립에는 다른 날로 갈 방법이 이것뿐이다. 같은 날을 다시 누르면
        // 자동(오늘 우선)으로 되돌린다.
        document.getElementById('collapsedCalGrid').addEventListener('click', (e) => {
            const cell = e.target.closest('[data-day]');
            if (!cell) return;
            const key = cell.dataset.day;
            this.collapsedPickedKey = this.collapsedPickedKey === key ? null : key;
            this.renderTasks();
            this.resizeCollapsedWindow();
        });

        // 완료 목록은 열 때마다 읽는다. 미리 채워두면 다른 창에서 완료한 것이나
        // 자정을 넘긴 뒤의 목록이 낡은 채로 뜬다.
        document.getElementById('completionCounter').addEventListener('mouseenter', () => {
            this.renderCompletedList();
        });

        // 빠른 필터. 칩은 매번 다시 그려지므로 위임으로 붙인다.
        document.getElementById('quickFilters').addEventListener('click', (e) => {
            const chip = e.target.closest('.quick-chip');
            if (!chip) return;

            if (chip.hasAttribute('data-quick-all')) {
                this.quickFilters.status.clear();
                this.quickFilters.tags.clear();
                this.clearSearch();
                return;
            }

            // 켜고 끄기. 여러 개를 동시에 걸 수 있어야 "지연이면서 #운영"처럼
            // 좁힐 수 있고, 하나씩만 되면 칩을 누를 때마다 앞의 조건이 날아간다.
            const bucket = chip.dataset.quickColumn === 'status'
                ? this.quickFilters.status
                : this.quickFilters.tags;
            const value = chip.dataset.quick;
            if (bucket.has(value)) bucket.delete(value);
            else bucket.add(value);

            this.currentPage = 1;
            this.renderTasks();
        });

        // Confirmation form submission
        document.getElementById('confirmForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleConfirmAction();
        });

        document.getElementById('confirmCancelBtn').addEventListener('click', () => {
            this.hideConfirmModal();
        });

        // Table button click events (event delegation)
        document.getElementById('tasksTable').addEventListener('click', (e) => {
            // Find the closest action button (handles nested SVG elements)
            const button = e.target.closest('.action-btn');
            if (button) {
                const taskId = button.getAttribute('data-task-id');
                const action = button.getAttribute('data-action');
                
                if (taskId && action) {
                    this.runTaskAction(action, taskId);
                }
            }
        });

        // 날짜 형식 검증은 하지 않는다. 입력이 datetime-local이라 브라우저가
        // 형식을 보장하고, 값은 'T'로 구분된다. 예전 검증은 텍스트 입력 시절의
        // 공백 구분 형식을 기대해서 정상 입력에도 항상 빨간 테두리를 씌웠다.

        document.getElementById('settingsOpacitySlider').addEventListener('input', (e) => {
            this.changeUnfocusedOpacity(parseFloat(e.target.value));
        });

        // Language toggle buttons
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const languageCode = btn.getAttribute('data-lang');
                this.changeLanguage(languageCode);
            });
        });

        // Theme toggle buttons
        document.getElementById('lightModeBtn').addEventListener('click', () => {
            this.toggleTheme(false);
        });

        document.getElementById('darkModeBtn').addEventListener('click', () => {
            this.toggleTheme(true);
        });

        // Notification toggle buttons (safe check)
        const notificationOnBtn = document.getElementById('notificationOnBtn');
        const notificationOffBtn = document.getElementById('notificationOffBtn');
        
        if (notificationOnBtn) {
            notificationOnBtn.addEventListener('click', () => {
                this.toggleDefaultNotification(true);
            });
        }

        if (notificationOffBtn) {
            notificationOffBtn.addEventListener('click', () => {
                this.toggleDefaultNotification(false);
            });
        }

        // Tag preset add button
        const addTagPresetBtn = document.getElementById('addTagPresetBtn');
        if (addTagPresetBtn) {
            addTagPresetBtn.addEventListener('click', () => {
                this.addNewTagPreset();
            });
        }

        // Color example buttons in settings
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('color-example')) {
                e.preventDefault();
                e.stopPropagation();
                this.addColorToTagInput(e.target.textContent);
            }
        });

        // Tag preset input enter key
        const newTagPresetInput = document.getElementById('newTagPreset');
        if (newTagPresetInput) {
            newTagPresetInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.addNewTagPreset();
                }
            });
        }

        // Search functionality
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.searchQuery = e.target.value.toLowerCase();
            this.renderTasks();
        });
    }

    async loadTasks() {
        try {
            if (this.isElectron) {
                // Electron mode: use IPC
                this.tasks = await window.electronAPI.loadTasks();
            } else {
                // Browser mode: use localStorage
                const tasksData = localStorage.getItem('tasklogger_tasks');
                const logsData = localStorage.getItem('tasklogger_logs');
                
                this.tasks = tasksData ? JSON.parse(tasksData) : [];
                this.logs = logsData ? JSON.parse(logsData) : [];
            }
        } catch (error) {
            console.error('Failed to load tasks:', error);
            this.tasks = [];
            this.logs = [];
        }

        // 완료한 작업은 tasks.json에 남기지 않는다. 이력은 TSV가 맡고, 그 쪽에는
        // TASK_ID·시작·목표·태그·내용이 모두 들어 있어 완전한 중복이었다.
        // 실제로 읽는 코드가 한 군데도 없었는데도 파일과 백업에 계속 쌓였다.
        // 예전 데이터와 예전 백업에서 들어오는 것들을 여기서 걷어낸다.
        const dropped = this.tasks.filter(t => t.completed).length;
        if (dropped > 0) {
            this.tasks = this.tasks.filter(t => !t.completed);
            console.log(`Dropped ${dropped} completed task(s) kept only in tasks.json`);
            await this.saveTasks();
        }
    }

    async saveTasks() {
        // 저장을 직렬화한다. 하이라이트/이동/알림 토글은 saveTasks를 await 없이
        // 호출하므로, 동시에 실행되면 먼저 떠난 스냅샷이 나중에 기록되면서
        // 뒤에 일어난 변경이 조용히 사라진다.
        this.saveQueue = (this.saveQueue || Promise.resolve()).then(() => this.writeTasks());
        return this.saveQueue;
    }

    async writeTasks() {
        try {
            if (this.isElectron) {
                // Electron mode: use IPC
                await window.electronAPI.saveTasks(this.tasks);
            } else {
                // Browser mode: use localStorage
                localStorage.setItem('tasklogger_tasks', JSON.stringify(this.tasks));
                localStorage.setItem('tasklogger_logs', JSON.stringify(this.logs));
            }
            return true;
        } catch (error) {
            console.error('Failed to save tasks:', error);
            if (!this.isElectron) {
                alert('Failed to save data. Please check your browser storage.');
            }
            return false;
        }
    }

    // 로그와 저장을 백그라운드로 넘기되 실패를 표면화한다. saveTasks가 예외를
    // 내부에서 삼키기 때문에 .catch()로는 저장 실패를 절대 잡을 수 없다.
    persistInBackground(action, task) {
        Promise.all([
            this.addLog(action, task, task.content),
            this.saveTasks()
        ]).then(([, saved]) => {
            if (!saved) {
                console.error(`Failed to persist ${action} for task:`, task.id);
            }
        });
    }

    async loadRules() {
        try {
            if (this.isElectron) {
                this.rules = await window.electronAPI.loadRules();
            } else {
                const data = localStorage.getItem('tasklogger_rules');
                this.rules = data ? JSON.parse(data) : [];
            }
        } catch (error) {
            console.error('Failed to load rules:', error);
            this.rules = [];
        }
    }

    async saveRules() {
        try {
            if (this.isElectron) {
                await window.electronAPI.saveRules(this.rules);
            } else {
                localStorage.setItem('tasklogger_rules', JSON.stringify(this.rules));
            }
            return true;
        } catch (error) {
            console.error('Failed to save rules:', error);
            return false;
        }
    }

    // 반복 규칙에는 표에 보이는 행이 하나씩 있어야 한다. 규칙만 남고 행이
    // 없으면(예전 방식으로 만든 데이터를 열거나, 백업을 가져온 경우) 규칙이
    // 눈에 안 보여서 손댈 수도 멈출 수도 없다.
    async ensureRuleRows() {
        if (typeof Recurrence === 'undefined') return;

        const created = [];
        for (const rule of this.rules) {
            if (rule.enabled === false) continue;
            if (this.tasks.some(t => t.ruleId === rule.id && !t.completed)) continue;

            const today = Recurrence.localKey(new Date());
            // 오늘이 회차면 오늘 것으로. 아니면 다음 회차로.
            const occurrence =
                Recurrence.nextOccurrenceAfter(rule, Recurrence.localKey(new Date(Date.now() - 86400000))) ||
                Recurrence.nextOccurrenceAfter(rule, today);
            if (!occurrence) continue;

            created.push({
                id: this.generateId(),
                content: rule.content,
                tags: rule.tags || '',
                ...Recurrence.occurrenceTimes(rule, occurrence),
                completed: false,
                highlighted: false,
                notificationEnabled: this.defaultNotificationEnabled,
                createdAt: new Date().toISOString(),
                ruleId: rule.id
            });
        }

        if (created.length === 0) return;

        const completed = this.tasks.filter(t => t.completed);
        const active = this.tasks.filter(t => !t.completed);
        this.tasks = [...active, ...created, ...completed];

        for (const task of created) {
            await this.addLog('ADD', task, task.content);
        }
        await this.saveTasks();
    }

    // 반복 작업을 완료하면 목록에서 없애지 않고 다음 회차로 한 칸 옮긴다.
    // 옮겼으면 true.
    advanceRecurringTask(task) {
        if (!task.ruleId || typeof Recurrence === 'undefined') return false;

        const rule = this.rules.find(r => r.id === task.ruleId);
        if (!rule || rule.enabled === false) return false;

        // 현재 회차 다음 것으로 한 칸만 간다. 밀린 걸 한 번에 건너뛰지 않으므로
        // 실제로 남은 건수만큼 완료를 눌러야 하고, 몰아서 넘기려면 사용자가
        // 날짜를 직접 고치면 된다.
        const currentKey = task.startDateTime.split(' ')[0];
        const nextKey = Recurrence.nextOccurrenceAfter(rule, currentKey);
        if (!nextKey) return false;

        Object.assign(task, Recurrence.occurrenceTimes(rule, nextKey));
        return true;
    }

    async addLog(action, task, details = null) {
        try {
            const logEntry = {
                action,
                task: { ...task },
                details: details,
                timestamp: new Date().toISOString()
            };

            console.log('Adding log entry:', action, 'for task:', task.id, 'details:', details);

            if (this.isElectron) {
                // Electron mode: use IPC
                const result = await window.electronAPI.addLog(logEntry);
                console.log('Log write result:', result);
            } else {
                // Browser mode: add to local array
                this.logs.push(logEntry);
                await this.saveTasks(); // Save to localStorage
            }
        } catch (error) {
            console.error('Failed to add log:', error);
        }
    }

    generateId() {
        // UUID v4 형식으로 생성
        return 'task-' + 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    // 모달 입력창에 채울 문자열. 설정한 표시 형식을 그대로 쓴다.
    formatDateTimeLocal(date) {
        return formatWithPattern(date, this.dateFormat);
    }

    // 저장 형식(항상 'YYYY-MM-DD HH:mm')으로 변환. 형식이 안 맞으면 null.
    parseInputDateTime(text) {
        const date = parseWithPattern(text, this.dateFormat);
        return date ? formatWithPattern(date, STORAGE_FORMAT) : null;
    }

    formatDateTime(dateTime) {
        if (!dateTime) return '';
        const date = new Date(dateTime);
        if (isNaN(date.getTime())) return '';
        return formatWithPattern(date, this.dateFormat);
    }

    getLocalizedText(key) {
        const texts = {
            'en': {
                // Status
                'done': 'Done',
                'pending': 'Pending',
                'inprogress': 'In Progress', 
                'overdue': 'Overdue',
                'urgent': 'Due Soon',
                // Table headers
                'number': '#',
                'startTime': 'Start Time',
                'targetTime': 'Target Time',
                'tags': 'Tags',  
                'taskContent': 'Task Content',
                'status': 'Status',
                'actions': 'Actions',
                // Tooltips
                'addTask': 'Add Task',
                'edit': 'Edit',
                'complete': 'Complete',
                'delete': 'Delete',
                'highlight': 'Highlight',
                'moveUp': 'Move Up',
                'moveDown': 'Move Down',
                'downloadExport': 'Download/Export',
                'uploadImport': 'Upload/Import',
                'settings': 'Settings',
                'about': 'About',
                'search': 'Search...',
                'completed': 'Completed',
                'completionCounter': 'Completed',
                'position': 'Position',
                'notification': 'Toggle Notification',
                // Messages
                'noTasks': 'No tasks registered. Click the \'+ Add Task\' button to add a task.',
                'repeat': 'Repeat',
                'repeatNone': 'No repeat',
                'repeatDaily': 'Daily',
                'repeatWeekly': 'Weekly',
                'repeatMonthly': 'Monthly',
                'repeatYearly': 'Yearly',
                'repeatUnitDaily': 'days',
                'repeatUnitWeekly': 'weeks',
                'repeatUnitMonthly': 'months',
                'repeatUnitYearly': 'years',
                'repeatIntervalFormat': 'every {n} {unit}',
                'repeatHelp': 'The next occurrence is created when you open the app, using the times above.',
                'repeating': 'Repeating task',
                'repeatFilter': 'Show repeating tasks only',
                'dateFormat': 'Date Format',
                'invalidDateFormat': 'Please enter the date in this format:',
                'weekdaysShort': 'Sun,Mon,Tue,Wed,Thu,Fri,Sat',
                'allCompleted': 'All tasks completed! Add a new task.',
                'noSearchResults': 'No tasks found matching your search.',
                'deleteConfirm': 'Are you sure you want to delete this task?',
                'fillAllFields': 'Please fill in all fields.',
                'targetAfterStart': 'Target time must be later than start time.',
                'dataImportSuccess': 'Data imported successfully.',
                'invalidFile': 'Invalid file format.',
                'fileReadError': 'Error reading the file.',
                'replaceDataConfirm': 'All current data will be replaced. Continue?',
                'saveDataFailed': 'Failed to save data. Please check your browser storage.',
                // Form placeholders and buttons
                'tagsPlaceholder': 'e.g., #meeting #urgent #development',
                'taskContentPlaceholder': 'Enter task content...',
                'cancel': 'Cancel',
                'save': 'Save',
                'confirm': 'OK',
                'standing': 'Ongoing',
                'leadMinutes': '{n} minutes remaining!',
                'leadHours': '{n} hour(s) remaining!',
                'historyImportElectronOnly': 'History import is only available in the desktop app',
                'searchAllColumns': 'All columns',
                'selectedCount': '{n} selected',
                'selectTasksFirst': 'Select tasks first',
                'moreActions': 'More actions',
                'addNewTask': 'Add New Task',
                'editTask': 'Edit Task',
                // Completion and deletion
                'completeTask': 'Complete Task',
                'deleteTask': 'Delete Task',
                'completeDetails': 'Completion notes (optional)',
                'completedAt': 'Completed at',
                'showAll': 'All',
                'totalCount': '{n} tasks',
                'dragToMove': 'Drag to move the window',
                'views': 'Views',
                'searchAndFilters': 'Search and Filters',
                'repeatingTasks': 'Repeating Tasks',
                'sideStrip': 'Side strip',
                'aboutListViewDesc': 'The table. Everything you can do to a task happens here',
                'aboutCalendarViewDesc': 'A month grid, toggled from the buttons at the top right. A task shows on every day it spans, and one with no target time sits at the top of its start day. The time shown is the target time. View-only - nothing in a cell is clickable',
                'aboutCollapsedViewDesc': 'Ctrl+M. Read-only, always on top. In calendar view it stands up a single day - today, or the next day with work if today is clear',
                'aboutSearchColumnTitle': 'Search a column',
                'aboutSearchColumnDesc': 'The dropdown beside the search box narrows the search to one column',
                'aboutChipFilterTitle': 'Chips',
                'aboutChipFilterDesc': 'Click a tag, status or repeat chip in the table to filter by it. The column follows automatically',
                'aboutQuickFilterTitle': 'Quick filters',
                'aboutQuickFilterDesc': 'The row under the search box lists the statuses and tags actually in use, up to fifteen. All clears the search and the column',
                'aboutRepeatRowTitle': 'One row is the rule',
                'aboutRepeatRowDesc': 'Set a repeat in the task edit form. Completing it does not remove the row - the dates move to the next occurrence',
                'aboutRepeatStepTitle': 'One step at a time',
                'aboutRepeatStepDesc': 'A task overdue by five occurrences takes five presses, and each is logged. To skip ahead, edit the date',
                'aboutRepeatDeleteTitle': 'Deleting',
                'aboutRepeatDeleteDesc': 'Deleting the row deletes the repeat rule with it',
                'aboutRepeatTargetTitle': 'Target time required',
                'aboutRepeatTargetDesc': 'A task with no target time cannot repeat',
                'aboutSelectTitle': 'Select',
                'aboutSelectDesc': 'Click anywhere in a row. Tags and status chips are the exception - they filter instead',
                'aboutStandingStatusDesc': 'No target time. Never overdue or due soon, and raises no notifications',
                'nothingCompletedYet': 'Nothing completed yet today',
                'completedToday': 'Completed today',
                'moreTags': 'More tags exist; search to reach them',
                'nothingScheduled': 'Nothing scheduled',
                'calendarView': 'Calendar view',
                'listView': 'List view',
                'today': 'Today',
                'weekdayNames': 'Mon,Tue,Wed,Thu,Fri,Sat,Sun',
                'deleteReason': 'Reason for deletion (optional)',
                'confirmComplete': 'Confirm completion',
                'confirmDelete': 'Confirm deletion',
                'tagsHelpText': 'You can add tag presets in Settings to make tagging easier.',
                'tagsInlineHelp': '(Create presets in Settings for easier tagging)',
                // Statistics and UI elements
                'statistics': 'Statistics',
                'statisticsTitle': 'Statistics (Last 30 Days)',
                'collapseView': 'Collapse view (Ctrl+M)',
                'expand': 'Expand',
                'clearSearch': 'Clear search',
                'expandToFullView': 'Expand to full view',
                // Settings modal
                'settingsTitle': 'Settings',
                'language': 'Language',
                'themeMode': 'Theme Mode',
                'lightMode': 'Light Mode',
                'darkMode': 'Dark Mode',
                'defaultNotification': 'Default Notification',
                'notificationsOn': 'Notifications On',
                'notificationsOff': 'Notifications Off',
                'unfocusedOpacity': 'Unfocused Opacity',
                'tagPresets': 'Tag Presets',
                'useColors': 'Use colors:',
                'add': 'Add',
                // About modal
                'aboutTitle': 'About Tasktory',
                'viewHistory': 'View History',
                'howToUse': 'How to Use',
                'notifications': 'Notifications',
                'taskStatus': 'Task Status',
                'keyboardShortcuts': 'Keyboard Shortcuts',
                'addNewTaskShortcut': 'Add new task',
                'collapseViewShortcut': 'Collapse view (80px width)',
                'closeModalShortcut': 'Close modal or date picker',
                'version': 'Version',
                'license': 'License',
                'author': 'Author',
                // Settings - Tag presets
                'noTagPresetsAdded': 'No tag presets added yet',
                // About - How to Use instructions
                'addTaskInstruction': 'Click',
                'addTaskInstructionEnd': 'icon or press Ctrl+N',
                'editInstruction': 'Click',
                'editInstructionEnd': 'icon in Actions column',
                'completeInstruction': 'Click',
                'completeInstructionEnd': 'icon to mark as done',
                'deleteInstruction': 'Click',
                'deleteInstructionEnd': 'icon to remove task',
                'highlightInstruction': 'Click',
                'highlightInstructionEnd': 'icon to highlight important tasks',
                'reorderInstruction': 'Use',
                'reorderInstructionEnd': 'arrows to change task order',
                'exportImportInstruction': 'Use',
                'exportImportInstructionEnd': 'arrows to backup/restore data',
                'tagsInstruction': 'Use #hashtags separated by spaces (e.g., #work #urgent)',
                'notificationsInstruction': 'Click',
                'notificationsInstructionEnd': 'icon to toggle task notifications',
                // About - Notifications section
                'autoAlerts': 'Auto Alerts',
                'autoAlertsDesc': '1 hour and 15 minutes before deadline',
                'overdueAlert': 'Overdue Alert',
                'overdueAlertDesc': 'When task passes target time',
                'togglePerTask': 'Toggle Per Task',
                'togglePerTaskDesc': 'Use bell button in task row',
                'defaultSetting': 'Default Setting',
                'defaultSettingDesc': 'Configure in Settings',
                'defaultSettingEnd': 'icon',
                // About - Task Status descriptions
                'pendingStatusDesc': 'Task is waiting to be started',
                'inProgressStatusDesc': 'Task is currently being worked on',
                'dueSoonStatusDesc': 'Less than 1 hour remaining',
                'overdueStatusDesc': 'Task has passed target time',
                'completedStatusDesc': 'Task has been finished',
                // Completion Counter section
                'completionCounterTitle': 'Completion Counter',
                'completionCounterDescription': 'The completion counter shows the number of tasks completed today, based on completion records in the daily history log files.'
            },
            'ko': {
                // Status
                'done': '완료',
                'pending': '대기',
                'inprogress': '진행중',
                'overdue': '지연',
                'urgent': '임박',
                // Table headers
                'number': '번호',
                'startTime': '시작 시간',
                'targetTime': '목표 시간',
                'tags': '태그',
                'taskContent': '작업 내용',
                'status': '상태',
                'actions': '작업',
                // Tooltips
                'addTask': '작업 추가',
                'edit': '편집',
                'complete': '완료',
                'delete': '삭제',
                'highlight': '강조',
                'moveUp': '위로 이동',
                'moveDown': '아래로 이동',  
                'downloadExport': '다운로드/내보내기',
                'uploadImport': '업로드/가져오기',
                'settings': '설정',
                'about': '정보',
                'search': '검색...',
                'completed': '완료',
                'completionCounter': '완료',
                'position': '위치',
                'notification': '알림 토글',
                // Messages
                'noTasks': '등록된 작업이 없습니다. \'+ 작업 추가\' 버튼을 클릭하여 작업을 추가해보세요.',
                'repeat': '반복',
                'repeatNone': '반복 안 함',
                'repeatDaily': '매일',
                'repeatWeekly': '매주',
                'repeatMonthly': '매월',
                'repeatYearly': '매년',
                'repeatUnitDaily': '일마다',
                'repeatUnitWeekly': '주마다',
                'repeatUnitMonthly': '개월마다',
                'repeatUnitYearly': '년마다',
                'repeatIntervalFormat': '{n}{unit}',
                'repeatHelp': '다음 회차는 앱을 켤 때 위 시각을 기준으로 생성됩니다.',
                'repeating': '반복 작업',
                'repeatFilter': '반복 작업만 보기',
                'dateFormat': '날짜 표기',
                'invalidDateFormat': '날짜를 이 형식으로 입력해 주세요:',
                'weekdaysShort': '일,월,화,수,목,금,토',
                'allCompleted': '모든 작업이 완료되었습니다! 새로운 작업을 추가해보세요.',
                'noSearchResults': '검색 조건에 맞는 작업이 없습니다.',
                'deleteConfirm': '이 작업을 삭제하시겠습니까?',
                'fillAllFields': '모든 필드를 입력해주세요.',
                'targetAfterStart': '목표 시간은 시작 시간보다 늦어야 합니다.',
                'dataImportSuccess': '데이터를 성공적으로 가져왔습니다.',
                'invalidFile': '올바르지 않은 파일 형식입니다.',
                'fileReadError': '파일을 읽는 중 오류가 발생했습니다.',
                'replaceDataConfirm': '현재 데이터가 모두 대체됩니다. 계속하시겠습니까?',
                'saveDataFailed': '데이터 저장에 실패했습니다. 브라우저 저장공간을 확인해주세요.',
                // Form placeholders and buttons
                'tagsPlaceholder': '예: #회의 #긴급 #개발',
                'taskContentPlaceholder': '작업 내용을 입력하세요...',
                'cancel': '취소',
                'save': '저장',
                'confirm': '확인',
                'standing': '상시',
                'leadMinutes': '{n}분 남았습니다',
                'leadHours': '{n}시간 남았습니다',
                'historyImportElectronOnly': '이력 가져오기는 데스크톱 앱에서만 됩니다',
                'searchAllColumns': '전체 컬럼',
                'selectedCount': '{n}개 선택됨',
                'selectTasksFirst': '먼저 작업을 선택하세요',
                'moreActions': '추가 작업',
                'addNewTask': '새 작업 추가',
                'editTask': '작업 편집',
                // Completion and deletion
                'completeTask': '작업 완료',
                'deleteTask': '작업 삭제',
                'completeDetails': '완료 메모 (선택사항)',
                'completedAt': '완료 시각',
                'showAll': '전체',
                'totalCount': '{n}건',
                'dragToMove': '끌어서 창 옮기기',
                'views': '보기',
                'searchAndFilters': '검색과 필터',
                'repeatingTasks': '반복 작업',
                'sideStrip': '측면 스트립',
                'aboutListViewDesc': '표. 작업에 할 수 있는 일은 모두 여기서 한다',
                'aboutCalendarViewDesc': '월간 격자. 오른쪽 위 버튼으로 전환한다. 작업은 걸쳐 있는 모든 날에 나타나고, 목표 시각이 없는 작업은 시작한 날 맨 위에 놓인다. 표시되는 시각은 목표 시각이다. 보기 전용이라 칸 안에는 누를 것이 없다',
                'aboutCollapsedViewDesc': 'Ctrl+M. 읽기 전용이며 항상 위에 뜬다. 달력 보기에서는 하루만 세운다 - 오늘, 오늘이 비어 있으면 일이 있는 다음 날',
                'aboutSearchColumnTitle': '컬럼 지정 검색',
                'aboutSearchColumnDesc': '검색창 옆 선택 상자로 검색 대상을 한 컬럼으로 좁힌다',
                'aboutChipFilterTitle': '칩',
                'aboutChipFilterDesc': '표 안의 태그·상태·반복 칩을 누르면 그 값으로 검색한다. 검색 대상 컬럼도 따라 바뀐다',
                'aboutQuickFilterTitle': '빠른 필터',
                'aboutQuickFilterDesc': '검색창 아래 줄에 실제로 쓰이고 있는 상태와 태그가 최대 열다섯 개까지 나온다. 전체를 누르면 검색어와 대상 컬럼이 함께 초기화된다',
                'aboutRepeatRowTitle': '한 행이 곧 규칙',
                'aboutRepeatRowDesc': '작업 편집 창에서 반복을 설정한다. 완료해도 행은 사라지지 않고 날짜가 다음 회차로 넘어간다',
                'aboutRepeatStepTitle': '한 번에 한 회차',
                'aboutRepeatStepDesc': '다섯 회차가 밀렸다면 다섯 번 눌러야 하고, 각각이 이력에 남는다. 건너뛰려면 날짜를 직접 고친다',
                'aboutRepeatDeleteTitle': '삭제',
                'aboutRepeatDeleteDesc': '행을 지우면 반복 규칙도 함께 지워진다',
                'aboutRepeatTargetTitle': '목표 시각 필요',
                'aboutRepeatTargetDesc': '목표 시각이 없는 작업은 반복할 수 없다',
                'aboutSelectTitle': '선택',
                'aboutSelectDesc': '행 어디를 눌러도 선택된다. 태그와 상태 칩만 예외로, 누르면 검색이 된다',
                'aboutStandingStatusDesc': '목표 시각이 없다. 지연도 임박도 되지 않고 알림도 울리지 않는다',
                'nothingCompletedYet': '오늘 완료한 작업이 없습니다',
                'completedToday': '오늘 완료',
                'moreTags': '태그가 더 있습니다. 검색으로 찾으세요',
                'nothingScheduled': '예정된 일정 없음',
                'calendarView': '달력 보기',
                'listView': '목록 보기',
                'today': '오늘',
                'weekdayNames': '월,화,수,목,금,토,일',
                'deleteReason': '삭제 사유 (선택사항)',
                'confirmComplete': '완료 확인',
                'confirmDelete': '삭제 확인',
                'tagsHelpText': '설정에서 태그 프리셋을 추가하면 태그 작성이 더 쉬워집니다.',
                'tagsInlineHelp': '(설정에서 프리셋 생성 가능)',
                // Statistics and UI elements
                'statistics': '통계',
                'statisticsTitle': '통계 (최근 30일)',
                'collapseView': '축소 보기 (Ctrl+M)',
                'expand': '확장',
                'clearSearch': '검색 지우기',
                'expandToFullView': '전체 보기로 확장',
                // Settings modal
                'settingsTitle': '설정',
                'language': '언어',
                'themeMode': '테마 모드',
                'lightMode': '라이트 모드',
                'darkMode': '다크 모드',
                'defaultNotification': '기본 알림',
                'notificationsOn': '알림 켜기',
                'notificationsOff': '알림 끄기',
                'unfocusedOpacity': '비활성 투명도',
                'tagPresets': '태그 프리셋',
                'useColors': '색상 사용:',
                'add': '추가',
                // About modal
                'aboutTitle': 'Tasktory 정보',
                'viewHistory': '이력 보기',
                'howToUse': '사용법',
                'notifications': '알림',
                'taskStatus': '작업 상태',
                'keyboardShortcuts': '키보드 단축키',
                'addNewTaskShortcut': '새 작업 추가',
                'collapseViewShortcut': '축소 보기 (80px 너비)',
                'closeModalShortcut': '모달 또는 날짜 선택기 닫기',
                'version': '버전',
                'license': '라이센스',
                'author': '제작자',
                // Settings - Tag presets
                'noTagPresetsAdded': '아직 태그 프리셋이 추가되지 않았습니다',
                // About - How to Use instructions
                'addTaskInstruction': '클릭',
                'addTaskInstructionEnd': '아이콘을 클릭하거나 Ctrl+N을 누르세요',
                'editInstruction': '클릭',
                'editInstructionEnd': '작업 열의 아이콘을 클릭하세요',
                'completeInstruction': '클릭',
                'completeInstructionEnd': '아이콘을 클릭하여 완료 표시',
                'deleteInstruction': '클릭',
                'deleteInstructionEnd': '아이콘을 클릭하여 작업 제거',
                'highlightInstruction': '클릭',
                'highlightInstructionEnd': '아이콘을 클릭하여 중요한 작업 강조',
                'reorderInstruction': '사용',
                'reorderInstructionEnd': '화살표로 작업 순서 변경',
                'exportImportInstruction': '사용',
                'exportImportInstructionEnd': '화살표로 데이터 백업/복원',
                'tagsInstruction': '공백으로 구분된 #해시태그 사용 (예: #작업 #긴급)',
                'notificationsInstruction': '클릭',
                'notificationsInstructionEnd': '아이콘을 클릭하여 작업 알림 토글',
                // About - Notifications section
                'autoAlerts': '자동 알림',
                'autoAlertsDesc': '마감 1시간 및 15분 전',
                'overdueAlert': '지연 알림',
                'overdueAlertDesc': '작업이 목표 시간을 초과했을 때',
                'togglePerTask': '작업별 토글',
                'togglePerTaskDesc': '작업 행의 벨 버튼 사용',
                'defaultSetting': '기본 설정',
                'defaultSettingDesc': '설정에서 구성',
                'defaultSettingEnd': '아이콘',
                // About - Task Status descriptions
                'pendingStatusDesc': '작업이 시작을 기다리고 있습니다',
                'inProgressStatusDesc': '작업이 현재 진행 중입니다',
                'dueSoonStatusDesc': '1시간 미만 남음',
                'overdueStatusDesc': '작업이 목표 시간을 초과했습니다',
                'completedStatusDesc': '작업이 완료되었습니다',
                // Completion Counter section
                'completionCounterTitle': '완료 카운터',
                'completionCounterDescription': '완료 카운터는 일일 이력 로그 파일의 완료 기록을 기반으로 오늘 완료된 작업 수를 나타냅니다.'
            },
            'zh': {
                // Status
                'done': '完成',
                'pending': '待处理',
                'inprogress': '进行中',
                'overdue': '逾期',
                'urgent': '即将到期',
                // Table headers
                'number': '#',
                'startTime': '开始时间',
                'targetTime': '目标时间',
                'tags': '标签',
                'taskContent': '任务内容',
                'status': '状态',
                'actions': '操作',
                // Tooltips
                'addTask': '添加任务',
                'edit': '编辑',
                'complete': '完成',
                'delete': '删除',
                'highlight': '高亮',
                'moveUp': '上移',
                'moveDown': '下移',
                'downloadExport': '下载/导出',
                'uploadImport': '上传/导入',
                'settings': '设置',
                'about': '关于',
                'search': '搜索...',
                'completed': '已完成',
                'completionCounter': '已完成',
                'position': '位置',
                'notification': '切换通知',
                // Messages
                'noTasks': '没有注册的任务。点击"+ 添加任务"按钮来添加任务。',
                'repeat': '重复',
                'repeatNone': '不重复',
                'repeatDaily': '每天',
                'repeatWeekly': '每周',
                'repeatMonthly': '每月',
                'repeatYearly': '每年',
                'repeatUnitDaily': '天',
                'repeatUnitWeekly': '周',
                'repeatUnitMonthly': '个月',
                'repeatUnitYearly': '年',
                'repeatIntervalFormat': '每{n}{unit}',
                'repeatHelp': '下一次将在您打开应用时按上述时间创建。',
                'repeating': '重复任务',
                'repeatFilter': '仅显示重复任务',
                'dateFormat': '日期格式',
                'invalidDateFormat': '请按此格式输入日期：',
                'weekdaysShort': '日,一,二,三,四,五,六',
                'allCompleted': '所有任务已完成！添加新任务。',
                'noSearchResults': '没有找到匹配的任务。',
                'deleteConfirm': '确定要删除这个任务吗？',
                'fillAllFields': '请填写所有字段。',
                'targetAfterStart': '目标时间必须晚于开始时间。',
                'dataImportSuccess': '数据导入成功。',
                'invalidFile': '无效的文件格式。',
                'fileReadError': '读取文件时出错。',
                'replaceDataConfirm': '所有当前数据将被替换。继续吗？',
                'saveDataFailed': '保存数据失败。请检查您的浏览器存储。',
                // Form placeholders and buttons
                'tagsPlaceholder': '例如：#会议 #紧急 #开发',
                'taskContentPlaceholder': '输入任务内容...',
                'cancel': '取消',
                'save': '保存',
                'confirm': '确定',
                'standing': '常态',
                'leadMinutes': '还剩 {n} 分钟',
                'leadHours': '还剩 {n} 小时',
                'historyImportElectronOnly': '历史导入仅在桌面应用中可用',
                'searchAllColumns': '所有列',
                'selectedCount': '已选 {n} 项',
                'selectTasksFirst': '请先选择任务',
                'moreActions': '更多操作',
                'addNewTask': '添加新任务',
                'editTask': '编辑任务',
                // Completion and deletion
                'completeTask': '完成任务',
                'deleteTask': '删除任务',
                'completeDetails': '完成备注（可选）',
                'completedAt': '完成时间',
                'showAll': '全部',
                'totalCount': '共 {n} 项',
                'dragToMove': '拖动以移动窗口',
                'views': '视图',
                'searchAndFilters': '搜索与筛选',
                'repeatingTasks': '重复任务',
                'sideStrip': '侧边栏',
                'aboutListViewDesc': '表格。对任务的所有操作都在这里进行',
                'aboutCalendarViewDesc': '月历网格，用右上角的按钮切换。任务会出现在它跨越的每一天；没有目标时间的任务位于开始日的顶部。显示的时间为目标时间。仅供查看，格子内无可点击项',
                'aboutCollapsedViewDesc': 'Ctrl+M。只读，始终置顶。在日历视图中只显示一天——今天，若今天没有任务则显示下一个有任务的日期',
                'aboutSearchColumnTitle': '按列搜索',
                'aboutSearchColumnDesc': '搜索框旁的下拉框可将搜索范围限定为某一列',
                'aboutChipFilterTitle': '标记',
                'aboutChipFilterDesc': '点击表格中的标签、状态或重复标记即可按其筛选，搜索列会自动跟随',
                'aboutQuickFilterTitle': '快速筛选',
                'aboutQuickFilterDesc': '搜索框下方一行列出实际在用的状态与标签，最多十五个。点击“全部”会同时清除搜索词和搜索列',
                'aboutRepeatRowTitle': '一行即规则',
                'aboutRepeatRowDesc': '在任务编辑窗口设置重复。完成后该行不会消失，日期会移到下一次',
                'aboutRepeatStepTitle': '一次前进一步',
                'aboutRepeatStepDesc': '若积压了五次，就要按五次，每次都会记入历史。想跳过请直接修改日期',
                'aboutRepeatDeleteTitle': '删除',
                'aboutRepeatDeleteDesc': '删除该行会同时删除重复规则',
                'aboutRepeatTargetTitle': '需要目标时间',
                'aboutRepeatTargetDesc': '没有目标时间的任务无法重复',
                'aboutSelectTitle': '选择',
                'aboutSelectDesc': '点击行内任意位置即可选中。标签与状态标记除外——点击它们会进行筛选',
                'aboutStandingStatusDesc': '没有目标时间。不会逾期或临近，也不会发出通知',
                'nothingCompletedYet': '今天还没有完成的任务',
                'completedToday': '今日完成',
                'moreTags': '还有更多标签，请使用搜索',
                'nothingScheduled': '没有安排',
                'calendarView': '日历视图',
                'listView': '列表视图',
                'today': '今天',
                'weekdayNames': '一,二,三,四,五,六,日',
                'deleteReason': '删除原因（可选）',
                'confirmComplete': '确认完成',
                'confirmDelete': '确认删除',
                'tagsHelpText': '您可以在设置中添加标签预设以便于标记。',
                'tagsInlineHelp': '（在设置中创建预设以便于标记）',
                // Statistics and UI elements
                'statistics': '统计',
                'statisticsTitle': '统计（最近30天）',
                'collapseView': '折叠视图 (Ctrl+M)',
                'expand': '展开',
                'clearSearch': '清除搜索',
                'expandToFullView': '展开到完整视图',
                // Settings modal
                'settingsTitle': '设置',
                'language': '语言',
                'themeMode': '主题模式',
                'lightMode': '亮色模式',
                'darkMode': '暗色模式',
                'defaultNotification': '默认通知',
                'notificationsOn': '开启通知',
                'notificationsOff': '关闭通知',
                'unfocusedOpacity': '未聚焦透明度',
                'tagPresets': '标签预设',
                'useColors': '使用颜色：',
                'add': '添加',
                // About modal
                'aboutTitle': '关于 Tasktory',
                'viewHistory': '查看历史',
                'howToUse': '使用方法',
                'notifications': '通知',
                'taskStatus': '任务状态',
                'keyboardShortcuts': '键盘快捷键',
                'addNewTaskShortcut': '添加新任务',
                'collapseViewShortcut': '折叠视图（80px宽度）',
                'closeModalShortcut': '关闭模态框或日期选择器',
                'version': '版本',
                'license': '许可证',
                'author': '作者',
                // Settings - Tag presets
                'noTagPresetsAdded': '尚未添加标签预设',
                // About - How to Use instructions
                'addTaskInstruction': '点击',
                'addTaskInstructionEnd': '图标或按 Ctrl+N',
                'editInstruction': '点击',
                'editInstructionEnd': '操作列中的图标',
                'completeInstruction': '点击',
                'completeInstructionEnd': '图标标记为完成',
                'deleteInstruction': '点击',
                'deleteInstructionEnd': '图标删除任务',
                'highlightInstruction': '点击',
                'highlightInstructionEnd': '图标高亮重要任务',
                'reorderInstruction': '使用',
                'reorderInstructionEnd': '箭头更改任务顺序',
                'exportImportInstruction': '使用',
                'exportImportInstructionEnd': '箭头备份/恢复数据',
                'tagsInstruction': '使用空格分隔的#标签 (例如: #工作 #紧急)',
                'notificationsInstruction': '点击',
                'notificationsInstructionEnd': '图标切换任务通知',
                // About - Notifications section
                'autoAlerts': '自动提醒',
                'autoAlertsDesc': '截止时间前1小时和15分钟',
                'overdueAlert': '逾期提醒',
                'overdueAlertDesc': '任务超过目标时间时',
                'togglePerTask': '按任务切换',
                'togglePerTaskDesc': '使用任务行中的铃声按钮',
                'defaultSetting': '默认设置',
                'defaultSettingDesc': '在设置中配置',
                'defaultSettingEnd': '图标',
                // About - Task Status descriptions
                'pendingStatusDesc': '任务等待开始',
                'inProgressStatusDesc': '任务正在进行中',
                'dueSoonStatusDesc': '剩余时间不足1小时',
                'overdueStatusDesc': '任务已超过目标时间',
                'completedStatusDesc': '任务已完成',
                // Completion Counter section
                'completionCounterTitle': '完成计数器',
                'completionCounterDescription': '完成计数器显示今日完成的任务数量，基于日历史记录文件中的完成记录。'
            },
            'ja': {
                // Status
                'done': '完了',
                'pending': '保留中',
                'inprogress': '進行中',
                'overdue': '期限切れ',
                'urgent': '期限間近',
                // Table headers
                'number': '#',
                'startTime': '開始時刻',
                'targetTime': '目標時刻',
                'tags': 'タグ',
                'taskContent': 'タスク内容',
                'status': 'ステータス',
                'actions': 'アクション',
                // Tooltips
                'addTask': 'タスク追加',
                'edit': '編集',
                'complete': '完了',
                'delete': '削除',
                'highlight': 'ハイライト',
                'moveUp': '上に移動',
                'moveDown': '下に移動',
                'downloadExport': 'ダウンロード/エクスポート',
                'uploadImport': 'アップロード/インポート',
                'settings': '設定',
                'about': 'について',
                'search': '検索...',
                'completed': '完了済み',
                'completionCounter': '完了済み',
                'position': '位置',
                'notification': '通知切り替え',
                // Messages
                'noTasks': 'タスクが登録されていません。「+ タスク追加」ボタンをクリックしてタスクを追加してください。',
                'repeat': '繰り返し',
                'repeatNone': '繰り返さない',
                'repeatDaily': '毎日',
                'repeatWeekly': '毎週',
                'repeatMonthly': '毎月',
                'repeatYearly': '毎年',
                'repeatUnitDaily': '日ごと',
                'repeatUnitWeekly': '週ごと',
                'repeatUnitMonthly': 'ヶ月ごと',
                'repeatUnitYearly': '年ごと',
                'repeatIntervalFormat': '{n}{unit}',
                'repeatHelp': '次回はアプリ起動時に上記の時刻で作成されます。',
                'repeating': '繰り返しタスク',
                'repeatFilter': '繰り返しタスクのみ表示',
                'dateFormat': '日付形式',
                'invalidDateFormat': '次の形式で日付を入力してください:',
                'weekdaysShort': '日,月,火,水,木,金,土',
                'allCompleted': 'すべてのタスクが完了しました！新しいタスクを追加してください。',
                'noSearchResults': '検索条件に一致するタスクが見つかりません。',
                'deleteConfirm': 'このタスクを削除してもよろしいですか？',
                'fillAllFields': 'すべてのフィールドを入力してください。',
                'targetAfterStart': '目標時刻は開始時刻より後である必要があります。',
                'dataImportSuccess': 'データのインポートに成功しました。',
                'invalidFile': '無効なファイル形式です。',
                'fileReadError': 'ファイルの読み取り中にエラーが発生しました。',
                'replaceDataConfirm': '現在のデータがすべて置き換えられます。続行しますか？',
                'saveDataFailed': 'データの保存に失敗しました。ブラウザのストレージを確認してください。',
                // Form placeholders and buttons
                'tagsPlaceholder': '例：#会議 #緊急 #開発',
                'taskContentPlaceholder': 'タスク内容を入力...',
                'cancel': 'キャンセル',
                'save': '保存',
                'confirm': 'OK',
                'standing': '常時',
                'leadMinutes': '残り {n} 分です',
                'leadHours': '残り {n} 時間です',
                'historyImportElectronOnly': '履歴の取り込みはデスクトップアプリのみ対応しています',
                'searchAllColumns': 'すべての列',
                'selectedCount': '{n}件を選択中',
                'selectTasksFirst': '先にタスクを選択してください',
                'moreActions': 'その他の操作',
                'addNewTask': '新しいタスクを追加',
                'editTask': 'タスクを編集',
                // Completion and deletion
                'completeTask': 'タスク完了',
                'deleteTask': 'タスク削除',
                'completeDetails': '完了メモ（オプション）',
                'completedAt': '完了時刻',
                'showAll': 'すべて',
                'totalCount': '{n}件',
                'dragToMove': 'ドラッグでウィンドウを移動',
                'views': '表示',
                'searchAndFilters': '検索とフィルター',
                'repeatingTasks': '繰り返しタスク',
                'sideStrip': 'サイドストリップ',
                'aboutListViewDesc': '表。タスクに対する操作はすべてここで行う',
                'aboutCalendarViewDesc': '月間グリッド。右上のボタンで切り替える。タスクはまたがるすべての日に表示され、目標時刻のないものは開始日の先頭に置かれる。表示される時刻は目標時刻。閲覧専用で、セル内に押せるものはない',
                'aboutCollapsedViewDesc': 'Ctrl+M。読み取り専用で常に最前面。カレンダー表示では一日だけを立てる - 今日、今日が空なら次に予定のある日',
                'aboutSearchColumnTitle': '列を指定して検索',
                'aboutSearchColumnDesc': '検索ボックス横のドロップダウンで対象を1列に絞る',
                'aboutChipFilterTitle': 'チップ',
                'aboutChipFilterDesc': '表内のタグ・状態・繰り返しチップを押すとその値で絞り込む。対象列も自動で合わせる',
                'aboutQuickFilterTitle': 'クイックフィルター',
                'aboutQuickFilterDesc': '検索ボックスの下の行に、実際に使われている状態とタグが最大15件まで並ぶ。「すべて」を押すと検索語と対象列がまとめて解除される',
                'aboutRepeatRowTitle': '1行がルールそのもの',
                'aboutRepeatRowDesc': 'タスク編集画面で繰り返しを設定する。完了しても行は消えず、日付が次回に進む',
                'aboutRepeatStepTitle': '一度に1回分',
                'aboutRepeatStepDesc': '5回分たまっていれば5回押す必要があり、それぞれが履歴に残る。飛ばしたいときは日付を直接直す',
                'aboutRepeatDeleteTitle': '削除',
                'aboutRepeatDeleteDesc': '行を削除すると繰り返しルールも一緒に消える',
                'aboutRepeatTargetTitle': '目標時刻が必要',
                'aboutRepeatTargetDesc': '目標時刻のないタスクは繰り返せない',
                'aboutSelectTitle': '選択',
                'aboutSelectDesc': '行のどこを押しても選択される。タグと状態チップだけは例外で、押すと絞り込みになる',
                'aboutStandingStatusDesc': '目標時刻がない。遅延にも間近にもならず、通知も鳴らない',
                'nothingCompletedYet': '今日はまだ完了したタスクがありません',
                'completedToday': '今日の完了',
                'moreTags': 'タグは他にもあります。検索してください',
                'nothingScheduled': '予定なし',
                'calendarView': 'カレンダー表示',
                'listView': 'リスト表示',
                'today': '今日',
                'weekdayNames': '月,火,水,木,金,土,日',
                'deleteReason': '削除理由（オプション）',
                'confirmComplete': '完了確認',
                'confirmDelete': '削除確認',
                'tagsHelpText': 'タグ付けを簡単にするために、設定でタグプリセットを追加できます。',
                'tagsInlineHelp': '（簡単なタグ付けのために設定でプリセットを作成）',
                // Statistics and UI elements
                'statistics': '統計',
                'statisticsTitle': '統計（過去30日間）',
                'collapseView': '折りたたみ表示 (Ctrl+M)',
                'expand': '展開',
                'clearSearch': '検索をクリア',
                'expandToFullView': 'フルビューに展開',
                // Settings modal
                'settingsTitle': '設定',
                'language': '言語',
                'themeMode': 'テーマモード',
                'lightMode': 'ライトモード',
                'darkMode': 'ダークモード',
                'defaultNotification': 'デフォルト通知',
                'notificationsOn': '通知オン',
                'notificationsOff': '通知オフ',
                'unfocusedOpacity': '未フォーカス透明度',
                'tagPresets': 'タグプリセット',
                'useColors': '色を使用：',
                'add': '追加',
                // About modal
                'aboutTitle': 'Tasktoryについて',
                'viewHistory': '履歴を表示',
                'howToUse': '使用方法',
                'notifications': '通知',
                'taskStatus': 'タスクステータス',
                'keyboardShortcuts': 'キーボードショートカット',
                'addNewTaskShortcut': '新しいタスクを追加',
                'collapseViewShortcut': '折りたたみ表示（80px幅）',
                'closeModalShortcut': 'モーダルまたは日付ピッカーを閉じる',
                'version': 'バージョン',
                'license': 'ライセンス',
                'author': '作者',
                // Settings - Tag presets
                'noTagPresetsAdded': 'まだタグプリセットが追加されていません',
                // About - How to Use instructions
                'addTaskInstruction': 'クリック',
                'addTaskInstructionEnd': 'アイコンをクリックまたはCtrl+Nを押す',
                'editInstruction': 'クリック',
                'editInstructionEnd': 'アクション列のアイコンをクリック',
                'completeInstruction': 'クリック',
                'completeInstructionEnd': 'アイコンで完了マーク',
                'deleteInstruction': 'クリック',
                'deleteInstructionEnd': 'アイコンでタスク削除',
                'highlightInstruction': 'クリック',
                'highlightInstructionEnd': 'アイコンで重要なタスクをハイライト',
                'reorderInstruction': '使用',
                'reorderInstructionEnd': '矢印でタスク順序を変更',
                'exportImportInstruction': '使用',
                'exportImportInstructionEnd': '矢印でデータバックアップ/復元',
                'tagsInstruction': 'スペースで区切られた#ハッシュタグを使用 (例: #作業 #緊急)',
                'notificationsInstruction': 'クリック',
                'notificationsInstructionEnd': 'アイコンでタスク通知を切り替え',
                // About - Notifications section
                'autoAlerts': '自動アラート',
                'autoAlertsDesc': '締切の1時間前と15分前',
                'overdueAlert': '期限切れアラート',
                'overdueAlertDesc': 'タスクが目標時刻を過ぎた時',
                'togglePerTask': 'タスク別切り替え',
                'togglePerTaskDesc': 'タスク行のベルボタンを使用',
                'defaultSetting': 'デフォルト設定',
                'defaultSettingDesc': '設定で構成',
                'defaultSettingEnd': 'アイコン',
                // About - Task Status descriptions
                'pendingStatusDesc': 'タスクは開始を待っています',
                'inProgressStatusDesc': 'タスクは現在進行中です',
                'dueSoonStatusDesc': '残り1時間未満',
                'overdueStatusDesc': 'タスクが目標時刻を過ぎました',
                'completedStatusDesc': 'タスクが完了しました',
                // Completion Counter section
                'completionCounterTitle': '完了カウンター',
                'completionCounterDescription': '完了カウンターは、日別履歴ログファイルの完了記録に基づいて、今日完了したタスク数を表示します。'
            },
            'es': {
                // Status
                'done': 'Hecho',
                'pending': 'Pendiente',
                'inprogress': 'En Progreso',
                'overdue': 'Vencido',
                'urgent': 'Próximo a Vencer',
                // Table headers
                'number': '#',
                'startTime': 'Hora de Inicio',
                'targetTime': 'Hora Objetivo',
                'tags': 'Etiquetas',
                'taskContent': 'Contenido de Tarea',
                'status': 'Estado',
                'actions': 'Acciones',
                // Tooltips
                'addTask': 'Añadir Tarea',
                'edit': 'Editar',
                'complete': 'Completar',
                'delete': 'Eliminar',
                'highlight': 'Resaltar',
                'moveUp': 'Mover Arriba',
                'moveDown': 'Mover Abajo',
                'downloadExport': 'Descargar/Exportar',
                'uploadImport': 'Subir/Importar',
                'settings': 'Configuración',
                'about': 'Acerca de',
                'search': 'Buscar...',
                'completed': 'Completado',
                'completionCounter': 'Completado',
                'position': 'Posición',
                'notification': 'Alternar Notificación',
                // Messages
                'noTasks': 'No hay tareas registradas. Haga clic en el botón \'+ Añadir Tarea\' para añadir una tarea.',
                'repeat': 'Repetir',
                'repeatNone': 'Sin repetición',
                'repeatDaily': 'Diario',
                'repeatWeekly': 'Semanal',
                'repeatMonthly': 'Mensual',
                'repeatYearly': 'Anual',
                'repeatUnitDaily': 'días',
                'repeatUnitWeekly': 'semanas',
                'repeatUnitMonthly': 'meses',
                'repeatUnitYearly': 'años',
                'repeatIntervalFormat': 'cada {n} {unit}',
                'repeatHelp': 'La próxima repetición se crea al abrir la aplicación, con los horarios de arriba.',
                'repeating': 'Tarea repetitiva',
                'repeatFilter': 'Mostrar solo tareas repetitivas',
                'dateFormat': 'Formato de fecha',
                'invalidDateFormat': 'Introduzca la fecha con este formato:',
                'weekdaysShort': 'Dom,Lun,Mar,Mié,Jue,Vie,Sáb',
                'allCompleted': '¡Todas las tareas completadas! Añadir nueva tarea.',
                'noSearchResults': 'No se encontraron tareas que coincidan con su búsqueda.',
                'deleteConfirm': '¿Está seguro de que desea eliminar esta tarea?',
                'fillAllFields': 'Por favor complete todos los campos.',
                'targetAfterStart': 'La hora objetivo debe ser posterior a la hora de inicio.',
                'dataImportSuccess': 'Datos importados con éxito.',
                'invalidFile': 'Formato de archivo inválido.',
                'fileReadError': 'Error al leer el archivo.',
                'replaceDataConfirm': 'Todos los datos actuales serán reemplazados. ¿Continuar?',
                'saveDataFailed': 'Error al guardar los datos. Por favor verifique el almacenamiento de su navegador.',
                // Form placeholders and buttons
                'tagsPlaceholder': 'ej., #reunión #urgente #desarrollo',
                'taskContentPlaceholder': 'Ingrese el contenido de la tarea...',
                'cancel': 'Cancelar',
                'save': 'Guardar',
                'confirm': 'Aceptar',
                'standing': 'Continua',
                'leadMinutes': '¡Quedan {n} minutos!',
                'leadHours': '¡Queda(n) {n} hora(s)!',
                'historyImportElectronOnly': 'La importación del historial solo funciona en la aplicación de escritorio',
                'searchAllColumns': 'Todas las columnas',
                'selectedCount': '{n} seleccionadas',
                'selectTasksFirst': 'Seleccione tareas primero',
                'moreActions': 'Más acciones',
                'addNewTask': 'Añadir Nueva Tarea',
                'editTask': 'Editar Tarea',
                // Completion and deletion
                'completeTask': 'Completar Tarea',
                'deleteTask': 'Eliminar Tarea',
                'completeDetails': 'Notas de finalización (opcional)',
                'completedAt': 'Completado a las',
                'showAll': 'Todas',
                'totalCount': '{n} tareas',
                'dragToMove': 'Arrastre para mover la ventana',
                'views': 'Vistas',
                'searchAndFilters': 'Búsqueda y filtros',
                'repeatingTasks': 'Tareas repetidas',
                'sideStrip': 'Franja lateral',
                'aboutListViewDesc': 'La tabla. Todo lo que puede hacer con una tarea ocurre aquí',
                'aboutCalendarViewDesc': 'Una cuadrícula mensual, que se activa con los botones de arriba a la derecha. Una tarea aparece en todos los días que abarca, y una sin hora objetivo se coloca al principio de su día de inicio. La hora mostrada es la hora objetivo. Solo lectura: nada dentro de una celda es pulsable',
                'aboutCollapsedViewDesc': 'Ctrl+M. Solo lectura, siempre visible. En vista de calendario muestra un único día: hoy, o el siguiente día con trabajo si hoy está libre',
                'aboutSearchColumnTitle': 'Buscar en una columna',
                'aboutSearchColumnDesc': 'El desplegable junto al cuadro de búsqueda limita la búsqueda a una columna',
                'aboutChipFilterTitle': 'Etiquetas',
                'aboutChipFilterDesc': 'Pulse una etiqueta, un estado o una pauta de repetición en la tabla para filtrar por ella. La columna se ajusta sola',
                'aboutQuickFilterTitle': 'Filtros rápidos',
                'aboutQuickFilterDesc': 'La fila bajo el cuadro de búsqueda muestra los estados y etiquetas realmente en uso, hasta quince. Todas borra la búsqueda y la columna',
                'aboutRepeatRowTitle': 'Una fila es la regla',
                'aboutRepeatRowDesc': 'Configure la repetición en el formulario de edición. Al completarla la fila no desaparece: las fechas pasan a la siguiente vez',
                'aboutRepeatStepTitle': 'Un paso cada vez',
                'aboutRepeatStepDesc': 'Una tarea con cinco repeticiones atrasadas requiere cinco pulsaciones, y cada una queda registrada. Para saltar, edite la fecha',
                'aboutRepeatDeleteTitle': 'Eliminar',
                'aboutRepeatDeleteDesc': 'Al eliminar la fila se elimina también su regla de repetición',
                'aboutRepeatTargetTitle': 'Se requiere hora objetivo',
                'aboutRepeatTargetDesc': 'Una tarea sin hora objetivo no puede repetirse',
                'aboutSelectTitle': 'Seleccionar',
                'aboutSelectDesc': 'Pulse en cualquier parte de la fila. Las etiquetas y los estados son la excepción: filtran',
                'aboutStandingStatusDesc': 'Sin hora objetivo. Nunca vence ni está por vencer, y no genera avisos',
                'nothingCompletedYet': 'Aún no ha completado nada hoy',
                'completedToday': 'Completadas hoy',
                'moreTags': 'Hay más etiquetas; búsquelas',
                'nothingScheduled': 'Nada programado',
                'calendarView': 'Vista de calendario',
                'listView': 'Vista de lista',
                'today': 'Hoy',
                'weekdayNames': 'Lun,Mar,Mié,Jue,Vie,Sáb,Dom',
                'deleteReason': 'Razón para la eliminación (opcional)',
                'confirmComplete': 'Confirmar finalización',
                'confirmDelete': 'Confirmar eliminación',
                'tagsHelpText': 'Puede añadir preajustes de etiquetas en Configuración para facilitar el etiquetado.',
                'tagsInlineHelp': '(Crear preajustes en Configuración para etiquetado más fácil)',
                // Statistics and UI elements
                'statistics': 'Estadísticas',
                'statisticsTitle': 'Estadísticas (Últimos 30 Días)',
                'collapseView': 'Vista contraída (Ctrl+M)',
                'expand': 'Expandir',
                'clearSearch': 'Limpiar búsqueda',
                'expandToFullView': 'Expandir a vista completa',
                // Settings modal
                'settingsTitle': 'Configuración',
                'language': 'Idioma',
                'themeMode': 'Modo de Tema',
                'lightMode': 'Modo Claro',
                'darkMode': 'Modo Oscuro',
                'defaultNotification': 'Notificación Predeterminada',
                'notificationsOn': 'Notificaciones Activadas',
                'notificationsOff': 'Notificaciones Desactivadas',
                'unfocusedOpacity': 'Opacidad Sin Foco',
                'tagPresets': 'Preajustes de Etiquetas',
                'useColors': 'Usar colores:',
                'add': 'Añadir',
                // About modal
                'aboutTitle': 'Acerca de Tasktory',
                'viewHistory': 'Ver Historial',
                'howToUse': 'Cómo Usar',
                'notifications': 'Notificaciones',
                'taskStatus': 'Estado de Tarea',
                'keyboardShortcuts': 'Atajos de Teclado',
                'addNewTaskShortcut': 'Añadir nueva tarea',
                'collapseViewShortcut': 'Vista contraída (ancho 80px)',
                'closeModalShortcut': 'Cerrar modal o selector de fecha',
                'version': 'Versión',
                'license': 'Licencia',
                'author': 'Autor',
                // Settings - Tag presets
                'noTagPresetsAdded': 'Aún no se han añadido preajustes de etiquetas',
                // About - How to Use instructions
                'addTaskInstruction': 'Hacer clic',
                'addTaskInstructionEnd': 'icono o presionar Ctrl+N',
                'editInstruction': 'Hacer clic',
                'editInstructionEnd': 'icono en la columna Acciones',
                'completeInstruction': 'Hacer clic',
                'completeInstructionEnd': 'icono para marcar como terminado',
                'deleteInstruction': 'Hacer clic',
                'deleteInstructionEnd': 'icono para eliminar tarea',
                'highlightInstruction': 'Hacer clic',
                'highlightInstructionEnd': 'icono para resaltar tareas importantes',
                'reorderInstruction': 'Usar',
                'reorderInstructionEnd': 'flechas para cambiar orden de tareas',
                'exportImportInstruction': 'Usar',
                'exportImportInstructionEnd': 'flechas para respaldar/restaurar datos',
                'tagsInstruction': 'Usar #hashtags separados por espacios (ej., #trabajo #urgente)',
                'notificationsInstruction': 'Hacer clic',
                'notificationsInstructionEnd': 'icono para alternar notificaciones de tarea',
                // About - Notifications section
                'autoAlerts': 'Alertas Automáticas',
                'autoAlertsDesc': '1 hora y 15 minutos antes del plazo',
                'overdueAlert': 'Alerta de Vencimiento',
                'overdueAlertDesc': 'Cuando la tarea pasa el tiempo objetivo',
                'togglePerTask': 'Alternar por Tarea',
                'togglePerTaskDesc': 'Usar botón de campana en fila de tarea',
                'defaultSetting': 'Configuración Predeterminada',
                'defaultSettingDesc': 'Configurar en Ajustes',
                'defaultSettingEnd': 'icono',
                // About - Task Status descriptions
                'pendingStatusDesc': 'La tarea está esperando ser iniciada',
                'inProgressStatusDesc': 'La tarea está siendo trabajada actualmente',
                'dueSoonStatusDesc': 'Menos de 1 hora restante',
                'overdueStatusDesc': 'La tarea ha pasado el tiempo objetivo',
                'completedStatusDesc': 'La tarea ha sido terminada',
                // Completion Counter section
                'completionCounterTitle': 'Contador de Finalización',
                'completionCounterDescription': 'El contador de finalización muestra el número de tareas completadas hoy, basado en los registros de finalización en los archivos de historial diario.'
            }
        };
        
        // Determine language based on locale
        let lang = 'en'; // default
        if (this.locale.startsWith('ko')) {
            lang = 'ko';
        } else if (this.locale.startsWith('zh')) {
            lang = 'zh';
        } else if (this.locale.startsWith('ja')) {
            lang = 'ja';
        } else if (this.locale.startsWith('es')) {
            lang = 'es';
        }
        
        return texts[lang][key] || texts['en'][key] || key;
    }

    updateTagsHelpText() {
        const helpTextDiv = document.getElementById('tagsHelpText');
        const helpMessage = document.getElementById('tagsHelpMessage');
        const inlineHelp = document.getElementById('tagsInlineHelp');
        
        // Check if there are any tag presets
        const hasPresets = this.tagPresets && this.tagPresets.length > 0;
        
        // Always show inline help text
        inlineHelp.textContent = this.getLocalizedText('tagsInlineHelp');
        
        if (!hasPresets) {
            helpMessage.textContent = this.getLocalizedText('tagsHelpText');
            helpTextDiv.style.display = 'flex';
        } else {
            helpTextDiv.style.display = 'none';
        }
    }

    // 태그를 화면에 보이는 형태로. 색상 태그는 저장값과 표시값이 다르다:
    // '#[RED]이슈'로 저장되지만 '#이슈'로 보인다. 검색이 저장값만 보면
    // 화면의 태그를 그대로 입력해도 안 걸린다.
    displayTagTexts(task) {
        return (task.tags || '')
            .split(/\s+/)
            .filter(tag => tag.startsWith('#'))
            .map(tag => this.parseTagWithColor(tag).content);
    }

    // 검색 대상 태그 문자열 (저장값 + 표시값 둘 다)
    searchableTags(task) {
        return [task.tags || '', ...this.displayTagTexts(task)].join(' ').toLowerCase();
    }

    runTaskAction(action, taskId) {
        switch (action) {
            case 'edit': this.editTask(taskId); break;
            case 'complete': this.completeTask(taskId); break;
            case 'delete': this.deleteTask(taskId); break;
            case 'highlight': this.toggleHighlight(taskId); break;
            case 'up': this.moveTask(taskId, 'up'); break;
            case 'down': this.moveTask(taskId, 'down'); break;
            case 'notification': this.toggleNotification(taskId); break;
        }
    }


    // ---- 다중 선택 / 일괄 처리 ---------------------------------------------
    // 행마다 있는 버튼은 그대로 두고, 여러 건을 한 번에 처리할 때만 쓴다.
    // 선택이 없으면 바가 나타나지 않으므로 평소 화면은 달라지지 않는다.

    toggleTaskSelection(taskId, selected) {
        if (selected) {
            this.selectedTaskIds.add(taskId);
        } else {
            this.selectedTaskIds.delete(taskId);
        }
        this.updateSelectionUI();
    }

    // 지금 화면에 보이는 행들 (검색·페이지 적용 후)
    visibleTaskIds() {
        return Array.from(document.querySelectorAll('#tasksBody .task-select'))
            .map(box => box.dataset.taskId);
    }

    // 전체 선택은 페이지가 아니라 지금 걸린 검색 결과 전체에 적용된다.
    // 보이는 열 줄만 잡으면 "전체"라는 말과 어긋나고, 50건을 지우려면 페이지를
    // 넘겨가며 다섯 번 눌러야 했다. 검색은 존중한다 - 걸러 놓고 전체 선택을
    // 눌렀다면 걸러진 것들을 뜻한 것이다.
    toggleSelectAll(selected) {
        for (const task of this.filteredActiveTasks()) {
            if (selected) {
                this.selectedTaskIds.add(task.id);
            } else {
                this.selectedTaskIds.delete(task.id);
            }
        }
        document.querySelectorAll('#tasksBody .task-select').forEach(box => {
            box.checked = selected;
        });
        this.updateSelectionUI();
    }

    clearSelection() {
        this.selectedTaskIds.clear();
        document.querySelectorAll('#tasksBody .task-select').forEach(box => {
            box.checked = false;
        });
        this.updateSelectionUI();
    }

    updateSelectionUI() {
        const summary = document.getElementById('selectionSummary');
        const selectAll = document.getElementById('selectAllTasks');
        if (!summary) return;

        // 목록에서 사라진 항목(삭제·완료)은 선택에서도 빠져야 한다
        for (const id of [...this.selectedTaskIds]) {
            if (!this.tasks.some(t => t.id === id && !t.completed)) {
                this.selectedTaskIds.delete(id);
            }
        }

        const selected = this.selectedTaskIds.size;
        // 선택이 없을 때 안내 문장을 띄우면 늘 잔소리처럼 남는다.
        // 버튼이 이미 흐려져 있으니 개수만 필요할 때 보여주면 된다.
        summary.textContent = selected > 0
            ? this.getLocalizedText('selectedCount').replace('{n}', selected)
            : '';
        summary.classList.toggle('has-selection', selected > 0);

        const singleOnly = new Set(['edit', 'up', 'down']);
        document.querySelectorAll('[data-bulk]').forEach(button => {
            const action = button.dataset.bulk;
            button.disabled = singleOnly.has(action) ? selected !== 1 : selected === 0;
        });

        const tips = {
            notification: 'notification', edit: 'edit', complete: 'complete',
            delete: 'delete', highlight: 'highlight', up: 'moveUp', down: 'moveDown'
        };
        document.querySelectorAll('[data-bulk]').forEach(button => {
            button.title = this.getLocalizedText(tips[button.dataset.bulk]);
        });

        if (selectAll) {
            // 머리 체크박스도 검색 결과 전체를 기준으로 읽는다. 현재 페이지만
            // 보면 2페이지로 넘겼을 때 "전체 선택됨"이 풀린 것처럼 보인다.
            const all = this.filteredActiveTasks().map(t => t.id);
            const allChosen = all.length > 0 && all.every(id => this.selectedTaskIds.has(id));
            selectAll.checked = allChosen;
            selectAll.indeterminate = !allChosen && all.some(id => this.selectedTaskIds.has(id));
        }
    }

    // 선택된 항목에 같은 동작을 순서대로 적용한다. 저장은 saveTasks가 직렬화하므로
    // 중간에 서로 덮어쓰지 않는다.
    async runBulkAction(action) {
        const ids = [...this.selectedTaskIds];
        if (ids.length === 0) return;

        // 편집과 순서 이동은 대상이 하나여야 뜻이 통한다. 선택은 유지해서
        // 위/아래를 연속으로 누를 수 있게 한다.
        if (action === 'edit' || action === 'up' || action === 'down') {
            if (ids.length !== 1) return;
            this.runTaskAction(action, ids[0]);
            return;
        }

        // 완료와 삭제는 확인 모달을 거친다. 행마다 버튼이 있던 시절에는
        // completeTask/deleteTask가 모달을 열었는데, 막대로 옮기면서 여기서
        // doCompleteTask를 직접 부르는 바람에 확인 절차가 통째로 끊겼었다.
        if (action === 'complete' || action === 'delete') {
            this.showConfirmModal(action, ids);
            return;
        }

        // 토글은 선택 전체를 같은 상태로 맞춘다. 각자 뒤집으면 상태가 섞여
        // 있을 때 결과가 뒤죽박죽이 되고, 누르기 전에 무엇이 될지 알 수 없다.
        // 규칙은 "표시된 쪽으로 모은다": 하나라도 표시되지 않은 것이 있으면
        // 전부 표시하고, 전부 표시되어 있을 때만 전부 해제한다. 강조는
        // 강조됨이, 알림은 금지됨이 표시된 상태다.
        const picked = ids.map(id => this.tasks.find(t => t.id === id)).filter(Boolean);
        const highlightTo = picked.some(t => !t.highlighted);
        const notifyTo = picked.every(t => t.notificationEnabled === false);

        for (const task of picked) {
            if (action === 'highlight') {
                if (!task.highlighted !== !highlightTo) await this.toggleHighlight(task.id);
            } else if (action === 'notification') {
                if ((task.notificationEnabled !== false) !== notifyTo) {
                    await this.toggleNotification(task.id);
                }
            }
        }

        // 선택은 남긴다. 되돌리려면 한 번 더 눌러야 하는데, 여기서 비우면 다시
        // 고르기 전에는 누를 수가 없어 "한 번 더 눌러도 그대로"로 보인다.
        // (완료·삭제는 위에서 모달로 빠지고, 확정된 뒤에 선택을 비운다.)
        this.renderTasks();
    }

    // ---- 날짜/시간 선택기 -------------------------------------------------
    // 표시 형식이 설정에 따라 달라지므로 네이티브 datetime-local을 쓸 수 없다.
    // 직접 만든 대신 확인/취소 버튼이 있어서, 고르고 딴 데를 눌러야 확정되던
    // 네이티브 피커보다 무엇이 적용되는지 분명하다.

    openDateTimePicker(inputId) {
        const input = document.getElementById(inputId);
        const picker = document.getElementById('dateTimePicker');
        if (!input || !picker) return;

        // 입력값이 형식에 맞으면 그 시각에서, 아니면 지금에서 시작한다
        const current = parseWithPattern(input.value, this.dateFormat) || new Date();
        this.pickerTarget = inputId;
        this.pickerDate = new Date(current);
        this.pickerMonth = new Date(current.getFullYear(), current.getMonth(), 1);

        this.pickerHour = current.getHours();
        this.pickerMinute = current.getMinutes();
        document.getElementById('dtpCancel').textContent = this.getLocalizedText('cancel');
        document.getElementById('dtpApply').textContent = this.getLocalizedText('confirm');

        this.renderPickerCalendar();
        this.renderPickerTime();

        picker.style.display = 'block';
        const box = input.getBoundingClientRect();
        picker.style.top = `${box.bottom + 4}px`;
        picker.style.left = `${box.left}px`;

        // 화면 밖으로 나가면 끌어들인다
        const shown = picker.getBoundingClientRect();
        if (shown.right > window.innerWidth - 8) {
            picker.style.left = `${Math.max(8, window.innerWidth - shown.width - 8)}px`;
        }
        if (shown.bottom > window.innerHeight - 8) {
            picker.style.top = `${Math.max(8, box.top - shown.height - 4)}px`;
        }
    }

    closeDateTimePicker() {
        const picker = document.getElementById('dateTimePicker');
        if (picker) picker.style.display = 'none';
        this.pickerTarget = null;
    }

    renderPickerCalendar() {
        const month = this.pickerMonth;
        document.getElementById('dtpMonthLabel').textContent =
            month.toLocaleDateString(this.locale, { year: 'numeric', month: 'long' });

        const weekdays = document.getElementById('dtpWeekdays');
        weekdays.innerHTML = '';
        for (const name of this.getLocalizedText('weekdaysShort').split(',')) {
            const cell = document.createElement('span');
            cell.textContent = name;
            weekdays.appendChild(cell);
        }

        const days = document.getElementById('dtpDays');
        days.innerHTML = '';

        const first = new Date(month.getFullYear(), month.getMonth(), 1);
        const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
        const sameDay = (a, b) =>
            a.getFullYear() === b.getFullYear() &&
            a.getMonth() === b.getMonth() &&
            a.getDate() === b.getDate();
        const today = new Date();

        // 1일이 오는 요일만큼 앞을 비운다
        for (let i = 0; i < first.getDay(); i++) {
            days.appendChild(document.createElement('span'));
        }

        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(month.getFullYear(), month.getMonth(), day);
            const cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'dtp-day';
            cell.textContent = day;
            if (sameDay(date, this.pickerDate)) cell.classList.add('selected');
            if (sameDay(date, today)) cell.classList.add('today');
            cell.addEventListener('click', () => {
                this.pickerDate = date;
                this.renderPickerCalendar();
            });
            days.appendChild(cell);
        }
    }

    // 시/분도 눌러서 고른다. 숫자 입력창은 피커 안에서 이질적이고, 몇 시인지
    // 훑어보기도 어렵다. 분은 5분 단위로 두되 현재 값이 그 사이면 함께 넣어
    // 09:07 같은 값이 고를 수 없게 사라지지 않도록 한다.
    renderPickerTime() {
        const hours = document.getElementById('dtpHours');
        const minutes = document.getElementById('dtpMinutes');
        if (!hours || !minutes) return;

        const fill = (container, values, selected, onPick) => {
            container.innerHTML = '';
            for (const value of values) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'dtp-time-cell';
                cell.dataset.value = value;
                cell.textContent = String(value).padStart(2, '0');
                if (value === selected) cell.classList.add('selected');
                cell.addEventListener('click', () => {
                    onPick(value);
                    this.renderPickerTime();
                });
                container.appendChild(cell);
            }
            const active = container.querySelector('.selected');
            if (active) container.scrollTop = active.offsetTop - container.clientHeight / 2 + 12;
        };

        const minuteValues = [...new Set(
            [...Array.from({ length: 12 }, (_, i) => i * 5), this.pickerMinute]
        )].sort((a, b) => a - b);

        fill(hours, Array.from({ length: 24 }, (_, i) => i), this.pickerHour,
            (value) => { this.pickerHour = value; });
        fill(minutes, minuteValues, this.pickerMinute,
            (value) => { this.pickerMinute = value; });
    }

    movePickerMonth(delta) {
        this.pickerMonth = new Date(
            this.pickerMonth.getFullYear(),
            this.pickerMonth.getMonth() + delta,
            1
        );
        this.renderPickerCalendar();
    }

    applyDateTimePicker() {
        if (!this.pickerTarget) return;

        const chosen = new Date(this.pickerDate);
        chosen.setHours(this.pickerHour, this.pickerMinute, 0, 0);

        document.getElementById(this.pickerTarget).value =
            formatWithPattern(chosen, this.dateFormat);
        this.closeDateTimePicker();
    }

    // 날짜 형식 선택 목록. 형식 문자열과 그 형식으로 찍은 실제 예시를 함께 보여준다.
    updateDateFormatControls() {
        const label = document.getElementById('settingsDateFormatLabel');
        const select = document.getElementById('dateFormatSelect');
        const preview = document.getElementById('dateFormatPreview');
        if (!label || !select) return;

        label.textContent = this.getLocalizedText('dateFormat');

        if (select.options.length !== DATE_FORMATS.length) {
            select.innerHTML = '';
            for (const pattern of DATE_FORMATS) {
                const option = document.createElement('option');
                option.value = pattern;
                select.appendChild(option);
            }
        }

        const sample = new Date(2026, 7, 4, 15, 30);
        Array.from(select.options).forEach((option, index) => {
            const pattern = DATE_FORMATS[index];
            option.textContent = `${pattern}    ${formatWithPattern(sample, pattern)}`;
        });

        select.value = this.dateFormat;
        if (preview) preview.textContent = formatWithPattern(new Date(), this.dateFormat);
    }

    changeDateFormat(pattern) {
        this.dateFormat = pattern;
        localStorage.setItem('dateFormat', pattern);
        this.updateDateFormatControls();
        this.renderTasks();
    }

    // 슬라이더 범위(0.3~1) 밖의 값은 무시한다. 0에 가까우면 창이 사실상
    // 사라져서 되돌릴 방법이 없다.
    loadUnfocusedOpacity() {
        const saved = parseFloat(localStorage.getItem('unfocusedOpacity'));
        return saved >= 0.3 && saved <= 1 ? saved : 1;
    }

    changeUnfocusedOpacity(opacity) {
        this.unfocusedOpacity = opacity;
        localStorage.setItem('unfocusedOpacity', String(opacity));
        this.updateOpacityControl();
        if (this.isElectron) window.electronAPI.setUnfocusedOpacity(opacity);
    }

    updateOpacityControl() {
        const slider = document.getElementById('settingsOpacitySlider');
        const value = document.getElementById('opacityValue');
        if (slider) slider.value = String(this.unfocusedOpacity);
        if (value) value.textContent = String(this.unfocusedOpacity);
    }

    // 검색 대상 컬럼 목록. 라벨은 표 헤더와 같은 문구를 쓴다.
    updateSearchColumnControl() {
        const select = document.getElementById('searchColumn');
        if (!select) return;

        const columns = [
            ['all', 'searchAllColumns'],
            ['start', 'startTime'],
            ['target', 'targetTime'],
            ['tags', 'tags'],
            ['content', 'taskContent'],
            ['status', 'status'],
            ['repeat', 'repeat']
        ];

        if (select.options.length !== columns.length) {
            select.innerHTML = '';
            for (const [value] of columns) {
                const option = document.createElement('option');
                option.value = value;
                select.appendChild(option);
            }
        }
        columns.forEach(([, key], index) => {
            select.options[index].textContent = this.getLocalizedText(key);
        });
        select.value = this.searchColumn;
    }

    // ---- 달력 보기 ---------------------------------------------------------
    // 목록은 "무엇이 있는가"에 강하고 달력은 "언제 몰려 있는가"에 강하다.
    // 보기 전용이다: 선택도 편집도 없다. 좁은 칸에 클릭 대상을 채우면 잘못
    // 누르기 쉽고, 어차피 목록으로 돌아가면 다 할 수 있다.

    // 달력 칸은 문자열로 조립한다. 작업 내용에 '<'가 들어가면 격자가 깨지므로
    // 넣기 전에 막는다.
    escapeHtml(text) {
        return String(text).replace(/[&<>"]/g, ch =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    }

    // 하루 단위 키. 파일 이름과 마찬가지로 로컬 날짜다.
    dayKey(date) {
        return formatWithPattern(date, 'YYYY-MM-DD');
    }

    // 날짜별 작업 묶음. 작업은 **마감일 하루에만** 놓인다.
    // 예전에는 시작일부터 마감일까지 걸친 날을 전부 칠했는데, 시작 시각은
    // 대개 "적어둔 때"라서 마감을 며칠 미루면 그 사이가 통째로 칠해졌다.
    // 편집한 날에만 있어야 할 것이 이전 날짜에 그대로 남아 누적된 것처럼
    // 보였고, 달력 전체가 같은 작업으로 번졌다.
    // 마감이 없는 상시 업무만 기준이 없으므로 시작한 날에 둔다.
    tasksByDay(tasks) {
        const byDay = new Map();

        for (const task of tasks) {
            const anchor = new Date(task.targetDateTime || task.startDateTime);
            if (isNaN(anchor.getTime())) continue;

            const key = this.dayKey(anchor);
            if (!byDay.has(key)) byDay.set(key, []);
            byDay.get(key).push(task);
        }

        // 칸 안에서는 목표 시각순. 달력에서 궁금한 것은 "언제까지"이지 "언제부터"가
        // 아니라서 칸에 찍는 시각도 목표 시각이고, 정렬도 같은 값을 따라야
        // 보이는 시각이 순서대로 선다.
        // 마감 없는 상시 업무는 시각이 없으니 맨 위로 올린다 (종일 줄과 같은 자리).
        for (const list of byDay.values()) {
            list.sort((a, b) => {
                if (!a.targetDateTime !== !b.targetDateTime) return a.targetDateTime ? 1 : -1;
                return String(a.targetDateTime).localeCompare(String(b.targetDateTime));
            });
        }

        return byDay;
    }

    // 칸 안의 한 줄. 목표 시각 + 내용, 배경은 상태색.
    calendarChip(task) {
        const status = this.getTaskStatus(task);
        const time = task.targetDateTime
            ? formatWithPattern(new Date(task.targetDateTime), 'HH:mm')
            : '';
        const title = this.escapeHtml(task.content);
        const text = this.escapeHtml(task.content.split('\n')[0].replace(/^\s*\d+\s*[.)]\s*/, ''));
        const marks = task.highlighted ? ' highlighted' : '';

        return `<div class="cal-chip ${status.status}${marks}" title="${title}">` +
            (time ? `<span class="cal-chip-time">${time}</span>` : '') +
            `<span class="cal-chip-text">${text}</span></div>`;
    }

    moveCalendarMonth(delta) {
        this.calendarMonth = new Date(
            this.calendarMonth.getFullYear(),
            this.calendarMonth.getMonth() + delta,
            1
        );
        this.renderTasks();
    }

    renderCalendar() {
        const grid = document.getElementById('calGrid');
        const label = document.getElementById('calLabel');
        const weekdays = document.getElementById('calWeekdays');
        if (!grid) return;

        label.textContent = formatWithPattern(this.calendarMonth, 'YYYY-MM');
        document.getElementById('calToday').textContent = this.getLocalizedText('today');

        const names = this.getLocalizedText('weekdayNames').split(',');
        weekdays.innerHTML = names.map(n => `<div class="cal-weekday">${n}</div>`).join('');

        const byDay = this.tasksByDay(this.filteredActiveTasks());
        const todayKey = this.dayKey(new Date());
        const month = this.calendarMonth.getMonth();

        // 월요일 시작. 첫 칸은 1일이 속한 주의 월요일이다.
        const first = new Date(this.calendarMonth);
        const cursor = new Date(first);
        cursor.setDate(1 - ((first.getDay() + 6) % 7));

        const cells = [];
        // 6주면 어떤 달이든 덮는다. 5주로 끝나는 달은 마지막 줄이 다음 달로만
        // 채워지므로 그 줄은 그리지 않는다.
        for (let week = 0; week < 6; week++) {
            const row = [];
            for (let day = 0; day < 7; day++) {
                const key = this.dayKey(cursor);
                const outside = cursor.getMonth() !== month;
                const classes = ['cal-day'];
                if (outside) classes.push('outside');
                if (key === todayKey) classes.push('today');

                const chips = (byDay.get(key) || []).map(t => this.calendarChip(t)).join('');
                row.push(
                    `<div class="${classes.join(' ')}">` +
                    `<div class="cal-date">${cursor.getDate()}</div>` +
                    `<div class="cal-day-body">${chips}</div></div>`
                );
                cursor.setDate(cursor.getDate() + 1);
            }
            // 통째로 다음 달인 줄은 버린다
            if (week >= 4 && row.every(cell => cell.includes('outside'))) break;
            cells.push(...row);
        }

        grid.innerHTML = cells.join('');
    }

    // 접힘(150px)에서는 7열 격자가 물리적으로 안 들어간다. 같은 생각을 한 칸으로
    // 옮겨서 오늘 하루를 시간순으로 세운다 - 여전히 달력이지, 목록이 아니다.
    // 스트립에 세울 하루. 오늘에 걸치는 일이 있으면 오늘, 없으면 일이 있는 가장
    // 가까운 앞날이다. 오늘만 고집하면 이번 주에 할 일이 있어도 스트립이 텅 비는데,
    // 늘 떠 있는 메모지가 비어 있으면 접어둘 이유가 없다.
    collapsedCalendarDay() {
        const byDay = this.tasksByDay(this.tasks.filter(t => !t.completed));

        // 격자에서 직접 고른 날이 있으면 그 날이 우선이다. 비어 있어도 보여준다 -
        // "그날은 아무것도 없다"도 알고 싶은 답이다.
        if (this.collapsedPickedKey) {
            return { key: this.collapsedPickedKey, tasks: byDay.get(this.collapsedPickedKey) || [] };
        }

        const todayKey = this.dayKey(new Date());
        if (byDay.has(todayKey)) return { key: todayKey, tasks: byDay.get(todayKey) };

        const ahead = [...byDay.keys()].filter(key => key > todayKey).sort();
        if (ahead.length) return { key: ahead[0], tasks: byDay.get(ahead[0]) };

        // 앞날에도 없으면 지난 것 중 가장 최근 - 밀린 일을 감추지 않는다
        const behind = [...byDay.keys()].sort();
        if (behind.length) return { key: behind[behind.length - 1], tasks: byDay.get(behind[behind.length - 1]) };

        return { key: todayKey, tasks: [] };
    }

    // 하루 안에서 가장 급한 상태. 미니 격자의 점은 칸 하나에 색 하나뿐이라
    // 그날을 대표할 상태를 하나 골라야 한다.
    static get STATUS_SEVERITY() {
        return ['overdue', 'urgent', 'inprogress', 'pending', 'standing', 'completed'];
    }

    worstStatus(tasks) {
        const order = TaskManager.STATUS_SEVERITY;
        let worst = null;
        for (const task of tasks) {
            const status = this.getTaskStatus(task).status;
            if (worst === null || order.indexOf(status) < order.indexOf(worst)) worst = status;
        }
        return worst;
    }

    // 접힘 폭에서는 칸에 글자를 넣을 수 없다. 숫자와 점만으로 "언제 몰려 있는가"를
    // 보여주고, 무엇인지는 아래 목록이 맡는다. 격자가 없으면 날짜만 얹은 목록으로
    // 보여서 달력으로 읽히지 않는다.
    renderCollapsedMiniGrid(shownKey) {
        const grid = document.getElementById('collapsedCalGrid');
        const label = document.getElementById('collapsedCalMonth');
        const weekdays = document.getElementById('collapsedCalWeekdays');
        if (!grid) return;

        // 보여주는 날이 속한 달을 띄운다. 오늘이 비어 다음 달로 넘어갔다면
        // 그 달이 나와야 아래 목록과 격자가 어긋나지 않는다.
        const shown = new Date(`${shownKey}T00:00:00`);
        const month = new Date(shown.getFullYear(), shown.getMonth(), 1);
        label.textContent = formatWithPattern(month, 'YYYY-MM');

        // 첫 글자만 쓴다. 한중일은 원래 한 글자고, 영어·스페인어는 잘라 쓴다.
        weekdays.innerHTML = this.getLocalizedText('weekdayNames').split(',')
            .map(name => `<div>${this.escapeHtml(name.trim().charAt(0))}</div>`).join('');

        const byDay = this.tasksByDay(this.tasks.filter(t => !t.completed));
        const todayKey = this.dayKey(new Date());

        const cursor = new Date(month);
        cursor.setDate(1 - ((month.getDay() + 6) % 7)); // 월요일 시작

        const cells = [];
        for (let i = 0; i < 42; i++) {
            const key = this.dayKey(cursor);
            const outside = cursor.getMonth() !== month.getMonth();
            const status = this.worstStatus(byDay.get(key) || []);

            const classes = ['mini-cal-day'];
            if (outside) classes.push('outside');
            if (key === todayKey) classes.push('today');
            if (key === shownKey) classes.push('shown');

            cells.push(
                `<div class="${classes.join(' ')}" data-day="${key}"><span>${cursor.getDate()}</span>` +
                (status ? `<i class="mini-cal-dot ${status}"></i>` : '') +
                '</div>'
            );
            cursor.setDate(cursor.getDate() + 1);

            // 남은 칸이 전부 다음 달이면 그 줄은 그리지 않는다
            if (i % 7 === 6 && i >= 27 && cursor.getMonth() !== month.getMonth()) break;
        }

        grid.innerHTML = cells.join('');
    }

    renderCollapsedCalendar() {
        const list = document.getElementById('collapsedMiniTasksBody');
        const header = document.getElementById('collapsedCalDate');
        list.innerHTML = '';

        const { key, tasks } = this.collapsedCalendarDay();
        this.renderCollapsedMiniGrid(key);
        if (header) header.textContent = key.slice(5); // MM-DD

        if (tasks.length === 0) {
            // "모든 작업 완료"가 아니다. 남은 일이 있는데 오늘 자리에 없을 뿐일 수도
            // 있어서, 그 문구는 사실이 아닌 말을 하게 된다.
            list.innerHTML = `<li class="empty-message">${this.getLocalizedText('nothingScheduled')}</li>`;
            return;
        }

        for (const task of tasks) {
            const li = document.createElement('li');
            li.setAttribute('data-task-id', task.id);

            const time = document.createElement('span');
            time.className = 'mini-index';
            time.textContent = task.targetDateTime
                ? formatWithPattern(new Date(task.targetDateTime), 'HH:mm')
                : '·';

            const text = document.createElement('span');
            text.className = 'mini-text';
            text.textContent = task.content.split('\n')[0].replace(/^\s*\d+\s*[.)]\s*/, '');

            li.append(time, text);
            li.title = task.content;
            if (task.highlighted) li.classList.add('highlighted');
            else li.classList.add(this.getTaskStatus(task).status);

            list.appendChild(li);
        }
    }

    toggleViewMode() {
        this.viewMode = this.viewMode === 'calendar' ? 'list' : 'calendar';
        localStorage.setItem('viewMode', this.viewMode);
        // 보기를 바꿀 때마다 이번 달로 돌아온다. 지난달을 보다 목록으로 갔다가
        // 돌아왔을 때 엉뚱한 달이 떠 있으면 비어 보인다.
        this.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        // 골라둔 날도 같이 놓는다. 같은 이유다 - 목록으로 갔다 돌아왔는데
        // 지난주가 떠 있으면 오늘 할 일이 없는 것처럼 보인다.
        this.collapsedPickedKey = null;
        this.applyViewMode();
        this.renderTasks();
        // 접힌 채로 보기를 바꾸면 줄 수가 달라지므로 창 높이도 다시 맞춘다
        if (this.isCollapsed) this.resizeCollapsedWindow();
    }

    // 달력일 때 숨길 것들: 선택 막대와 페이지 넘김은 보기 전용 화면에서 할 일이 없다.
    applyViewMode() {
        const calendar = this.viewMode === 'calendar';
        const show = (id, visible) => {
            const el = document.getElementById(id);
            if (el) el.style.display = visible ? '' : 'none';
        };

        show('calendarView', calendar && !this.isCollapsed);
        show('taskActionBar', !calendar);
        show('paginationContainer', !calendar);
        document.querySelector('.table-container').style.display = calendar ? 'none' : '';

        // 아이콘은 "지금 무엇인가"가 아니라 "누르면 무엇이 되는가"를 그린다.
        // 접기 버튼과 같은 규칙이라 둘이 따로 놀지 않는다.
        const button = document.getElementById('viewModeBtn');
        if (button) {
            button.innerHTML = calendar ? LIST_ICON : CALENDAR_ICON;
            button.title = this.getLocalizedText(calendar ? 'listView' : 'calendarView');
        }
        document.body.classList.toggle('calendar-mode', calendar);
    }

    // ---- 오늘 완료 목록 -----------------------------------------------------
    // 카운터에 마우스를 올리면 무엇을 끝냈는지 보여준다. "오늘 7개"는 뿌듯하지만
    // 무엇이었는지 기억나지 않으면 회고에도 보고에도 쓸모가 없다.
    // 목록은 로그 파일에서 읽는다. 완료한 작업은 활성 목록에서 사라지고, 반복
    // 작업은 다음 회차로 넘어가 버려서 메모리에는 남아 있지 않기 때문이다.
    static get COMPLETED_LIST_LIMIT() { return 12; }

    async loadCompletedToday() {
        if (!this.isElectron || !window.electronAPI.getCompletedTasks) return [];
        const today = formatWithPattern(new Date(), 'YYYY-MM-DD');
        try {
            return await window.electronAPI.getCompletedTasks(today) || [];
        } catch (error) {
            console.error('Failed to read completed tasks:', error);
            return [];
        }
    }

    async renderCompletedList() {
        const box = document.getElementById('completedList');
        if (!box) return;

        const entries = await this.loadCompletedToday();
        if (entries.length === 0) {
            box.innerHTML = `<div class="completed-empty">${this.getLocalizedText('nothingCompletedYet')}</div>`;
            return;
        }

        // 최근 완료가 위로 오게 뒤집는다. 로그는 시간순으로 쌓이지만, 방금 끝낸
        // 것이 궁금해서 올려다보는 경우가 대부분이다.
        const recent = [...entries].reverse();
        const shown = recent.slice(0, TaskManager.COMPLETED_LIST_LIMIT);
        const rows = shown.map(entry => {
            // 로그 본문은 "내용 (completed) at ... 메모" 형태다. 앞의 내용만 뗀다.
            const label = entry.content.replace(/\s*\(completed\).*$/, '') || entry.content;
            const time = entry.timestamp.slice(11, 16); // HH:mm
            return `<div class="completed-row"><span class="completed-time">${this.escapeHtml(time)}</span>` +
                `<span class="completed-text">${this.escapeHtml(label)}</span></div>`;
        });

        if (recent.length > shown.length) {
            rows.push(`<div class="completed-more">+${recent.length - shown.length}</div>`);
        }

        box.innerHTML = rows.join('');
    }

    // 손잡이를 끌면 창이 따라온다. CSS의 -webkit-app-region: drag 는 프레임 없는
    // 창 전용이라 제목줄이 있는 이 창에서는 아무 일도 하지 않았다 - 잡아도 안
    // 움직였던 이유다. 화면 좌표(screenX/Y)의 변화량을 그대로 창에 넘긴다.
    setupWindowDrag() {
        const grip = document.getElementById('dragBar');
        if (!grip || !this.isElectron || !window.electronAPI.moveWindowBy) return;

        let last = null;

        const move = (e) => {
            if (!last) return;
            const dx = e.screenX - last.x;
            const dy = e.screenY - last.y;
            if (dx === 0 && dy === 0) return;
            last = { x: e.screenX, y: e.screenY };
            window.electronAPI.moveWindowBy(dx, dy);
        };

        const stop = () => {
            last = null;
            grip.classList.remove('dragging');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', stop);
        };

        grip.addEventListener('mousedown', (e) => {
            // 왼쪽 버튼만. 가운데/오른쪽 버튼으로 창이 끌려다니면 놀란다.
            if (e.button !== 0) return;
            e.preventDefault();
            last = { x: e.screenX, y: e.screenY };
            grip.classList.add('dragging');
            // 손잡이 밖으로 벗어나도 계속 따라오도록 document에 건다
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', stop);
        });
    }

    // 검색창 아래의 빠른 필터. 표 안의 칩과 같은 일을 하지만, 원하는 칩이 걸린
    // 행을 먼저 찾아 헤맬 필요가 없다. 지금 목록에 실제로 있는 상태와 태그만
    // 내보낸다 - 하나도 없는 조건을 눌러 빈 표를 보는 건 의미가 없다.
    // 상태는 많아야 다섯 가지라 전부 내보내고, 태그는 남는 자리를 많이 쓰인
    // 순서로 채운다. 열다섯이면 검색창 폭에서 두 줄쯤이라 표를 크게 밀지 않는다.
    static get QUICK_FILTER_LIMIT() { return 15; }

    static get PAGE_SIZES() { return [10, 20, 50, 100]; }

    quickFilterOptions() {
        const active = this.tasks.filter(task => !task.completed);
        const statuses = new Map();
        const tags = new Map();

        for (const task of active) {
            const status = this.getTaskStatus(task);
            if (!statuses.has(status.text)) {
                statuses.set(status.text, { value: status.text, column: 'status', kind: status.status });
            }
            // 표의 칩과 같은 색을 쓴다. 같은 태그가 표에서는 빨강, 필터에서는
            // 파랑이면 눈으로 잇지 못한다.
            for (const raw of (task.tags || '').split(/\s+/).filter(t => t.startsWith('#'))) {
                const parsed = this.parseTagWithColor(raw);
                const found = tags.get(parsed.content);
                if (found) found.count += 1;
                else tags.set(parsed.content, {
                    value: parsed.content, column: 'tags', kind: 'tag',
                    color: parsed.color, count: 1
                });
            }
        }

        const room = Math.max(0, TaskManager.QUICK_FILTER_LIMIT - statuses.size);
        const ranked = [...tags.values()].sort((a, b) => b.count - a.count);

        return { shown: [...statuses.values(), ...ranked.slice(0, room)], hidden: Math.max(0, ranked.length - room) };
    }

    renderQuickFilters() {
        const bar = document.getElementById('quickFilters');
        if (!bar) return;

        // '전체'는 어떤 필터가 걸렸든 늘 첫 칸에 있어야 빠져나올 길이 보인다
        const cleared = !this.searchQuery
            && !this.quickFilters.status.size && !this.quickFilters.tags.size;
        const chips = [
            `<button type="button" class="quick-chip quick-all${cleared ? ' active' : ''}" data-quick-all>` +
            `${this.getLocalizedText('showAll')}</button>`
        ];

        const { shown, hidden } = this.quickFilterOptions();
        for (const option of shown) {
            const bucket = option.column === 'status' ? this.quickFilters.status : this.quickFilters.tags;
            const active = bucket.has(option.value);
            const style = option.color
                ? ` style="background-color:${option.color.bg};border-color:${option.color.border};color:${option.color.text}"`
                : '';
            const value = this.escapeHtml(option.value);
            chips.push(
                `<button type="button" class="quick-chip quick-${option.kind}${active ? ' active' : ''}"${style} ` +
                `data-quick="${value}" data-quick-column="${option.column}" ` +
                `title="${value}">${value}</button>`
            );
        }

        // 잘라낸 개수는 밝힌다. 조용히 자르면 "이게 전부"로 읽힌다.
        if (hidden > 0) {
            chips.push(`<span class="quick-more" title="${this.getLocalizedText('moreTags')}">+${hidden}</span>`);
        }

        bar.innerHTML = chips.join('');
    }

    // 반복 주기를 사람이 읽는 문장으로. 반복이 아니면 빈 문자열.
    // 예: '매일', '3일마다', '매주 월·수', '매년'
    describeRuleCadence(rule) {
        const baseKeys = {
            daily: 'repeatDaily', weekly: 'repeatWeekly',
            monthly: 'repeatMonthly', yearly: 'repeatYearly'
        };
        const unitKeys = {
            daily: 'repeatUnitDaily', weekly: 'repeatUnitWeekly',
            monthly: 'repeatUnitMonthly', yearly: 'repeatUnitYearly'
        };
        if (!baseKeys[rule.freq]) return '';

        const interval = rule.interval || 1;
        let text = interval === 1
            ? this.getLocalizedText(baseKeys[rule.freq])
            : this.getLocalizedText('repeatIntervalFormat')
                  .replace('{n}', interval)
                  .replace('{unit}', this.getLocalizedText(unitKeys[rule.freq]));

        if (rule.freq === 'weekly' && rule.byWeekday && rule.byWeekday.length) {
            const names = this.getLocalizedText('weekdaysShort').split(',');
            const days = [...rule.byWeekday].sort((a, b) => a - b).map(d => names[d]);
            text += ' ' + days.join('·');
        }
        return text;
    }

    // 태스크 기준. 검색과 표 표시가 같은 문자열을 쓰도록 한 곳에서 만든다.
    describeRepeat(task) {
        if (!task.ruleId) return '';
        const rule = this.rules.find(r => r.id === task.ruleId);
        if (!rule) return '';
        // '반복'을 함께 넣어 두면 검색 한 번으로 반복 작업만 추릴 수 있다
        return `${this.getLocalizedText('repeating')} ${this.describeRuleCadence(rule)}`.trim();
    }

    getTaskStatus(task) {
        const now = new Date();
        const startDate = new Date(task.startDateTime);

        if (task.completed) {
            return { status: 'completed', text: this.getLocalizedText('done') };
        }
        // 마감이 없는 상시 업무. 지연도 임박도 될 수 없으니 따로 표시한다.
        // 매일 반복으로 흉내내면 하지도 않을 날마다 지연으로 쌓인다.
        if (!task.targetDateTime) {
            return now >= startDate
                ? { status: 'standing', text: this.getLocalizedText('standing') }
                : { status: 'pending', text: this.getLocalizedText('pending') };
        }

        const targetDate = new Date(task.targetDateTime);
        // 임박 기준은 알림 시점 중 가장 이른 것. 두 값을 따로 두면 어긋난다.
        const urgentFrom = new Date(targetDate.getTime() - LEAD_MINUTES[0] * 60 * 1000);

        if (now > targetDate) {
            return { status: 'overdue', text: this.getLocalizedText('overdue') };
        } else if (now >= urgentFrom) {
            return { status: 'urgent', text: this.getLocalizedText('urgent') };
        } else if (now >= startDate) {
            return { status: 'inprogress', text: this.getLocalizedText('inprogress') };
        } else {
            return { status: 'pending', text: this.getLocalizedText('pending') };
        }
    }

    renderTasks() {
        if (this.isCollapsed) {
            if (this.viewMode === 'calendar') this.renderCollapsedCalendar();
            else this.renderMiniCollapsedTasks();
        } else if (this.viewMode === 'calendar') {
            this.renderCalendar();
            this.renderQuickFilters();
        } else {
            this.renderExpandedTasks();
            this.renderQuickFilters();
        }

        // Always update completion counter
        this.updateCompletionCounter();
        this.updateCollapsedCompletionCounter();
    }

    // 표와 달력이 같은 목록을 본다. 각자 거르면 검색해 둔 채로 보기를 바꿨을 때
    // 한쪽만 걸러진 결과가 나온다.
    filteredActiveTasks() {
        let active = this.tasks.filter(task => !task.completed);

        const { status, tags } = this.quickFilters;
        if (status.size || tags.size) {
            active = active.filter(task => {
                if (status.size && !status.has(this.getTaskStatus(task).text)) return false;
                if (tags.size && !this.displayTagTexts(task).some(tag => tags.has(tag))) return false;
                return true;
            });
        }

        if (!this.searchQuery) return active;

        return active.filter(task => {
            // 컬럼별 검색 대상. '전체'면 전부 훑는다.
            const fields = {
                content: task.content.toLowerCase(),
                tags: this.searchableTags(task),
                start: this.formatDateTime(task.startDateTime).toLowerCase(),
                target: this.formatDateTime(task.targetDateTime).toLowerCase(),
                status: this.getTaskStatus(task).text.toLowerCase(),
                // 반복은 주기 설명과 '반복' 라벨로 찾을 수 있다
                repeat: this.describeRepeat(task).toLowerCase()
            };

            const searched = this.searchColumn === 'all'
                ? Object.values(fields)
                : [fields[this.searchColumn] || ''];

            return searched.some(value => value !== '' && value.includes(this.searchQuery));
        });
    }

    renderExpandedTasks() {
        const tbody = document.getElementById('tasksBody');
        tbody.innerHTML = '';

        if (this.tasks.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-message">
                        ${this.getLocalizedText('noTasks')}
                    </td>
                </tr>
            `;
            this.renderPagination(0);
            return;
        }

        const activeTasks = this.filteredActiveTasks();

        if (activeTasks.length === 0) {
            // 빠른 필터만 걸려도 "결과 없음"이다. 검색어만 보고 판단하면 필터로
            // 비운 화면에 "모든 작업 완료!"가 떠서 사실이 아닌 말을 한다.
            const filtered = this.searchQuery
                || this.quickFilters.status.size || this.quickFilters.tags.size;
            const message = filtered ? this.getLocalizedText('noSearchResults') : this.getLocalizedText('allCompleted');
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-message">
                        ${message}
                    </td>
                </tr>
            `;
            this.renderPagination(0);
            return;
        }

        // Pagination logic
        const totalPages = Math.ceil(activeTasks.length / this.tasksPerPage);
        
        // Auto-adjust current page if it's beyond available pages
        if (this.currentPage > totalPages && totalPages > 0) {
            this.currentPage = totalPages;
        } else if (this.currentPage < 1) {
            this.currentPage = 1;
        }
        
        const startIndex = (this.currentPage - 1) * this.tasksPerPage;
        const endIndex = startIndex + this.tasksPerPage;
        const tasksToShow = activeTasks.slice(startIndex, endIndex);

        tasksToShow.forEach((task, pageIndex) => {
            // Get actual position in unfiltered active tasks list
            const allActiveTasks = this.tasks.filter(t => !t.completed);
            const actualPosition = allActiveTasks.findIndex(t => t.id === task.id) + 1;
            const taskStatus = this.getTaskStatus(task);
            const rule = task.ruleId ? this.rules.find(r => r.id === task.ruleId) : null;
            const repeatCadence = rule ? this.describeRuleCadence(rule) : '';
            // 알림 버튼이 행에서 빠졌으므로, 꺼져 있다는 사실은 표시로 남겨야 한다.
            // 켜짐이 기본값이라 꺼진 것만 보여주면 화면이 조용하다.
            // 알림은 목표 시각을 기준으로 울리므로 목표 시간 칸에 표시한다.
            // 작업 내용 칸은 white-space: pre-wrap이라 여기 끼워 넣으면
            // 템플릿의 들여쓰기가 그대로 보여 정렬이 무너지기도 했다.
            // 아이콘은 설정 모달의 '알림 끄기'와 같은 것(노란 종 + 빨간 빗금).
            const notificationFlag = task.notificationEnabled === false
                ? `<div class="row-flag" title="${this.getLocalizedText('notificationsOff')}"><svg width="13" height="13" viewBox="0 0 24 24" fill="transparent" stroke="#ffc107" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="m13.73 21a2 2 0 0 1-3.46 0"/><line x1="1" y1="1" x2="23" y2="23" stroke="#dc3545" stroke-width="3"/></svg></div>`
                : '';
            // 주기는 시작 시간 아래 한 번만. 두 시각의 주기가 다를 수 없으므로
            // 양쪽에 쓰면 같은 문장이 한 줄 건너 반복될 뿐이다.
            // 다른 칩과 같은 규칙: 보이는 글자 그대로 걸러진다. '2일마다'를 눌렀는데
            // 반복 전체가 나오면 누른 것과 결과가 어긋난다.
            const cadenceMarkup = repeatCadence ? `
                <div class="repeat-cadence" title="${repeatCadence}">
                    <span class="repeat-badge">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="17,1 21,5 17,9"/><path d="M3,11V9a4,4,0,0,1,4-4H21"/>
                            <polyline points="7,23 3,19 7,15"/><path d="M21,13v2a4,4,0,0,1-4,4H3"/>
                        </svg>
                    </span>${repeatCadence}
                </div>` : '';
            const row = document.createElement('tr');
            
            if (task.highlighted) {
                row.classList.add('highlighted');
            }
            
            // Task content without tag formatting
            const plainContent = task.content;
            
            // Tags from the tags field with color support
            const displayTags = task.tags ? task.tags.split(/\s+/).filter(tag => tag.startsWith('#')).map(tag => {
                const parsed = this.parseTagWithColor(tag);
                return `<span class="tag" title="${parsed.content}" style="background-color: ${parsed.color.bg}; border-color: ${parsed.color.border}; color: ${parsed.color.text}">${parsed.content}</span>`;
            }).join(' ') : '';
            
            row.innerHTML = `
                <td class="select-col"><input type="checkbox" class="task-select" data-task-id="${task.id}"${this.selectedTaskIds.has(task.id) ? ' checked' : ''}></td>
                <td>${actualPosition}</td>
                <td>${this.formatDateTime(task.startDateTime)}${cadenceMarkup}</td>
                <td>${this.formatDateTime(task.targetDateTime)}${notificationFlag}</td>
                <td class="task-tags">${displayTags}</td>
                <td class="task-content">${plainContent}</td>
                <td><span class="status ${taskStatus.status}" title="${taskStatus.text}">${taskStatus.text}</span></td>
            `;
            
            tbody.appendChild(row);
        });

        this.updateSelectionUI();
        this.renderPagination(totalPages);
    }

    renderCollapsedTasks() {
        const collapsedList = document.getElementById('collapsedTasksBody');
        collapsedList.innerHTML = '';

        // Display only active tasks (not completed)
        let activeTasks = this.tasks.filter(task => !task.completed);

        // Apply search filter
        if (this.searchQuery) {
            activeTasks = activeTasks.filter(task => {
                const content = task.content.toLowerCase();
                return content.includes(this.searchQuery);
            });
        }

        if (activeTasks.length === 0) {
            const message = this.searchQuery ? this.getLocalizedText('noSearchResults') : this.getLocalizedText('allCompleted');
            collapsedList.innerHTML = `<li class="empty-message">${message}</li>`;
            this.renderPagination(0);
            return;
        }

        // Pagination logic for collapsed view
        const totalPages = Math.ceil(activeTasks.length / this.tasksPerPage);
        const startIndex = (this.currentPage - 1) * this.tasksPerPage;
        const endIndex = startIndex + this.tasksPerPage;
        const tasksToShow = activeTasks.slice(startIndex, endIndex);

        tasksToShow.forEach((task, pageIndex) => {
            const originalIndex = startIndex + pageIndex;
            const li = document.createElement('li');
            li.setAttribute('data-task-id', task.id);
            li.innerHTML = `${originalIndex + 1}. ${task.content}`;
            
            // Apply highlight style if task is highlighted
            if (task.highlighted) {
                li.classList.add('highlighted');
            }
            
            // Add click handler for collapsed items
            li.addEventListener('click', () => {
                this.editTask(task.id);
            });
            
            collapsedList.appendChild(li);
        });

        this.renderPagination(totalPages);
    }

    renderMiniCollapsedTasks() {
        const collapsedList = document.getElementById('collapsedMiniTasksBody');
        collapsedList.innerHTML = '';

        // Display only active tasks (not completed)
        let activeTasks = this.tasks.filter(task => !task.completed);

        if (activeTasks.length === 0) {
            collapsedList.innerHTML = '<li style="color: #666; font-style: italic; text-align: center;">No tasks</li>';
            return;
        }

        // 창 높이는 활성 작업 전체 기준으로 계산되므로 여기서도 전부 그린다.
        // 예전에는 20개로 잘라서 개수가 많으면 아래쪽이 빈 채로 남았다.
        const tasksToShow = activeTasks;

        tasksToShow.forEach((task, index) => {
            const li = document.createElement('li');
            li.setAttribute('data-task-id', task.id);
            
            // Apply highlight styling if task is highlighted
            if (task.highlighted) {
                if (this.darkMode) {
                    li.style.backgroundColor = '#4a3a2a';
                    li.style.color = '#fd7e14';
                    li.style.border = '2px solid #fd7e14';
                } else {
                    li.style.backgroundColor = '#fff2e6';
                    li.style.color = '#e55100';
                    li.style.border = '2px solid #fd7e14';
                }
                li.style.fontWeight = '600';
                li.style.borderRadius = '3px';
                li.style.padding = '4px 6px';
            }
            
            // 순번을 붙이지 않는다. 폭이 좁아 글자 예산이 빠듯한데 "1. "이 그중
            // 상당 부분을 먹고, 내용이 숫자로 시작하면 "1. 1. ..."처럼 겹쳐 보인다.
            // 자르기는 CSS의 text-overflow에 맡긴다 - 실제 폭에 맞춰 잘리므로
            // 글자 수로 미리 자르는 것보다 정확하다.
            // 순번은 별도 span으로 넣고 색을 달리한다. 예전처럼 내용 문자열
            // 앞에 그냥 붙이면, 내용이 '1.'로 시작할 때 어느 쪽이 순번인지
            // 구분되지 않는다.
            const order = document.createElement('span');
            order.className = 'mini-index';
            order.textContent = index + 1;

            // 여러 줄짜리 메모는 첫 줄만. nowrap이라 줄바꿈이 전부 한 줄로
            // 이어붙어 무슨 작업인지 더 알아보기 어려워진다.
            // 첫 줄이 '1. '처럼 목록 번호로 시작하면 그 번호는 떼어낸다.
            // 바로 앞에 순번이 있어서 '1  1. ...'처럼 숫자가 붙어 보인다.
            const text = document.createElement('span');
            text.className = 'mini-text';
            text.textContent = task.content
                .split('\n')[0]
                .replace(/^\s*\d+\s*[.)]\s*/, '');

            li.append(order, text);
            li.title = task.content;

            // 상태색은 하이라이트가 없을 때만 칠한다. 하이라이트는 사용자가
            // 직접 지정한 것이라 자동 판정인 상태색보다 우선한다.
            // (getTaskStatus는 {status, text} 객체다. 예전에는 이걸 문자열과
            // 비교해서 이 분기가 한 번도 참이 된 적이 없었다.)
            if (!task.highlighted) {
                // 상태 이름을 그대로 클래스로 쓴다. 예전에는 urgent/overdue만
                // 나열해서 '진행중'과 '대기'가 색 없이 남았다.
                li.classList.add(this.getTaskStatus(task).status);
            }

            // 클릭 핸들러는 붙이지 않는다. 150px 창에서 편집 모달이 열리면
            // 제대로 보이지도 않는다. 미니 뷰는 읽기 전용이고, 전체 내용은
            // 마우스를 올리면 툴팁으로 보인다.

            collapsedList.appendChild(li);
        });
    }

    updateCollapsedCompletionCounter() {
        const counterElement = document.getElementById('collapsedCompletionCounter');
        if (counterElement) {
            counterElement.textContent = this.completionCount;
        }
    }

    renderPagination(totalPages) {
        const paginationContainer = document.getElementById('paginationContainer');
        const pageNumbers = document.getElementById('pageNumbers');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        const total = document.getElementById('paginationTotal');
        const pageSize = document.getElementById('pageSizeSelect');

        // 총 개수는 페이지가 하나뿐이어도 보여준다. "몇 건인가"는 페이지를
        // 넘길 일이 있을 때만 궁금한 값이 아니다.
        const count = this.filteredActiveTasks().length;
        if (total) {
            total.textContent = this.getLocalizedText('totalCount').replace('{n}', count);
        }
        if (pageSize) pageSize.value = String(this.tasksPerPage);

        // visibility: hidden 은 자리를 그대로 차지해서, 페이지가 하나일 때 보이지
        // 않는 넘김 버튼이 쪽당 개수를 오른쪽 끝에서 밀어냈다.
        const pager = paginationContainer.querySelector('.pagination');
        if (pager) pager.style.display = totalPages <= 1 ? 'none' : 'flex';

        paginationContainer.style.display = 'flex';
        pageNumbers.innerHTML = '';

        if (totalPages <= 1) return;

        // Previous button
        prevBtn.disabled = this.currentPage === 1;
        prevBtn.onclick = () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderTasks();
            }
        };

        // Next button
        nextBtn.disabled = this.currentPage === totalPages;
        nextBtn.onclick = () => {
            if (this.currentPage < totalPages) {
                this.currentPage++;
                this.renderTasks();
            }
        };

        // Smart pagination display logic
        if (totalPages <= 5) {
            // Show all pages when 5 or fewer pages
            for (let i = 1; i <= totalPages; i++) {
                this.createPageButton(i, pageNumbers);
            }
        } else {
            // Show 1, 2, ..., last-1, last format for 6+ pages
            this.createPageButton(1, pageNumbers);
            this.createPageButton(2, pageNumbers);
            
            if (totalPages > 4) {
                this.createEllipsis(pageNumbers);
            }
            
            if (totalPages > 3) {
                this.createPageButton(totalPages - 1, pageNumbers);
            }
            this.createPageButton(totalPages, pageNumbers);
        }
    }

    createPageButton(pageNum, container) {
        const pageBtn = document.createElement('button');
        pageBtn.className = 'page-number';
        pageBtn.textContent = pageNum;
        if (pageNum === this.currentPage) {
            pageBtn.classList.add('active');
        }
        pageBtn.onclick = () => {
            this.currentPage = pageNum;
            this.renderTasks();
        };
        container.appendChild(pageBtn);
    }

    createEllipsis(container) {
        const ellipsis = document.createElement('button');
        ellipsis.className = 'page-number ellipsis';
        ellipsis.textContent = '...';
        ellipsis.disabled = true;
        container.appendChild(ellipsis);
    }

    toggleCollapse() {
        this.isCollapsed = !this.isCollapsed;
        const container = document.querySelector('.container');
        const collapseBtn = document.getElementById('collapseBtn');
        const tableElement = document.getElementById('tasksTable');
        const collapsedElement = document.getElementById('collapsedTaskList');
        const miniLayout = document.getElementById('collapsedMiniLayout');

        // 문서 레벨 스크롤바는 컨테이너 CSS로는 못 막는다. body에도 표시를 남긴다.
        document.body.classList.toggle('collapsed-mode-body', this.isCollapsed);

        if (this.isCollapsed) {
            // Enter collapsed mode - narrow side strip
            container.classList.add('collapsed-mode');
            collapseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
            collapseBtn.title = this.getLocalizedText('expandToFullView');
            tableElement.style.display = 'none';
            collapsedElement.style.display = 'none';
            miniLayout.style.display = 'flex';
        } else {
            // Exit collapsed mode - return to normal view
            container.classList.remove('collapsed-mode');
            collapseBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="14,4 14,10 20,10"/><polyline points="10,20 10,14 4,14"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
            collapseBtn.title = this.getLocalizedText('collapseView');
            tableElement.style.display = 'table';
            collapsedElement.style.display = 'none';
            miniLayout.style.display = 'none';
            
            // Resize window back to normal if in Electron mode
            if (this.isElectron && window.electronAPI) {
                this.resizeAndPositionWindow(900, 500, 'center');
            }
        }

        this.applyViewMode();
        this.renderTasks();
        // 높이는 그려진 뒤에 잰다. 그리기 전에 재면 이전 내용의 높이가 나온다.
        if (this.isCollapsed) this.resizeCollapsedWindow();
    }

    // 접힘 창 높이는 실제로 그려질 줄 수를 따라간다. 달력 보기는 오늘 하루만
    // 세우므로, 활성 작업 전체로 계산하면 빈 칸이 길게 남는다.
    collapsedRowCount() {
        const active = this.tasks.filter(t => !t.completed);
        if (this.viewMode !== 'calendar') return active.length;

        // 미니 격자(달 이름 + 요일 + 여섯 줄 + 날짜 머리)가 대략 여섯 줄어치를
        // 차지한다. 그 아래에 그날의 작업들이 붙는다. 비었을 때도 안내 문구가
        // 두 줄까지 접히므로 최소 두 줄은 잡는다.
        return Math.max(2, this.collapsedCalendarDay().tasks.length) + 7;
    }

    resizeCollapsedWindow() {
        if (!this.isElectron || !window.electronAPI) return;

        // 그려진 것을 그대로 잰다. 줄 수를 세어 추정하던 방식은 내용이 바뀔
        // 때마다 계수를 다시 맞춰야 했고, 달력 격자가 들어오자 곧바로 어긋나
        // 목록이 창 밖으로 밀렸다. (jsdom에는 레이아웃이 없어 0이 나오므로
        // 그때만 줄 수 추정으로 되돌아간다.)
        const layout = document.getElementById('collapsedMiniLayout');
        const measured = layout ? layout.scrollHeight : 0;
        const estimated = 80 + this.collapsedRowCount() * 22;
        const height = Math.max(150, (measured || estimated) + 30);

        this.resizeAndPositionWindow(COLLAPSED_WIDTH, height, 'top-right-150');
    }

    resizeWindow(width, height) {
        // This would need to be implemented in main.js as an IPC handler
        if (this.isElectron && window.electronAPI && window.electronAPI.resizeWindow) {
            window.electronAPI.resizeWindow(width, height);
        }
    }

    resizeAndPositionWindow(width, height, position) {
        if (this.isElectron && window.electronAPI && window.electronAPI.resizeAndPositionWindow) {
            window.electronAPI.resizeAndPositionWindow(width, height, position);
        }
    }

    extractTags(content) {
        const tagRegex = /#[\w가-힣]+/g;
        return content.match(tagRegex) || [];
    }

    formatContentWithTags(content) {
        return content.replace(/#([\w가-힣]+)/g, '<span class="tag">#$1</span>');
    }


    // 스로틀은 걸지 않는다. 행마다 있던 버튼이 사라져 중복 이벤트가 날 곳이
    // 없어졌고, 남은 것은 막대 버튼 한 번에 한 번뿐이다. 반면 켰다 바로 끄는
    // 연타는 정상적인 조작이라 스로틀이 있으면 그쪽만 조용히 삼켜진다.
    async toggleHighlight(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            const wasHighlighted = task.highlighted;
            task.highlighted = !task.highlighted;
            
            // 즉시 UI 업데이트 (사용자 반응성 개선)
            this.renderTasks();
            
            // 비동기 작업들은 백그라운드에서 처리
            const action = task.highlighted ? 'HIGHLIGHT' : 'UNHIGHLIGHT';
            this.persistInBackground(action, task);
        }
    }

    // 스로틀링 헬퍼 메서드 (너무 빠른 연속 클릭 방지)
    isActionThrottled(actionKey, throttleMs = 100) {
        const now = Date.now();
        const lastAction = this.actionThrottleMap.get(actionKey);
        
        if (lastAction && (now - lastAction) < throttleMs) {
            return true; // 스로틀 중
        }
        
        this.actionThrottleMap.set(actionKey, now);
        return false; // 실행 허용
    }

    async moveTask(taskId, direction) {
        // 스로틀링 체크: 키에 direction을 넣으면 위/아래 연속 발생이 서로 다른
        // 키가 되어 스로틀을 그대로 통과한다. 또 200ms는 "위로 세 칸" 같은
        // 의도적인 연타까지 삼켜버린다. 중복 이벤트만 막을 만큼만 짧게 잡는다.
        if (this.isActionThrottled(`move_${taskId}`, 50)) return;
        
        const taskIndex = this.tasks.findIndex(t => t.id === taskId && !t.completed);
        if (taskIndex === -1) return;

        const activeTasks = this.tasks.filter(t => !t.completed);
        const activeIndex = activeTasks.findIndex(t => t.id === taskId);
        const currentTask = this.tasks[taskIndex];
        
        let moved = false;
        let action = '';
        
        if (direction === 'up' && activeIndex > 0) {
            const targetIndex = this.tasks.findIndex(t => t.id === activeTasks[activeIndex - 1].id);
            
            this.tasks.splice(taskIndex, 1);
            this.tasks.splice(targetIndex, 0, currentTask);
            moved = true;
            action = 'MOVE_UP';
        } else if (direction === 'down' && activeIndex < activeTasks.length - 1) {
            const targetIndex = this.tasks.findIndex(t => t.id === activeTasks[activeIndex + 1].id);
            
            this.tasks.splice(taskIndex, 1);
            this.tasks.splice(targetIndex, 0, currentTask);
            moved = true;
            action = 'MOVE_DOWN';
        }

        if (moved) {
            // 즉시 UI 업데이트 (사용자 반응성 개선)
            this.renderTasks();
            
            // 비동기 작업들은 백그라운드에서 처리
            this.persistInBackground(action, currentTask);
        }
    }

    // 반복 컨트롤의 라벨/요일 버튼을 현재 언어로 그린다
    renderRepeatControls() {
        const label = document.getElementById('labelRepeat');
        const select = document.getElementById('taskRepeat');
        const weekdays = document.getElementById('repeatWeekdays');
        const help = document.getElementById('repeatHelpText');
        if (!label || !select || !weekdays || !help) return;

        label.textContent = this.getLocalizedText('repeat');
        help.textContent = this.getLocalizedText('repeatHelp');

        const optionKeys = { none: 'repeatNone', daily: 'repeatDaily', weekly: 'repeatWeekly', monthly: 'repeatMonthly', yearly: 'repeatYearly' };
        for (const option of select.options) {
            option.textContent = this.getLocalizedText(optionKeys[option.value]);
        }

        // 요일 버튼은 언어가 바뀔 때마다 다시 그리되 선택 상태는 유지한다
        const selected = new Set(
            Array.from(weekdays.querySelectorAll('.weekday-btn.selected')).map(btn => Number(btn.dataset.weekday))
        );
        weekdays.innerHTML = '';
        this.getLocalizedText('weekdaysShort').split(',').forEach((name, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = selected.has(index) ? 'weekday-btn selected' : 'weekday-btn';
            button.dataset.weekday = index;
            button.textContent = name;
            button.addEventListener('click', () => button.classList.toggle('selected'));
            weekdays.appendChild(button);
        });

        this.updateRepeatVisibility();
    }

    // 선택한 주기에 따라 간격/요일 입력을 보여준다
    updateRepeatVisibility() {
        const freq = document.getElementById('taskRepeat').value;
        const unitKeys = { daily: 'repeatUnitDaily', weekly: 'repeatUnitWeekly', monthly: 'repeatUnitMonthly', yearly: 'repeatUnitYearly' };

        document.getElementById('repeatIntervalWrap').style.display = freq === 'none' ? 'none' : 'inline-flex';
        document.getElementById('repeatWeekdays').style.display = freq === 'weekly' ? 'flex' : 'none';
        document.getElementById('repeatHelpText').style.display = freq === 'none' ? 'none' : 'block';

        if (freq !== 'none') {
            document.getElementById('labelRepeatUnit').textContent = this.getLocalizedText(unitKeys[freq]);
        }
    }

    // 편집 시 해당 태스크가 속한 규칙을 폼에 채운다
    populateRepeatControls(task) {
        this.resetRepeatControls();

        const rule = task && task.ruleId ? this.rules.find(r => r.id === task.ruleId) : null;
        if (!rule) return;

        document.getElementById('taskRepeat').value = rule.freq;
        document.getElementById('taskRepeatInterval').value = String(rule.interval || 1);
        (rule.byWeekday || []).forEach(day => {
            const button = document.querySelector(`#repeatWeekdays .weekday-btn[data-weekday="${day}"]`);
            if (button) button.classList.add('selected');
        });

        this.updateRepeatVisibility();
    }

    // 편집 저장 시 규칙을 만들거나/갱신하거나/해제한다.
    // taskData를 제자리에서 수정하고, 규칙 목록도 함께 갱신한다.
    async applyRepeatChange(taskData, previousTask) {
        const freq = document.getElementById('taskRepeat').value;
        const previousRuleId = previousTask && previousTask.ruleId;

        if (freq === 'none') {
            if (!previousRuleId) return;
            // 반복 해제: 규칙을 지운다. 이 행은 평범한 일회성 작업으로 남는다.
            this.rules = this.rules.filter(r => r.id !== previousRuleId);
            delete taskData.ruleId;
            await this.saveRules();
            return;
        }

        const rule = this.buildRuleFromForm(taskData);
        const existingIndex = previousRuleId
            ? this.rules.findIndex(r => r.id === previousRuleId)
            : -1;

        if (existingIndex !== -1) {
            // 기존 규칙 갱신. id는 유지해야 이 행과의 연결이 끊기지 않는다.
            const previousRule = this.rules[existingIndex];
            this.rules[existingIndex] = { ...rule, id: previousRule.id };
            taskData.ruleId = previousRule.id;
        } else {
            this.rules.push(rule);
            taskData.ruleId = rule.id;
        }

        await this.saveRules();
    }

    resetRepeatControls() {
        document.getElementById('taskRepeat').value = 'none';
        document.getElementById('taskRepeatInterval').value = '1';
        document.querySelectorAll('#repeatWeekdays .weekday-btn').forEach(btn => btn.classList.remove('selected'));
        this.updateRepeatVisibility();
    }

    // 폼에서 반복 규칙을 만든다. 반복이 아니면 null.
    buildRuleFromForm(task) {
        const freq = document.getElementById('taskRepeat').value;
        // 마감이 없으면 다음 회차로 넘길 기준이 없다
        if (freq === 'none' || !task.targetDateTime) return null;

        const [anchorDate, startTimeOfDay] = task.startDateTime.split(' ');
        const targetTimeOfDay = task.targetDateTime.split(' ')[1];
        const byWeekday = Array.from(document.querySelectorAll('#repeatWeekdays .weekday-btn.selected'))
            .map(btn => Number(btn.dataset.weekday));

        return {
            id: 'rule-' + this.generateId(),
            content: task.content,
            tags: task.tags,
            freq,
            interval: Math.max(1, parseInt(document.getElementById('taskRepeatInterval').value) || 1),
            byWeekday: freq === 'weekly' ? byWeekday : [],
            anchorDate,
            startTimeOfDay,
            targetTimeOfDay,
            enabled: true
        };
    }

    showModal(task = null) {
        const modal = document.getElementById('taskModal');
        const modalTitle = document.getElementById('modalTitle');
        const form = document.getElementById('taskForm');
        const positionInput = document.getElementById('taskPosition');
        
        if (task) {
            // Edit mode
            modalTitle.textContent = this.getLocalizedText('editTask');
            // Convert to text format (YYYY-MM-DD HH:MM)
            const startDate = new Date(task.startDateTime);
            const targetDate = new Date(task.targetDateTime);
            
            document.getElementById('startDateTime').value = this.formatDateTimeLocal(startDate);
            document.getElementById('targetDateTime').value = this.formatDateTimeLocal(targetDate);
            document.getElementById('taskContent').value = task.content;
            document.getElementById('taskTags').value = task.tags || '';
            
            // Set current position for editing
            const currentIndex = this.tasks.filter(t => !t.completed).findIndex(t => t.id === task.id);
            positionInput.value = currentIndex + 1;
            positionInput.max = this.tasks.filter(t => !t.completed).length;
            
            this.editingTaskId = task.id;

            // 편집에서도 반복 설정을 그대로 보여주고 고칠 수 있게 한다
            document.getElementById('repeatGroup').style.display = '';
            this.populateRepeatControls(task);
        } else {
            // Add mode
            modalTitle.textContent = this.getLocalizedText('addNewTask');
            form.reset();
            document.getElementById('repeatGroup').style.display = '';
            this.resetRepeatControls();
            
            // Set current time as default
            const now = new Date();
            document.getElementById('startDateTime').value = this.formatDateTimeLocal(now);
            
            // Set target time to 1 hour later with minutes set to 00
            const targetTime = new Date(now.getTime() + 60 * 60 * 1000);
            targetTime.setMinutes(0, 0, 0); // 분, 초, 밀리초를 0으로 설정
            document.getElementById('targetDateTime').value = this.formatDateTimeLocal(targetTime);
            
            // Set position to end of list by default
            const activeTasksCount = this.tasks.filter(t => !t.completed).length;
            positionInput.value = activeTasksCount + 1;
            positionInput.max = activeTasksCount + 1;
            
            this.editingTaskId = null;
        }
        
        // Render tag presets in modal
        this.renderTagPresets();
        
        // Show/hide tags help text based on preset availability
        this.updateTagsHelpText();
        
        modal.style.display = 'block';
        
        // 첫 번째 입력 필드에 포커스
        setTimeout(() => {
            document.getElementById('taskPosition').focus();
        }, 50);
    }

    hideModal() {
        const modal = document.getElementById('taskModal');
        modal.style.display = 'none';
        this.editingTaskId = null;
    }

    showSettingsModal() {
        const modal = document.getElementById('settingsModal');
        
        // Render tag presets list
        this.renderTagPresetsList();
        
        modal.style.display = 'block';
    }

    hideSettingsModal() {
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'none';
    }

    async showAboutModal() {
        const modal = document.getElementById('aboutModal');
        const openFolderBtn = document.getElementById('openLogFolderBtn');
        
        // Show folder button only in Electron mode
        if (this.isElectron) {
            openFolderBtn.style.display = 'inline-flex';
        } else {
            openFolderBtn.style.display = 'none';
        }
        
        modal.style.display = 'block';
    }

    hideAboutModal() {
        const modal = document.getElementById('aboutModal');
        modal.style.display = 'none';
    }

    async showStatisticsModal() {
        const modal = document.getElementById('statisticsModal');
        
        // Update statistics modal title
        const statisticsTitle = modal.querySelector('h2');
        if (statisticsTitle) {
            statisticsTitle.textContent = this.getLocalizedText('statisticsTitle');
        }
        
        modal.style.display = 'block';
        
        // Load statistics data and render chart
        await this.renderStatisticsChart();
    }

    hideStatisticsModal() {
        const modal = document.getElementById('statisticsModal');
        modal.style.display = 'none';
    }

    async renderStatisticsChart() {
        const canvas = document.getElementById('chartCanvas');
        const ctx = canvas.getContext('2d');
        
        try {
            // Get 30 days of log data
            const statisticsData = await this.getStatisticsData();
            
            // Clear canvas
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // Chart dimensions
            const padding = 40;
            const chartWidth = canvas.width - 2 * padding;
            const chartHeight = canvas.height - 2 * padding;
            
            // Find max value for scaling
            const maxValue = Math.max(...statisticsData.map(d => d.completed), 1);
            
            // Bar width
            const barWidth = chartWidth / statisticsData.length;

            // 차트는 canvas라 CSS가 닿지 않는다. 다크모드에서 어두운 회색 글씨를
            // 그리면 배경에 묻혀 안 보이므로 색을 직접 골라야 한다.
            // 폰트도 Arial 고정이면 한글이 대체 폰트로 나온다.
            const palette = this.darkMode
                ? { bar: '#4d9fff', value: '#f0f0f0', label: '#b0b0b0', axis: '#555', grid: '#3a3a3a' }
                : { bar: '#007bff', value: '#333', label: '#666', axis: '#ccc', grid: '#f0f0f0' };
            const font = (size) => `${size}px ${getComputedStyle(document.body).fontFamily}`;
            
            // Draw bars
            statisticsData.forEach((data, index) => {
                const barHeight = (data.completed / maxValue) * chartHeight;
                const x = padding + index * barWidth;
                const y = canvas.height - padding - barHeight;
                
                // Draw bar
                ctx.fillStyle = palette.bar;
                ctx.fillRect(x + 2, y, barWidth - 4, barHeight);
                
                // Draw value on top of bar if > 0
                if (data.completed > 0) {
                    ctx.fillStyle = palette.value;
                    ctx.font = font(12);
                    ctx.textAlign = 'center';
                    ctx.fillText(data.completed.toString(), x + barWidth/2, y - 5);
                }
                
                // Draw date label (show every 5th day)
                if (index % 5 === 0 || index === statisticsData.length - 1) {
                    ctx.fillStyle = palette.label;
                    ctx.font = font(10);
                    ctx.textAlign = 'center';
                    ctx.save();
                    ctx.translate(x + barWidth/2, canvas.height - 10);
                    ctx.rotate(-Math.PI/4);
                    ctx.fillText(data.date, 0, 0);
                    ctx.restore();
                }
            });
            
            // Draw axes
            ctx.strokeStyle = palette.axis;
            ctx.lineWidth = 1;
            
            // Y-axis
            ctx.beginPath();
            ctx.moveTo(padding, padding);
            ctx.lineTo(padding, canvas.height - padding);
            ctx.stroke();
            
            // X-axis
            ctx.beginPath();
            ctx.moveTo(padding, canvas.height - padding);
            ctx.lineTo(canvas.width - padding, canvas.height - padding);
            ctx.stroke();
            
            // Y-axis labels
            const steps = 5;
            for (let i = 0; i <= steps; i++) {
                const value = Math.round((maxValue / steps) * i);
                const y = canvas.height - padding - (i / steps) * chartHeight;
                
                ctx.fillStyle = palette.label;
                ctx.font = font(12);
                ctx.textAlign = 'right';
                ctx.fillText(value.toString(), padding - 10, y + 4);
                
                // Grid lines
                if (i > 0) {
                    ctx.strokeStyle = palette.grid;
                    ctx.beginPath();
                    ctx.moveTo(padding, y);
                    ctx.lineTo(canvas.width - padding, y);
                    ctx.stroke();
                }
            }
            
        } catch (error) {
            console.error('Failed to render statistics chart:', error);
            
            // Show error message on canvas
            ctx.fillStyle = this.darkMode ? '#b0b0b0' : '#666';
            ctx.font = `16px ${getComputedStyle(document.body).fontFamily}`;
            ctx.textAlign = 'center';
            ctx.fillText('Failed to load statistics data', canvas.width/2, canvas.height/2);
        }
    }

    async getStatisticsData() {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29); // 30 days including today
        
        const statisticsData = [];
        
        // Generate data for each of the last 30 days
        for (let i = 0; i < 30; i++) {
            const currentDate = new Date(thirtyDaysAgo);
            currentDate.setDate(thirtyDaysAgo.getDate() + i);
            
            // Use local timezone for consistency with log files
            const year = currentDate.getFullYear();
            const month = String(currentDate.getMonth() + 1).padStart(2, '0');
            const day = String(currentDate.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`; // YYYY-MM-DD (local timezone)
            const displayDate = `${currentDate.getMonth() + 1}/${currentDate.getDate()}`;
            
            let completedCount = 0;
            
            if (this.isElectron) {
                // Read from log file for this date
                try {
                    completedCount = await window.electronAPI.getCompletedTasksCount(dateStr);
                } catch (error) {
                    console.error(`Failed to get completed tasks for ${dateStr}:`, error);
                    completedCount = 0;
                }
            } else {
                // For browser mode, we can only show current day from localStorage
                // Check if this is today using local timezone
                const today = new Date();
                const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                if (dateStr === todayStr) {
                    completedCount = this.completionCount;
                }
            }
            
            statisticsData.push({
                date: displayDate,
                completed: completedCount
            });
        }
        
        return statisticsData;
    }

    // 완료와 삭제는 되돌릴 수 없어서 한 번 묻는다. 선택한 것 전체에 한 번만
    // 물어보므로 taskIds는 배열이다. 행마다 묻던 시절의 단일 id를 그대로 두면
    // 열 개를 지울 때 모달이 열 번 뜬다.
    showConfirmModal(action, taskIds) {
        const modal = document.getElementById('confirmModal');
        const title = document.getElementById('confirmModalTitle');
        const label = document.getElementById('confirmDetailsLabel');
        const actionBtn = document.getElementById('confirmActionBtn');
        const detailsTextarea = document.getElementById('confirmDetails');
        const completedGroup = document.getElementById('confirmCompletedAtGroup');
        const completedInput = document.getElementById('confirmCompletedAt');

        this.pendingConfirmAction = action;
        this.pendingConfirmTaskIds = [...taskIds];

        const count = this.pendingConfirmTaskIds.length;
        const suffix = count > 1 ? ` (${this.getLocalizedText('selectedCount').replace('{n}', count)})` : '';

        if (action === 'complete') {
            title.textContent = this.getLocalizedText('completeTask') + suffix;
            label.textContent = this.getLocalizedText('completeDetails');
            actionBtn.textContent = this.getLocalizedText('confirmComplete');
            actionBtn.className = 'btn complete-btn';
        } else if (action === 'delete') {
            title.textContent = this.getLocalizedText('deleteTask') + suffix;
            label.textContent = this.getLocalizedText('deleteReason');
            actionBtn.textContent = this.getLocalizedText('confirmDelete');
            actionBtn.className = 'btn delete-btn';
        }

        // 완료 시각은 지금으로 채워두되 고칠 수 있게 둔다. 어제 끝낸 일을
        // 오늘 체크하는 일이 흔하고, 그때 기록이 오늘로 남으면 이력이 어긋난다.
        completedGroup.style.display = action === 'complete' ? '' : 'none';
        if (action === 'complete') {
            document.getElementById('confirmCompletedAtLabel').textContent =
                this.getLocalizedText('completedAt');
            completedInput.value = this.formatDateTimeLocal(new Date());
        }

        detailsTextarea.value = '';
        modal.style.display = 'block';

        // Focus on textarea
        setTimeout(() => {
            detailsTextarea.focus();
        }, 50);
    }

    hideConfirmModal() {
        const modal = document.getElementById('confirmModal');
        modal.style.display = 'none';
        this.pendingConfirmAction = null;
        this.pendingConfirmTaskIds = [];
    }

    async handleConfirmAction() {
        const details = document.getElementById('confirmDetails').value.trim();
        const ids = this.pendingConfirmTaskIds || [];

        if (this.pendingConfirmAction === 'complete') {
            const typed = document.getElementById('confirmCompletedAt').value.trim();
            const completedAt = typed ? this.parseInputDateTime(typed) : null;
            if (typed && !completedAt) {
                alert(`${this.getLocalizedText('invalidDateFormat')}\n${this.dateFormat}`);
                return;
            }
            for (const id of ids) await this.doCompleteTask(id, details, completedAt);
        } else if (this.pendingConfirmAction === 'delete') {
            for (const id of ids) await this.doDeleteTask(id, details);
        }

        this.hideConfirmModal();
        this.clearSelection();
        this.renderTasks();
    }

    async saveTask() {
        const startDateTime = document.getElementById('startDateTime').value;
        const targetDateTime = document.getElementById('targetDateTime').value;
        const content = document.getElementById('taskContent').value.trim();
        const tags = document.getElementById('taskTags').value.trim();
        const position = parseInt(document.getElementById('taskPosition').value);

        // 목표 시각은 선택 항목이다. 비우면 마감 없는 상시 업무가 된다.
        if (!startDateTime || !content) {
            alert(this.getLocalizedText('fillAllFields'));
            return;
        }

        // 입력은 설정한 표시 형식으로 들어온다. 저장 형식으로 바꿔서 보관한다.
        const storedStart = this.parseInputDateTime(startDateTime);
        // 목표 시각을 비우면 마감 없는 상시 업무가 된다
        const storedTarget = targetDateTime ? this.parseInputDateTime(targetDateTime) : '';

        if (!storedStart || (targetDateTime && !storedTarget)) {
            alert(`${this.getLocalizedText('invalidDateFormat')}\n${this.dateFormat}`);
            return;
        }

        if (storedTarget && new Date(storedStart) >= new Date(storedTarget)) {
            alert(this.getLocalizedText('targetAfterStart'));
            return;
        }

        // Validate position
        const activeTasks = this.tasks.filter(t => !t.completed);
        const maxPosition = this.editingTaskId ? activeTasks.length : activeTasks.length + 1;
        
        if (position < 1 || position > maxPosition || isNaN(position)) {
            alert(`Position must be between 1 and ${maxPosition}`);
            return;
        }

        const taskData = {
            id: this.editingTaskId || this.generateId(),
            startDateTime: storedStart,
            targetDateTime: storedTarget,
            content,
            tags,
            completed: false,
            highlighted: false,
            notificationEnabled: this.editingTaskId ? 
                this.tasks.find(t => t.id === this.editingTaskId).notificationEnabled : 
                this.defaultNotificationEnabled,
            createdAt: this.editingTaskId ? 
                this.tasks.find(t => t.id === this.editingTaskId).createdAt : 
                new Date().toISOString()
        };

        if (this.editingTaskId) {
            // Edit mode - update existing task and reposition
            const taskIndex = this.tasks.findIndex(t => t.id === this.editingTaskId);
            if (taskIndex !== -1) {
                const oldTask = { ...this.tasks[taskIndex] };

                // 반복 설정 변경(신규/수정/해제)을 taskData와 규칙에 반영한다
                await this.applyRepeatChange(taskData, oldTask);

                this.tasks[taskIndex] = taskData;

                // Reposition task if needed
                this.repositionTask(this.editingTaskId, position);
                
                // Log with actual task content
                await this.addLog('EDIT', taskData, taskData.content);
            }

            // 편집은 선택을 푼다. 저장하면 상태나 날짜가 바뀌어 걸어둔 검색에서
            // 빠지는 일이 흔한데, 그러면 보이지도 않는 행이 선택된 채로 남아
            // 다음 일괄 작업에 딸려간다. 반대로 강조·알림 토글은 되돌리려면 한 번
            // 더 눌러야 하므로 선택을 유지한다.
            this.clearSelection();
        } else {
            // Add mode - insert at specified position
            const completedTasks = this.tasks.filter(t => t.completed);
            const activeTasks = this.tasks.filter(t => !t.completed);

            // 반복이 선택됐으면 규칙을 만들고 이 행에 묶는다. 이 행이 곧 규칙이 된다.
            const rule = this.buildRuleFromForm(taskData);
            if (rule) {
                taskData.ruleId = rule.id;
                this.rules.push(rule);
                await this.saveRules();
            }

            // Insert at the specified position (1-based)
            activeTasks.splice(position - 1, 0, taskData);

            // Rebuild tasks array with completed tasks at the end
            this.tasks = [...activeTasks, ...completedTasks];

            await this.addLog('ADD', taskData, taskData.content);
        }

        // Reset current page if we're beyond available pages
        const currentActiveTasks = this.tasks.filter(t => !t.completed);
        const totalPages = Math.ceil(currentActiveTasks.length / this.tasksPerPage);
        if (this.currentPage > totalPages && totalPages > 0) {
            this.currentPage = totalPages;
        }

        await this.saveTasks();
        this.renderTasks();
        this.hideModal();
    }

    editTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            this.showModal(task);
        }
    }

    async completeTask(taskId) {
        this.showConfirmModal('complete', [taskId]);
    }

    // completedAt은 저장 형식('YYYY-MM-DD HH:mm')이거나 null(=지금)이다
    async doCompleteTask(taskId, details, completedAt) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.tasks[taskIndex];

            // 사용자가 고른 완료 시각은 로그 본문에 남긴다. TIMESTAMP는 어디까지나
            // "이 조작을 언제 했는가"라서, 소급해 체크한 시각으로 덮으면 안 된다.
            const parts = [`${task.content} (completed)`];
            if (completedAt) parts.push(`at ${completedAt}`);
            if (details) parts.push(details);
            const logDetails = parts.join(' ');
            // 로그는 완료 상태로 남긴다. 반복이면 태스크 자체는 다음 회차로
            // 넘어가지만, 이번 회차를 해냈다는 기록은 그대로 있어야 한다.
            await this.addLog('COMPLETE', { ...task, completed: true }, logDetails);

            // 반복 작업은 사라지지 않고 다음 회차로 이동한다. 그 행이 곧 규칙이라
            // 없애버리면 반복을 다시 볼 방법이 없어진다.
            // 일회성 작업은 목록에서 뺀다. completed: true로 표시만 해두던 시절에는
            // 아무도 읽지 않는 행이 tasks.json과 백업에 영원히 쌓였다.
            if (!this.advanceRecurringTask(task)) {
                this.tasks.splice(taskIndex, 1);
            }

            await this.saveTasks();
            this.renderTasks();
            
            // Update completion counter with animation and confetti
            await this.incrementCompletionCounter();
            this.showConfetti();
        }
    }

    async deleteTask(taskId) {
        this.showConfirmModal('delete', [taskId]);
    }

    async doDeleteTask(taskId, details) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.tasks[taskIndex];
            this.tasks.splice(taskIndex, 1);

            // 반복 작업의 행은 곧 규칙이다. 행만 지우고 규칙을 남기면 손댈 수
            // 없는 규칙이 되어 다음 실행 때 행이 되살아난다.
            if (task.ruleId) {
                this.rules = this.rules.filter(r => r.id !== task.ruleId);
                await this.saveRules();
            }

            const logDetails = details ? `${task.content} (deleted) ${details}` : `${task.content} (deleted)`;
            await this.addLog('DELETE', task, logDetails);
            await this.saveTasks();
            this.renderTasks();
        }
    }

    // Export functionality
    // 백업에 함께 담을 화면 설정과 태그 프리셋. localStorage에만 사는 값들이라
    // 여기서 모아주지 않으면 백업에 절대 포함되지 않는다.
    collectPreferences() {
        return {
            tagPresets: this.tagPresets || [],
            dateFormat: this.dateFormat,
            selectedLanguage: localStorage.getItem('selectedLanguage'),
            darkMode: this.darkMode,
            defaultNotificationEnabled: this.defaultNotificationEnabled,
            unfocusedOpacity: this.unfocusedOpacity
        };
    }

    // 백업의 설정을 적용한다. 없는 항목은 건드리지 않는다.
    applyPreferences(preferences) {
        if (!preferences || typeof preferences !== 'object') return;

        if (Array.isArray(preferences.tagPresets)) {
            this.tagPresets = preferences.tagPresets;
            this.saveTagPresets();
        }
        if (DATE_FORMATS.includes(preferences.dateFormat)) {
            this.dateFormat = preferences.dateFormat;
            localStorage.setItem('dateFormat', preferences.dateFormat);
        }
        if (preferences.selectedLanguage) {
            this.locale = preferences.selectedLanguage;
            localStorage.setItem('selectedLanguage', preferences.selectedLanguage);
        }
        if (typeof preferences.darkMode === 'boolean') {
            this.darkMode = preferences.darkMode;
            localStorage.setItem('darkMode', String(preferences.darkMode));
            this.applyTheme();
        }
        if (typeof preferences.defaultNotificationEnabled === 'boolean') {
            this.defaultNotificationEnabled = preferences.defaultNotificationEnabled;
            localStorage.setItem(
                'defaultNotificationEnabled',
                String(preferences.defaultNotificationEnabled)
            );
        }
        if (preferences.unfocusedOpacity >= 0.3 && preferences.unfocusedOpacity <= 1) {
            this.changeUnfocusedOpacity(preferences.unfocusedOpacity);
        }

        this.updateUIText();
    }

    downloadFile(text, filename, mime) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(new Blob([text], { type: mime }));
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    // 날짜별 로그 파일을 한 장으로 합친다. 헤더는 한 번만 두고 날짜순으로 잇는다.
    buildHistoryTsv(logFiles) {
        if (!logFiles || Object.keys(logFiles).length === 0) return '';

        const rows = [];
        for (const name of Object.keys(logFiles).sort()) {
            for (const line of String(logFiles[name]).split('\n')) {
                // 파일마다 들어 있는 헤더와 빈 줄은 버린다
                if (!line.trim() || line.startsWith('TIMESTAMP')) continue;
                rows.push(line);
            }
        }
        return rows.length ? `${LOG_HEADER}\n${rows.join('\n')}\n` : '';
    }

    // 합쳐진 TSV를 날짜별 로그 파일로 되돌린다. TIMESTAMP 앞 10자가 날짜다.
    parseHistoryTsv(text) {
        const files = {};

        for (const line of String(text).split('\n')) {
            if (!line.trim() || line.startsWith('TIMESTAMP')) continue;
            const date = line.slice(0, 10);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
            const key = `${date}.tsv`;
            (files[key] = files[key] || []).push(line);
        }

        const out = {};
        for (const [name, rows] of Object.entries(files)) {
            out[name] = `${LOG_HEADER}\n${rows.join('\n')}\n`;
        }
        return out;
    }

    async exportData() {
        try {
            let data;
            
            if (this.isElectron) {
                // Electron mode: get data from IPC
                data = await window.electronAPI.exportData();
                if (!data) {
                    alert('Failed to export data.');
                    return;
                }
            } else {
                // Browser mode: use local data
                data = {
                    tasks: this.tasks,
                    rules: this.rules,
                    logs: this.logs,
                    exportDate: new Date().toISOString(),
                    version: '1.3'
                };
            }

            // 태그 프리셋과 화면 설정은 localStorage에만 있어서 백업에서 빠져
            // 있었다. 새 PC에서 복원하면 태그 색과 표시 설정을 처음부터 다시
            // 만들어야 했다.
            data.preferences = this.collectPreferences();

            const stamp = formatWithPattern(new Date(), 'YYYY-MM-DD');
            this.downloadFile(
                JSON.stringify(data, null, 2),
                `tasktory-backup-${stamp}.json`,
                'application/json'
            );

            // 이력은 TSV로만 내보낸다. 백업 JSON에는 넣지 않으므로 파일에서
            // 직접 읽어 온다.
            const logFiles = this.isElectron && window.electronAPI.readLogFiles
                ? await window.electronAPI.readLogFiles()
                : data.logFiles;
            const history = this.buildHistoryTsv(logFiles);
            if (history) {
                this.downloadFile(history, `tasktory-history-${stamp}.tsv`, 'text/tab-separated-values');
            }
        } catch (error) {
            console.error('Export error:', error);
            alert('Failed to export data.');
        }
    }

    // 이력 TSV만 되돌린다. 작업 목록과 설정은 건드리지 않는다.
    async importHistoryTsv(text) {
        const logFiles = this.parseHistoryTsv(text);
        if (Object.keys(logFiles).length === 0) {
            alert(this.getLocalizedText('invalidFile'));
            return;
        }

        if (!this.isElectron) {
            alert(this.getLocalizedText('historyImportElectronOnly'));
            return;
        }

        // tasks를 비워 보내면 작업 목록이 지워진다. 지금 것을 그대로 다시 넘긴다.
        const success = await window.electronAPI.importData({
            tasks: this.tasks,
            rules: this.rules,
            logFiles
        });
        alert(this.getLocalizedText(success ? 'dataImportSuccess' : 'invalidFile'));
    }

    async importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                // 이력만 담긴 TSV도 받는다. 백업 JSON과 파일이 나뉘어 있으니
                // 가져오기도 둘 다 받을 수 있어야 한다.
                if (/\.tsv$/i.test(file.name)) {
                    await this.importHistoryTsv(e.target.result);
                    return;
                }

                const data = JSON.parse(e.target.result);

                if (data.tasks) {
                    if (confirm(this.getLocalizedText('replaceDataConfirm'))) {
                        if (this.isElectron) {
                            // Electron mode: use IPC
                            const success = await window.electronAPI.importData(data);
                            if (success) {
                                await this.loadTasks();
                                await this.loadRules();
                                this.applyPreferences(data.preferences);
                                this.renderTasks();
                                alert(this.getLocalizedText('dataImportSuccess'));
                            } else {
                                alert('Failed to import data.');
                            }
                        } else {
                            // Browser mode: use local storage
                            this.tasks = data.tasks;
                            if (data.logs) this.logs = data.logs;
                            this.rules = data.rules || [];
                            this.applyPreferences(data.preferences);
                            await this.saveRules();
                            await this.saveTasks();
                            this.renderTasks();
                            alert(this.getLocalizedText('dataImportSuccess'));
                        }
                    }
                } else {
                    alert(this.getLocalizedText('invalidFile'));
                }
            } catch (error) {
                alert(this.getLocalizedText('fileReadError'));
                console.error('Import error:', error);
            }
        };
        reader.readAsText(file);
        
        // Reset file input
        document.getElementById('fileInput').value = '';
    }

    startNotificationCheck() {
        // 30초마다 알림 체크
        setInterval(() => {
            this.checkUpcomingTasks();
        }, 30000);

        // 1분마다 상태 업데이트
        setInterval(() => {
            this.updateTaskStatuses();
        }, 60000);

        // 즉시 한 번 체크
        this.checkUpcomingTasks();
        
        // 초기 상태 업데이트
        this.updateTaskStatuses();
        
        // 1시간마다 완료 카운터 새로고침 (날짜 변경 대응)
        setInterval(async () => {
            const newCount = await this.getTodayCompletionCount();
            if (newCount !== this.completionCount) {
                this.completionCount = newCount;
                this.updateCompletionCounter();
                this.updateCollapsedCompletionCounter();
            }
        }, 3600000); // 1 hour
    }

    async checkUpcomingTasks() {
        if (!this.isElectron) return; // Electron에서만 작동

        const now = new Date();
        const activeTasks = this.tasks.filter(task => !task.completed);

        for (const task of activeTasks) {
            // Skip if notification is disabled for this task
            if (task.notificationEnabled === false) continue;
            // 마감이 없는 상시 업무는 알릴 시점 자체가 없다
            if (!task.targetDateTime) continue;
            
            const targetDate = new Date(task.targetDateTime);

            // 상태 배지와 같은 목록을 쓴다
            for (const minutes of LEAD_MINUTES) {
                const key = `${task.id}-lead${minutes}`;
                const fireFrom = new Date(targetDate.getTime() - minutes * 60 * 1000);

                if (now >= fireFrom && now < targetDate && !this.notifiedTasks.has(key)) {
                    await this.showTaskNotification(task, this.describeLead(minutes));
                    this.rememberNotified(key);
                }
            }

            // 시간 초과 알림
            if (now >= targetDate && !this.notifiedTasks.has(task.id + '-overdue')) {
                await this.showTaskNotification(task, 'Task is now overdue!');
                this.rememberNotified(task.id + '-overdue');
            }
        }
    }

    loadNotifiedTasks() {
        try {
            const saved = JSON.parse(localStorage.getItem('notifiedTasks') || '[]');
            return new Set(Array.isArray(saved) ? saved : []);
        } catch (error) {
            return new Set();
        }
    }

    // 알림 기록을 남긴다. 지금 목록에 없는 태스크의 기록은 같이 정리해서
    // 지운 작업의 흔적이 무한히 쌓이지 않게 한다.
    rememberNotified(key) {
        this.notifiedTasks.add(key);

        const live = new Set(this.tasks.map(task => task.id));
        for (const entry of [...this.notifiedTasks]) {
            if (!live.has(entry.slice(0, entry.lastIndexOf('-')))) {
                this.notifiedTasks.delete(entry);
            }
        }
        localStorage.setItem('notifiedTasks', JSON.stringify([...this.notifiedTasks]));
    }

    // '90분 남음' / '1시간 남음'처럼 읽히게 만든다
    describeLead(minutes) {
        if (minutes % 60 === 0) {
            return this.getLocalizedText('leadHours').replace('{n}', minutes / 60);
        }
        return this.getLocalizedText('leadMinutes').replace('{n}', minutes);
    }

    async showTaskNotification(task, timeMsg) {
        try {
            const title = 'Tasktory - ' + timeMsg;
            const body = task.content.length > 50 ? 
                task.content.substring(0, 50) + '...' : 
                task.content;
            
            await window.electronAPI.showNotification(title, body);
        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    }

    // Completion counter methods
    async getTodayCompletionCount() {
        const today = new Date().toDateString();
        
        if (this.isElectron && window.electronAPI && window.electronAPI.getCompletedTasksCount) {
            // In Electron mode, get count from today's log file.
            // 로그 파일명은 로컬 날짜 기준이므로 toISOString()(UTC)을 쓰면 하루 중
            // 몇 시간 동안 엉뚱한 날짜 파일을 읽게 된다.
            const now = new Date();
            const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            try {
                const count = await window.electronAPI.getCompletedTasksCount(todayStr);
                return count;
            } catch (error) {
                console.error('Failed to get completion count from log:', error);
                return 0;
            }
        } else {
            // Browser mode: use localStorage
            const storedDate = localStorage.getItem('completionCountDate');
            const storedCount = parseInt(localStorage.getItem('completionCount')) || 0;
            
            if (storedDate === today) {
                return storedCount;
            } else {
                // New day, reset counter
                localStorage.setItem('completionCountDate', today);
                localStorage.setItem('completionCount', '0');
                return 0;
            }
        }
    }

    updateCompletionCounter() {
        const counterElement = document.getElementById('completionCount');
        if (counterElement) {
            counterElement.textContent = this.completionCount;
        }
    }

    updateCompletionCounterText() {
        const counterTextElement = document.getElementById('completionCounterText');
        if (counterTextElement) {
            counterTextElement.textContent = this.getLocalizedText('completionCounter');
        }
    }

    async incrementCompletionCounter() {
        if (this.isElectron) {
            // In Electron mode, refresh count from log file
            this.completionCount = await this.getTodayCompletionCount();
        } else {
            // Browser mode: increment localStorage counter and update date
            this.completionCount++;
            const today = new Date().toDateString();
            localStorage.setItem('completionCount', this.completionCount.toString());
            localStorage.setItem('completionCountDate', today);
        }
        
        const counterElement = document.getElementById('completionCount');
        if (counterElement) {
            // Add animation class
            counterElement.classList.add('animate');
            counterElement.textContent = this.completionCount;
            
            // Remove animation class after animation completes
            setTimeout(() => {
                counterElement.classList.remove('animate');
            }, 300);
        }
        
        // Update collapsed counter too
        this.updateCollapsedCompletionCounter();
    }

    clearSearch() {
        const searchInput = document.getElementById('searchInput');
        const clearBtn = document.getElementById('clearSearchBtn');
        if (searchInput && clearBtn) {
            searchInput.value = '';
            this.searchQuery = '';
            // 대상 컬럼도 되돌린다. 칩을 눌러 '상태'로 좁혀둔 채 검색어만
            // 비우면, 다음에 친 단어가 조용히 상태 컬럼에서만 찾아진다.
            this.searchColumn = 'all';
            this.updateSearchColumnControl();
            this.currentPage = 1; // Reset to first page
            clearBtn.style.display = 'none';
            this.renderTasks();
        }
    }

    loadTagPresets() {
        const saved = localStorage.getItem('tagPresets');
        return saved ? JSON.parse(saved) : [];
    }

    saveTagPresets() {
        localStorage.setItem('tagPresets', JSON.stringify(this.tagPresets));
    }

    addNewTagPreset() {
        const input = document.getElementById('newTagPreset');
        const value = input.value.trim();
        
        if (!value) return;
        
        // Check if already exists
        if (this.tagPresets.includes(value)) {
            alert('Tag already exists');
            return;
        }
        
        // Check limit (10 tags)
        if (this.tagPresets.length >= 10) {
            alert('Maximum 10 tag presets allowed');
            return;
        }
        
        this.tagPresets.push(value);
        this.saveTagPresets();
        this.renderTagPresets();
        this.renderTagPresetsList();
        
        input.value = '';
    }

    removeTagPreset(tagToRemove) {
        this.tagPresets = this.tagPresets.filter(tag => tag !== tagToRemove);
        this.saveTagPresets();
        this.renderTagPresets();
        this.renderTagPresetsList();
    }

    renderTagPresetsList() {
        const container = document.getElementById('tagPresetsList');
        if (!container) return;
        
        container.innerHTML = '';
        
        if (this.tagPresets.length === 0) {
            container.innerHTML = `<div style="color: #666; font-style: italic;">${this.getLocalizedText('noTagPresetsAdded')}</div>`;
            return;
        }
        
        this.tagPresets.forEach(preset => {
            const item = document.createElement('div');
            item.className = 'tag-preset-item';
            
            const tagText = document.createElement('span');
            const fullTag = preset.startsWith('#') ? preset : `#${preset}`;
            const parsed = this.parseTagWithColor(fullTag);
            
            tagText.textContent = parsed.content;
            tagText.style.cursor = 'pointer';
            tagText.title = 'Click to add to tags input';
            
            // Apply colors to the item itself, overriding CSS
            item.style.backgroundColor = parsed.color.bg;
            item.style.borderColor = parsed.color.border;
            item.style.color = parsed.color.text;
            
            // Add click event to add tag to input
            tagText.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.addPresetTag(preset);
            };
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'tag-preset-remove';
            removeBtn.textContent = '×';
            removeBtn.title = 'Remove tag preset';
            removeBtn.onclick = () => this.removeTagPreset(preset);
            
            item.appendChild(tagText);
            item.appendChild(removeBtn);
            container.appendChild(item);
        });
    }

    renderTagPresets() {
        const container = document.getElementById('tagPresets');
        if (!container) return;
        
        container.innerHTML = '';
        
        this.tagPresets.forEach((preset, index) => {
            if (preset) {
                const button = document.createElement('button');
                button.className = 'tag-preset-btn';
                
                const fullTag = preset.startsWith('#') ? preset : `#${preset}`;
                const parsed = this.parseTagWithColor(fullTag);
                
                button.textContent = parsed.content;
                button.style.backgroundColor = parsed.color.bg;
                button.style.borderColor = parsed.color.border;
                button.style.color = parsed.color.text;
                
                button.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this.addPresetTag(preset);
                };
                container.appendChild(button);
            }
        });
    }

    addPresetTag(preset) {
        const tagsInput = document.getElementById('taskTags');
        if (!tagsInput) return;
        
        const currentValue = tagsInput.value.trim();
        const tagToAdd = preset.startsWith('#') ? preset : `#${preset}`;
        
        if (currentValue) {
            // Parse existing tags and add new one
            const existingTags = this.parseTagsFromInput(currentValue);
            if (!existingTags.includes(tagToAdd)) {
                existingTags.push(tagToAdd);
                tagsInput.value = existingTags.join(' ');
            }
        } else {
            tagsInput.value = tagToAdd;
        }
    }

    addColorToTagInput(colorCode) {
        // Find the currently active tag input
        let tagsInput = document.getElementById('taskTags'); // Task modal
        if (!tagsInput || tagsInput.offsetParent === null) {
            tagsInput = document.getElementById('newTagPreset'); // Settings modal
        }
        
        if (!tagsInput) return;
        
        const currentValue = tagsInput.value;
        const cursorPosition = tagsInput.selectionStart;
        
        // Insert color code at cursor position
        const beforeCursor = currentValue.substring(0, cursorPosition);
        const afterCursor = currentValue.substring(cursorPosition);
        const newValue = beforeCursor + colorCode + afterCursor;
        
        tagsInput.value = newValue;
        
        // Position cursor after the color code, ready to type tag name
        const newCursorPosition = cursorPosition + colorCode.length;
        tagsInput.setSelectionRange(newCursorPosition, newCursorPosition);
        tagsInput.focus();
    }

    parseTagsFromInput(input) {
        // Parse tags with # delimiter only
        const tags = input.split(/\s+/).filter(tag => tag.startsWith('#') && tag.length > 1);
        return tags;
    }

    getGitHubColors() {
        return {
            'RED': { bg: '#ffeaea', border: '#d73a49', text: '#d73a49' },
            'GREEN': { bg: '#dcffe4', border: '#28a745', text: '#28a745' },
            'BLUE': { bg: '#f1f8ff', border: '#0366d6', text: '#0366d6' },
            'YELLOW': { bg: '#fff8c5', border: '#ffd33d', text: '#b08800' },
            'PURPLE': { bg: '#f8f4ff', border: '#6f42c1', text: '#6f42c1' },
            'ORANGE': { bg: '#fff3cd', border: '#fd7e14', text: '#fd7e14' },
            'GRAY': { bg: '#f6f8fa', border: '#6a737d', text: '#6a737d' },
            'PINK': { bg: '#fce8f3', border: '#e83e8c', text: '#e83e8c' }
        };
    }

    parseTagWithColor(tag) {
        // Parse tag format: #[COLOR]content or #content
        const colorMatch = tag.match(/^#\[([A-Z]+)\](.+)$/);
        if (colorMatch) {
            const [, color, content] = colorMatch;
            const colors = this.getGitHubColors();
            if (colors[color]) {
                return {
                    content: '#' + content,
                    color: colors[color],
                    hasColor: true
                };
            }
        }
        // 색을 지정하지 않은 태그. 예전에는 전부 같은 파랑이라, 손으로 친 태그와
        // 색 없는 프리셋이 화면에서 구분되지 않았다. 이름에서 색을 유도해
        // 태그마다 고유한 색을 갖게 한다 - 같은 이름이면 언제 어디서 봐도 같은 색이다.
        return {
            content: tag, // Keep #
            color: this.derivedTagColor(tag),
            hasColor: false
        };
    }

    // 이름을 팔레트의 한 자리로 접는다. 무작위가 아니라 이름의 함수라서
    // 다시 그려도, 다른 화면에서도 같은 색이 나온다.
    derivedTagColor(tag) {
        const palette = Object.values(this.getGitHubColors());
        let hash = 0;
        for (let i = 0; i < tag.length; i++) {
            hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
        }
        return palette[hash % palette.length];
    }

    repositionTask(taskId, newPosition) {
        const completedTasks = this.tasks.filter(t => t.completed);
        const activeTasks = this.tasks.filter(t => !t.completed);
        
        // Find the task to move
        const taskIndex = activeTasks.findIndex(t => t.id === taskId);
        if (taskIndex === -1) return;
        
        const taskToMove = activeTasks[taskIndex];
        
        // Remove from current position
        activeTasks.splice(taskIndex, 1);
        
        // Insert at new position (1-based index, so subtract 1)
        activeTasks.splice(newPosition - 1, 0, taskToMove);
        
        // Rebuild tasks array
        this.tasks = [...activeTasks, ...completedTasks];
    }

    // toggleHighlight와 같은 이유로 스로틀 없음
    async toggleNotification(taskId) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.tasks[taskIndex];
            // 알림 판정은 어디서나 `!== false`, 즉 값이 없으면 켜진 것으로 본다.
            // 그런데 !undefined 는 true라서, 값이 없던 작업은 첫 클릭이 "켜짐 →
            // 켜짐"이 되어 아무 일도 일어나지 않았다. 실제 상태를 먼저 읽는다.
            task.notificationEnabled = task.notificationEnabled === false;

            // 즉시 UI 업데이트 (사용자 반응성 개선)
            this.renderTasks();
            
            // 비동기 작업들은 백그라운드에서 처리
            const action = task.notificationEnabled ? 'NOTI_ON' : 'NOTI_OFF';
            this.persistInBackground(action, task);
        }
    }

    showConfetti() {
        const colors = ['#ffd700', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#fd79a8', '#fdcb6e', '#6c5ce7', '#a29bfe'];
        
        // Fireworks explosion effect
        this.createFireworks();
        
        // Confetti falling from top
        this.createFallingConfetti(colors);
        
        // Burst confetti from center
        this.createBurstConfetti(colors);
        
        // Side celebration effects
        this.createSideCelebration(colors);
    }

    createFireworks() {
        const fireworkPositions = [
            { x: '20%', y: '30%' },
            { x: '80%', y: '25%' },
            { x: '50%', y: '40%' },
            { x: '30%', y: '20%' },
            { x: '70%', y: '35%' }
        ];
        
        fireworkPositions.forEach((pos, index) => {
            setTimeout(() => {
                for (let i = 0; i < 12; i++) {
                    const firework = document.createElement('div');
                    firework.className = 'firework';
                    firework.style.left = pos.x;
                    firework.style.top = pos.y;
                    firework.style.backgroundColor = ['#ff6b6b', '#4ecdc4', '#ffd700', '#fd79a8', '#6c5ce7'][Math.floor(Math.random() * 5)];
                    
                    const angle = (360 / 12) * i;
                    const distance = Math.random() * 100 + 50;
                    firework.style.transform = `rotate(${angle}deg) translateX(${distance}px)`;
                    
                    document.body.appendChild(firework);
                    
                    setTimeout(() => {
                        if (firework.parentNode) {
                            firework.parentNode.removeChild(firework);
                        }
                    }, 1200);
                }
            }, index * 200);
        });
    }

    createFallingConfetti(colors) {
        const confettiCount = 40;
        
        for (let i = 0; i < confettiCount; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti fall';
                confetti.style.left = Math.random() * window.innerWidth + 'px';
                confetti.style.top = '-20px';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animationDelay = Math.random() * 0.5 + 's';
                confetti.style.animationDuration = (Math.random() * 1 + 2) + 's';
                
                // Random horizontal drift
                const drift = (Math.random() - 0.5) * 200;
                confetti.style.setProperty('--drift', drift + 'px');
                
                document.body.appendChild(confetti);
                
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, 3500);
            }, i * 50);
        }
    }

    createBurstConfetti(colors) {
        const centerX = window.innerWidth / 2;
        const centerY = window.innerHeight / 2;
        
        for (let i = 0; i < 24; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti burst';
                
                const angle = (360 / 24) * i;
                const distance = Math.random() * 150 + 100;
                const x = centerX + Math.cos(angle * Math.PI / 180) * distance;
                const y = centerY + Math.sin(angle * Math.PI / 180) * distance;
                
                confetti.style.left = x + 'px';
                confetti.style.top = y + 'px';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                
                document.body.appendChild(confetti);
                
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, 1500);
            }, i * 30);
        }
    }

    createSideCelebration(colors) {
        // Left side celebration
        for (let i = 0; i < 15; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.left = '0px';
                confetti.style.top = Math.random() * window.innerHeight + 'px';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animation = `confetti-burst 1s ease-out forwards`;
                
                const moveDistance = Math.random() * 200 + 100;
                confetti.style.transform = `translateX(${moveDistance}px) rotate(${Math.random() * 360}deg)`;
                
                document.body.appendChild(confetti);
                
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, 1000);
            }, i * 40);
        }
        
        // Right side celebration
        for (let i = 0; i < 15; i++) {
            setTimeout(() => {
                const confetti = document.createElement('div');
                confetti.className = 'confetti';
                confetti.style.right = '0px';
                confetti.style.top = Math.random() * window.innerHeight + 'px';
                confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
                confetti.style.animation = `confetti-burst 1s ease-out forwards`;
                
                const moveDistance = Math.random() * 200 + 100;
                confetti.style.transform = `translateX(-${moveDistance}px) rotate(${Math.random() * 360}deg)`;
                
                document.body.appendChild(confetti);
                
                setTimeout(() => {
                    if (confetti.parentNode) {
                        confetti.parentNode.removeChild(confetti);
                    }
                }, 1000);
            }, i * 40);
        }
    }

    async updateTaskStatuses() {
        let statusChanged = false;
        
        for (const task of this.tasks) {
            if (!task.completed) {
                const currentStatus = this.getTaskStatus(task);
                const previousStatus = task.status;
                
                // Check if status has changed
                if (previousStatus && previousStatus !== currentStatus.status) {
                    task.status = currentStatus.status;
                    statusChanged = true;
                    
                    // Log status change (always in English for consistent formatting)
                    const statusText = currentStatus.status === 'overdue' ? 'overdue' : 
                                      currentStatus.status === 'urgent' ? 'urgent' : 
                                      currentStatus.status === 'inprogress' ? 'inprogress' : 'pending';
                    
                    await this.addLog('STATUS_CHANGE', task, `Status changed to ${statusText}`);
                } else if (!previousStatus) {
                    // First time setting status
                    task.status = currentStatus.status;
                }
            }
        }
        
        if (statusChanged) {
            await this.saveTasks();
            this.renderTasks(); // Re-render to update colors and display
        }
    }
}

// App initialization
let taskManager;

document.addEventListener('DOMContentLoaded', () => {
    taskManager = new TaskManager();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (!taskManager) return;
    
    // Ctrl/Cmd + N: Add new task
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        taskManager.showModal();
    }
    
    // Ctrl/Cmd + M: Toggle compact mode
    if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        taskManager.toggleCollapse();
    }
    
    // ESC: Close any open modal
    if (e.key === 'Escape') {
        taskManager.hideModal();
        taskManager.hideSettingsModal();
        taskManager.hideAboutModal();
        taskManager.hideConfirmModal();
    }
});

// Confirmation before page unload in browser mode (prevent data loss)
window.addEventListener('beforeunload', (e) => {
    if (taskManager && !taskManager.isElectron && taskManager.tasks.length > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});