const { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, dialog, shell } = require('electron')
const fs = require('fs').promises
const path = require('path')

let mainWindow
let unfocusedOpacity = 1.0
let originalWindowBounds = null
// 접기 전에 최대화돼 있었는가. 최대화된 창은 setBounds 로 줄지 않으므로 접을 때
// 풀어야 하고, 펼 때는 크기가 아니라 최대화 상태로 되돌려야 한다.
let wasMaximizedBeforeCollapse = false
// 사용자가 마지막으로 둔 자리. 화면보호기/잠금 이후 창이 밀려나면 여기로 돌린다.
let intendedBounds = null
const NORMAL_MIN_WIDTH = 900 // 접힘 여부 판단 기준 (BrowserWindow의 minWidth와 같다)
const DEFAULT_HEIGHT = 900

// 화면보다 큰 창으로 시작하지 않는다. 노트북 해상도에서는 750이 작업 영역을
// 넘어, 아래쪽 페이저가 화면 밖으로 나간다.
const startingHeight = () => {
    const { height } = screen.getPrimaryDisplay().workAreaSize
    return Math.min(DEFAULT_HEIGHT, height - 80)
}

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 900,
        height: startingHeight(),
        minWidth: 900,
        minHeight: 400,
        alwaysOnTop: true,
        // minimizable 은 건드리지 않는다. 항상 위에 뜨는 창에서 최소화를 빼면
        // 치울 방법이 없어진다 - 작업표시줄에서 다른 앱을 불러도 그 위를 계속
        // 가린다. Win+D 로 내려가는 것은 정상 동작으로 받아들인다.
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
    
    // setAlwaysOnTop 으로 레벨을 올리지 않는다. 'screen-saver' 는 위가 없는
    // 레벨이라 다른 앱 창이 전부 뒤로 깔린다. 기본 alwaysOnTop 은 보통 창들
    // 위에만 서고 대화상자에는 양보한다.

    // __dirname 기준이어야 한다. 상대 경로는 앱 경로를 따라가므로, main.js 를
    // 다른 스크립트가 불러오면 그쪽 폴더에서 index.html 을 찾아 빈 창이 뜬다.
    mainWindow.loadFile(path.join(__dirname, 'index.html'))

    mainWindow.on('focus', () => {
        mainWindow.setOpacity(1.0)
    })

    mainWindow.on('blur', () => {
        mainWindow.setOpacity(unfocusedOpacity)
    })

    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools()
    }

    keepWindowWhereItWasPut()
}

// 창을 미는 쪽은 Windows다. 세션이 풀릴 때 디스플레이 구성이 잠깐 바뀌면서
// 창이 작업 영역 기준으로 다시 놓인다.
//
// 'moved'/'resized' 를 계속 지켜보는 방식은 쓸 수 없다. 그 이벤트는 Windows가
// 옮겼을 때도 똑같이 뜨므로, 밀려난 자리가 곧 "사용자가 둔 자리"로 덮여 기준이
// 사라진다. 그래서 잠기는 순간에 스냅샷을 찍고, 복원이 끝날 때까지 이동을
// 무시한다.

// 되돌릴지, 어디로 되돌릴지 판단만 하는 순수 함수. 창도 이벤트도 모르므로
// Electron 런타임 없이 테스트할 수 있다.
const boundsToRestore = (saved, current, displays) => {
    if (!saved || !current) return null
    if (saved.x === current.x && saved.y === current.y
        && saved.width === current.width && saved.height === current.height) return null

    // 기억해 둔 자리가 지금 연결된 화면 밖이면(모니터를 뺐다면) 그대로 둔다.
    // 억지로 돌려놓으면 창이 보이지 않는 곳으로 사라진다.
    const visible = displays.some(d => {
        const a = d.workArea
        return saved.x < a.x + a.width && saved.x + saved.width > a.x
            && saved.y < a.y + a.height && saved.y + saved.height > a.y
    })
    return visible ? saved : null
}

