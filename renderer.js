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
        this.selectedTaskIds = new Set(); // 일괄 처리용 선택
        // 이미 알림을 보낸 태스크들. 메모리에만 두면 앱을 껐다 켤 때마다
        // 아직 시간대에 걸린 작업의 알림이 전부 다시 울린다.
        this.notifiedTasks = this.loadNotifiedTasks();
        this.completionCount = 0; // Will be set in init()
        this.isCollapsed = false;
        this.currentPage = 1;
        this.tasksPerPage = 10;
        this.defaultNotificationEnabled = localStorage.getItem('defaultNotificationEnabled') !== 'false';
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

        // 편집이 선택 후 버튼 두 단계가 되었으니, 행을 더블클릭하면 바로 열리게 한다
        document.getElementById('tasksBody').addEventListener('dblclick', (e) => {
            const row = e.target.closest('tr');
            const box = row && row.querySelector('.task-select');
            if (box) this.editTask(box.dataset.taskId);
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

        // 표 안의 칩(태그·상태·반복)을 클릭하면 그 키워드로 검색한다.
        // 어떤 단어를 쳐야 하는지 몰라도 되고, 언어가 바뀌어도 보이는 것을 누르면 된다.
        document.getElementById('tasksTable').addEventListener('click', (e) => {
            const chip = e.target.closest('[data-filter]');
            if (chip) this.applyChipFilter(chip.dataset.filter, chip.dataset.filterColumn);
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

        // Settings modal opacity slider (Electron only)
        if (this.isElectron) {
            document.getElementById('settingsOpacitySlider').addEventListener('input', (e) => {
                const opacity = parseFloat(e.target.value);
                document.getElementById('opacityValue').textContent = opacity;
                window.electronAPI.setUnfocusedOpacity(opacity);
            });
        }

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

    toggleSelectAll(selected) {
        for (const id of this.visibleTaskIds()) {
            if (selected) {
                this.selectedTaskIds.add(id);
            } else {
                this.selectedTaskIds.delete(id);
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

        // 화면에서 사라진 항목(삭제·완료)은 선택에서도 빠져야 한다
        const visible = new Set(this.visibleTaskIds());
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
            const shown = [...visible];
            const allChosen = shown.length > 0 && shown.every(id => this.selectedTaskIds.has(id));
            selectAll.checked = allChosen;
            selectAll.indeterminate = !allChosen && shown.some(id => this.selectedTaskIds.has(id));
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

        // 알림은 선택 전체를 같은 상태로 맞춘다
        const turnOff = ids.some(id => {
            const task = this.tasks.find(t => t.id === id);
            return task && task.notificationEnabled !== false;
        });

        for (const id of ids) {
            const task = this.tasks.find(t => t.id === id);
            if (!task) continue;

            if (action === 'complete') {
                await this.doCompleteTask(id, null);
            } else if (action === 'delete') {
                await this.doDeleteTask(id, null);
            } else if (action === 'highlight') {
                await this.toggleHighlight(id);
            } else if (action === 'notification') {
                // 선택된 것들의 상태가 섞여 있을 때 각자 뒤집으면 결과가
                // 뒤죽박죽이 된다. 하나라도 켜져 있으면 전부 끄고, 전부 꺼져
                // 있으면 전부 켠다.
                if (this.tasks.find(t => t.id === id).notificationEnabled !== false) {
                    if (turnOff) await this.toggleNotification(id);
                } else if (!turnOff) {
                    await this.toggleNotification(id);
                }
            }
        }

        this.clearSelection();
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

    // 칩 클릭 = 그 키워드로 검색. 검색창에도 값을 넣어 무슨 일이 일어났는지 보이게 하고,
    // 기존 지우기 버튼으로 그대로 되돌릴 수 있게 한다.
    // 칩을 누르면 그 칩이 속한 컬럼으로 대상까지 맞춘다. '지연'을 눌렀는데
    // 전체 컬럼으로 찾으면 작업 내용에 '지연'이 들어간 것까지 딸려 나온다.
    applyChipFilter(value, column) {
        const input = document.getElementById('searchInput');
        if (input) input.value = value;

        this.searchColumn = column || 'all';
        this.updateSearchColumnControl();

        this.searchQuery = value.toLowerCase();
        this.currentPage = 1;
        this.renderTasks();
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
            this.renderMiniCollapsedTasks();
        } else {
            this.renderExpandedTasks();
        }
        
        // Always update completion counter
        this.updateCompletionCounter();
        this.updateCollapsedCompletionCounter();
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

        // Display only active tasks (not completed)
        let activeTasks = this.tasks.filter(task => !task.completed);

        // Apply search filter
        if (this.searchQuery) {
            activeTasks = activeTasks.filter(task => {
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

        if (activeTasks.length === 0) {
            const message = this.searchQuery ? this.getLocalizedText('noSearchResults') : this.getLocalizedText('allCompleted');
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
                <div class="repeat-cadence" data-filter="${repeatCadence}" data-filter-column="repeat" title="${repeatCadence}">
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
                return `<span class="tag" data-filter="${parsed.content}" data-filter-column="tags" title="${parsed.content}" style="background-color: ${parsed.color.bg}; border-color: ${parsed.color.border}; color: ${parsed.color.text}">${parsed.content}</span>`;
            }).join(' ') : '';
            
            row.innerHTML = `
                <td class="select-col"><input type="checkbox" class="task-select" data-task-id="${task.id}"${this.selectedTaskIds.has(task.id) ? ' checked' : ''}></td>
                <td>${actualPosition}</td>
                <td>${this.formatDateTime(task.startDateTime)}${cadenceMarkup}</td>
                <td>${this.formatDateTime(task.targetDateTime)}${notificationFlag}</td>
                <td class="task-tags">${displayTags}</td>
                <td class="task-content">${plainContent}</td>
                <td><span class="status ${taskStatus.status}" data-filter="${taskStatus.text}" data-filter-column="status" title="${taskStatus.text}">${taskStatus.text}</span></td>
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

        
        if (totalPages <= 1) {
            paginationContainer.style.display = 'none';
            return;
        }

        paginationContainer.style.display = 'flex';
        pageNumbers.innerHTML = '';

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
            
            // Resize window if in Electron mode
            if (this.isElectron && window.electronAPI) {
                // Calculate dynamic height based on task count
                const activeTasks = this.tasks.filter(t => !t.completed);
                const taskCount = activeTasks.length; // Show all tasks without limit
                const baseHeight = 80; // Expand button + completion counter + padding
                const taskHeight = 22; // Height per task item
                const paddingHeight = 30; // Bottom padding
                const dynamicHeight = Math.max(150, baseHeight + (taskCount * taskHeight) + paddingHeight);
                
                this.resizeAndPositionWindow(COLLAPSED_WIDTH, dynamicHeight, 'top-right-150');
            }
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

        this.renderTasks();
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


    async toggleHighlight(taskId) {
        // 스로틀링 체크 (100ms)
        if (this.isActionThrottled(`highlight_${taskId}`, 100)) return;
        
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

    showConfirmModal(action, taskId) {
        const modal = document.getElementById('confirmModal');
        const title = document.getElementById('confirmModalTitle');
        const label = document.getElementById('confirmDetailsLabel');
        const actionBtn = document.getElementById('confirmActionBtn');
        const detailsTextarea = document.getElementById('confirmDetails');
        
        this.pendingConfirmAction = action;
        this.pendingConfirmTaskId = taskId;
        
        if (action === 'complete') {
            title.textContent = this.getLocalizedText('completeTask');
            label.textContent = this.getLocalizedText('completeDetails');
            actionBtn.textContent = this.getLocalizedText('confirmComplete');
            actionBtn.className = 'btn complete-btn';
        } else if (action === 'delete') {
            title.textContent = this.getLocalizedText('deleteTask');
            label.textContent = this.getLocalizedText('deleteReason');
            actionBtn.textContent = this.getLocalizedText('confirmDelete');
            actionBtn.className = 'btn delete-btn';
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
        this.pendingConfirmTaskId = null;
    }

    async handleConfirmAction() {
        const details = document.getElementById('confirmDetails').value.trim();
        
        if (this.pendingConfirmAction === 'complete') {
            await this.doCompleteTask(this.pendingConfirmTaskId, details);
        } else if (this.pendingConfirmAction === 'delete') {
            await this.doDeleteTask(this.pendingConfirmTaskId, details);
        }
        
        this.hideConfirmModal();
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
        this.showConfirmModal('complete', taskId);
    }

    async doCompleteTask(taskId, details) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.tasks[taskIndex];

            const logDetails = details ? `${task.content} (completed) ${details}` : `${task.content} (completed)`;
            // 로그는 완료 상태로 남긴다. 반복이면 태스크 자체는 다음 회차로
            // 넘어가지만, 이번 회차를 해냈다는 기록은 그대로 있어야 한다.
            await this.addLog('COMPLETE', { ...task, completed: true }, logDetails);

            // 반복 작업은 사라지지 않고 다음 회차로 이동한다. 그 행이 곧 규칙이라
            // 없애버리면 반복을 다시 볼 방법이 없어진다.
            if (!this.advanceRecurringTask(task)) {
                task.completed = true;
                task.completedAt = new Date().toISOString();
            }

            await this.saveTasks();
            this.renderTasks();
            
            // Update completion counter with animation and confetti
            await this.incrementCompletionCounter();
            this.showConfetti();
        }
    }

    async deleteTask(taskId) {
        this.showConfirmModal('delete', taskId);
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
            defaultNotificationEnabled: this.defaultNotificationEnabled
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
        // Default tag without color
        return {
            content: tag, // Keep #
            color: { bg: '#e3f2fd', border: '#bbdefb', text: '#1565c0' },
            hasColor: false
        };
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

    async toggleNotification(taskId) {
        // 스로틀링 체크 (100ms)
        if (this.isActionThrottled(`notification_${taskId}`, 100)) return;
        
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