// Manual mock for the `electron` module. Jest picks this up automatically for
// any test that requires main.js, which cannot run under a real Electron runtime.
//
// The mock records every ipcMain.handle() registration so tests can invoke the
// handlers directly via __invoke(), and points app.getPath('userData') at the
// directory named by TASKTORY_USERDATA so file I/O runs against a temp dir.

const handlers = new Map()
const shortcuts = new Map()
const taken = new Set()

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

    // 전역 단축키. 등록을 기록해 두어 테스트가 무엇이 어떤 조합으로 걸렸는지
    // 확인할 수 있게 한다. free 는 "아무도 안 쓰고 있다"는 가정이고,
    // __takeShortcut() 으로 뒤집어 실패한 등록을 흉내 낸다.
    globalShortcut: {
        register: (accelerator, callback) => {
            if (taken.has(accelerator)) return false
            shortcuts.set(accelerator, callback)
            return true
        },
        isRegistered: (accelerator) => shortcuts.has(accelerator),
        unregisterAll: () => shortcuts.clear()
    },

    // Test helpers
    __invoke: (channel, ...args) => {
        const handler = handlers.get(channel)
        if (!handler) throw new Error(`No IPC handler registered for "${channel}"`)
        return handler(null, ...args)
    },
    __handlers: handlers,
    __shortcuts: shortcuts,
    __takeShortcut: (accelerator) => taken.add(accelerator),
    __freeShortcuts: () => {
        taken.clear()
        shortcuts.clear()
    }
}