const keepWindowWhereItWasPut = () => {
    if (!mainWindow) return

    let disrupted = false

    const remember = () => {
        if (disrupted) return // 지금 움직이는 것은 사용자가 아니다
        if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
            intendedBounds = mainWindow.getBounds()
        }
    }

    mainWindow.on('moved', remember)
    mainWindow.on('resized', remember)
    remember()

    const disrupt = () => {
        remember()        // 아직 밀리기 전이라면 이 값이 가장 정확하다
        disrupted = true
    }

    const restore = () => {
        disrupted = true
        // OS가 배치를 끝낸 뒤에 되돌려야 한다. 곧바로 부르면 그 위에 다시 덮인다.
        setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
                const target = boundsToRestore(intendedBounds, mainWindow.getBounds(),
                                               screen.getAllDisplays())
                if (target) mainWindow.setBounds(target)
            }
            disrupted = false
        }, 600)
    }

    powerMonitor.on('lock-screen', disrupt)
    powerMonitor.on('suspend', disrupt)

    powerMonitor.on('unlock-screen', restore)
    powerMonitor.on('resume', restore)
    screen.on('display-metrics-changed', restore)
    screen.on('display-added', restore)
    screen.on('display-removed', restore)
}

const COLLAPSE_SHORTCUT = 'CommandOrControl+Alt+Shift+M'
let collapseShortcutRegistered = false

module.exports = { boundsToRestore, registerCollapseShortcut, COLLAPSE_SHORTCUT }

// GPU 가속 비활성화 (호환성 문제 해결)
app.disableHardwareAcceleration()

// Windows 는 이 값이 없으면 토스트를 어느 앱의 것인지 알지 못해 띄우지 않는다.
// 조용히 실패하므로 알림 코드가 아니라 알림 설정을 의심하게 된다.
// package.json 의 build.appId 와 같아야 설치본의 시작 메뉴 바로가기와 맞는다.
if (process.platform === 'win32') app.setAppUserModelId('com.tasktory.app')

// 창 밖에서도 접을 수 있어야 한다 - 다른 일을 하는 중에 스티키 노트를 치우는
// 것이 이 단축키의 쓸모 전부다.
//
// 조합이 흔하면 전역 등록은 그 키를 다른 프로그램에서 빼앗는다. 재보니 이 컴퓨터
// 에서 Ctrl+Alt+M 은 이미 누가 쓰고 있었고, Ctrl+Shift+M 은 VS Code 의 문제 패널과
// 크롬 개발자도구가 쓴다. 수식키 세 개짜리는 그런 일이 거의 없다.
// 실패하면 조용히 넘어간다. 다른 프로그램이 먼저 잡았다는 뜻이고, 그때는 창 안에서
// 듣는 쪽으로 되돌아간다 - 렌더러가 registered 를 보고 정한다.
function registerCollapseShortcut() {
    collapseShortcutRegistered = globalShortcut.register(COLLAPSE_SHORTCUT, () => {
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return
        // 최소화된 채로 접으면 화면에 아무 일도 일어나지 않아 단축키가 죽은 것으로
        // 읽힌다. 되살려 놓고 접는다.
        if (win.isMinimized()) win.restore()
        win.webContents.send('toggle-collapse')
    })
    return collapseShortcutRegistered
}

