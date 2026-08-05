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

describe('collapsed mini view', () => {
    const soon = (minutes) =>
        new Date(Date.now() + minutes * 60 * 1000).toISOString()

    const items = () => Array.from(document.querySelectorAll('#collapsedMiniTasksBody li'))

    const rowOf = (li) => ({
        index: li.querySelector('.mini-index').textContent,
        text: li.querySelector('.mini-text').textContent
    })

    // Recurring occurrences share their rule's content, so consecutive rows can
    // read identically. The row number must stay a separate, distinguishable
    // element or it blends into content that starts with "1." itself.
    test('numbers the rows separately from the content', async () => {
        const manager = await boot([
            task('a', { content: 'status report' }),
            task('b', { content: 'review logs' })
        ])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items().map(rowOf)).toEqual([
            { index: '1', text: 'status report' },
            { index: '2', text: 'review logs' }
        ])
    })

    // Recurring occurrences share their rule's content, so consecutive rows read
    // identically. With a numbered note the row came out as "1  1." / "2  1.",
    // which looks like one broken number rather than a position and a title.
    test('drops a leading list marker so it cannot collide with the row number', async () => {
        const shared = '1. status report\n2. review logs\n3. ship it'
        const manager = await boot([
            task('a', { content: shared }),
            task('b', { content: shared })
        ])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items().map(rowOf)).toEqual([
            { index: '1', text: 'status report' },
            { index: '2', text: 'status report' }
        ])
        // The untouched note is still available on hover.
        expect(items()[0].title).toBe(shared)
    })

    test.each([
        ['1. status report', 'status report'],
        ['2) review logs', 'review logs'],
        ['10.  ship it', 'ship it'],
        ['no marker here', 'no marker here'],
        ['3M filters', '3M filters']
    ])('strips the marker in %p', async (content, expected) => {
        const manager = await boot([task('a', { content })])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(rowOf(items()[0]).text).toBe(expected)
    })

    test('renders every active task, not just the first twenty', async () => {
        const manager = await boot(Array.from({ length: 25 }, (_, i) => task(`t${i}`)))

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items()).toHaveLength(25)
    })

    // Colour bars were noise in a strip this narrow, so the list stays plain.
    test('does not colour rows by status', async () => {
        const manager = await boot([
            task('due', { startDateTime: soon(-120), targetDateTime: soon(30) }),
            task('late', { startDateTime: soon(-300), targetDateTime: soon(-60) })
        ])

        manager.isCollapsed = true
        manager.renderTasks()

        for (const item of items()) {
            expect(item.classList.contains('urgent')).toBe(false)
            expect(item.classList.contains('overdue')).toBe(false)
        }
    })

    // The strip is read-only: an edit modal cannot render usefully in a 150px
    // window, so clicking an item must do nothing.
    test('clicking an item does not open the edit modal', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        manager.isCollapsed = true
        manager.renderTasks()
        items()[0].click()

        expect(manager.showModal).not.toHaveBeenCalled()
    })

    test('still exposes the full content as a tooltip', async () => {
        const long = 'a very long task title that will not fit in the strip'
        const manager = await boot([task('a', { content: long })])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items()[0].title).toBe(long)
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
