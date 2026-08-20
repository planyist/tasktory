// Manual mock for the `electron` module. Jest picks this up automatically for
// any test that requires main.js, which cannot run under a real Electron runtime.
//
// The mock records every ipcMain.handle() registration so tests can invoke the
// handlers directly via __invoke(), and points app.getPath('userData') at the
// directory named by TASKTORY_USERDATA so file I/O runs against a temp dir.

const handlers = new Map()

const app = {
    disableHardwareAcceleration: () => {},
    setAppUserModelId: () => {},
    // Never resolves, so createWindow() never runs during tests.
    whenReady: () => new Promise(() => {}),
    on: () => {},
    quit: () => {},
    getPath: () => process.env.TASKTORY_USERDATA
}

const ipcMain = {
    handle: (channel, handler) => {
        handlers.set(channel, handler)
    }
}

class BrowserWindow {
    static getAllWindows() {
        return []
    }
}

class Notification {
    static isSupported() {
        return false
    }
}

module.exports = {
    app,
    ipcMain,
    BrowserWindow,
    Notification,
    shell: { openPath: () => '', showItemInFolder: () => {} },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    screen: {
        getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
        getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
        on: () => {}
    },
    // main.js 가 잠금·복귀에 반응해 창을 제자리로 돌린다. 목에 없으면 구조 분해에서
    // undefined 가 되어, 나중에 그 경로를 건드리는 순간 조용히 터진다.
    powerMonitor: { on: () => {} },

    // Test helpers
    __invoke: (channel, ...args) => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`No IPC handler registered for "${channel}"`)
        return handler(null, ...args)
    },
    __handlers: handlers
}
