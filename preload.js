const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
    loadTasks: () => ipcRenderer.invoke('load-tasks'),
    saveTasks: (tasks) => ipcRenderer.invoke('save-tasks', tasks),
    addLog: (logEntry) => ipcRenderer.invoke('add-log', logEntry),
    exportData: () => ipcRenderer.invoke('export-data'),
    importData: (data) => ipcRenderer.invoke('import-data', data),
    getLogPath: () => ipcRenderer.invoke('get-log-path'),
    setUnfocusedOpacity: (opacity) => ipcRenderer.invoke('set-unfocused-opacity', opacity),
    showNotification: (title, body) => ipcRenderer.invoke('show-notification', title, body),
    getCompletedTasksCount: (dateStr) => ipcRenderer.invoke('get-completed-tasks-count', dateStr),
    resizeWindow: (width, height) => ipcRenderer.invoke('resize-window', width, height),
    resizeAndPositionWindow: (width, height, position) => ipcRenderer.invoke('resize-and-position-window', width, height, position)
})