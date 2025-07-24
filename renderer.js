class TaskManager {
    constructor() {
        this.tasks = [];
        this.logs = [];
        this.editingTaskId = null;
        this.isElectron = typeof window.electronAPI !== 'undefined';
        this.locale = this.getSystemLocale();
        this.darkMode = localStorage.getItem('darkMode') === 'true';
        this.searchQuery = '';
        this.notifiedTasks = new Set(); // 이미 알림을 보낸 태스크들
        this.init();
    }

    getSystemLocale() {
        return navigator.language || navigator.userLanguage || 'en-US';
    }

    async init() {
        this.setupEventListeners();
        this.setupUI();
        this.updateUIText();
        this.applyTheme();
        await this.loadTasks();
        this.renderTasks();
        this.startNotificationCheck();
    }

    setupUI() {
        // Adjust UI based on Electron mode vs browser mode
        if (!this.isElectron) {
            // Browser mode: show info bar and export/import buttons
            document.getElementById('infoBar').style.display = 'block';
            document.getElementById('exportBtn').style.display = 'inline-block';
            document.getElementById('importBtn').style.display = 'inline-block';
            document.getElementById('logPathInfo').style.display = 'none';
        } else {
            // Electron mode: show export/import buttons
            document.getElementById('exportBtn').style.display = 'inline-block';
            document.getElementById('importBtn').style.display = 'inline-block';
        }
    }

    updateUIText() {
        // Update all UI text with localized versions
        
        // Header buttons tooltips
        document.getElementById('addTaskBtn').title = this.getLocalizedText('addTask');
        document.getElementById('exportBtn').title = this.getLocalizedText('downloadExport');
        document.getElementById('importBtn').title = this.getLocalizedText('uploadImport');
        document.getElementById('settingsBtn').title = this.getLocalizedText('settings');
        document.getElementById('aboutBtn').title = this.getLocalizedText('about');
        
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
        document.getElementById('labelStartTime').textContent = this.getLocalizedText('startTime') + ':';
        document.getElementById('labelTargetTime').textContent = this.getLocalizedText('targetTime') + ':';
        document.getElementById('labelTags').textContent = this.getLocalizedText('tags') + ':';
        document.getElementById('labelTaskContent').textContent = this.getLocalizedText('taskContent') + ':';
        
        // Modal form placeholders
        document.getElementById('taskTags').placeholder = this.getLocalizedText('tagsPlaceholder');
        document.getElementById('taskContent').placeholder = this.getLocalizedText('taskContentPlaceholder');
        
        // Modal buttons
        document.getElementById('cancelBtn').textContent = this.getLocalizedText('cancel');
        document.getElementById('saveBtn').textContent = this.getLocalizedText('save');
        
        // Confirmation modal buttons
        document.getElementById('confirmCancelBtn').textContent = this.getLocalizedText('cancel');
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

    toggleTheme(isDark) {
        this.darkMode = isDark;
        localStorage.setItem('darkMode', isDark.toString());
        this.applyTheme();
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

        // Close modals
        document.querySelectorAll('.close').forEach(closeBtn => {
            closeBtn.addEventListener('click', (e) => {
                const modalType = e.target.getAttribute('data-modal');
                if (modalType === 'settings') {
                    this.hideSettingsModal();
                } else if (modalType === 'about') {
                    this.hideAboutModal();
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
            if (e.target.classList.contains('action-btn') || e.target.parentElement.classList.contains('action-btn')) {
                const button = e.target.classList.contains('action-btn') ? e.target : e.target.parentElement;
                const taskId = button.getAttribute('data-task-id');
                const action = button.getAttribute('data-action');
                
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
                }
            }
        });

        // Date input field events (auto-close date picker)
        document.getElementById('startDateTime').addEventListener('change', () => {
            document.getElementById('startDateTime').blur();
        });

        document.getElementById('targetDateTime').addEventListener('change', () => {
            document.getElementById('targetDateTime').blur();
        });

        // Close date picker with ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.type === 'datetime-local') {
                    activeElement.blur();
                }
            }
        });

        // Settings modal opacity slider (Electron only)
        if (this.isElectron) {
            document.getElementById('settingsOpacitySlider').addEventListener('input', (e) => {
                const opacity = parseFloat(e.target.value);
                document.getElementById('opacityValue').textContent = opacity;
                window.electronAPI.setUnfocusedOpacity(opacity);
            });
        }

        // Theme toggle buttons
        document.getElementById('lightModeBtn').addEventListener('click', () => {
            this.toggleTheme(false);
        });

        document.getElementById('darkModeBtn').addEventListener('click', () => {
            this.toggleTheme(true);
        });

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

            if (this.isElectron) {
                // Electron mode: use IPC
                await window.electronAPI.addLog(logEntry);
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
        // datetime-local input에 사용할 형식 (YYYY-MM-DDTHH:MM)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        
        return `${year}-${month}-${day}T${hours}:${minutes}`;
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
                'completeDetails': 'Completion notes (optional):',
                'deleteReason': 'Reason for deletion (optional):',
                'confirmComplete': 'Confirm completion',
                'confirmDelete': 'Confirm deletion'
            },
            'ko': {
                // Status
                'done': '완료',
                'pending': '대기',
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
                'completeDetails': '완료 메모 (선택사항):',
                'deleteReason': '삭제 사유 (선택사항):',
                'confirmComplete': '완료 확인',
                'confirmDelete': '삭제 확인'
            }
        };
        
        const lang = this.locale.startsWith('ko') ? 'ko' : 'en';
        return texts[lang][key] || texts['en'][key] || key;
    }

    getTaskStatus(task) {
        const now = new Date();
        const targetDate = new Date(task.targetDateTime);
        const oneHourBefore = new Date(targetDate.getTime() - 60 * 60 * 1000);
        
        if (task.completed) {
            return { status: 'completed', text: this.getLocalizedText('done') };
        } else if (now > targetDate) {
            return { status: 'overdue', text: this.getLocalizedText('overdue') };
        } else if (now >= oneHourBefore) {
            return { status: 'urgent', text: this.getLocalizedText('urgent') };
        } else {
            return { status: 'pending', text: this.getLocalizedText('pending') };
        }
    }

    renderTasks() {
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
            return;
        }

        activeTasks.forEach((task, index) => {
            const taskStatus = this.getTaskStatus(task);
            const row = document.createElement('tr');
            
            if (task.highlighted) {
                row.classList.add('highlighted');
            }
            
            // Task content without tag formatting
            const plainContent = task.content;
            
            // Tags from the tags field only
            const displayTags = task.tags ? task.tags.split(/\s+/).filter(tag => tag.startsWith('#')).map(tag => `<span class="tag">${tag}</span>`).join(' ') : '';
            
            row.innerHTML = `
                <td>${index + 1}</td>
                <td>${this.formatDateTime(task.startDateTime)}</td>
                <td>${this.formatDateTime(task.targetDateTime)}</td>
                <td class="task-tags">${displayTags}</td>
                <td class="task-content">${plainContent}</td>
                <td><span class="status ${taskStatus.status}">${taskStatus.text}</span></td>
                <td class="action-buttons">
                    <button class="action-btn edit-btn" data-task-id="${task.id}" data-action="edit" title="${this.getLocalizedText('edit')}">
                        <span>✏️</span>
                    </button>
                    <button class="action-btn complete-btn" data-task-id="${task.id}" data-action="complete" title="${this.getLocalizedText('complete')}">
                        <span>✅</span>
                    </button>
                    <button class="action-btn delete-btn" data-task-id="${task.id}" data-action="delete" title="${this.getLocalizedText('delete')}">
                        <span>🗑️</span>
                    </button>
                    <button class="action-btn highlight-btn" data-task-id="${task.id}" data-action="highlight" title="${this.getLocalizedText('highlight')}">
                        <span>🔶</span>
                    </button>
                    <button class="action-btn up-btn" data-task-id="${task.id}" data-action="up" title="${this.getLocalizedText('moveUp')}">
                        <span>⬆️</span>
                    </button>
                    <button class="action-btn down-btn" data-task-id="${task.id}" data-action="down" title="${this.getLocalizedText('moveDown')}">
                        <span>⬇️</span>
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
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
            const details = task.highlighted ? 'Task highlighted for emphasis' : 'Task highlight removed';
            
            await this.addLog(action, task, details);
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
            
            await this.addLog('MOVE_UP', currentTask, `Moved task up from position ${activeIndex + 1} to ${activeIndex}`);
        } else if (direction === 'down' && activeIndex < activeTasks.length - 1) {
            const targetIndex = this.tasks.findIndex(t => t.id === activeTasks[activeIndex + 1].id);
            
            this.tasks.splice(taskIndex, 1);
            this.tasks.splice(targetIndex + 1, 0, currentTask);
            
            await this.addLog('MOVE_DOWN', currentTask, `Moved task down from position ${activeIndex + 1} to ${activeIndex + 2}`);
        }

        await this.saveTasks();
        this.renderTasks();
    }

    showModal(task = null) {
        const modal = document.getElementById('taskModal');
        const modalTitle = document.getElementById('modalTitle');
        const form = document.getElementById('taskForm');
        
        if (task) {
            // Edit mode
            modalTitle.textContent = this.getLocalizedText('editTask');
            // Convert to datetime-local format (YYYY-MM-DDTHH:MM)
            const startDate = new Date(task.startDateTime);
            const targetDate = new Date(task.targetDateTime);
            
            document.getElementById('startDateTime').value = this.formatDateTimeLocal(startDate);
            document.getElementById('targetDateTime').value = this.formatDateTimeLocal(targetDate);
            document.getElementById('taskContent').value = task.content;
            document.getElementById('taskTags').value = task.tags || '';
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
            
            this.editingTaskId = null;
        }
        
        modal.style.display = 'block';
        
        // 첫 번째 입력 필드에 포커스
        setTimeout(() => {
            document.getElementById('startDateTime').focus();
        }, 100);
    }

    hideModal() {
        const modal = document.getElementById('taskModal');
        modal.style.display = 'none';
        this.editingTaskId = null;
    }

    showSettingsModal() {
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'block';
    }

    hideSettingsModal() {
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'none';
    }

    async showAboutModal() {
        const modal = document.getElementById('aboutModal');
        
        // Update log path in about modal
        if (this.isElectron) {
            try {
                const logPath = await window.electronAPI.getLogPath();
                document.getElementById('aboutLogPath').textContent = logPath;
            } catch (error) {
                document.getElementById('aboutLogPath').textContent = 'Error loading path';
            }
        } else {
            document.getElementById('aboutLogPath').textContent = 'Browser localStorage';
        }
        
        modal.style.display = 'block';
    }

    hideAboutModal() {
        const modal = document.getElementById('aboutModal');
        modal.style.display = 'none';
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
        }, 100);
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

        if (!startDateTime || !targetDateTime || !content) {
            alert(this.getLocalizedText('fillAllFields'));
            return;
        }

        const startDate = new Date(startDateTime);
        const targetDate = new Date(targetDateTime);

        if (startDate >= targetDate) {
            alert(this.getLocalizedText('targetAfterStart'));
            return;
        }

        const taskData = {
            id: this.editingTaskId || this.generateId(),
            startDateTime,
            targetDateTime,
            content,
            tags,
            completed: false,
            highlighted: false,
            createdAt: this.editingTaskId ? 
                this.tasks.find(t => t.id === this.editingTaskId).createdAt : 
                new Date().toISOString()
        };

        if (this.editingTaskId) {
            // 편집
            const taskIndex = this.tasks.findIndex(t => t.id === this.editingTaskId);
            if (taskIndex !== -1) {
                const oldTask = { ...this.tasks[taskIndex] };
                this.tasks[taskIndex] = taskData;
                
                // 변경 사항 세부 정보 생성
                const changes = [];
                if (oldTask.startDateTime !== taskData.startDateTime) {
                    changes.push(`Start time: ${this.formatDateTime(oldTask.startDateTime)} → ${this.formatDateTime(taskData.startDateTime)}`);
                }
                if (oldTask.targetDateTime !== taskData.targetDateTime) {
                    changes.push(`Target time: ${this.formatDateTime(oldTask.targetDateTime)} → ${this.formatDateTime(taskData.targetDateTime)}`);
                }
                if (oldTask.content !== taskData.content) {
                    changes.push(`Content: "${oldTask.content}" → "${taskData.content}"`);
                }
                if (oldTask.tags !== taskData.tags) {
                    changes.push(`Tags: "${oldTask.tags || ''}" → "${taskData.tags || ''}"`);
                }
                
                const changeDetails = changes.length > 0 ? changes.join('; ') : 'No changes detected';
                await this.addLog('EDIT', taskData, changeDetails);
            }
        } else {
            // 추가
            this.tasks.push(taskData);
            await this.addLog('ADD', taskData, 'New task created');
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
            
            const logDetails = details ? `Completion notes: ${details}` : 'Task completed';
            await this.addLog('COMPLETE', task, logDetails);
            await this.saveTasks();
            this.renderTasks();
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
            
            const logDetails = details ? `Deletion reason: ${details}` : 'Task deleted';
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

        // 즉시 한 번 체크
        this.checkUpcomingTasks();
    }

    async checkUpcomingTasks() {
        if (!this.isElectron) return; // Electron에서만 작동

        const now = new Date();
        const activeTasks = this.tasks.filter(task => !task.completed);

        for (const task of activeTasks) {
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
}

// App initialization
let taskManager;

document.addEventListener('DOMContentLoaded', () => {
    taskManager = new TaskManager();
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + N: Add new task
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        taskManager.showModal();
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