app.whenReady().then(() => {
    createWindow()
    registerCollapseShortcut()

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

// 전역 등록은 프로세스가 아니라 OS 가 들고 있다. 풀지 않으면 앱이 사라진 뒤에도
// 그 조합이 잡혀 있는 것으로 남는다.
app.on('will-quit', () => {
    globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

// 패키지된 앱에서도 쓰기 가능한 곳이어야 하므로 userData 아래에 둔다
const dataDir = path.join(app.getPath('userData'), 'data')
const logsDir = path.join(app.getPath('userData'), 'logs')
const tasksFile = path.join(dataDir, 'tasks.json')
const rulesFile = path.join(dataDir, 'rules.json')

const ensureDataDir = async () => {
    try {
        await fs.mkdir(dataDir, { recursive: true })
        await fs.mkdir(logsDir, { recursive: true })
    } catch (error) {
        console.error('Failed to create directories:', error)
    }
}

// 로그 파일 이름은 UTC가 아니라 로컬 날짜를 따른다
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

ipcMain.handle('load-tasks', async () => {
    try {
        await ensureDataDir()
        const data = await fs.readFile(tasksFile, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        return []
    }
})

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

// 규칙은 tasks.json 과 다른 파일에 둔다
ipcMain.handle('load-rules', async () => {
    try {
        await ensureDataDir()
        const data = await fs.readFile(rulesFile, 'utf8')
        return JSON.parse(data)
    } catch (error) {
        return []
    }
})

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

const writeLogEntry = async (logEntry) => {
    try {
        console.log('IPC: Adding log entry:', logEntry.action, 'for task:', logEntry.task.id);
        await ensureDataDir()
        const todayLogFile = getTodayLogFile()
        console.log('IPC: Log file path:', todayLogFile);
        
        let fileExists = false;
        try {
            await fs.access(todayLogFile);
            fileExists = true;
            console.log('IPC: Log file exists');
        } catch (error) {
            console.log('IPC: Log file does not exist, will create with header');
        }
        
        if (!fileExists) {
            const header = 'TIMESTAMP\tACTION\tSTATUS\tTASK_ID\tSTART_TIME\tTARGET_TIME\tTAGS\tCONTENT\tATTACHMENTS\tCOMPLETED_AT\tNOTE\n';
            await fs.writeFile(todayLogFile, header);
        }
        
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
        
        const statusMap = {
            'completed': 'COMPLETED',
            'pending': 'PENDING',
            'inprogress': 'INPROGRESS',
            'urgent': 'URGENT',
            'overdue': 'OVERDUE'
        };
        const taskStatus = logEntry.task.status || (logEntry.task.completed ? 'completed' : 'pending');
        const status = statusMap[taskStatus] || taskStatus.toUpperCase();
        
        const taskId = logEntry.task.id || logEntry.task.taskId || '';
        const startTime = logEntry.task.startDateTime || '';
        const targetTime = logEntry.task.targetDateTime || '';
        const tags = logEntry.task.tags || '';

        // 경로째로 적는다. 이름만으로는 나중에 그 파일을 찾아갈 수 없고, 이
        // 로그에는 이미 작업 내용과 태그가 그대로 들어 있어 경로만 가릴 이유가
        // 없다.
        const attachments = (logEntry.task.attachments || [])
            .map(item => item.path || item.name || '')
            .filter(Boolean)
            .join('; ');
        
        // 완료 시각과 메모는 제 칸으로 간다. CONTENT 는 작업 내용 그대로다 -
        // '(completed)' 를 덧붙이는 것은 ACTION 이 이미 하는 말의 되풀이였다.
        const completedAt = logEntry.completedAt || '';
        const note = logEntry.note || '';

        let content = logEntry.details || logEntry.task.content || '';
        
        const escapeTsvValue = (value) => {
            if (typeof value !== 'string') return value;
            
            return value.replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
        };
        
        const logLine = [timestamp, action, status, taskId, startTime, targetTime,
            tags, content, attachments, completedAt, note]
            .map(escapeTsvValue).join('\t') + '\n';
        
        console.log('IPC: Writing log line:', logLine.substring(0, 100) + '...');
        
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

// 백업에 담을 수 있는 로그 파일명만 허용한다. 가져오기는 이 이름으로 파일을
// 쓰므로, 검증하지 않으면 조작된 백업이 데이터 폴더 밖에 파일을 만들 수 있다.
const LOG_FILE_NAME = /^\d{4}-\d{2}-\d{2}\.(tsv|log)$/

const readAllLogs = async () => {
    const logs = {}
    const names = await fs.readdir(logsDir).catch(() => [])

    for (const name of names) {
        if (!LOG_FILE_NAME.test(name)) continue
        const content = await fs.readFile(path.join(logsDir, name), 'utf8').catch(() => null)
        if (content !== null) logs[name] = content
    }
    return logs
}

// 이력은 백업 JSON과 분리해 TSV로 내보낸다
ipcMain.handle('read-log-files', async () => {
    try {
        await ensureDataDir()
        return await readAllLogs()
    } catch (error) {
        console.error('Failed to read log files:', error)
        return {}
    }
})

ipcMain.handle('export-data', async () => {
    try {
        await ensureDataDir()
        const tasksData = await fs.readFile(tasksFile, 'utf8').catch(() => '[]')
        const rulesData = await fs.readFile(rulesFile, 'utf8').catch(() => '[]')

        // 규칙을 함께 내보내지 않으면, 가져오기로 태스크만 복원됐을 때
        // 반복 작업이 통째로 사라진다.
        // 이력은 별도의 TSV로 내보낸다. 여기 함께 넣으면 탭과 줄바꿈이
        // 이스케이프된 거대한 문자열이 되어 읽을 수도 엑셀에 붙일 수도 없고,
        // 몇 년치가 쌓이면 백업 파일을 이것만으로 채운다.
        // (가져오기는 예전 백업을 위해 logFiles를 계속 받는다)
        const exportData = {
            tasks: JSON.parse(tasksData),
            rules: JSON.parse(rulesData),
            exportDate: new Date().toISOString(),
            version: '1.3'
        }

        return exportData
    } catch (error) {
        console.error('Failed to export data:', error)
        return null
    }
})

ipcMain.handle('import-data', async (event, data) => {
    try {
        await ensureDataDir()
        await fs.writeFile(tasksFile, JSON.stringify(data.tasks, null, 2))
        // 태스크를 통째로 갈아끼우므로 규칙도 함께 맞춰야 한다. 규칙만 남으면
        // 사라진 태스크의 회차가 다음 실행 때 되살아난다.
        // v1.0 백업에는 rules가 없으므로 그 경우 규칙을 비운다.
        await fs.writeFile(rulesFile, JSON.stringify(data.rules || [], null, 2))

        // 이력은 파일 단위로 덮어쓴다. 백업에 없는 날짜의 로그는 건드리지 않아,
        // 다른 기기의 기록을 실수로 지우지 않는다.
        for (const [name, content] of Object.entries(data.logFiles || {})) {
            if (!LOG_FILE_NAME.test(name) || typeof content !== 'string') continue
            await fs.writeFile(path.join(logsDir, name), content)
        }

        return true
    } catch (error) {
        console.error('Failed to import data:', error)
        return false
    }
})

ipcMain.handle('get-log-path', async () => {
    return logsDir
})

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

// 첨부는 경로만 가리킨다. 완료한 작업은 tasks.json 에서 사라지므로, 사본을
// 두면 아무도 참조하지 않는 파일이 userData 에 남는다.
ipcMain.handle('pick-attachments', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    return result.filePaths.map(filePath => ({
        name: path.basename(filePath),
        path: filePath
    }))
})

// 열 수 없으면 그 사실을 돌려준다. 조용히 실패하면 눌러도 아무 일이 없는 것처럼
// 보여서, 파일이 옮겨졌는지 앱이 고장났는지 구분할 수 없다.
ipcMain.handle('open-attachment', async (event, filePath) => {
    try {
        await fs.access(filePath)
    } catch {
        return { ok: false, reason: 'missing' }
    }
    const error = await shell.openPath(filePath)
    return error ? { ok: false, reason: error } : { ok: true }
})

ipcMain.handle('reveal-attachment', async (event, filePath) => {
    try {
        await fs.access(filePath)
    } catch {
        return { ok: false, reason: 'missing' }
    }
    shell.showItemInFolder(filePath)
    return { ok: true }
})

// 어떤 첨부가 아직 살아 있는지. 목록을 그릴 때 한 번에 물어본다.
ipcMain.handle('check-attachments', async (event, paths) => {
    const alive = {}
    await Promise.all((paths || []).map(async filePath => {
        try {
            await fs.access(filePath)
            alive[filePath] = true
        } catch {
            alive[filePath] = false
        }
    }))
    return alive
})

ipcMain.handle('get-app-version', async () => app.getVersion())

// CSS의 -webkit-app-region: drag 는 프레임 없는 창(frame: false)용이라, 제목줄이
// 있는 이 창에서는 Windows가 통째로 무시한다. 그래서 직접 옮긴다.
// 절대 좌표가 아니라 이동량을 받는다 - 창 위치를 renderer가 알 필요가 없다.
ipcMain.handle('move-window-by', async (event, dx, dy) => {
    if (!mainWindow) return false
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(Math.round(x + dx), Math.round(y + dy))
    return true
})

ipcMain.handle('set-always-on-top', async (event, onTop) => {
    if (!mainWindow) return false
    mainWindow.setAlwaysOnTop(Boolean(onTop))
    return true
})

// 로그인 자동 실행. 값은 OS 가 소유한다 - 사용자가 작업 관리자의 시작 프로그램에서
// 끌 수 있으므로 앱이 따로 저장해 두면 화면과 실제가 어긋난다. 늘 여기서 읽는다.
// Linux 에서는 Electron 이 이 API 를 구현하지 않아 언제나 false 를 돌려준다.
// 조합 문자열은 여기서만 정한다. 도움말과 버튼 툴팁이 이 값을 받아 쓰므로,
// 키를 바꿔도 화면의 안내가 뒤처지지 않는다.
ipcMain.handle('get-collapse-shortcut', async () => ({
    accelerator: COLLAPSE_SHORTCUT,
    registered: collapseShortcutRegistered
}))

ipcMain.handle('get-open-at-login', async () => ({
    supported: process.platform === 'win32' || process.platform === 'darwin',
    openAtLogin: app.getLoginItemSettings().openAtLogin
}))

ipcMain.handle('set-open-at-login', async (event, openAtLogin) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(openAtLogin) })
    return app.getLoginItemSettings().openAtLogin
})

ipcMain.handle('set-unfocused-opacity', async (event, opacity) => {
    unfocusedOpacity = opacity
    if (!mainWindow.isFocused()) {
        mainWindow.setOpacity(unfocusedOpacity)
    }
})

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
        
        notification.on('click', () => {
            if (mainWindow) {
                mainWindow.focus()
            }
        })
        
        return true
    }
    return false
})

