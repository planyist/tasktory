const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs').promises
const path = require('path')

let mainWindow
let unfocusedOpacity = 1.0

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

// 데이터 디렉토리 생성
const ensureDataDir = async () => {
    try {
        await fs.mkdir(dataDir, { recursive: true })
        await fs.mkdir(logsDir, { recursive: true })
    } catch (error) {
        console.error('Failed to create directories:', error)
    }
}

// 오늘 날짜의 로그 파일 경로 생성
const getTodayLogFile = () => {
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD 형식
    return path.join(logsDir, `${today}.json`)
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

// 로그 추가 (날짜별 파일로 저장)
ipcMain.handle('add-log', async (event, logEntry) => {
    try {
        await ensureDataDir()
        const todayLogFile = getTodayLogFile()
        let logs = []
        
        try {
            const data = await fs.readFile(todayLogFile, 'utf8')
            logs = JSON.parse(data)
        } catch (error) {
            // 파일이 없으면 빈 배열로 시작
        }
        
        // UUID와 함께 상세한 정보 저장
        const detailedLog = {
            logId: 'log-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            timestamp: new Date().toISOString(),
            action: logEntry.action,
            taskId: logEntry.task.id || logEntry.task.taskId,
            details: logEntry.details || '',
            taskData: {
                id: logEntry.task.id || logEntry.task.taskId,
                content: logEntry.task.content ? logEntry.task.content.substring(0, 100) : '',
                tags: logEntry.task.tags || '',
                startDateTime: logEntry.task.startDateTime || '',
                targetDateTime: logEntry.task.targetDateTime || '',
                status: logEntry.task.completed ? 'completed' : 'active'
            }
        }
        
        logs.push(detailedLog)
        
        await fs.writeFile(todayLogFile, JSON.stringify(logs, null, 2))
        return true
    } catch (error) {
        console.error('Failed to add log:', error)
        return false
    }
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