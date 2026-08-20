const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    loadTasks: () => ipcRenderer.invoke('load-tasks'),
    saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),
    loadRules: () => ipcRenderer.invoke('load-rules'),
    saveRules: (rules) => ipcRenderer.invoke('save-rules', rules),
    addLog: (logEntry) => ipcRenderer.invoke('add-log', logEntry),
    exportData: () => ipcRenderer.invoke('export-data'),
    readLogFiles: () => ipcRenderer.invoke('read-log-files'),
    importData: (data) => ipcRenderer.invoke('import-data', data),
    getLogPath: () => ipcRenderer.invoke('get-log-path'),
    openLogFolder: () => ipcRenderer.invoke('open-log-folder'),
    setAlwaysOnTop: (onTop) => ipcRenderer.invoke('set-always-on-top', onTop),
    setUnfocusedOpacity: (opacity) => ipcRenderer.invoke('set-unfocused-opacity', opacity),
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
    getCompletedTasksCount: (dateStr) => ipcRenderer.invoke('get-completed-tasks-count', dateStr),
    getCompletedTasks: (dateStr) => ipcRenderer.invoke('get-completed-tasks', dateStr),
    resizeAndPositionWindow: (width, height, position) => ipcRenderer.invoke('resize-and-position-window', width, height, position),
    // 정보 창의 버전은 package.json 에서 읽는다. 손으로 적으면 릴리스마다
    // 갱신을 잊을 자리가 하나 늘어난다.
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    moveWindowBy: (dx, dy) => ipcRenderer.invoke('move-window-by', dx, dy),
    pickAttachments: () => ipcRenderer.invoke('pick-attachments'),
    openAttachment: (filePath) => ipcRenderer.invoke('open-attachment', filePath),
    revealAttachment: (filePath) => ipcRenderer.invoke('reveal-attachment', filePath),
    checkAttachments: (paths) => ipcRenderer.invoke('check-attachments', paths),
    // 끌어다 놓은 File 의 실제 경로. Electron 32 에서 File.path 가 사라져
    // webUtils.getPathForFile 이 유일한 방법이다.
    pathForFile: (file) => {
        try { return webUtils.getPathForFile(file) } catch { return '' }
    }
})