// ACTION 은 TSV의 두 번째 열이다. 개수와 목록을 한 함수에서 뽑아, 카운터와
// 목록이 서로 다른 답을 내놓는 일이 없게 한다.
// COMPLETED_AT / NOTE 가 생기기 전의 줄은 그 둘이 CONTENT 안에 섞여 있다:
//   '테스트 (completed) at 2026-08-11 07:27 메모'
// 이미 디스크에 쌓인 것이므로 읽을 때 되돌린다.
const CONTENT_WITH_COMPLETION =
    /^(.*?) \(completed\)(?: at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}))?(?: (.*))?$/;

// 더 옛날에는 표시가 앞에 붙었고, 말도 그때의 화면 언어를 따랐다:
//   '(완료) 테스트', '(completed) yrdydfgdf'
// 이것들은 완료 시각을 아예 담지 않는다 - 그 시절 그 값은 TIMESTAMP 뿐이었다.
const COMPLETION_PREFIX = /^\((?:completed|완료)\)\s+/;

const splitLegacyContent = (content) => {
    const found = CONTENT_WITH_COMPLETION.exec(content);
    if (found) {
        return { content: found[1], completedAt: found[2] || '', note: (found[3] || '').trim() };
    }
    return { content: content.replace(COMPLETION_PREFIX, ''), completedAt: '', note: '' };
}

