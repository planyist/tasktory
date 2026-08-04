/**
 * @jest-environment jsdom
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const SOURCE = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8')
const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))

const TaskManager = new Function(`${SOURCE}\nreturn TaskManager;`)()

// init() is fired from the constructor and not awaited anywhere, so give its
// promise chain room to settle before asserting on the DOM.
const settle = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
}

const task = (id, overrides = {}) => ({
    id,
    content: `task ${id}`,
    startDateTime: '2026-08-04T09:00',
    targetDateTime: '2026-08-04T18:00',
    completed: false,
    ...overrides
})

let electronAPI
let stored

const boot = async (tasks = []) => {
    stored = tasks
    electronAPI = {
        loadTasks: jest.fn(async () => JSON.parse(JSON.stringify(stored))),
        saveTasks: jest.fn(async (next) => {
            stored = JSON.parse(JSON.stringify(next))
            return true
        }),
        addLog: jest.fn().mockResolvedValue(true),
        getCompletedTasksCount: jest.fn().mockResolvedValue(0),
        showNotification: jest.fn().mockResolvedValue(true),
        setUnfocusedOpacity: jest.fn()
    }
    window.electronAPI = electronAPI

    const manager = new TaskManager()
    await settle()
    return manager
}

const rows = () =>
    Array.from(document.querySelectorAll('#tasksBody tr')).filter(
        (row) => !row.querySelector('.empty-message')
    )

beforeEach(() => {
    document.body.innerHTML = BODY
    localStorage.clear()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    // Keeps three setInterval timers from outliving the test.
    jest.spyOn(TaskManager.prototype, 'startNotificationCheck').mockImplementation(() => {})
})

afterEach(() => {
    jest.restoreAllMocks()
    delete window.electronAPI
})

describe('boot', () => {
    test('loads tasks over IPC and renders one row each', async () => {
        await boot([task('a'), task('b')])

        expect(electronAPI.loadTasks).toHaveBeenCalled()
        expect(rows()).toHaveLength(2)
    })

    test('shows the empty message when there are no tasks', async () => {
        await boot([])

        expect(document.querySelector('#tasksBody .empty-message')).not.toBeNull()
        expect(rows()).toHaveLength(0)
    })

    test('hides completed tasks from the active table', async () => {
        await boot([task('a'), task('b', { completed: true })])

        expect(rows()).toHaveLength(1)
    })

    test('seeds the completion counter from the log file', async () => {
        const manager = await boot([])
        electronAPI.getCompletedTasksCount.mockResolvedValue(4)

        manager.completionCount = await manager.getTodayCompletionCount()
        manager.updateCompletionCounter()

        expect(document.getElementById('completionCount').textContent).toBe('4')
    })
})

describe('search', () => {
    test('filters the rendered rows', async () => {
        const manager = await boot([
            task('a', { content: 'buy milk' }),
            task('b', { content: 'write report' })
        ])

        manager.searchQuery = 'milk'
        manager.renderTasks()

        expect(rows()).toHaveLength(1)
        expect(document.getElementById('tasksBody').textContent).toContain('buy milk')
    })

    test('shows the no-results message when nothing matches', async () => {
        const manager = await boot([task('a', { content: 'buy milk' })])

        manager.searchQuery = 'zzz'
        manager.renderTasks()

        expect(rows()).toHaveLength(0)
        expect(document.querySelector('#tasksBody .empty-message')).not.toBeNull()
    })
})

describe('pagination', () => {
    test('renders at most one page of tasks at a time', async () => {
        const manager = await boot(Array.from({ length: 12 }, (_, i) => task(`t${i}`)))

        expect(rows()).toHaveLength(10)

        manager.currentPage = 2
        manager.renderTasks()

        expect(rows()).toHaveLength(2)
    })
})

describe('background persistence through the real IPC path', () => {
    test('toggleHighlight writes the flag through saveTasks', async () => {
        const manager = await boot([task('a')])

        await manager.toggleHighlight('a')
        await settle()

        expect(stored.find((t) => t.id === 'a').highlighted).toBe(true)
        expect(electronAPI.addLog).toHaveBeenCalled()
    })

    test('moveTask persists the reordered list', async () => {
        const manager = await boot([task('a'), task('b')])

        await manager.moveTask('b', 'up')
        await settle()

        expect(stored.map((t) => t.id)).toEqual(['b', 'a'])
    })

    test('a failing save is reported instead of passing silently', async () => {
        const manager = await boot([task('a')])
        electronAPI.saveTasks.mockRejectedValue(new Error('disk full'))

        await manager.toggleNotification('a')
        await settle()

        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('Failed to persist'),
            'a'
        )
    })
})
