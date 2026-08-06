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

    test('colours rows by status', async () => {
        const manager = await boot([
            task('due', { startDateTime: soon(-120), targetDateTime: soon(30) }),
            task('late', { startDateTime: soon(-300), targetDateTime: soon(-60) })
        ])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items()[0].classList.contains('urgent')).toBe(true)
        expect(items()[1].classList.contains('overdue')).toBe(true)
    })

    // A highlight is something the user set by hand; a status is derived from
    // the clock. The deliberate choice should win.
    test('lets a highlight override the status colour', async () => {
        const manager = await boot([
            task('late', {
                startDateTime: soon(-300),
                targetDateTime: soon(-60),
                highlighted: true
            })
        ])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items()[0].classList.contains('overdue')).toBe(false)
        expect(items()[0].style.backgroundColor).toBeTruthy()
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

describe('date format setting', () => {
    const at = (id) => document.getElementById(id)
    const startCell = () => document.querySelector('#tasksBody tr').cells[1].textContent.trim()

    const afternoon = () =>
        task('a', { startDateTime: '2026-08-04 15:30', targetDateTime: '2026-08-04 18:00' })

    test('defaults to the ISO-style pattern', async () => {
        const manager = await boot([afternoon()])

        expect(manager.dateFormat).toBe('YYYY-MM-DD HH:mm')
        expect(startCell()).toBe('2026-08-04 15:30')
    })

    test.each([
        ['YYYY/MM/DD HH:mm', '2026/08/04 15:30'],
        ['YYYYMMDD HHmm', '20260804 1530'],
        ['DD/MM/YYYY HH:mm', '04/08/2026 15:30'],
        ['MM/DD/YYYY hh:mm A', '08/04/2026 03:30 PM']
    ])('renders the table with %s', async (pattern, expected) => {
        const manager = await boot([afternoon()])

        manager.changeDateFormat(pattern)

        expect(startCell()).toBe(expected)
    })

    test('the edit modal uses the same pattern as the table', async () => {
        const manager = await boot([afternoon()])
        manager.changeDateFormat('YYYYMMDD HHmm')

        manager.showModal(manager.tasks[0])

        expect(at('startDateTime').value).toBe('20260804 1530')
        expect(at('targetDateTime').value).toBe('20260804 1800')
    })

    // Storage must not follow the display setting, or changing the setting
    // would rewrite every date in tasks.json.
    test('saves in the fixed storage format whatever the display pattern', async () => {
        const manager = await boot([])
        manager.changeDateFormat('YYYYMMDD HHmm')

        at('startDateTime').value = '20260910 0900'
        at('targetDateTime').value = '20260910 1800'
        at('taskContent').value = 'ship it'
        at('taskPosition').value = '1'
        await manager.saveTask()
        await settle()

        expect(stored[0].startDateTime).toBe('2026-09-10 09:00')
        expect(stored[0].targetDateTime).toBe('2026-09-10 18:00')
    })

    test('round-trips a 12-hour pattern back to 24-hour storage', async () => {
        const manager = await boot([])
        manager.changeDateFormat('MM/DD/YYYY hh:mm A')

        at('startDateTime').value = '09/10/2026 09:00 AM'
        at('targetDateTime').value = '09/10/2026 03:30 PM'
        at('taskContent').value = 'ship it'
        at('taskPosition').value = '1'
        await manager.saveTask()
        await settle()

        expect(stored[0].startDateTime).toBe('2026-09-10 09:00')
        expect(stored[0].targetDateTime).toBe('2026-09-10 15:30')
    })

    test('rejects input that does not match the chosen pattern', async () => {
        jest.spyOn(window, 'alert').mockImplementation(() => {})
        const manager = await boot([])
        manager.changeDateFormat('YYYY-MM-DD HH:mm')

        at('startDateTime').value = '2026/09/10 09:00'
        at('targetDateTime').value = '2026-09-10 18:00'
        at('taskContent').value = 'ship it'
        at('taskPosition').value = '1'
        await manager.saveTask()
        await settle()

        expect(stored).toEqual([])
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('YYYY-MM-DD HH:mm'))
    })

    test('rejects a date that does not exist', async () => {
        jest.spyOn(window, 'alert').mockImplementation(() => {})
        const manager = await boot([])

        at('startDateTime').value = '2026-02-30 09:00'
        at('targetDateTime').value = '2026-03-01 18:00'
        at('taskContent').value = 'ship it'
        at('taskPosition').value = '1'
        await manager.saveTask()
        await settle()

        expect(stored).toEqual([])
    })

    test('remembers the choice across launches', async () => {
        const first = await boot([afternoon()])
        first.changeDateFormat('YYYY.MM.DD HH:mm')

        const second = await boot([afternoon()])

        expect(second.dateFormat).toBe('YYYY.MM.DD HH:mm')
        expect(at('dateFormatSelect').value).toBe('YYYY.MM.DD HH:mm')
    })

    test('lists every pattern with a worked example', async () => {
        await boot([])

        const options = Array.from(at('dateFormatSelect').options)
        expect(options.length).toBeGreaterThan(1)
        expect(options[0].textContent).toContain('YYYY-MM-DD HH:mm')
        expect(options[0].textContent).toContain('2026-08-04 15:30')
    })

    test('is labelled in the selected language', async () => {
        localStorage.setItem('selectedLanguage', 'ko')
        await boot([])

        expect(at('settingsDateFormatLabel').textContent).toBe('날짜 표기')
    })
})