const completedFromTsv = (logData) => {
    return logData.split('\n')
        .filter(line => line.trim() && !line.startsWith('TIMESTAMP\tACTION\tSTATUS'))
        .map(line => line.split('\t'))
        .filter(columns => columns.length >= 2 && columns[1].trim() === 'COMPLETE')
        .map(columns => {
            const legacy = splitLegacyContent((columns[7] || '').trim());
            return {
                timestamp: (columns[0] || '').trim(),
                taskId: (columns[3] || '').trim(),
                startTime: (columns[4] || '').trim(),
                targetTime: (columns[5] || '').trim(),
                tags: (columns[6] || '').trim(),
                content: legacy.content,
                attachments: (columns[8] || '').trim(),
                completedAt: (columns[9] || '').trim() || legacy.completedAt,
                note: (columns[10] || '').trim() || legacy.note
            };
        });
}

// v0.2.5 이하의 로그는 고정폭 포맷이라 ACTION이 25~40번째 문자에 위치한다.
// 내용은 그 시절에도 마지막 탭 뒤에 있었다.
const completedFromLegacy = (logData) => {
    return logData.split('\n')
        .filter(line => line.trim() && !line.startsWith('TIMESTAMP'))
        .filter(line => line.substring(25, 40).trim() === 'COMPLETE')
        .map(line => ({
            timestamp: line.substring(0, 25).trim(),
            ...splitLegacyContent(line.split('\t').pop().trim())
        }));
}

// 하루치 완료 목록. .tsv를 먼저 보고, 없으면 v0.2.6 이전의 .log를 읽는다
// (업그레이드 후 기록 유실 방지).
// 로그 파일은 하루에 하나이고 이름이 로컬 날짜다. 날짜를 Date 로 옮겨 더하면
// 서머타임이 있는 지역에서 하루를 건너뛰거나 두 번 세는 일이 생기므로, 문자열
// 자체를 UTC 자정으로 읽어 하루씩 민다.
const eachDayKey = function* (fromKey, toKey) {
    const at = new Date(`${fromKey}T00:00:00Z`)
    const end = new Date(`${toKey}T00:00:00Z`)
    while (at <= end) {
        yield at.toISOString().slice(0, 10)
        at.setUTCDate(at.getUTCDate() + 1)
    }
}

const readCompleted = async (dateStr) => {
    try {
        return completedFromTsv(await fs.readFile(path.join(logsDir, `${dateStr}.tsv`), 'utf8'));
    } catch (error) {
        try {
            return completedFromLegacy(await fs.readFile(path.join(logsDir, `${dateStr}.log`), 'utf8'));
        } catch (legacyError) {
            return [];
        }
    }
}

