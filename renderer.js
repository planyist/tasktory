class TaskManager {
    constructor() {
        this.tasks = [];
        this.logs = [];
        this.editingTaskId = null;
        this.isElectron = typeof window.electronAPI !== 'undefined';
        this.locale = this.getSelectedLanguage();
        this.darkMode = localStorage.getItem('darkMode') === 'true';
        this.searchQuery = '';
        this.notifiedTasks = new Set(); // 이미 알림을 보낸 태스크들
        this.completionCount = 0; // Will be set in init()
        this.isCollapsed = false;
        this.currentPage = 1;
        this.tasksPerPage = 10;
        this.defaultNotificationEnabled = localStorage.getItem('defaultNotificationEnabled') !== 'false';
        this.tagPresets = this.loadTagPresets();
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
        document.getElementById('thActions').textContent = this.getLocalizedText('actions');
        
        // Modal form labels
        document.getElementById('labelStartTime').textContent = this.getLocalizedText('startTime');
        document.getElementById('labelTargetTime').textContent = this.getLocalizedText('targetTime');
        document.getElementById('labelTags').textContent = this.getLocalizedText('tags');
        document.getElementById('labelTaskContent').textContent = this.getLocalizedText('taskContent');
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

        // Close modals when clicking background
        document.getElementById('taskModal').addEventListener('click', (e) => {
            if (e.target.id === 'taskModal') {
                this.hideModal();
            }
        });

        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') {
                this.hideSettingsModal();
            }
        });

        document.getElementById('aboutModal').addEventListener('click', (e) => {
            if (e.target.id === 'aboutModal') {
                this.hideAboutModal();
            }
        });

        document.getElementById('statisticsModal').addEventListener('click', (e) => {
            if (e.target.id === 'statisticsModal') {
                this.hideStatisticsModal();
            }
        });

        document.getElementById('confirmModal').addEventListener('click', (e) => {
            if (e.target.id === 'confirmModal') {
                this.hideConfirmModal();
            }
        });

        // Form submission
        document.getElementById('taskForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveTask();
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
                    switch (action) {
                        case 'edit':
                            this.editTask(taskId);
                            break;
                        case 'complete':
                            this.completeTask(taskId);
                            break;
                        case 'delete':
                            this.deleteTask(taskId);
                            break;
                        case 'highlight':
                            this.toggleHighlight(taskId);
                            break;
                        case 'up':
                            this.moveTask(taskId, 'up');
                            break;
                        case 'down':
                            this.moveTask(taskId, 'down');
                            break;
                        case 'notification':
                            this.toggleNotification(taskId);
                            break;
                    }
                }
            }
        });

        // Date input validation
        document.getElementById('startDateTime').addEventListener('blur', (e) => {
            this.validateDateTimeInput(e.target);
        });

        document.getElementById('targetDateTime').addEventListener('blur', (e) => {
            this.validateDateTimeInput(e.target);
        });

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
        try {
            if (this.isElectron) {
                // Electron mode: use IPC
                await window.electronAPI.saveTasks(this.tasks);
            } else {
                // Browser mode: use localStorage
                localStorage.setItem('tasklogger_tasks', JSON.stringify(this.tasks));
                localStorage.setItem('tasklogger_logs', JSON.stringify(this.logs));
            }
        } catch (error) {
            console.error('Failed to save tasks:', error);
            if (!this.isElectron) {
                alert('Failed to save data. Please check your browser storage.');
            }
        }
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

    formatDateTimeLocal(date) {
        // text input에 사용할 형식 (YYYY-MM-DD HH:MM)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    validateDateTimeInput(input) {
        const value = input.value.trim();
        const pattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
        
        if (value && !pattern.test(value)) {
            input.style.borderColor = '#e74c3c';
            input.title = 'Format: YYYY-MM-DD HH:MM (e.g., 2025-07-24 14:30)';
        } else {
            input.style.borderColor = '';
            input.title = '';
        }
    }

    formatDateTime(dateTime) {
        if (!dateTime) return '';
        const date = new Date(dateTime);
        return date.toLocaleString(this.locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
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

    getTaskStatus(task) {
        const now = new Date();
        const startDate = new Date(task.startDateTime);
        const targetDate = new Date(task.targetDateTime);
        const oneHourBefore = new Date(targetDate.getTime() - 60 * 60 * 1000);
        
        if (task.completed) {
            return { status: 'completed', text: this.getLocalizedText('done') };
        } else if (now > targetDate) {
            return { status: 'overdue', text: this.getLocalizedText('overdue') };
        } else if (now >= oneHourBefore) {
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
                const content = task.content.toLowerCase();
                const tags = (task.tags || '').toLowerCase();
                const startTime = this.formatDateTime(task.startDateTime).toLowerCase();
                const targetTime = this.formatDateTime(task.targetDateTime).toLowerCase();
                const status = this.getTaskStatus(task).text.toLowerCase();
                
                return content.includes(this.searchQuery) || 
                       tags.includes(this.searchQuery) ||
                       startTime.includes(this.searchQuery) ||
                       targetTime.includes(this.searchQuery) ||
                       status.includes(this.searchQuery);
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
            const row = document.createElement('tr');
            
            if (task.highlighted) {
                row.classList.add('highlighted');
            }
            
            // Task content without tag formatting
            const plainContent = task.content;
            
            // Tags from the tags field with color support
            const displayTags = task.tags ? task.tags.split(/\s+/).filter(tag => tag.startsWith('#')).map(tag => {
                const parsed = this.parseTagWithColor(tag);
                return `<span class="tag" style="background-color: ${parsed.color.bg}; border-color: ${parsed.color.border}; color: ${parsed.color.text}">${parsed.content}</span>`;
            }).join(' ') : '';
            
            row.innerHTML = `
                <td>${actualPosition}</td>
                <td>${this.formatDateTime(task.startDateTime)}</td>
                <td>${this.formatDateTime(task.targetDateTime)}</td>
                <td class="task-tags">${displayTags}</td>
                <td class="task-content">${plainContent}</td>
                <td><span class="status ${taskStatus.status}">${taskStatus.text}</span></td>
                <td class="action-buttons">
                    <button class="action-btn notification-btn" data-task-id="${task.id}" data-action="notification" title="${this.getLocalizedText('notification')}">
                        ${task.notificationEnabled !== false ? 
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="m13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor"/></svg>' : 
                            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="m13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor"/><line x1="1" y1="1" x2="23" y2="23" stroke="#dc3545" stroke-width="3"/></svg>'
                        }
                    </button>
                    <button class="action-btn edit-btn" data-task-id="${task.id}" data-action="edit" title="${this.getLocalizedText('edit')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="m18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button class="action-btn complete-btn" data-task-id="${task.id}" data-action="complete" title="${this.getLocalizedText('complete')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"/>
                        </svg>
                    </button>
                    <button class="action-btn delete-btn" data-task-id="${task.id}" data-action="delete" title="${this.getLocalizedText('delete')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"/>
                            <path d="m19,6v14a2,2,0,0,1-2,2H7a2,2,0,0,1-2-2V6m3,0V4a2,2,0,0,1,2-2h4a2,2,0,0,1,2,2V6"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                        </svg>
                    </button>
                    <button class="action-btn highlight-btn" data-task-id="${task.id}" data-action="highlight" title="${this.getLocalizedText('highlight')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>
                        </svg>
                    </button>
                    <button class="action-btn up-btn" data-task-id="${task.id}" data-action="up" title="${this.getLocalizedText('moveUp')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="18,15 12,9 6,15"/>
                        </svg>
                    </button>
                    <button class="action-btn down-btn" data-task-id="${task.id}" data-action="down" title="${this.getLocalizedText('moveDown')}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6,9 12,15 18,9"/>
                        </svg>
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
        });

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

        // Show only first 20 tasks in mini view
        const tasksToShow = activeTasks.slice(0, 20);

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
            
            // Truncate content to fit in 80px width
            const truncatedContent = task.content.length > 8 ? 
                task.content.substring(0, 8) + '...' : 
                task.content;
            
            li.innerHTML = `${index + 1}. ${truncatedContent}`;
            
            // Add tooltip with full content for truncated tasks
            if (task.content.length > 8) {
                li.title = task.content;
            }
            
            // Add status-based styling
            const status = this.getTaskStatus(task);
            if (status === 'urgent') {
                li.classList.add('urgent');
            } else if (status === 'overdue') {
                li.classList.add('overdue');
            }
            
            // Add click handler for collapsed items
            li.addEventListener('click', () => {
                this.editTask(task.id);
            });
            
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

        if (this.isCollapsed) {
            // Enter collapsed mode - 80px width ultra-minimal view
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
                
                this.resizeAndPositionWindow(80, dynamicHeight, 'top-right-150');
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
        const task = this.tasks.find(t => t.id === taskId);
        if (task) {
            const wasHighlighted = task.highlighted;
            task.highlighted = !task.highlighted;
            
            const action = task.highlighted ? 'HIGHLIGHT' : 'UNHIGHLIGHT';
            
            await this.addLog(action, task, task.content);
            await this.saveTasks();
            this.renderTasks();
        }
    }

    async moveTask(taskId, direction) {
        const taskIndex = this.tasks.findIndex(t => t.id === taskId && !t.completed);
        if (taskIndex === -1) return;

        const activeTasks = this.tasks.filter(t => !t.completed);
        const activeIndex = activeTasks.findIndex(t => t.id === taskId);
        const currentTask = this.tasks[taskIndex];
        
        if (direction === 'up' && activeIndex > 0) {
            const targetIndex = this.tasks.findIndex(t => t.id === activeTasks[activeIndex - 1].id);
            
            this.tasks.splice(taskIndex, 1);
            this.tasks.splice(targetIndex, 0, currentTask);
            
            await this.addLog('MOVE_UP', currentTask, currentTask.content);
        } else if (direction === 'down' && activeIndex < activeTasks.length - 1) {
            const targetIndex = this.tasks.findIndex(t => t.id === activeTasks[activeIndex + 1].id);
            
            this.tasks.splice(taskIndex, 1);
            this.tasks.splice(targetIndex, 0, currentTask);
            
            await this.addLog('MOVE_DOWN', currentTask, currentTask.content);
        }

        await this.saveTasks();
        this.renderTasks();
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
        } else {
            // Add mode
            modalTitle.textContent = this.getLocalizedText('addNewTask');
            form.reset();
            
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
            
            // Draw bars
            statisticsData.forEach((data, index) => {
                const barHeight = (data.completed / maxValue) * chartHeight;
                const x = padding + index * barWidth;
                const y = canvas.height - padding - barHeight;
                
                // Draw bar
                ctx.fillStyle = '#007bff';
                ctx.fillRect(x + 2, y, barWidth - 4, barHeight);
                
                // Draw value on top of bar if > 0
                if (data.completed > 0) {
                    ctx.fillStyle = '#333';
                    ctx.font = '12px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(data.completed.toString(), x + barWidth/2, y - 5);
                }
                
                // Draw date label (show every 5th day)
                if (index % 5 === 0 || index === statisticsData.length - 1) {
                    ctx.fillStyle = '#666';
                    ctx.font = '10px Arial';
                    ctx.textAlign = 'center';
                    ctx.save();
                    ctx.translate(x + barWidth/2, canvas.height - 10);
                    ctx.rotate(-Math.PI/4);
                    ctx.fillText(data.date, 0, 0);
                    ctx.restore();
                }
            });
            
            // Draw axes
            ctx.strokeStyle = '#ccc';
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
                
                ctx.fillStyle = '#666';
                ctx.font = '12px Arial';
                ctx.textAlign = 'right';
                ctx.fillText(value.toString(), padding - 10, y + 4);
                
                // Grid lines
                if (i > 0) {
                    ctx.strokeStyle = '#f0f0f0';
                    ctx.beginPath();
                    ctx.moveTo(padding, y);
                    ctx.lineTo(canvas.width - padding, y);
                    ctx.stroke();
                }
            }
            
        } catch (error) {
            console.error('Failed to render statistics chart:', error);
            
            // Show error message on canvas
            ctx.fillStyle = '#666';
            ctx.font = '16px Arial';
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

        if (!startDateTime || !targetDateTime || !content) {
            alert(this.getLocalizedText('fillAllFields'));
            return;
        }

        // Parse datetime-local format (YYYY-MM-DDTHH:MM)
        const startDate = new Date(startDateTime);
        const targetDate = new Date(targetDateTime);

        if (startDate >= targetDate) {
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
            startDateTime: startDateTime.replace('T', ' '),
            targetDateTime: targetDateTime.replace('T', ' '),
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
                this.tasks[taskIndex] = taskData;
                
                // Reposition task if needed
                this.repositionTask(this.editingTaskId, position);
                
                // Simple edit log without diff details
                await this.addLog('EDIT', taskData, 'Task modified');
            }
        } else {
            // Add mode - insert at specified position
            const completedTasks = this.tasks.filter(t => t.completed);
            const activeTasks = this.tasks.filter(t => !t.completed);
            
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
            task.completed = true;
            task.completedAt = new Date().toISOString();
            
            const logDetails = details ? `${task.content} (completed) ${details}` : `${task.content} (completed)`;
            await this.addLog('COMPLETE', task, logDetails);
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
            
            const logDetails = details ? `${task.content} (deleted) ${details}` : `${task.content} (deleted)`;
            await this.addLog('DELETE', task, logDetails);
            await this.saveTasks();
            this.renderTasks();
        }
    }

    // Export functionality
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
                    logs: this.logs,
                    exportDate: new Date().toISOString(),
                    version: '1.0'
                };
            }

            const dataStr = JSON.stringify(data, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            
            const link = document.createElement('a');
            link.href = URL.createObjectURL(dataBlob);
            link.download = `tasklogger-backup-${new Date().toISOString().slice(0, 10)}.json`;
            link.click();
            
            URL.revokeObjectURL(link.href);
        } catch (error) {
            console.error('Export error:', error);
            alert('Failed to export data.');
        }
    }

    async importData(file) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                
                if (data.tasks) {
                    if (confirm(this.getLocalizedText('replaceDataConfirm'))) {
                        if (this.isElectron) {
                            // Electron mode: use IPC
                            const success = await window.electronAPI.importData(data);
                            if (success) {
                                await this.loadTasks();
                                this.renderTasks();
                                alert(this.getLocalizedText('dataImportSuccess'));
                            } else {
                                alert('Failed to import data.');
                            }
                        } else {
                            // Browser mode: use local storage
                            this.tasks = data.tasks;
                            if (data.logs) this.logs = data.logs;
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
            
            const targetDate = new Date(task.targetDateTime);
            const oneHourBefore = new Date(targetDate.getTime() - 60 * 60 * 1000);
            const fifteenMinutesBefore = new Date(targetDate.getTime() - 15 * 60 * 1000);

            // 1시간 전 알림
            if (now >= oneHourBefore && now < targetDate && !this.notifiedTasks.has(task.id + '-1hour')) {
                await this.showTaskNotification(task, '1 hour remaining!');
                this.notifiedTasks.add(task.id + '-1hour');
            }

            // 15분 전 알림
            if (now >= fifteenMinutesBefore && now < targetDate && !this.notifiedTasks.has(task.id + '-15min')) {
                await this.showTaskNotification(task, '15 minutes remaining!');
                this.notifiedTasks.add(task.id + '-15min');
            }

            // 시간 초과 알림
            if (now >= targetDate && !this.notifiedTasks.has(task.id + '-overdue')) {
                await this.showTaskNotification(task, 'Task is now overdue!');
                this.notifiedTasks.add(task.id + '-overdue');
            }
        }
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
            // In Electron mode, get count from today's log file
            const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
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
                localStorage.setItem('completionCountDate', todayDateString);
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
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const task = this.tasks[taskIndex];
            task.notificationEnabled = !task.notificationEnabled;
            
            const action = task.notificationEnabled ? 'NOTI_ON' : 'NOTI_OFF';
            await this.addLog(action, task, task.content);
            await this.saveTasks();
            this.renderTasks();
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