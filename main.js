const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs').promises
const path = require('path')

let mainWindow
let unfocusedOpacity = 1.0
let originalWindowBounds = null

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 500,
        minWidth: 900,
        minHeight: 400,
        alwaysOnTop: true,
        resizable: true,
        x: 100,
        y: 50,
        autoHideMenuBar: true, // 메뉴바 숨기기
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    })
    
    mainWindow.loadFile('index.html')
    
    
    // 포커스 상태에 따른 opacity 처리
    mainWindow.on('focus', () => {
        mainWindow.setOpacity(1.0)
    })
    
    mainWindow.on('blur', () => {
        mainWindow.setOpacity(unfocusedOpacity)
    })
    
    // 개발 시에만 개발자 도구 열기
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools()
    }
}

// GPU 가속 비활성화 (호환성 문제 해결)
app.disableHardwareAcceleration()

// 앱 준비 완료 시 창 생성
app.whenReady().then(() => {
    createWindow()
    
    // macOS에서 dock 아이콘 클릭 시 창 다시 생성
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

// 모든 창이 닫혔을 때 앱 종료 (macOS 제외)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// 데이터 파일 경로 (패키지된 앱에서도 작동하도록 userData 사용)
const dataDir = path.join(app.getPath('userData'), 'data')
const logsDir = path.join(app.getPath('userData'), 'logs')
const tasksFile = path.join(dataDir, 'tasks.json')
const rulesFile = path.join(dataDir, 'rules.json')

// 데이터 디렉토리 생성
const ensureDataDir = async () => {
    try {
        await fs.mkdir(dataDir, { recursive: true })
        await fs.mkdir(logsDir, { recursive: true })
    } catch (error) {
        console.error('Failed to create directories:', error)
    }
}

// 오늘 날짜의 로그 파일 경로 생성 (로컬 타임존 사용)
const getTodayLogFile = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const todayStr = `${year}-${month}-${day}`; // YYYY-MM-DD 형식 (로컬 타임존)
    const logFile = path.join(logsDir, `${todayStr}.tsv`)
    console.log('IPC: Today log file:', logFile, 'for date:', todayStr);
    return logFile
}

// 태스크 로드
ipcMain.handle('load-tasks', async () => {
    try {
        await ensureDataDir()
        const data = await fs.readFile(tasksFile, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        return []
    }
})

// 태스크 저장
ipcMain.handle('save-tasks', async (event, tasks) => {
    try {
        await ensureDataDir()
        await fs.writeFile(tasksFile, JSON.stringify(tasks, null, 2))
        return true
    } catch (error) {
        console.error('Failed to save tasks:', error)
        return false
    }
})

// 반복 규칙 로드 (규칙은 태스크와 별도 파일로 관리한다)
ipcMain.handle('load-rules', async () => {
    try {
        await ensureDataDir()
        const data = await fs.readFile(rulesFile, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        return []
    }
})

// 반복 규칙 저장
ipcMain.handle('save-rules', async (event, rules) => {
    try {
        await ensureDataDir()
        await fs.writeFile(rulesFile, JSON.stringify(rules, null, 2))
        return true
    } catch (error) {
        console.error('Failed to save rules:', error)
        return false
    }
})

// 로그 추가 (날짜별 파일로 저장)
const writeLogEntry = async (logEntry) => {
    try {
        console.log('IPC: Adding log entry:', logEntry.action, 'for task:', logEntry.task.id);
        await ensureDataDir()
        const todayLogFile = getTodayLogFile()
        console.log('IPC: Log file path:', todayLogFile);
        
        // Check if file exists and add header if it's a new file
        let fileExists = false;
        try {
            await fs.access(todayLogFile);
            fileExists = true;
            console.log('IPC: Log file exists');
        } catch (error) {
            console.log('IPC: Log file does not exist, will create with header');
            // File doesn't exist, we'll create it with header
        }
        
        // Add TSV header if file is new
        if (!fileExists) {
            const header = 'TIMESTAMP\tACTION\tSTATUS\tTASK_ID\tSTART_TIME\tTARGET_TIME\tTAGS\tCONTENT\n';
            await fs.writeFile(todayLogFile, header);
        }
        
        // Format timestamp (로컬 타임존 사용)
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        // 로그는 되돌릴 수 없는 과거 기록이다. 로컬 벽시계 시각만 남기면 나중에
        // 어느 타임존이었는지 복원할 방법이 없고, 서머타임이 있는 지역에서는
        // 가을 전환 때 같은 시각이 두 번 나와 순서가 뒤엉킨다. UTC 오프셋을 붙인다.
        // (START_TIME/TARGET_TIME은 "벽시계 의도"라 존을 붙이지 않는다)
        const offsetMinutes = -now.getTimezoneOffset();
        const offsetSign = offsetMinutes >= 0 ? '+' : '-';
        const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
        const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
        const offset = `${offsetSign}${offsetHours}:${offsetMins}`;
        const timestamp = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offset}`;

        // Convert action to English
        const actionMap = {
            'ADD': 'ADD',
            'EDIT': 'EDIT', 
            'COMPLETE': 'COMPLETE',
            'DELETE': 'DELETE',
            'MOVE_UP': 'MOVE_UP',
            'MOVE_DOWN': 'MOVE_DOWN',
            'HIGHLIGHT': 'HIGHLIGHT',
            'UNHIGHLIGHT': 'UNHIGHLIGHT',
            'NOTI_ON': 'NOTI_ON',
            'NOTI_OFF': 'NOTI_OFF',
            'STATUS_CHANGE': 'STATUS_CHANGE'
        };
        const action = actionMap[logEntry.action] || logEntry.action;
        
        // Convert status to English
        const statusMap = {
            'completed': 'COMPLETED',
            'pending': 'PENDING',
            'inprogress': 'INPROGRESS',
            'urgent': 'URGENT',
            'overdue': 'OVERDUE'
        };
        // Use actual task status from the task object, or determine from completion state
        const taskStatus = logEntry.task.status || (logEntry.task.completed ? 'completed' : 'pending');
        const status = statusMap[taskStatus] || taskStatus.toUpperCase();
        
        // Task data
        const taskId = logEntry.task.id || logEntry.task.taskId || '';
        const startTime = logEntry.task.startDateTime || '';
        const targetTime = logEntry.task.targetDateTime || '';
        const tags = logEntry.task.tags || '';
        
        // For content: always use logEntry.details if provided, otherwise use task content
        let content = logEntry.details || logEntry.task.content || '';
        
        // TSV helper function to escape tab characters and newlines
        const escapeTsvValue = (value) => {
            if (typeof value !== 'string') return value;
            
            // Replace tabs and newlines with spaces to maintain TSV structure
            return value.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
        };
        
        // Create TSV log line
        const logLine = `${escapeTsvValue(timestamp)}\t${escapeTsvValue(action)}\t${escapeTsvValue(status)}\t${escapeTsvValue(taskId)}\t${escapeTsvValue(startTime)}\t${escapeTsvValue(targetTime)}\t${escapeTsvValue(tags)}\t${escapeTsvValue(content)}\n`;
        
        console.log('IPC: Writing log line:', logLine.substring(0, 100) + '...');
        
        // Append to log file
        await fs.appendFile(todayLogFile, logLine)
        console.log('IPC: Log file written successfully');
        return true
    } catch (error) {
        console.error('IPC: Failed to add log:', error)
        return false
    }
}

// 로그 쓰기 직렬화: 렌더러가 add-log를 await 없이 호출하므로, 새 파일에 헤더를
// 쓰는 writeFile이 다른 호출이 이미 append한 줄을 잘라내지 않도록 순서를 보장한다.
let logWriteQueue = Promise.resolve()

ipcMain.handle('add-log', async (event, logEntry) => {
    const write = logWriteQueue.then(() => writeLogEntry(logEntry))
    logWriteQueue = write.catch(() => {}) // 실패해도 큐는 계속 살려둔다
    return write
})

// 데이터 내보내기 (Electron 모드용)
ipcMain.handle('export-data', async () => {
    try {
        await ensureDataDir()
        const tasksData = await fs.readFile(tasksFile, 'utf8').catch(() => '[]')
        
        const exportData = {
            tasks: JSON.parse(tasksData),
            exportDate: new Date().toISOString(),
            version: '1.0'
        }
        
        return exportData
    } catch (error) {
        console.error('Failed to export data:', error)
        return null
    }
})

// 데이터 가져오기 (Electron 모드용)
ipcMain.handle('import-data', async (event, data) => {
    try {
        await ensureDataDir()
        await fs.writeFile(tasksFile, JSON.stringify(data.tasks, null, 2))
        return true
    } catch (error) {
        console.error('Failed to import data:', error)
        return false
    }
})

// 로그 경로 반환
ipcMain.handle('get-log-path', async () => {
    return logsDir
})

// 로그 폴더 열기
ipcMain.handle('open-log-folder', async () => {
    try {
        const { shell } = require('electron')
        await ensureDataDir()
        shell.openPath(logsDir)
        return true
    } catch (error) {
        console.error('Failed to open log folder:', error)
        return false
    }
})

// Opacity 설정
ipcMain.handle('set-unfocused-opacity', async (event, opacity) => {
    unfocusedOpacity = opacity
    if (!mainWindow.isFocused()) {
        mainWindow.setOpacity(unfocusedOpacity)
    }
})

// 윈도우 알림 표시
ipcMain.handle('show-notification', async (event, title, body) => {
    const { Notification } = require('electron')
    
    if (Notification.isSupported()) {
        const notification = new Notification({
            title: title,
            body: body,
            icon: null, // 기본 아이콘 사용
            urgency: 'normal'
        })
        
        notification.show()
        
        // 알림 클릭 시 메인 윈도우 포커스
        notification.on('click', () => {
            if (mainWindow) {
                mainWindow.focus()
            }
        })
        
        return true
    }
    return false
})

// Count COMPLETE actions in a TSV log (ACTION is the second tab-separated column)
const countCompletedTsv = (logData) => {
    return logData.split('\n')
        .filter(line => line.trim() && !line.startsWith('TIMESTAMP\tACTION\tSTATUS'))
        .filter(line => {
            const columns = line.split('\t');
            return columns.length >= 2 && columns[1].trim() === 'COMPLETE';
        })
        .length;
}

// v0.2.5 이하의 로그는 고정폭 포맷이라 ACTION이 25~40번째 문자에 위치한다
const countCompletedLegacy = (logData) => {
    return logData.split('\n')
        .filter(line => line.trim() && !line.startsWith('TIMESTAMP'))
        .filter(line => line.substring(25, 40).trim() === 'COMPLETE')
        .length;
}

// Get completed tasks count for a specific date from TSV log file
ipcMain.handle('get-completed-tasks-count', async (event, dateStr) => {
    try {
        const logData = await fs.readFile(path.join(logsDir, `${dateStr}.tsv`), 'utf8');
        return countCompletedTsv(logData);
    } catch (error) {
        // .tsv가 없으면 v0.2.6 이전에 쌓인 .log 파일을 읽는다 (업그레이드 후 기록 유실 방지)
        try {
            const legacyData = await fs.readFile(path.join(logsDir, `${dateStr}.log`), 'utf8');
            return countCompletedLegacy(legacyData);
        } catch (legacyError) {
            // 해당 날짜의 로그가 아예 없음
            return 0;
        }
    }
})

// Resize window for collapsed mode
ipcMain.handle('resize-window', async (event, width, height) => {
    if (mainWindow) {
        if (width === 80) {
            // Store original bounds before collapsing
            originalWindowBounds = mainWindow.getBounds();
            // Temporarily remove minimum size constraints for collapse
            mainWindow.setMinimumSize(80, 400);
        }
        
        mainWindow.setSize(width, height);
        
        if (width !== 80 && originalWindowBounds) {
            // Restore original position and minimum size when expanding
            mainWindow.setPosition(originalWindowBounds.x, originalWindowBounds.y);
            mainWindow.setMinimumSize(900, 400);
            originalWindowBounds = null;
        }
        
        return true;
    }
    return false;
})

// Resize and position window with specific positioning
ipcMain.handle('resize-and-position-window', async (event, width, height, position) => {
    if (mainWindow) {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        if (width === 80) {
            // Store original bounds before collapsing
            originalWindowBounds = mainWindow.getBounds();
            // Temporarily remove minimum size constraints for collapse
            mainWindow.setMinimumSize(80, height);
        }
        
        mainWindow.setSize(width, height);
        
        // Calculate position based on position parameter
        let x, y;
        if (position === 'top-right-150') {
            // Position at top-right, 150px down from top
            x = screenWidth - width - 20; // 20px padding from right edge
            y = 150;
        } else if (position === 'center') {
            // Center the window
            x = Math.round((screenWidth - width) / 2);
            y = Math.round((screenHeight - height) / 2);
            // Restore minimum size when expanding
            mainWindow.setMinimumSize(900, 400);
            originalWindowBounds = null;
        } else {
            // Default to current position
            return true;
        }
        
        mainWindow.setPosition(x, y);
        return true;
    }
    return false;
})