ipcMain.handle('get-completed-tasks-count', async (event, dateStr) => {
    return (await readCompleted(dateStr)).length;
})

ipcMain.handle('get-completed-tasks', async (event, dateStr) => readCompleted(dateStr))

// 완료 화면이 읽는 자리. 하루치 리더를 날짜 범위로 돌릴 뿐이다 - 파서도 폴백도
// 카운터가 쓰는 것과 같은 것이라, 셋이 서로 다른 답을 낼 수가 없다.
//
// 파일이 없는 날은 readCompleted 가 빈 배열을 주므로 건너뛸 필요가 없다. 3년치
// 1,095개 파일을 한꺼번에 읽어도 200ms 남짓이고, 화면은 기본 30일만 본다.
// 로그에는 경로만 적힌다. 이름은 언제나 그 경로의 마지막 조각이므로 - 파일
// 고르기는 path.basename 을, 끌어다 놓기는 File.name 을 쓰고 둘 다 같은 값이다 -
// 여기서 되짚으면 저장돼 있던 것과 글자 그대로 같은 이름이 나온다. 로그 형식을
// 바꾸는 쪽보다 이 편이 낫다: 이미 쌓인 기록에서도 이름이 나온다.
//
// 경로를 자르는 일은 renderer 가 하지 않기로 되어 있고, path.basename 은 앱에서
// 경로를 다루는 유일한 자리다.
const namedPaths = (joined) => (joined || '')
    .split(';')
    .map(one => one.trim())
    .filter(Boolean)
    .map(filePath => ({ name: path.basename(filePath), path: filePath }))

ipcMain.handle('get-completed-range', async (event, fromKey, toKey) => {
    const days = []
    for (const key of eachDayKey(fromKey, toKey)) days.push(key)

    const perDay = await Promise.all(days.map(async (key) => {
        const rows = await readCompleted(key)
        return rows.map(row => ({ ...row, day: key, attachments: namedPaths(row.attachments) }))
    }))
    return perDay.flat()
})

ipcMain.handle('resize-and-position-window', async (event, width, height, position) => {
    if (!mainWindow) return false

    const { screen } = require('electron')
    // workArea는 크기뿐 아니라 원점도 준다. 작업표시줄이 왼쪽/위에 있거나
    // 모니터가 여러 대면 작업 영역이 0,0에서 시작하지 않는다.
    const { workArea } = screen.getPrimaryDisplay()

    let x, y
    if (position === 'top-right-150') {
        if (!originalWindowBounds) {
            wasMaximizedBeforeCollapse = mainWindow.isMaximized()
            originalWindowBounds = mainWindow.getBounds()
        }
        // 최대화된 채로는 setBounds 가 통하지 않는다. 풀지 않으면 접기를 눌러도
        // 스트립만 그려지고 창은 화면을 꽉 채운 채 남는다.
        if (mainWindow.isMaximized()) mainWindow.unmaximize()
        y = workArea.y + 150
        // 작업이 많으면 계산된 높이가 화면을 넘어가고, 그러면 창 안에 스크롤이 생긴다
        height = Math.min(height, workArea.height - 150)
        // 최소 크기를 먼저 풀어야 좁은 폭/낮은 높이가 실제로 적용된다
        mainWindow.setMinimumSize(width, 100)
        x = workArea.x + workArea.width - width
    } else if (position === 'center') {
        mainWindow.setMinimumSize(NORMAL_MIN_WIDTH, 400)

        // 접기 전 상태로 돌아간다. 넘겨받은 크기는 그 기억이 없을 때만 쓴다 -
        // 예전에는 여기서 늘 900x500 으로 되돌려, 창을 키워 놓고 한 번 접으면
        // 그 크기가 사라졌다.
        if (wasMaximizedBeforeCollapse) {
            wasMaximizedBeforeCollapse = false
            originalWindowBounds = null
            mainWindow.maximize()
            return true
        }
        if (originalWindowBounds) {
            const restore = originalWindowBounds
            originalWindowBounds = null
            mainWindow.setBounds(restore)
            return true
        }
        x = workArea.x + Math.round((workArea.width - width) / 2)
        y = workArea.y + Math.round((workArea.height - height) / 2)
    } else {
        return true
    }

    // 크기와 위치를 한 번에 적용한다. setSize와 setPosition을 따로 부르면
    // 중간 상태에서 최소 크기 제약이나 OS 위치 보정에 걸려 어긋난다.
    mainWindow.setBounds({ x, y, width, height })
    return true
})