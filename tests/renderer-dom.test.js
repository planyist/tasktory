/**
 * @jest-environment jsdom
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const SOURCE = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8')
const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))

// index.html loads i18n.js before renderer.js; the same order has to hold here,
// because the class reads TRANSLATIONS as a global.
const I18N = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8')
const CSS = fs.readFileSync(path.join(root, 'styles.css'), 'utf8')
const TaskManager = new Function(`${I18N}\n${SOURCE}\nreturn TaskManager;`)()

// init() is fired from the constructor and not awaited anywhere, so give its
// promise chain room to settle before asserting on the DOM.
const settle = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve()
}

// 행 클릭은 DOUBLE_CLICK_MS(220ms) 동안 기다렸다가 토글한다. 두 번째 클릭이
// 오지 않았다는 것을 확인하는 시간이라, 지나야 선택이 일어난다.
const pastDoubleClick = () => new Promise((r) => setTimeout(r, 300))

// 실제 브라우저는 같은 자리의 두 번째 클릭에 detail: 2 를 준다. dblclick 이벤트는
// 두 클릭이 같은 요소일 때만 오므로 앱은 그것을 쓰지 않는다.
const doubleClick = (el) => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 2 }))
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

// 메인이 전역 단축키를 눌렀을 때 부르는 콜백. 붙잡아 두어야 창 밖에서 누른 것을
// 흉내 낼 수 있다.
let toggleCollapseListener = null

const formatKey = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
].join('-')

const boot = async (tasks = []) => {
    toggleCollapseListener = null
    stored = tasks
    electronAPI = {
        loadTasks: jest.fn(async () => JSON.parse(JSON.stringify(stored))),
        saveTasks: jest.fn(async (next) => {
            stored = JSON.parse(JSON.stringify(next))
            return true
        }),
        addLog: jest.fn().mockResolvedValue(true),
        exportData: jest.fn(async () => ({
            tasks: JSON.parse(JSON.stringify(stored)),
            rules: [],
            logFiles: {},
            exportDate: '2026-08-04T00:00:00.000Z',
            version: '1.2'
        })),
        getCompletedTasksCount: jest.fn().mockResolvedValue(0),
        showNotification: jest.fn().mockResolvedValue(true),
        setUnfocusedOpacity: jest.fn(),
        setAlwaysOnTop: jest.fn(),
        // 끌어다 놓은 File 의 실제 경로. 실제 앱에서는 webUtils 가 준다.
        pathForFile: jest.fn((file) => '/dropped/' + file.name),
        checkAttachments: jest.fn(async (paths) =>
            Object.fromEntries(paths.map((p) => [p, true]))),
        pickAttachments: jest.fn(async () => []),
        openAttachment: jest.fn(async () => ({ ok: true })),
        revealAttachment: jest.fn(async () => ({ ok: true })),
        loadRules: jest.fn(async () => []),
        saveRules: jest.fn(async () => true),
        importData: jest.fn(async () => true),
        readLogFiles: jest.fn(async () => ({})),
        getCompletedTasks: jest.fn(async () => []),
        getAppVersion: jest.fn(async () => '0.0.0-test'),
        openLogFolder: jest.fn(async () => true),
        moveWindowBy: jest.fn(),
        resizeAndPositionWindow: jest.fn(async () => true),
        getCompletedRange: jest.fn(async () => []),
        getCollapseShortcut: jest.fn(async () => ({
            accelerator: 'CommandOrControl+Alt+Shift+M', registered: true
        })),
        onToggleCollapse: jest.fn((cb) => { toggleCollapseListener = cb }),
        getOpenAtLogin: jest.fn(async () => ({ supported: true, openAtLogin: false })),
        setOpenAtLogin: jest.fn(async (v) => v)
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
    // cells[0] is the select checkbox, cells[1] the row number.
    const startCell = () => document.querySelector('#tasksBody tr').cells[2].textContent.trim()

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

    // Separators are forgiven, deliberately. The chosen pattern is how dates are
    // shown, not a contract the typist has to honour - the stored form never
    // changes either way. Typing the digits and letting them land is faster than
    // hunting for the right slash.
    test('accepts the same date written with other separators', async () => {
        const manager = await boot([])
        manager.changeDateFormat('YYYY-MM-DD HH:mm')

        at('startDateTime').value = '2026/09/10 09:00'
        at('targetDateTime').value = '2026-09-10 18:00'
        at('taskContent').value = 'ship it'
        at('taskPosition').value = '1'
        await manager.saveTask()
        await settle()

        expect(stored[0].startDateTime).toBe('2026-09-10 09:00')
    })

    test('rejects input that is not a date at all', async () => {
        jest.spyOn(window, 'alert').mockImplementation(() => {})
        const manager = await boot([])
        manager.changeDateFormat('YYYY-MM-DD HH:mm')

        at('startDateTime').value = 'next tuesday'
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

describe('date/time picker', () => {
    const at = (id) => document.getElementById(id)
    const open = (target = 'startDateTime') =>
        document.querySelector(`.datetime-pick-btn[data-target="${target}"]`).click()
    const days = () => Array.from(document.querySelectorAll('#dtpDays .dtp-day'))
    const dayCell = (n) => days().find((d) => d.textContent === String(n))
    const timeCell = (col, n) =>
        Array.from(document.querySelectorAll(`#${col} .dtp-time-cell`)).find(
            (c) => c.dataset.value === String(n)
        )
    const pickedTime = () => ({
        hour: document.querySelector('#dtpHours .selected').textContent,
        minute: document.querySelector('#dtpMinutes .selected').textContent
    })

    // The native datetime-local picker cannot follow a custom display format,
    // so it was replaced. Losing the calendar entirely was not the intent.
    test('opens from the button and seeds from the current value', async () => {
        const manager = await boot([])
        at('startDateTime').value = '2026-08-04 15:30'

        open()

        expect(at('dateTimePicker').style.display).toBe('block')
        expect(pickedTime()).toEqual({ hour: '15', minute: '30' })
        expect(at('dtpMonthLabel').textContent).toContain('2026')
        expect(days()).toHaveLength(31)
        expect(document.querySelector('#dtpDays .dtp-day.selected').textContent).toBe('4')
    })

    test('falls back to now when the field is empty', async () => {
        await boot([])
        at('startDateTime').value = ''

        open()

        expect(at('dateTimePicker').style.display).toBe('block')
        expect(days().length).toBeGreaterThan(27)
    })

    test('applies only on confirm, in the chosen display format', async () => {
        const manager = await boot([])
        manager.changeDateFormat('YYYY/MM/DD HH:mm')
        at('startDateTime').value = '2026/08/04 15:30'
        open()

        dayCell(20).click()
        timeCell('dtpHours', 9).click()
        timeCell('dtpMinutes', 5).click()
        at('dtpApply').click()

        expect(at('startDateTime').value).toBe('2026/08/20 09:05')
        expect(at('dateTimePicker').style.display).toBe('none')
    })

    test('cancel leaves the field untouched', async () => {
        await boot([])
        at('startDateTime').value = '2026-08-04 15:30'
        open()

        dayCell(20).click()
        at('dtpCancel').click()

        expect(at('startDateTime').value).toBe('2026-08-04 15:30')
    })

    test('month arrows move the calendar', async () => {
        await boot([])
        at('startDateTime').value = '2026-08-04 15:30'
        open()

        at('dtpNextMonth').click()
        expect(days()).toHaveLength(30) // September

        at('dtpPrevMonth').click()
        at('dtpPrevMonth').click()
        expect(days()).toHaveLength(31) // July
    })

    test('writes to whichever field was opened', async () => {
        await boot([])
        at('targetDateTime').value = '2026-08-04 18:00'

        open('targetDateTime')
        dayCell(11).click()
        at('dtpApply').click()

        expect(at('targetDateTime').value).toBe('2026-08-11 18:00')
        expect(at('startDateTime').value).toBe('')
    })

    test('offers every hour and five-minute steps', async () => {
        await boot([])
        at('startDateTime').value = '2026-08-04 15:30'
        open()

        expect(document.querySelectorAll('#dtpHours .dtp-time-cell')).toHaveLength(24)
        expect(document.querySelectorAll('#dtpMinutes .dtp-time-cell')).toHaveLength(12)
    })

    // A stored 09:07 must stay selectable, or opening and confirming the picker
    // would quietly round the task's time.
    test('keeps an off-step minute in the list', async () => {
        await boot([])
        at('startDateTime').value = '2026-08-04 09:07'
        open()

        expect(pickedTime()).toEqual({ hour: '09', minute: '07' })
        expect(timeCell('dtpMinutes', 7)).toBeDefined()

        at('dtpApply').click()
        expect(at('startDateTime').value).toBe('2026-08-04 09:07')
    })
})

describe('modal dismissal', () => {
    // Clicking the backdrop used to close the task modal, discarding whatever
    // had been typed. Only the explicit controls should close it.
    test('clicking the backdrop keeps the task modal open', async () => {
        const manager = await boot([])
        manager.showModal()
        document.getElementById('taskContent').value = 'half-written note'

        document.getElementById('taskModal').click()

        expect(document.getElementById('taskModal').style.display).not.toBe('none')
        expect(document.getElementById('taskContent').value).toBe('half-written note')
    })

    test('the settings modal also survives a backdrop click', async () => {
        const manager = await boot([])
        manager.showSettingsModal()

        document.getElementById('settingsModal').click()

        expect(document.getElementById('settingsModal').style.display).not.toBe('none')
    })
})

describe('backup contents', () => {
    // jsdom's Blob has no .text(), so grab the JSON as it is handed to the
    // constructor rather than reading it back out.
    const backupOf = async (manager) => {
        let captured
        const RealBlob = window.Blob
        window.Blob = function (parts, options) {
            captured = parts.join('')
            return new RealBlob(parts, options)
        }
        window.URL.createObjectURL = jest.fn(() => 'blob:fake')
        window.URL.revokeObjectURL = jest.fn()
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

        try {
            await manager.exportData()
        } finally {
            window.Blob = RealBlob
        }
        return JSON.parse(captured)
    }

    // Tag presets and display settings live only in localStorage, so a restore
    // on a new machine used to start from scratch on both.
    test('carries tag presets and display settings', async () => {
        const manager = await boot([task('a')])
        manager.tagPresets = ['#[RED]urgent', '#work']
        manager.changeDateFormat('YYYYMMDD HHmm')

        const backup = await backupOf(manager)

        expect(backup.preferences.tagPresets).toEqual(['#[RED]urgent', '#work'])
        expect(backup.preferences.dateFormat).toBe('YYYYMMDD HHmm')
    })

    test('restores them on import', async () => {
        const manager = await boot([])

        manager.applyPreferences({
            tagPresets: ['#imported'],
            dateFormat: 'YYYY/MM/DD HH:mm',
            darkMode: true
        })

        expect(manager.tagPresets).toEqual(['#imported'])
        expect(manager.dateFormat).toBe('YYYY/MM/DD HH:mm')
        expect(localStorage.getItem('tagPresets')).toBe('["#imported"]')
        expect(manager.darkMode).toBe(true)
    })

    test('ignores an unknown date format rather than breaking rendering', async () => {
        const manager = await boot([])

        manager.applyPreferences({ dateFormat: 'NONSENSE' })

        expect(manager.dateFormat).toBe('YYYY-MM-DD HH:mm')
    })

    test('a backup without preferences imports unchanged', async () => {
        const manager = await boot([])
        const before = manager.dateFormat

        manager.applyPreferences(undefined)

        expect(manager.dateFormat).toBe(before)
    })
})

describe('multi-select', () => {
    const checkboxes = () => Array.from(document.querySelectorAll('#tasksBody .task-select'))
    const barBtn = (action) => document.querySelector(`[data-bulk="${action}"]`)
    const summary = () => document.getElementById('selectionSummary').textContent
    const pick = (id) => {
        const box = checkboxes().find((b) => b.dataset.taskId === id)
        box.checked = true
        box.dispatchEvent(new window.Event('change', { bubbles: true }))
    }

    // Actions moved out of the rows entirely; the column they used to occupy
    // took 16% of the table for buttons repeated on every single row.
    test('rows carry no action buttons and no actions column', async () => {
        await boot([task('a')])

        expect(document.querySelectorAll('#tasksBody .action-btn')).toHaveLength(0)
        expect(document.getElementById('thActions')).toBeNull()
        // select, #, start, target, tags, content, files, status
        expect(document.querySelector('#tasksBody tr').cells).toHaveLength(8)
    })

    // The bar is always present. One that appeared on selection pushed the
    // whole table down a row every time you ticked a box.
    test('the bar sits disabled until something is selected', async () => {
        await boot([task('a'), task('b')])

        expect(barBtn('complete').disabled).toBe(true)
        // No nagging placeholder: the dimmed buttons already say it.
        expect(summary()).toBe('')

        pick('a')

        expect(barBtn('complete').disabled).toBe(false)
        expect(summary()).toBe('1 selected')
    })

    // Editing or reordering more than one row at a time is meaningless.
    test('edit and reorder need exactly one selection', async () => {
        await boot([task('a'), task('b')])

        pick('a')
        expect(barBtn('edit').disabled).toBe(false)
        expect(barBtn('up').disabled).toBe(false)

        pick('b')
        expect(barBtn('edit').disabled).toBe(true)
        expect(barBtn('up').disabled).toBe(true)
        expect(barBtn('complete').disabled).toBe(false)
    })

    // Reaching edit through the bar means select, then aim for a small icon.
    // A double-click is the shortcut people expect from a table.
    test('double-clicking a row opens it for editing', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        doubleClick(document.querySelector('#tasksBody tr'))

        expect(manager.showModal).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' })
        )
    })

    // A double-click opens the editor and does nothing else. The toggle is held
    // back until a second click can be ruled out, so it never happens here -
    // toggling and undoing would show as a flicker, and toggling once would
    // leave the selection changed by an action that was not about selecting.
    test('a double-click does not touch the selection', async () => {
        const manager = await boot([task('a'), task('b')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        doubleClick(document.querySelector('#tasksBody tr'))
        await pastDoubleClick()

        expect(manager.showModal).toHaveBeenCalled()
        expect(manager.selectedTaskIds.size).toBe(0)
        expect(document.querySelector('#tasksBody tr .task-select').checked).toBe(false)
    })

    // The second click can arrive after the first toggle has already run, if
    // the pair is slower than DOUBLE_CLICK_MS. It is undone rather than left,
    // so the outcome is the same either way.
    test('a slow double-click undoes the toggle it already made', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})
        const row = document.querySelector('#tasksBody tr')

        row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }))
        await pastDoubleClick()
        expect(manager.selectedTaskIds.has('a')).toBe(true)

        row.dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 2 }))

        expect(manager.selectedTaskIds.size).toBe(0)
        expect(manager.showModal).toHaveBeenCalled()
    })

    test('a single click selects once the double-click window passes', async () => {
        const manager = await boot([task('a')])
        const row = document.querySelector('#tasksBody tr')

        row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        expect(manager.selectedTaskIds.has('a')).toBe(false)

        await pastDoubleClick()

        expect(manager.selectedTaskIds.has('a')).toBe(true)
    })

    test('double-clicking the checkbox does not open the modal', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        doubleClick(document.querySelector('#tasksBody .task-select'))

        expect(manager.showModal).not.toHaveBeenCalled()
    })

    test('no element appears or disappears when the selection changes', async () => {
        await boot([task('a')])
        const bar = document.getElementById('taskActionBar')
        const shape = () => Array.from(bar.querySelectorAll('*')).map((el) => el.tagName)
        const before = shape()

        pick('a')

        // Only the summary text and the disabled flags change, so nothing
        // below the bar moves.
        expect(shape()).toEqual(before)
    })

    test('select-all covers the rows currently shown', async () => {
        const manager = await boot([task('a'), task('b'), task('c')])

        document.getElementById('selectAllTasks').checked = true
        document.getElementById('selectAllTasks').dispatchEvent(new window.Event('change'))

        expect(manager.selectedTaskIds.size).toBe(3)
        expect(checkboxes().every((b) => b.checked)).toBe(true)
    })

    test('select-all shows a partial state when only some are picked', async () => {
        await boot([task('a'), task('b')])

        pick('a')

        expect(document.getElementById('selectAllTasks').indeterminate).toBe(true)
    })

    // Complete and delete cannot be undone, so they ask first. Moving the
    // actions to the bar once bypassed the modal entirely: runBulkAction
    // called doCompleteTask directly and nothing ever asked.
    const confirmOpen = () =>
        document.getElementById('confirmModal').style.display === 'block'
    const submitConfirm = async () => {
        document
            .getElementById('confirmForm')
            .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
        await settle()
    }

    test('completing in bulk asks once, then applies to every selected task', async () => {
        const manager = await boot([task('a'), task('b'), task('c')])
        pick('a')
        pick('c')

        await barBtn('complete').click()
        await settle()
        expect(confirmOpen()).toBe(true)
        expect(manager.tasks).toHaveLength(3)

        await submitConfirm()

        expect(manager.tasks.map((t) => t.id)).toEqual(['b'])
    })

    test('deleting in bulk asks once, then removes only the selected rows', async () => {
        const manager = await boot([task('a'), task('b'), task('c')])
        pick('b')

        await barBtn('delete').click()
        await settle()
        expect(confirmOpen()).toBe(true)

        await submitConfirm()

        expect(manager.tasks.map((t) => t.id)).toEqual(['a', 'c'])
    })

    test('cancelling the confirmation leaves everything alone', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')

        await barBtn('delete').click()
        document.getElementById('confirmCancelBtn').click()
        await settle()

        expect(manager.tasks.map((t) => t.id)).toEqual(['a', 'b'])
        expect(manager.selectedTaskIds.size).toBe(1)
    })

    test('the selection clears after completing or deleting', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')

        await barBtn('complete').click()
        await submitConfirm()

        expect(manager.selectedTaskIds.size).toBe(0)
        expect(barBtn('complete').disabled).toBe(true)
    })

    // Yesterday's work gets ticked off today all the time. Recording it as
    // today would put the history a day out.
    test('the completion time defaults to now but can be backdated', async () => {
        const manager = await boot([task('a')])
        pick('a')

        await barBtn('complete').click()
        await settle()
        const field = document.getElementById('confirmCompletedAt')
        expect(field.value).toBe(manager.formatDateTimeLocal(new Date()))

        field.value = '2026-08-01 09:00'
        await submitConfirm()

        // 고른 시각은 제 칸으로 간다. 내용 문자열에 섞어 넣던 시절에는 완료
        // 화면이 그것으로 정렬할 수 없었다. 행 자체는 사라진다.
        const logged = electronAPI.addLog.mock.calls.map((c) => c[0]).find(
            (entry) => entry.action === 'COMPLETE'
        )
        expect(logged.completedAt).toBe('2026-08-01 09:00')
        expect(logged.task.content).toBe('task a')
        expect(manager.tasks).toHaveLength(0)
    })

    test('the completion time is hidden when deleting', async () => {
        await boot([task('a')])
        pick('a')

        await barBtn('delete').click()
        await settle()

        expect(document.getElementById('confirmCompletedAtGroup').style.display).toBe('none')
    })

    // Clearing after a toggle meant undoing it needed the rows picked again,
    // so a second press looked like it did nothing at all.
    test('the selection survives a toggle so it can be pressed again', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')
        pick('b')

        await barBtn('highlight').click()
        await settle()
        expect(manager.selectedTaskIds.size).toBe(2)

        await barBtn('highlight').click()
        await settle()

        expect(manager.tasks.every((t) => !t.highlighted)).toBe(true)
    })

    // Inverting each task independently gave a result nobody could predict
    // before pressing. Both toggles now gather the selection onto the marked
    // state - highlighted for one, muted for the other.
    test('highlighting a mixed selection marks all of them', async () => {
        const manager = await boot([task('a', { highlighted: true }), task('b')])
        pick('a')
        pick('b')

        await barBtn('highlight').click()
        await settle()

        expect(manager.tasks.map((t) => !!t.highlighted)).toEqual([true, true])
    })

    test('highlighting again only clears once every one is marked', async () => {
        const manager = await boot([
            task('a', { highlighted: true }),
            task('b', { highlighted: true }),
        ])
        pick('a')
        pick('b')

        await barBtn('highlight').click()
        await settle()

        expect(manager.tasks.map((t) => !!t.highlighted)).toEqual([false, false])
    })

    test('muting a mixed selection silences all of them', async () => {
        const manager = await boot([task('a', { notificationEnabled: false }), task('b')])
        pick('a')
        pick('b')

        await barBtn('notification').click()
        await settle()

        expect(manager.tasks.map((t) => t.notificationEnabled)).toEqual([false, false])
    })

    test('unticking select-all drops the selection without touching the tasks', async () => {
        const manager = await boot([task('a'), task('b')])
        const all = document.getElementById('selectAllTasks')
        all.checked = true
        all.dispatchEvent(new window.Event('change'))

        all.checked = false
        all.dispatchEvent(new window.Event('change'))

        expect(manager.selectedTaskIds.size).toBe(0)
        expect(manager.tasks.every((t) => !t.completed)).toBe(true)
    })

    // A task removed elsewhere must not linger in the selection and get acted
    // on by the next bulk press.
    test('drops tasks that are no longer in the list', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')

        manager.tasks = manager.tasks.filter((t) => t.id !== 'a')
        manager.renderTasks()

        expect(manager.selectedTaskIds.size).toBe(0)
    })

    test('is labelled in the selected language', async () => {
        localStorage.setItem('selectedLanguage', 'ko')
        await boot([task('a')])
        pick('a')

        expect(summary()).toBe('1개 선택됨')
    })
})

// A duplicated setupEventListeners block once bound the month arrows twice, so
// a single click jumped two months. Guard the whole wiring, not just that one.
describe('event wiring', () => {
    // Asserts on the month the picker holds, not on its label. The label goes
    // through toLocaleDateString, so checking for "August" would really be
    // checking the machine's ICU data - and this test is about the wiring.
    test('binds each control exactly once', async () => {
        const manager = await boot([task('a')])

        document.getElementById('startDateTime').value = '2026-08-04 15:30'
        document.querySelector('.datetime-pick-btn[data-target="startDateTime"]').click()
        const month = () => manager.pickerMonth.getMonth()

        expect(month()).toBe(7) // 0-based: August
        document.getElementById('dtpNextMonth').click()
        expect(month()).toBe(8) // one step, not two
        document.getElementById('dtpPrevMonth').click()
        expect(month()).toBe(7)
    })

    test('a bulk button fires its action once per click', async () => {
        const manager = await boot([task('a'), task('b')])
        const box = document.querySelector('.task-select')
        box.checked = true
        box.dispatchEvent(new window.Event('change', { bubbles: true }))

        const spy = jest.spyOn(manager, 'runBulkAction')
        document.querySelector('[data-bulk="highlight"]').click()

        expect(spy).toHaveBeenCalledTimes(1)
    })
})

describe('notification state without a row button', () => {
    const flags = () => document.querySelectorAll('#tasksBody .row-flag')
    const pick = (id) => {
        const box = Array.from(document.querySelectorAll('.task-select')).find(
            (b) => b.dataset.taskId === id
        )
        box.checked = true
        box.dispatchEvent(new window.Event('change', { bubbles: true }))
    }

    // With the bell button gone from the row, muting a task had no visible
    // effect at all, so the toggle looked broken.
    test('marks a task whose notifications are off', async () => {
        await boot([task('a', { notificationEnabled: false }), task('b')])

        expect(flags()).toHaveLength(1)
        expect(document.querySelector('#tasksBody .row-flag')).not.toBeNull()
    })

    test('shows nothing when notifications are on, which is the default', async () => {
        await boot([task('a'), task('b', { notificationEnabled: true })])

        expect(flags()).toHaveLength(0)
    })

    // Regression: notificationEnabled was undefined on older tasks, and
    // !undefined is true - the same as the default - so the first click did
    // nothing at all and the toggle looked broken.
    test('the first toggle on a task that never had the flag turns it off', async () => {
        const manager = await boot([task('a')])
        expect(manager.tasks[0].notificationEnabled).toBeUndefined()
        pick('a')

        await document.querySelector('[data-bulk="notification"]').click()
        await settle()

        expect(manager.tasks[0].notificationEnabled).toBe(false)
        expect(flags()).toHaveLength(1)
    })

    test('toggling again turns it back on and clears the mark', async () => {
        const manager = await boot([task('a', { notificationEnabled: false })])
        pick('a')

        await document.querySelector('[data-bulk="notification"]').click()
        await settle()

        expect(manager.tasks[0].notificationEnabled).toBe(true)
        expect(flags()).toHaveLength(0)
    })
})

describe('action bar ordering', () => {
    test('keeps the order the row buttons used', async () => {
        await boot([task('a')])

        const order = Array.from(document.querySelectorAll('[data-bulk]')).map(
            (b) => b.dataset.bulk
        )

        expect(order).toEqual([
            'notification', 'edit', 'complete', 'delete', 'highlight', 'up', 'down'
        ])
    })

    test('carries the per-action colour classes', async () => {
        await boot([task('a')])

        expect(document.querySelector('[data-bulk="delete"]').className).toContain('bar-delete')
        expect(document.querySelector('[data-bulk="complete"]').className).toContain('bar-complete')
    })
})

describe('column-scoped search', () => {
    const rowCount = () =>
        Array.from(document.querySelectorAll('#tasksBody tr')).filter(
            (r) => !r.querySelector('.empty-message')
        ).length

    const setup = () => [
        task('a', { content: 'report', tags: '#urgent' }),
        task('b', { content: 'urgent call', tags: '#home' })
    ]

    const search = (manager, text, column = 'all') => {
        const select = document.getElementById('searchColumn')
        select.value = column
        select.dispatchEvent(new window.Event('change'))
        manager.searchQuery = text.toLowerCase()
        manager.renderTasks()
    }

    test('offers every column plus an all option', async () => {
        await boot([])

        const values = Array.from(document.getElementById('searchColumn').options).map(
            (o) => o.value
        )
        expect(values).toEqual(['all', 'start', 'target', 'tags', 'content', 'status', 'repeat'])
    })

    // "urgent" is a tag on one task and part of the content of the other, so
    // scoping is the only way to tell them apart.
    test('all columns finds both matches', async () => {
        const manager = await boot(setup())

        search(manager, 'urgent')

        expect(rowCount()).toBe(2)
    })

    test('scoping to tags finds only the tagged one', async () => {
        const manager = await boot(setup())

        search(manager, 'urgent', 'tags')

        expect(rowCount()).toBe(1)
        expect(document.getElementById('tasksBody').textContent).toContain('report')
    })

    test('scoping to content finds only the one whose text matches', async () => {
        const manager = await boot(setup())

        search(manager, 'urgent', 'content')

        expect(rowCount()).toBe(1)
        expect(document.getElementById('tasksBody').textContent).toContain('urgent call')
    })

    // Chips in the table used to jump to a search. The quick filters do that
    // job from a fixed place and hold several at once, so a chip in a row is
    // just part of the row now - brushing one while aiming for the row must
    // not replace the whole list.
    test('clicking a tag chip leaves the search alone', async () => {
        const manager = await boot(setup())

        document.querySelector('#tasksBody .tag').click()

        expect(manager.searchQuery).toBe('')
        expect(manager.searchColumn).toBe('all')
        expect(rowCount()).toBe(2)
    })

    test('clicking a status chip leaves the search alone', async () => {
        const manager = await boot(setup())

        document.querySelector('#tasksBody .status').click()

        expect(manager.searchQuery).toBe('')
        expect(manager.searchColumn).toBe('all')
    })

    test('is labelled in the selected language', async () => {
        localStorage.setItem('selectedLanguage', 'ko')
        await boot([])

        expect(document.getElementById('searchColumn').options[0].textContent).toBe('전체 컬럼')
    })
})

describe('collapsed strip status colours', () => {
    const items = () => Array.from(document.querySelectorAll('#collapsedMiniTasksBody li'))
    const soon = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString()

    // Only urgent and overdue were listed, so an in-progress or pending task
    // showed no colour at all in the strip.
    test('covers every status, not just urgent and overdue', async () => {
        const manager = await boot([
            task('waiting', { startDateTime: soon(120), targetDateTime: soon(300) }),
            task('running', { startDateTime: soon(-120), targetDateTime: soon(300) }),
            task('due', { startDateTime: soon(-120), targetDateTime: soon(30) }),
            task('late', { startDateTime: soon(-300), targetDateTime: soon(-60) })
        ])

        manager.isCollapsed = true
        manager.renderTasks()

        expect(items().map((li) => li.className)).toEqual([
            'pending', 'inprogress', 'urgent', 'overdue'
        ])
    })
})

describe('muted-notification marker placement', () => {
    // .task-content is white-space: pre-wrap, so a multi-line template put its
    // own indentation into the cell and knocked the text out of line.
    // Notifications fire relative to the target time, so the marker belongs
    // there - not in the content, which is also pre-wrap and picks up any
    // stray whitespace from the template.
    test('sits under the target time, leaving the content alone', async () => {
        await boot([task('a', { content: 'ship it', notificationEnabled: false })])

        const row = document.querySelector('#tasksBody tr')
        expect(row.cells[3].querySelector('.row-flag')).not.toBeNull()
        expect(row.querySelector('.task-content .row-flag')).toBeNull()
        expect(row.querySelector('.task-content').textContent).toBe('ship it')
    })

    test('leaves the content cell clean when notifications are on', async () => {
        await boot([task('a', { content: 'ship it' })])

        expect(document.querySelector('.task-content').textContent).toBe('ship it')
        expect(document.querySelectorAll('.row-flag')).toHaveLength(0)
    })
})

describe('history export and import', () => {
    // main.js 가 파일에 쓰는 머리와 같아야 한다
    const HEADER = 'TIMESTAMP\tACTION\tSTATUS\tTASK_ID\tSTART_TIME\tTARGET_TIME\tTAGS\tCONTENT\tATTACHMENTS\tCOMPLETED_AT\tNOTE\tOUTPUTS'
    const row = (ts, action) => `${ts}\t${action}\tPENDING\ttask-1\t\t\t\tnote`

    // The backup JSON stores each log as one escaped string, which is fine for
    // restoring and useless for pasting into a spreadsheet.
    test('flattens the dated logs into one sheet with a single header', async () => {
        const manager = await boot([])

        const tsv = manager.buildHistoryTsv({
            '2026-08-05.tsv': `${HEADER}\n${row('2026-08-05T09:00:00+09:00', 'ADD')}\n`,
            '2026-08-04.tsv': `${HEADER}\n${row('2026-08-04T09:00:00+09:00', 'COMPLETE')}\n`
        })

        const lines = tsv.trim().split('\n')
        expect(lines[0]).toBe(HEADER)
        expect(lines).toHaveLength(3)
        // Oldest first, so the sheet reads chronologically.
        expect(lines[1]).toContain('2026-08-04')
        expect(lines[2]).toContain('2026-08-05')
    })

    test('produces nothing when there is no history', async () => {
        const manager = await boot([])

        expect(manager.buildHistoryTsv({})).toBe('')
        expect(manager.buildHistoryTsv(undefined)).toBe('')
    })

    const captureDownloads = () => {
        const names = []
        window.URL.createObjectURL = jest.fn(() => 'blob:fake')
        window.URL.revokeObjectURL = jest.fn()
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            names.push(this.download)
        })
        return names
    }

    // Backup and history are separate buttons now: one JSON you restore, one
    // sheet you read. A single button dropping two files meant reading the
    // filenames to work out which was which.
    test('the backup button writes only the JSON', async () => {
        const manager = await boot([task('a')])
        electronAPI.exportData.mockResolvedValue({ tasks: [], rules: [], version: '1.2' })
        const names = captureDownloads()

        await manager.exportData()

        expect(names).toEqual([expect.stringMatching(/^tasktory-backup-.*[.]json$/)])
    })

    test('the history button writes only the sheet', async () => {
        const manager = await boot([task('a')])
        electronAPI.readLogFiles.mockResolvedValue({
            '2026-08-04.tsv': [HEADER, row('2026-08-04T09:00:00+09:00', 'ADD'), ''].join(String.fromCharCode(10))
        })
        const names = captureDownloads()

        await manager.exportHistory()

        expect(names).toEqual([expect.stringMatching(/^tasktory-history-.*[.]tsv$/)])
    })

    test('says so rather than writing an empty sheet', async () => {
        const manager = await boot([task('a')])
        electronAPI.readLogFiles.mockResolvedValue({})
        const names = captureDownloads()
        window.alert = jest.fn()

        await manager.exportHistory()

        expect(names).toEqual([])
        expect(window.alert).toHaveBeenCalled()
    })

    // A log is something the app writes and a person reads. No program takes
    // one back in, and moving machines is a matter of copying the logs folder -
    // which the History group opens for you.
    test('import takes JSON only', async () => {
        await boot([task('a')])

        expect(document.getElementById('fileInput').accept).toBe('.json')
    })
})

describe('action bar styling hooks', () => {
    // The generic .btn class dragged in padding and, in dark mode, a
    // background, border and text colour that wiped out the icon colours.
    test('bar buttons do not carry the generic btn class', async () => {
        await boot([task('a')])

        for (const button of document.querySelectorAll('[data-bulk]')) {
            expect(button.classList.contains('btn')).toBe(false)
            expect(button.classList.contains('bar-btn')).toBe(true)
        }
    })

    test('each button keeps its own colour class', async () => {
        await boot([task('a')])

        const classes = Array.from(document.querySelectorAll('[data-bulk]')).map(
            (b) => b.className.replace('bar-btn ', '')
        )
        expect(classes).toEqual([
            'bar-notification', 'bar-edit', 'bar-complete',
            'bar-delete', 'bar-highlight', 'bar-move', 'bar-move'
        ])
    })
})

describe('notification history across restarts', () => {
    const soon = (minutes) => new Date(Date.now() + minutes * 60 * 1000).toISOString()

    // notifiedTasks lived only in memory, so every relaunch re-fired the
    // 1-hour, 15-minute and overdue alerts for anything still in range.
    test('does not alert twice for the same task after a relaunch', async () => {
        const due = task('a', { startDateTime: soon(-120), targetDateTime: soon(30) })

        const first = await boot([due])
        first.startNotificationCheck.mockRestore?.()
        await first.checkUpcomingTasks()
        const alertsBefore = electronAPI.showNotification.mock.calls.length
        expect(alertsBefore).toBeGreaterThan(0)

        const second = await boot([due])
        await second.checkUpcomingTasks()

        expect(electronAPI.showNotification).not.toHaveBeenCalled()
        expect(second.notifiedTasks.size).toBeGreaterThan(0)
    })

    test('forgets tasks that are no longer in the list', async () => {
        const manager = await boot([task('a')])
        manager.notifiedTasks = new Set(['task-gone-1hour', 'a-1hour'])

        manager.rememberNotified('a-15min')

        expect([...manager.notifiedTasks].sort()).toEqual(['a-15min', 'a-1hour'])
    })

    test('survives a corrupted store', async () => {
        localStorage.setItem('notifiedTasks', 'not json')

        const manager = await boot([task('a')])

        expect(manager.notifiedTasks.size).toBe(0)
    })
})

describe('reminder lead times', () => {
    const minutesFromNow = (m) => {
        const d = new Date(Date.now() + m * 60 * 1000)
        const p = (n) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
    }

    // The badge threshold and the notification time used to be separate
    // hardcoded constants that merely happened to agree at 60 minutes. They
    // read one value now, so they cannot drift apart.
    test('the urgent badge starts at the lead time', async () => {
        const manager = await boot([
            task('early', { startDateTime: minutesFromNow(-300), targetDateTime: minutesFromNow(90) }),
            task('due', { startDateTime: minutesFromNow(-300), targetDateTime: minutesFromNow(45) })
        ])

        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('inprogress')
        expect(manager.getTaskStatus(manager.tasks[1]).status).toBe('urgent')
    })

    // One notification, not two. Once the moment is the user's to choose,
    // ringing again second-guesses the choice they made.
    test('fires once, however often it is checked', async () => {
        const manager = await boot([
            task('a', { startDateTime: minutesFromNow(-300), targetDateTime: minutesFromNow(10) })
        ])

        await manager.checkUpcomingTasks()
        await manager.checkUpcomingTasks()

        expect(electronAPI.showNotification).toHaveBeenCalledTimes(1)
    })

    // The whole point of the setting: a task that takes three hours has to go
    // red three hours out, not one.
    test('a task can widen its own window', async () => {
        const manager = await boot([
            task('a', { startDateTime: minutesFromNow(-300), targetDateTime: minutesFromNow(120) })
        ])
        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('inprogress')

        manager.tasks[0].leadMinutes = 180
        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('urgent')
    })

    // 0 is a real choice - "do not warn me" - and must survive being falsy.
    test('a lead of zero means no badge and no notification', async () => {
        const manager = await boot([
            task('a', {
                startDateTime: minutesFromNow(-300),
                targetDateTime: minutesFromNow(5),
                leadMinutes: 0
            })
        ])

        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('inprogress')
        await manager.checkUpcomingTasks()
        expect(electronAPI.showNotification).not.toHaveBeenCalled()
    })

    test('a task without its own value follows the default', async () => {
        const manager = await boot([
            task('a', { startDateTime: minutesFromNow(-300), targetDateTime: minutesFromNow(45) })
        ])
        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('urgent')

        manager.changeDefaultLead(30)

        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('inprogress')
    })

    // Number(null) is 0, and 0 is a valid choice, so a plain conversion would
    // leave anyone who never opened settings with no notifications at all.
    test('an unset default is one hour, not zero', async () => {
        const manager = await boot([task('a')])

        expect(localStorage.getItem('defaultLeadMinutes')).toBeNull()
        expect(manager.defaultLeadMinutes).toBe(60)
    })
})

describe('tasks with no deadline', () => {
    const at = (id) => document.getElementById(id)

    // Faking one with a daily repeat piles up an overdue entry for every day
    // you were never going to do it.
    test('reports an ongoing status rather than overdue', async () => {
        const manager = await boot([
            task('a', { startDateTime: '2020-01-01 09:00', targetDateTime: '' })
        ])

        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('standing')
    })

    test('is still pending before its start time', async () => {
        const manager = await boot([
            task('a', { startDateTime: '2099-01-01 09:00', targetDateTime: '' })
        ])

        expect(manager.getTaskStatus(manager.tasks[0]).status).toBe('pending')
    })

    test('never raises a notification', async () => {
        const manager = await boot([
            task('a', { startDateTime: '2020-01-01 09:00', targetDateTime: '' })
        ])
        manager.isElectron = true

        await manager.checkUpcomingTasks()

        expect(electronAPI.showNotification).not.toHaveBeenCalled()
    })

    test('saves with the target left blank', async () => {
        const manager = await boot([])
        at('startDateTime').value = '2026-09-10 09:00'
        at('targetDateTime').value = ''
        at('taskContent').value = 'keep an eye on the queue'
        at('taskPosition').value = '1'

        await manager.saveTask()
        await settle()

        expect(stored).toHaveLength(1)
        expect(stored[0].targetDateTime).toBe('')
    })

    test('still rejects a malformed target when one is given', async () => {
        jest.spyOn(window, 'alert').mockImplementation(() => {})
        const manager = await boot([])
        at('startDateTime').value = '2026-09-10 09:00'
        at('targetDateTime').value = 'nonsense'
        at('taskContent').value = 'x'
        at('taskPosition').value = '1'

        await manager.saveTask()
        await settle()

        expect(stored).toEqual([])
    })
})

describe('selecting by clicking the row', () => {
    const setup = () => [
        task('a', { content: 'first', tags: '#work' }),
        task('b', { content: 'second' })
    ]
    const rowOf = (id) =>
        Array.from(document.querySelectorAll('#tasksBody tr')).find(
            (r) => r.querySelector('.task-select')?.dataset.taskId === id
        )
    const boxOf = (id) => rowOf(id).querySelector('.task-select')

    // The checkbox alone is a small target.
    test('clicking anywhere in the row selects it', async () => {
        const manager = await boot(setup())

        rowOf('a').querySelector('.task-content').click()
        await pastDoubleClick()

        expect(manager.selectedTaskIds.has('a')).toBe(true)
        expect(boxOf('a').checked).toBe(true)
    })

    test('clicking again deselects', async () => {
        const manager = await boot(setup())
        const cell = rowOf('a').querySelector('.task-content')

        cell.click()
        cell.click()

        expect(manager.selectedTaskIds.size).toBe(0)
        expect(boxOf('a').checked).toBe(false)
    })

    // A chip is part of its row like anything else in it.
    test('clicking a chip selects the row it sits in', async () => {
        const manager = await boot(setup())

        document.querySelector('#tasksBody .tag').click()
        await pastDoubleClick()

        expect(manager.selectedTaskIds.has('a')).toBe(true)
        expect(boxOf('a').checked).toBe(true)
    })

    // The checkbox raises its own change event; the row handler must not
    // double-toggle on top of it.
    // A click on the box both flips it and bubbles to the row handler. If the
    // row handler did not stand aside, the two would cancel out.
    test('clicking the checkbox itself toggles exactly once', async () => {
        const manager = await boot(setup())
        const box = boxOf('a')

        box.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))

        expect(box.checked).toBe(true)
        expect(manager.selectedTaskIds.has('a')).toBe(true)
    })

    test('the empty-state row is not selectable', async () => {
        await boot([])

        document.querySelector('#tasksBody .empty-message').click()

        expect(document.querySelectorAll('.task-select')).toHaveLength(0)
    })
})

// A chip only reaches you once you have found a row carrying it. The quick
// filters put the same handles in a fixed place above the table.
describe('quick filters', () => {
    const chips = () =>
        Array.from(document.querySelectorAll('#quickFilters .quick-chip')).map(
            (c) => c.textContent
        )
    const chip = (text) =>
        Array.from(document.querySelectorAll('#quickFilters .quick-chip')).find(
            (c) => c.textContent === text
        )

    test('offers the statuses and tags actually present, plus an escape hatch', async () => {
        await boot([
            task('a', { tags: '#meeting' }),
            task('b', { tags: '#meeting #urgent' })
        ])

        expect(chips()[0]).toBe('All')
        expect(chips()).toContain('#meeting')
        expect(chips()).toContain('#urgent')
        // Listed once however many rows carry it.
        expect(chips().filter((c) => c === '#meeting')).toHaveLength(1)
    })

    // Offering a filter that matches nothing is just a button that empties
    // the table.
    test('lists nothing for a status no task is in', async () => {
        await boot([task('a', { tags: '#meeting' })])

        expect(chips()).not.toContain('Completed')
    })

    test('a chip filters, and the column follows it', async () => {
        const manager = await boot([
            task('a', { tags: '#meeting' }),
            task('b', { tags: '#urgent' })
        ])

        chip('#meeting').click()

        expect([...manager.quickFilters.tags]).toEqual(['#meeting'])
        expect(document.getElementById('searchInput').value).toBe('')
        expect(rows()).toHaveLength(1)
    })

    // One filter at a time makes every second click undo the first.
    test('several chips stack: OR within a kind, AND across kinds', async () => {
        const manager = await boot([
            task('a', { tags: '#meeting' }),
            task('b', { tags: '#urgent' }),
            task('c', { tags: '#other' })
        ])

        chip('#meeting').click()
        chip('#urgent').click()

        expect(rows()).toHaveLength(2)

        const status = manager.getTaskStatus(manager.tasks[0]).text
        chip(status).click()

        expect([...manager.quickFilters.status]).toEqual([status])
        expect(rows()).toHaveLength(2)
    })

    test('clicking an active chip turns it off again', async () => {
        const manager = await boot([task('a', { tags: '#meeting' }), task('b')])

        chip('#meeting').click()
        chip('#meeting').click()

        expect(manager.quickFilters.tags.size).toBe(0)
        expect(rows()).toHaveLength(2)
    })

    // Emptying the table with a filter and then claiming everything is done is
    // simply untrue.
    test('an empty result says no matches, not all completed', async () => {
        const manager = await boot([task('a', { tags: '#meeting' })])
        manager.quickFilters.tags.add('#nothing')
        manager.renderTasks()

        expect(document.querySelector('#tasksBody .empty-message').textContent.trim()).toBe(
            'No tasks found matching your search.'
        )
    })

    test('the active chip is marked so the current filter is visible', async () => {
        await boot([task('a', { tags: '#meeting' }), task('b', { tags: '#urgent' })])

        chip('#meeting').click()

        expect(chip('#meeting').className).toContain('active')
        expect(chip('All').className).not.toContain('active')
    })

    test('All clears every filter and goes back to every row', async () => {
        const manager = await boot([
            task('a', { tags: '#meeting' }),
            task('b', { tags: '#urgent' })
        ])
        chip('#meeting').click()
        manager.searchQuery = 'zzz'

        chip('All').click()

        expect(manager.searchQuery).toBe('')
        expect(manager.quickFilters.tags.size).toBe(0)
        expect(rows()).toHaveLength(2)
    })

    // Leaving the column narrowed after a clear meant the next word typed was
    // quietly searched in that one column only.
    test('clearing resets the column back to all', async () => {
        const manager = await boot([task('a', { tags: '#meeting' })])
        const column = document.getElementById('searchColumn')
        column.value = 'tags'
        column.dispatchEvent(new window.Event('change', { bubbles: true }))

        chip('All').click()

        expect(manager.searchColumn).toBe('all')
        expect(document.getElementById('searchColumn').value).toBe('all')
    })
})

// main.js holds the opacity in a plain variable, so nothing survived a restart
// unless the renderer stores it and pushes it back on start-up.
describe('unfocused opacity', () => {
    test('is restored and re-applied on start-up', async () => {
        localStorage.setItem('unfocusedOpacity', '0.5')

        const manager = await boot([task('a')])

        expect(manager.unfocusedOpacity).toBe(0.5)
        expect(electronAPI.setUnfocusedOpacity).toHaveBeenCalledWith(0.5)
        expect(document.getElementById('settingsOpacitySlider').value).toBe('0.5')
    })

    test('moving the slider stores the value', async () => {
        const manager = await boot([task('a')])
        const slider = document.getElementById('settingsOpacitySlider')

        slider.value = '0.7'
        slider.dispatchEvent(new window.Event('input', { bubbles: true }))

        expect(localStorage.getItem('unfocusedOpacity')).toBe('0.7')
        expect(manager.unfocusedOpacity).toBe(0.7)
    })

    // A value near zero makes the window invisible with no way back.
    test('ignores a stored value outside the slider range', async () => {
        localStorage.setItem('unfocusedOpacity', '0')

        const manager = await boot([task('a')])

        expect(manager.unfocusedOpacity).toBe(1)
    })

    test('travels in the backup', async () => {
        const manager = await boot([task('a')])
        manager.changeUnfocusedOpacity(0.6)

        expect(manager.collectPreferences().unfocusedOpacity).toBe(0.6)
    })
})

// A list answers "what is there"; a calendar answers "when does it pile up".
// View-only, with one deliberate hole: a chip opens the editor on a double
// click. Nothing else in a cell reacts.
// 끝낸 일은 활성 목록에서 사라지므로 메모리에는 없다. TSV 로그가 유일한 기록이고,
// 일일 카운터와 호버 목록이 이미 그것을 읽는다 - 셋이 같은 파서를 지나므로 서로
// 다른 답을 낼 수가 없다. 읽기 전용이다: 완료 취소도 메모 수정도 없다.
// jsdom 에는 레이아웃이 없어 getBoundingClientRect 가 늘 0 이다. 그래서 여기서는
// "무엇을 기억하고 무엇을 되돌리는가"만 본다 - 끌었을 때 실제로 몇 px 이 되는지는
// scripts/check-ui.js 가 진짜 Chromium 에서 잰다.
describe('column widths the user set', () => {
    const table = () => document.getElementById('tasksTable')
    const th = (id) => document.getElementById(id)

    beforeEach(() => localStorage.removeItem('columnWidths'))

    test('every column but the last gets something to drag', async () => {
        await boot([task('a')])

        const headers = [...table().tHead.rows[0].cells]
        expect(headers.slice(0, -1).every((one) => one.querySelector('.col-grip'))).toBe(true)
        // 마지막 칸에는 없다 - 가져올 다음 칸이 없다.
        expect(headers[headers.length - 1].querySelector('.col-grip')).toBeNull()
    })

    test('nothing is written until someone drags', async () => {
        await boot([task('a')])

        expect(localStorage.getItem('columnWidths')).toBeNull()
        expect(th('thStartTime').style.width).toBe('')
    })

    test('a saved width is put back on the next render', async () => {
        const manager = await boot([task('a')])
        const key = manager.columnLayoutKey(table())
        localStorage.setItem('columnWidths', JSON.stringify({
            [key]: { thStartTime: '22.000%', thTargetTime: '8.000%' }
        }))

        manager.renderTasks()

        expect(th('thStartTime').style.width).toBe('22%')
        expect(th('thTargetTime').style.width).toBe('8%')
    })

    // 첨부 컬럼이 나왔다 들어갔다 하므로 칸 구성이 두 가지다. 한 벌로 기억하면
    // 첨부가 나타나는 순간 합이 100%를 넘는다.
    test('the two column sets are remembered apart', async () => {
        const manager = await boot([task('a')])
        const plain = manager.columnLayoutKey(table())

        manager.tasks = [task('a', { attachments: [{ name: 'x', path: '/x' }] })]
        manager.renderTasks()
        const withFiles = manager.columnLayoutKey(table())

        expect(withFiles).not.toBe(plain)
        expect(withFiles).toContain('has-attachments')
    })

    // 끌어 둔 폭이 첨부가 왔다 간 뒤에도 남아야 한다.
    test('a width survives the attachment column coming and going', async () => {
        const manager = await boot([task('a')])
        const key = manager.columnLayoutKey(table())
        localStorage.setItem('columnWidths', JSON.stringify({ [key]: { thStartTime: '22.000%' } }))

        manager.tasks = [task('a', { attachments: [{ name: 'x', path: '/x' }] })]
        manager.renderTasks()
        expect(th('thStartTime').style.width).toBe('')

        manager.tasks = [task('a')]
        manager.renderTasks()
        expect(th('thStartTime').style.width).toBe('22%')
    })

    test('double clicking a grip puts the whole row back to the defaults', async () => {
        const manager = await boot([task('a')])
        const key = manager.columnLayoutKey(table())
        localStorage.setItem('columnWidths', JSON.stringify({ [key]: { thStartTime: '22.000%' } }))
        manager.renderTasks()

        th('thStartTime').querySelector('.col-grip')
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))

        expect(th('thStartTime').style.width).toBe('')
        expect(JSON.parse(localStorage.getItem('columnWidths'))[key]).toBeUndefined()
    })

    // 손잡이는 정렬 헤더 위에 얹혀 있다. 끄는 것과 누르는 것은 다른 일이다.
    test('using a grip does not also sort the column', async () => {
        const manager = await boot([task('a')])

        const grip = th('thStartTime').querySelector('.col-grip')
        grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 100 }))
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 130 }))
        grip.dispatchEvent(new MouseEvent('click', { bubbles: true }))

        expect(manager.sortBy).toBeNull()
    })

    test('the completed table gets grips of its own', async () => {
        const manager = await boot([])
        document.getElementById('completionCounter').click()
        await settle()

        expect(document.querySelector('#doneTable .col-grip')).not.toBeNull()
        expect(manager.columnLayoutKey(document.getElementById('doneTable')))
            .toContain('doneTable')
    })
})

// 결과물은 끝내면서 남기는 것이라 확인창이 그 자리다. 편집을 열어 붙이고 다시
// 완료를 누르는 것은 순서가 거꾸로다 - 결과물은 시작할 때 존재하지 않는다.
describe('what came out, left at the moment of completing', () => {
    const openComplete = async (ids) => {
        const manager = await boot(ids.map((id) => task(id)))
        for (const id of ids) manager.toggleTaskSelection(id, true)
        manager.showConfirmModal('complete', ids)
        await settle()
        return manager
    }

    test('completing one task offers somewhere to put the result', async () => {
        await openComplete(['a'])

        expect(document.getElementById('confirmOutputsGroup').style.display).not.toBe('none')
    })

    // 다섯 건을 한꺼번에 완료하면서 파일 하나를 붙이면 그것이 어느 것의
    // 결과인지 적을 자리가 없다. 편집이 "정확히 하나"를 요구하는 것과 같다.
    test('completing several does not, because it could not say whose it is', async () => {
        await openComplete(['a', 'b'])

        expect(document.getElementById('confirmOutputsGroup').style.display).toBe('none')
    })

    test('deleting never offers it', async () => {
        const manager = await boot([task('a')])
        manager.showConfirmModal('delete', ['a'])
        await settle()

        expect(document.getElementById('confirmOutputsGroup').style.display).toBe('none')
    })

    test('a chosen file is listed, counted, and can be taken back off', async () => {
        const manager = await openComplete(['a'])
        electronAPI.pickAttachments.mockResolvedValue([
            { name: 'week34.docx', path: '/out/week34.docx' }
        ])

        document.getElementById('outputPickBtn').click()
        await settle()

        expect([...document.querySelectorAll('#outputList .attachment-open')]
            .map((one) => one.textContent)).toEqual(['week34.docx'])
        expect(document.getElementById('labelConfirmOutputs').textContent).toContain('(1)')

        document.querySelector('#outputList [data-remove]').click()
        await settle()
        expect(document.querySelectorAll('#outputList .attachment-item')).toHaveLength(0)
    })

    // 편집 창의 첨부와 다르게 생기면 같은 것을 다르게 다뤄야 하는 줄 알게 된다.
    test('a row looks and behaves like the edit form does', async () => {
        const manager = await openComplete(['a'])
        electronAPI.pickAttachments.mockResolvedValue([
            { name: 'week34.docx', path: '/out/week34.docx' }
        ])
        document.getElementById('outputPickBtn').click()
        await settle()

        const item = document.querySelector('#outputList .attachment-item')
        expect(item.dataset.path).toBe('/out/week34.docx')
        expect(item.querySelector('[data-open]')).not.toBeNull()
        expect(item.querySelector('[data-reveal]')).not.toBeNull()
        expect(item.querySelector('[data-remove]')).not.toBeNull()

        item.querySelector('[data-open]').click()
        await settle()
        expect(electronAPI.openAttachment).toHaveBeenCalledWith('/out/week34.docx')

        item.querySelector('[data-reveal]').click()
        await settle()
        expect(electronAPI.revealAttachment).toHaveBeenCalledWith('/out/week34.docx')
    })

    // 점선 칸에만 맞춰 떨어뜨리게 하면 대부분 빗나간다. 받는 자리는 창 전체다 -
    // 편집 창이 이미 그렇게 배웠고, 빗나간 드롭은 Chromium 이 그 파일로
    // 이동해 버려 앱이 통째로 날아간다.
    test('a file dropped anywhere in the dialog is taken', async () => {
        await openComplete(['a'])
        electronAPI.pathForFile.mockReturnValue('/out/dropped.docx')

        const drop = new Event('drop', { bubbles: true, cancelable: true })
        drop.dataTransfer = { files: [{ name: 'dropped.docx' }] }
        // 점선 칸이 아니라 창의 다른 구석에 떨어뜨린다
        document.getElementById('confirmDetails').dispatchEvent(drop)
        await settle()

        expect([...document.querySelectorAll('#outputList .attachment-open')]
            .map((one) => one.textContent)).toEqual(['dropped.docx'])
        expect(drop.defaultPrevented).toBe(true)
    })

    test('the same file twice is once', async () => {
        const manager = await openComplete(['a'])
        electronAPI.pickAttachments.mockResolvedValue([
            { name: 'a.docx', path: '/out/a.docx' }
        ])

        document.getElementById('outputPickBtn').click()
        await settle()
        document.getElementById('outputPickBtn').click()
        await settle()

        expect(document.querySelectorAll('#outputList .attachment-item')).toHaveLength(1)
    })

    // 앞 완료에서 고른 것이 다음 완료에 남아 있으면 안 된다.
    test('the box starts empty every time it opens', async () => {
        const manager = await openComplete(['a'])
        electronAPI.pickAttachments.mockResolvedValue([{ name: 'a.docx', path: '/out/a.docx' }])
        document.getElementById('outputPickBtn').click()
        await settle()

        manager.hideConfirmModal()
        manager.showConfirmModal('complete', ['a'])
        await settle()

        expect(manager.pendingOutputs).toEqual([])
        expect(document.querySelectorAll('#outputList .attachment-item')).toHaveLength(0)
    })

    test('confirming sends it to the log', async () => {
        const manager = await openComplete(['a'])
        electronAPI.pickAttachments.mockResolvedValue([
            { name: 'week34.docx', path: '/out/week34.docx' }
        ])
        document.getElementById('outputPickBtn').click()
        await settle()

        document.getElementById('confirmActionBtn').click()
        await settle()

        const logged = electronAPI.addLog.mock.calls.map((c) => c[0])
            .find((entry) => entry.action === 'COMPLETE')
        expect(logged.outputs).toEqual([{ name: 'week34.docx', path: '/out/week34.docx' }])
    })
})

// 결과물이 먼저 서고 입력물이 그 아래에 온다. "무엇을 했는가"에 답하는 것은
// 결과물이고, 입력물은 그 일에 쓴 것이다.
describe('telling the result from what went into it', () => {
    const openDone = async (rows) => {
        const manager = await boot([])
        electronAPI.getCompletedRange.mockResolvedValue(rows)
        manager.viewMode = 'completed'
        manager.applyViewMode()
        manager.renderTasks()
        await settle()
        return manager
    }
    const row = (extra) => ({
        day: '2026-08-22', timestamp: '2026-08-22T09:00:00+09:00', taskId: 't',
        startTime: '2026-08-22 08:00', targetTime: '2026-08-22 18:00', tags: '',
        content: '주간 보고서', attachments: [], completedAt: '2026-08-22 17:00',
        note: '', outputs: [], ...extra
    })

    test('the result stands first and stands out', async () => {
        await openDone([row({
            attachments: [{ name: 'form.xlsx', path: '/docs/form.xlsx' }],
            outputs: [{ name: 'week34.docx', path: '/out/week34.docx' }]
        })])

        const links = [...document.querySelectorAll('#doneBody .attach-link')]
        expect(links.map((one) => one.textContent)).toEqual(['week34.docx', 'form.xlsx'])
        expect(links[0].classList.contains('is-output')).toBe(true)
        expect(links[1].classList.contains('is-output')).toBe(false)
    })

    // 표시는 새로 생긴 쪽만 갖는다. 그러지 않으면 결과물이 없는 기존 기록이
    // 이유 없이 달라 보인다.
    test('a row from before this existed looks exactly as it did', async () => {
        await openDone([row({ attachments: [{ name: 'old.pdf', path: '/docs/old.pdf' }] })])

        const link = document.querySelector('#doneBody .attach-link')
        expect(link.textContent).toBe('old.pdf')
        expect(link.classList.contains('is-output')).toBe(false)
    })

    test('a result opens like any other file', async () => {
        await openDone([row({ outputs: [{ name: 'week34.docx', path: '/out/week34.docx' }] })])

        document.querySelector('#doneBody .attach-link').click()
        await settle()

        expect(electronAPI.openAttachment).toHaveBeenCalledWith('/out/week34.docx')
    })
})

describe('the completed view', () => {
    const done = (day, content, extra = {}) => ({
        day,
        timestamp: `${day}T09:00:00+09:00`,
        taskId: extra.id || ('t-' + content),
        startTime: extra.startTime === undefined ? `${day} 08:00` : extra.startTime,
        targetTime: extra.targetTime === undefined ? `${day} 18:00` : extra.targetTime,
        tags: extra.tags || '',
        content,
        attachments: extra.attachments || [],
        completedAt: extra.completedAt === undefined ? `${day} 17:00` : extra.completedAt,
        note: extra.note || ''
    })

    const openDone = async (rows) => {
        const manager = await boot([])
        electronAPI.getCompletedRange.mockResolvedValue(rows)
        manager.viewMode = 'completed'
        manager.applyViewMode()
        manager.renderTasks()
        await settle()
        return manager
    }
    const cells = () => [...document.querySelectorAll('#doneBody tr')]
        .map((tr) => [...tr.cells].map((td) => td.textContent.trim()))
    // 메모가 내용 칸 안에 들어 있으므로, 내용만 견줄 때는 첫 줄만 본다.
    const contents = () => [...document.querySelectorAll('#doneBody .task-content')]
        .map((td) => td.childNodes[0].textContent.trim())
    const header = (key) =>
        document.querySelector(`#doneTable thead [data-done-sort="${key}"]`)

    // 완료는 "보기"가 아니라 "가는 곳"이다. 카운터가 이미 오늘 몇 건인지 말하고
    // 있으니 눌러서 더 보는 것은 배울 것이 없고, 새 아이콘은 뜻을 익혀야 한다.
    test('the counter is the way in', async () => {
        const manager = await boot([])

        document.getElementById('completionCounter').click()
        await settle()

        expect(manager.viewMode).toBe('completed')
        expect(document.getElementById('completedView').style.display).not.toBe('none')
    })

    // 달력을 보다 들어왔는데 목록으로 나오면 왔던 자리를 잃는다.
    test('leaving puts you back in the view you came from', async () => {
        const manager = await boot([])
        manager.toggleViewMode()
        expect(manager.viewMode).toBe('calendar')

        document.getElementById('completionCounter').click()
        await settle()
        document.getElementById('completionCounter').click()
        await settle()

        expect(manager.viewMode).toBe('calendar')
    })

    test('pressing the counter again comes back out', async () => {
        const manager = await boot([])

        document.getElementById('completionCounter').click()
        await settle()
        document.getElementById('completionCounter').click()
        await settle()

        expect(manager.viewMode).toBe('list')
    })

    // 완료는 저장되는 보기가 아니다. 들렀다 나오는 곳이라, 다음 실행에서
    // 거기부터 시작하면 목록이 사라진 것처럼 보인다.
    test('it is not remembered across launches', async () => {
        const manager = await boot([])
        document.getElementById('completionCounter').click()
        await settle()

        expect(localStorage.getItem('viewMode')).not.toBe('completed')

        const again = await boot([])
        expect(again.viewMode).toBe('list')
    })

    // 완료 화면에서는 보기 전환도 접기도 할 일이 없다. 꺼진 채로 두는 대신
    // 감춘다 - 눌리지 않는 버튼은 왜 안 눌리는지 물어보게 만들지만, 없는 버튼은
    // 아무것도 묻지 않는다.
    test('the view toggle and collapse are not on screen while it is open', async () => {
        const manager = await boot([])

        document.getElementById('completionCounter').click()
        await settle()
        expect(document.getElementById('viewModeBtn').style.display).toBe('none')
        expect(document.getElementById('collapseBtn').style.display).toBe('none')

        document.getElementById('completionCounter').click()
        await settle()
        expect(document.getElementById('viewModeBtn').style.display).not.toBe('none')
        expect(document.getElementById('collapseBtn').style.display).not.toBe('none')
    })

    // 버튼을 감춰 놓고 단축키로만 되게 두면 화면에 없는 동작이 키에만 살아
    // 있는 셈이다. 접힌 스트립은 "다음에 뭘 하지"에 답하는 자리라 끝낸 일과
    // 상관이 없다.
    test('the collapse shortcut does nothing while it is open', async () => {
        const manager = await boot([])
        document.getElementById('completionCounter').click()
        await settle()

        manager.toggleCollapse()
        await settle()

        expect(manager.isCollapsed).toBe(false)
        expect(manager.viewMode).toBe('completed')
    })

    // 나온 뒤에는 다시 듣는다.
    test('and works again once you leave', async () => {
        const manager = await boot([])
        document.getElementById('completionCounter').click()
        await settle()
        document.getElementById('completionCounter').click()
        await settle()

        manager.toggleCollapse()
        await settle()

        expect(manager.isCollapsed).toBe(true)
    })

    test('reads the log, not the task list', async () => {
        await openDone([done('2026-08-20', '계약서 확인')])

        expect(electronAPI.getCompletedRange).toHaveBeenCalled()
        expect(cells()[0][4]).toContain('계약서 확인')
    })

    // 기본은 최근 30일. "이번 달 뭐 했지" 에 답하는 폭이다.
    test('asks for the last thirty days, ending today', async () => {
        await openDone([])

        const [from, to] = electronAPI.getCompletedRange.mock.calls[0]
        expect(to).toBe(formatKey(new Date()))
        const days = (new Date(to) - new Date(from)) / 86400000
        expect(days).toBe(29)
    })

    // 화면에 적히는 것이 완료 시각이므로 그것으로 줄을 세워야 한다. TIMESTAMP 로
    // 세우면 소급해 체크한 줄이 엉뚱한 자리에 앉는데, 옆에는 완료 시각이 적혀
    // 있어 정렬이 깨진 것으로 보인다.
    test('sorts by the completion time it shows, newest first', async () => {
        await openDone([
            done('2026-08-21', '아침에 끝냄', { completedAt: '2026-08-21 09:00' }),
            done('2026-08-21', '저녁에 끝냄', { completedAt: '2026-08-21 20:00' }),
            done('2026-08-20', '어제 끝냄', { completedAt: '2026-08-20 12:00' })
        ])

        expect(contents()).toEqual(['저녁에 끝냄', '아침에 끝냄', '어제 끝냄'])
    })

    // 완료 시각이 없던 옛 줄도 자리를 잡아야 한다.
    test('falls back to the timestamp when the completion time is missing', async () => {
        await openDone([
            done('2026-08-19', '옛 줄', { completedAt: '' }),
            done('2026-08-21', '새 줄')
        ])

        expect(contents()).toEqual(['새 줄', '옛 줄'])
    })

    // 시작 시간은 로그에 있는데 화면에서 빠져 있었다.
    test('shows the start time as well as the target', async () => {
        await openDone([done('2026-08-20', '계약서 확인')])

        expect(cells()[0][1]).toContain('2026-08-20 08:00')
        expect(cells()[0][2]).toContain('2026-08-20 18:00')
    })

    // 메모는 대부분 비어 있고, 있을 때는 그 작업에 딸린 말이다. 칸을 하나 더
    // 내주는 것보다 내용 밑에 붙는 편이 폭도 덜 들고 읽기에도 자연스럽다.
    test('the note sits under the content, not in a column of its own', async () => {
        await openDone([done('2026-08-20', '계약서 확인', { note: '법무팀 전달' })])

        const content = document.querySelector('#doneBody .task-content')
        expect(content.querySelector('.done-note').textContent).toBe('법무팀 전달')
        expect(document.querySelectorAll('#doneBody tr')[0].cells).toHaveLength(6)
    })

    test('a row with no note grows nothing extra', async () => {
        await openDone([done('2026-08-20', '계약서 확인')])

        expect(document.querySelector('#doneBody .done-note')).toBeNull()
    })

    // 로그에는 경로만 적히지만 이름은 언제나 그 마지막 조각이라, main.js 가
    // 되짚어 목록과 같은 {name, path} 로 준다.
    test('lists attachment names, each opening its file', async () => {
        await openDone([done('2026-08-20', '계약서 확인', {
            attachments: [{ name: '계약서.docx', path: 'C:/docs/계약서.docx' }]
        })])

        const link = document.querySelector('#doneBody .attach-link')
        expect(link.textContent).toBe('계약서.docx')
        link.click()
        await settle()

        expect(electronAPI.openAttachment).toHaveBeenCalledWith('C:/docs/계약서.docx')
    })

    // 완료한 일회성 작업은 행이 지워지므로 시간이 지나면 파일 상당수가 사라져
    // 있다. 화면 절반에 취소선이 그이면 정보가 아니라 소음이다.
    test('it does not go asking the OS whether old files are still there', async () => {
        await openDone([done('2026-08-20', 'a', {
            attachments: [{ name: 'x.pdf', path: '/docs/x.pdf' }]
        })])

        expect(electronAPI.checkAttachments).not.toHaveBeenCalled()
    })

    // 표와 같은 방식으로 시간 머리를 누른다. 다만 여기에는 "원래 순서"가 없다 -
    // 사람이 배열한 차례가 없고 로그 순서는 곧 완료 순서다.
    test('pressing a time header sorts by it, newest first', async () => {
        const manager = await openDone([
            done('2026-08-20', '먼저 시작', { startTime: '2026-08-20 07:00' }),
            done('2026-08-21', '나중 시작', { startTime: '2026-08-21 07:00' })
        ])

        manager.cycleDoneSort('startTime')
        await settle()
        expect(contents()).toEqual(['나중 시작', '먼저 시작'])

        manager.cycleDoneSort('startTime')
        await settle()
        expect(contents()).toEqual(['먼저 시작', '나중 시작'])
    })

    test('the sorted header says which way it went', async () => {
        const manager = await openDone([done('2026-08-20', 'a')])

        expect(header('completedAt').classList.contains('sorted')).toBe(true)
        expect(header('completedAt').classList.contains('descending')).toBe(true)

        manager.cycleDoneSort('targetTime')
        await settle()

        expect(header('completedAt').classList.contains('sorted')).toBe(false)
        expect(header('targetTime').classList.contains('sorted')).toBe(true)
    })

    // 값이 없는 줄이 방향에 따라 위아래로 옮겨 다니면 사라진 것처럼 보인다.
    test('rows with no value for that column stay at the end either way', async () => {
        const manager = await openDone([
            done('2026-08-20', '목표 있음'),
            done('2026-08-20', '목표 없음', { targetTime: '' })
        ])

        manager.cycleDoneSort('targetTime')
        await settle()
        expect(contents()).toEqual(['목표 있음', '목표 없음'])

        manager.cycleDoneSort('targetTime')
        await settle()
        expect(contents()).toEqual(['목표 있음', '목표 없음'])
    })

    // 완료 시각이 적히지 않던 시절의 줄이 있다. 빈 칸으로 두면 "기록이 없다"로
    // 읽히지만 기록은 있다 - 그때는 TIMESTAMP 가 곧 완료한 순간이었다.
    test('a row with no completion time falls back to when it was logged', async () => {
        await openDone([{
            ...done('2026-08-11', '옛날 줄', { completedAt: '' }),
            timestamp: '2026-08-11T07:27:48+09:00'
        }])

        expect(cells()[0][0]).toContain('2026-08-11 07:27')
    })

    // 표의 태그와 완료 화면의 칩이 다르게 보이면 같은 태그로 읽히지 않는다.
    test('the tag chips are filled the same way the table fills them', async () => {
        await openDone([done('2026-08-20', 'a', { tags: '#[BLUE]업무' })])

        const chip = document.querySelector('#quickFilters [data-done-tag]')
        const inRow = document.querySelector('#doneBody .task-tags .tag')
        const background = (el) => el.style.backgroundColor
        expect(background(chip)).toBe(background(inRow))
        expect(background(chip)).not.toBe('transparent')
        expect(background(chip)).not.toBe('')
    })

    // 엔터로만 먹으면 친 사람은 알아도 처음 보는 사람은 모른다.
    test('leaving the field applies it, without pressing Enter', async () => {
        const manager = await openDone([])

        const field = document.getElementById('doneFrom')
        field.value = '2026-01-01'
        field.dispatchEvent(new Event('blur'))
        await settle()

        expect(electronAPI.getCompletedRange.mock.calls.slice(-1)[0][0]).toBe('2026-01-01')
    })

    // 대입은 이벤트를 내지 않는다. 선택기로 고른 값이 듣는 쪽에 닿지 않으면
    // 고르고 나서 엔터를 한 번 더 쳐야 한다.
    test('a date picked from the calendar applies straight away', async () => {
        const manager = await openDone([])

        manager.openDateTimePicker('doneFrom')
        manager.pickerDate = new Date(2026, 0, 1)
        manager.applyDateTimePicker()
        await settle()

        expect(electronAPI.getCompletedRange.mock.calls.slice(-1)[0][0]).toBe('2026-01-01')
    })

    // 날짜만 받는 칸에서 시각을 고를 수 있는데 확인하면 사라지는 것이 제일 나쁘다.
    test('the picker hides its time column for a date-only field', async () => {
        const manager = await openDone([])

        manager.openDateTimePicker('doneFrom')
        expect(document.querySelector('.dtp-time').style.display).toBe('none')

        manager.closeDateTimePicker()
        manager.showModal()
        manager.openDateTimePicker('startDateTime')
        expect(document.querySelector('.dtp-time').style.display).not.toBe('none')
    })

    // 화면만 바뀌면 목록을 거른 것인지 다른 데이터인지 알 수가 없다. 카운터가
    // 이미 '완료'라고 적혀 있으므로 제목을 한 번 더 두는 대신, 들어온 그 문이
    // 눌린 채로 남는다 - 그것이 곧 나가는 문이기도 하다.
    test('the counter stays lit while it is open, and is the way out', async () => {
        await boot([])
        const counter = document.getElementById('completionCounter')

        counter.click()
        await settle()
        expect(counter.classList.contains('is-open')).toBe(true)

        counter.click()
        await settle()
        expect(counter.classList.contains('is-open')).toBe(false)
    })

    // 그리기마다 읽으면 검색어 한 글자에 로그 전체를 다시 훑는다. 3년치에서
    // 글자당 160~185ms 로 재였고, 읽어 둔 것으로 거르면 10ms 다.
    test('filtering and sorting do not go back to disk', async () => {
        const manager = await openDone([
            done('2026-08-20', '계약서'), done('2026-08-20', '예산안')
        ])
        expect(electronAPI.getCompletedRange).toHaveBeenCalledTimes(1)

        manager.searchQuery = '계'
        await manager.renderCompletedView()
        manager.searchQuery = '계약'
        await manager.renderCompletedView()
        manager.doneSort = { by: 'targetTime', asc: true }
        await manager.renderCompletedView()

        expect(electronAPI.getCompletedRange).toHaveBeenCalledTimes(1)
        expect(contents()).toEqual(['계약서'])
    })

    test('changing the period does go back to disk', async () => {
        const manager = await openDone([done('2026-08-20', 'a')])
        expect(electronAPI.getCompletedRange).toHaveBeenCalledTimes(1)

        manager.setDoneWindow(7)
        await manager.renderCompletedView()

        expect(electronAPI.getCompletedRange).toHaveBeenCalledTimes(2)
    })

    // 가져오기는 로그 파일까지 덮어쓴다. 이력이 통째로 달라지는 유일한 자리다.
    test('importing a backup drops what was read', async () => {
        const manager = await openDone([done('2026-08-20', 'a')])
        const before = electronAPI.getCompletedRange.mock.calls.length

        // 가져오기는 되돌릴 수 없어 한 번 묻는다. jsdom 에는 그 대화상자가 없다.
        window.confirm = () => true
        window.alert = () => {}
        await manager.importData(new File(
            [JSON.stringify({ tasks: [], rules: [], logFiles: {} })],
            'backup.json', { type: 'application/json' }))
        // FileReader 의 onload 는 마이크로태스크가 아니라 실제 한 박자 뒤다.
        // settle() 로는 닿지 않는다.
        for (let i = 0; i < 40 && !electronAPI.importData.mock.calls.length; i++) {
            await new Promise((r) => setTimeout(r, 10))
        }
        await settle()

        expect(electronAPI.importData).toHaveBeenCalled()
        // 버린 뒤 곧바로 다시 그리므로 캐시는 다시 차 있다. 물어야 할 것은
        // 그것이 가져오기 뒤에 새로 읽은 것인가다.
        expect(electronAPI.getCompletedRange.mock.calls.length).toBeGreaterThan(before)
    })

    // 방금 하나 늘었다. 버리지 않으면 옛 목록을 계속 보여준다.
    test('completing something drops what was read', async () => {
        const manager = await openDone([done('2026-08-20', 'a')])
        manager.closeCompletedView()

        expect(manager.doneCache).not.toBeNull()
        await manager.doCompleteTask('nope', '', '')
        manager.tasks = [task('t')]
        await manager.doCompleteTask('t', '', '2026-08-20 10:00')

        expect(manager.doneCache).toBeNull()
    })

    // 스크롤로 몇 백 줄을 훑게 두면 어디까지 봤는지 놓친다. 목록과 같은 페이저다.
    test('pages the same way the list does', async () => {
        const manager = await openDone(Array.from({ length: 25 }, (_, i) =>
            done('2026-08-20', 'row' + i, { completedAt: `2026-08-20 ${String(i % 24).padStart(2, '0')}:00` })))
        manager.tasksPerPage = 10
        manager.donePage = 1
        manager.renderCompletedView()
        await settle()

        expect(contents()).toHaveLength(10)
        expect(document.getElementById('paginationTotal').textContent).toContain('25')

        document.getElementById('nextPageBtn').click()
        await settle()
        expect(manager.donePage).toBe(2)
        expect(contents()).toHaveLength(10)

        document.getElementById('nextPageBtn').click()
        await settle()
        expect(contents()).toHaveLength(5)
    })

    // 한쪽을 넘겼다고 다른 쪽이 움직이면 돌아왔을 때 있던 자리가 아니다.
    test('it keeps a page number of its own, apart from the list', async () => {
        const manager = await openDone(Array.from({ length: 25 }, (_, i) =>
            done('2026-08-20', 'row' + i)))
        manager.tasksPerPage = 10
        manager.currentPage = 3
        manager.donePage = 1
        manager.renderCompletedView()
        await settle()

        document.getElementById('nextPageBtn').click()
        await settle()

        expect(manager.donePage).toBe(2)
        expect(manager.currentPage).toBe(3)
    })

    // 3쪽을 보다 걸러서 한 쪽으로 줄면 없는 쪽에 남는다.
    test('narrowing the period comes back to the first page', async () => {
        const manager = await openDone(Array.from({ length: 25 }, (_, i) =>
            done('2026-08-20', 'row' + i)))
        manager.tasksPerPage = 10
        manager.donePage = 3
        manager.renderCompletedView()
        await settle()

        document.querySelector('#donePresets [data-done-days="7"]').click()
        await settle()

        expect(manager.donePage).toBe(1)
    })

    // 목록에서 칩이 검색 상자 바로 아래에 있다. 화면이 바뀌었다고 자리가
    // 옮겨 다니면 매번 찾아야 한다.
    test('the chips sit where the list keeps them, under the search box', async () => {
        await openDone([done('2026-08-20', 'a', { tags: '#[BLUE]업무' })])

        expect(document.querySelector('#quickFilters [data-done-tag]')).not.toBeNull()
        // 목록의 칩은 함께 있지 않다. 여기서는 상태가 전부 완료라 뜻이 없다.
        expect(document.querySelector('#quickFilters [data-quick]')).toBeNull()
    })

    test('All clears the tags without touching the period', async () => {
        const manager = await openDone([
            done('2026-08-20', '계약', { tags: '#[RED]긴급' }),
            done('2026-08-20', '예산', { tags: '#[BLUE]업무' })
        ])
        const before = manager.doneRange

        document.querySelectorAll('#quickFilters [data-done-tag]')[0].click()
        await settle()
        expect(contents()).toHaveLength(1)

        document.querySelector('#quickFilters [data-done-all]').click()
        await settle()

        expect(contents()).toHaveLength(2)
        expect(manager.doneRange).toEqual(before)
    })

    // 나올 때 목록의 칩이 돌아와야 한다. 완료 쪽 칩이 남아 있으면 목록을
    // 거르지 못한다.
    test('leaving gives the list its own chips back', async () => {
        const manager = await boot([task('a', { tags: '#[BLUE]업무' })])
        document.getElementById('completionCounter').click()
        await settle()
        document.getElementById('completionCounter').click()
        await settle()

        expect(document.querySelector('#quickFilters [data-done-tag]')).toBeNull()
        expect(document.querySelector('#quickFilters [data-quick]')).not.toBeNull()
    })

    // 몇 건인지는 페이저 줄이 말한다. 목록과 같은 자리, 같은 문구다.
    test('counts what it is showing, in the pager row', async () => {
        await openDone([done('2026-08-20', 'a'), done('2026-08-20', 'b')])

        expect(document.getElementById('paginationTotal').textContent).toContain('2')
    })

    test('says so when the period holds nothing', async () => {
        await openDone([])

        expect(document.querySelector('#doneBody .empty-message')).not.toBeNull()
        expect(document.getElementById('paginationTotal').textContent).toContain('0')
    })

    // 아무 일도 하지 않는 입력칸을 띄워 두는 것은 감추는 것보다 나쁘다.
    test('the search box filters here too', async () => {
        const manager = await openDone([
            done('2026-08-20', '계약서 확인', { note: '법무팀' }),
            done('2026-08-20', '예산안 검토', { tags: '#[BLUE]업무' })
        ])

        manager.searchQuery = '예산'
        manager.renderTasks()
        await settle()
        expect(contents()).toEqual(['예산안 검토'])

        manager.searchQuery = '법무'
        manager.renderTasks()
        await settle()
        expect(contents()).toEqual(['계약서 확인'])
    })

    // 빠른 필터는 활성 작업의 상태와 태그로 만든다. 여기서는 전부 완료라 상태
    // 칩은 뜻이 없고, 눌러도 아무 일이 없는 칩을 띄워 둘 이유가 없다.
    test('hides the list controls that mean nothing here', async () => {
        await openDone([done('2026-08-20', 'a')])

        expect(document.getElementById('taskActionBar').style.display).toBe('none')
        expect(document.querySelector('.table-container').style.display).toBe('none')
        // 페이저는 남는다. 여기도 넘길 것이 있다.
        expect(document.getElementById('paginationContainer').style.display).not.toBe('none')
    })

    // 읽기 전용이다. 고를 것도 고칠 것도 없다.
    test('nothing in a row is selectable or editable', async () => {
        const manager = await openDone([done('2026-08-20', '계약서 확인')])

        const row = document.querySelector('#doneBody tr')
        expect(row.querySelector('input')).toBeNull()
        row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
        await settle()

        expect(document.getElementById('taskModal').style.display).not.toBe('block')
        expect(manager.selectedTaskIds.size).toBe(0)
    })

    const lastRange = () => electronAPI.getCompletedRange.mock.calls.slice(-1)[0]

    test('stepping back moves both ends by the width on screen', async () => {
        const manager = await openDone([])
        const [firstFrom, firstTo] = electronAPI.getCompletedRange.mock.calls[0]

        manager.moveDoneRange(-1)
        await settle()

        const [from, to] = lastRange()
        expect((new Date(firstTo) - new Date(to)) / 86400000).toBe(30)
        expect((new Date(firstFrom) - new Date(from)) / 86400000).toBe(30)
    })

    // 폭을 고정해 두면 일주일을 골라 놓고 넘겼을 때 엉뚱한 데로 간다.
    test('a seven day window steps seven days, not thirty', async () => {
        const manager = await openDone([])
        manager.setDoneWindow(7)
        manager.renderCompletedView()
        await settle()
        const [beforeFrom] = lastRange()

        manager.moveDoneRange(-1)
        await settle()

        const [from, to] = lastRange()
        expect((new Date(beforeFrom) - new Date(from)) / 86400000).toBe(7)
        expect((new Date(to) - new Date(from)) / 86400000).toBe(6)
    })

    // 로그에 내일은 없다.
    test('it will not walk past today', async () => {
        const manager = await openDone([])

        manager.moveDoneRange(1)
        await settle()

        expect(lastRange()[1]).toBe(formatKey(new Date()))
    })

    test('a preset resets the window to that many days, ending today', async () => {
        await openDone([])

        document.querySelector('#donePresets [data-done-days="7"]').click()
        await settle()

        const [from, to] = lastRange()
        expect(to).toBe(formatKey(new Date()))
        expect((new Date(to) - new Date(from)) / 86400000).toBe(6)
    })

    // 기간은 읽는 자리가 곧 고치는 자리다. 라벨과 입력칸을 따로 두면 어느 쪽이
    // 진짜인지 알 수 없다.
    test('the two fields show the range and also set it', async () => {
        const manager = await openDone([])

        expect(document.getElementById('doneTo').value).toContain(formatKey(new Date()))

        document.getElementById('doneFrom').value = '2026-01-01 00:00'
        document.getElementById('doneTo').value = '2026-01-31 00:00'
        manager.applyDoneDates()
        await settle()

        expect(lastRange()).toEqual(['2026-01-01', '2026-01-31'])
    })

    // 빈 화면을 내놓고 왜인지 모르게 두는 것보다, 바로잡고 두 칸을 다시 그려
    // 무엇이 적용됐는지 보여주는 편이 낫다.
    test('a backwards range is turned the right way round', async () => {
        const manager = await openDone([])

        document.getElementById('doneFrom').value = '2026-01-31 00:00'
        document.getElementById('doneTo').value = '2026-01-01 00:00'
        manager.applyDoneDates()
        await settle()

        expect(lastRange()).toEqual(['2026-01-01', '2026-01-31'])
    })

    // 한쪽만 고치는 동안 다른 쪽이 비면 화면이 통째로 사라진다.
    test('clearing one field leaves the other end where it was', async () => {
        const manager = await openDone([])
        const [, originalTo] = lastRange()

        document.getElementById('doneFrom').value = '2026-01-01 00:00'
        document.getElementById('doneTo').value = ''
        manager.applyDoneDates()
        await settle()

        expect(lastRange()).toEqual(['2026-01-01', originalTo])
    })

    // 상태 칩은 전부 완료라 뜻이 없다. 태그는 그대로 뜻이 있다.
    test('offers the tags this period actually holds, and filters by them', async () => {
        const manager = await openDone([
            done('2026-08-20', '계약', { tags: '#[RED]긴급' }),
            done('2026-08-20', '예산', { tags: '#[BLUE]업무' }),
            done('2026-08-20', '보고', { tags: '#[BLUE]업무' })
        ])

        const chips = [...document.querySelectorAll('#quickFilters [data-done-tag]')]
        expect(chips.map((c) => c.textContent)).toEqual(['#업무', '#긴급'])

        chips[1].click()
        await settle()
        expect(contents()).toEqual(['계약'])
    })

    // 칩은 거른 뒤가 아니라 거르기 전 목록으로 만든다. 하나를 고른 순간 나머지가
    // 사라지면 다른 태그로 갈아탈 수가 없다.
    test('the chips stay put once one of them is on', async () => {
        const manager = await openDone([
            done('2026-08-20', '계약', { tags: '#[RED]긴급' }),
            done('2026-08-20', '예산', { tags: '#[BLUE]업무' })
        ])

        document.querySelectorAll('#quickFilters [data-done-tag]')[0].click()
        await settle()

        expect(document.querySelectorAll('#quickFilters [data-done-tag]')).toHaveLength(2)
    })

    test('a period with no tags shows no chips at all', async () => {
        await openDone([done('2026-08-20', '태그 없음')])

        expect(document.querySelectorAll('#quickFilters [data-done-tag]')).toHaveLength(0)
    })
})

describe('calendar view', () => {
    const at = (day, time) => `2026-08-${String(day).padStart(2, '0')} ${time}`
    const cells = () => Array.from(document.querySelectorAll('#calGrid .cal-day'))
    const cellFor = (day) =>
        cells().find(
            (c) =>
                c.querySelector('.cal-date').textContent === String(day) &&
                !c.classList.contains('outside')
        )
    const chipsIn = (day) =>
        Array.from(cellFor(day).querySelectorAll('.cal-chip')).map((c) => c.textContent)

    const openCalendar = async (tasks) => {
        const manager = await boot(tasks)
        manager.calendarMonth = new Date(2026, 7, 1)
        manager.viewMode = 'calendar'
        manager.applyViewMode()
        manager.renderTasks()
        return manager
    }

    // "저건 언제였지" 를 보다가 고치고 싶어지는 것은 달력 앞에서 늘 일어난다.
    // 그때마다 목록으로 돌아가면 달력을 두 번 보게 된다.
    test('a double click on a chip opens the editor', async () => {
        const manager = await openCalendar([
            task('a', { content: '분기 보고서', targetDateTime: at(21, '18:00') })
        ])

        const chip = cellFor(21).querySelector('.cal-chip')
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
        await settle()

        expect(document.getElementById('taskModal').style.display).toBe('block')
        expect(document.getElementById('taskContent').value).toBe('분기 보고서')
        expect(manager.editingTaskId).toBe('a')
    })

    // 한 번 누르는 것은 여전히 아무 일도 하지 않는다. 선택도 편집도 아니다.
    test('a single click still does nothing at all', async () => {
        const manager = await openCalendar([
            task('a', { targetDateTime: at(21, '18:00') })
        ])

        cellFor(21).querySelector('.cal-chip')
            .dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
        await settle()

        expect(document.getElementById('taskModal').style.display).not.toBe('block')
        expect(manager.selectedTaskIds.size).toBe(0)
    })

    // 칩이 아닌 곳은 그대로 보기 전용이다.
    test('double clicking empty space in a cell opens nothing', async () => {
        await openCalendar([task('a', { targetDateTime: at(21, '18:00') })])

        cellFor(14).dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
        await settle()

        expect(document.getElementById('taskModal').style.display).not.toBe('block')
    })

    test('hides the table, the action bar and pagination', async () => {
        await openCalendar([task('a')])

        expect(document.getElementById('calendarView').style.display).not.toBe('none')
        expect(document.querySelector('.table-container').style.display).toBe('none')
        expect(document.getElementById('taskActionBar').style.display).toBe('none')
        expect(document.getElementById('paginationContainer').style.display).toBe('none')
    })

    test('lays a task on its own day', async () => {
        await openCalendar([
            task('a', { startDateTime: at(12, '09:00'), targetDateTime: at(12, '18:00') })
        ])

        expect(chipsIn(12)).toEqual(['18:00task a'])
        expect(chipsIn(13)).toEqual([])
    })

    // A task sits on its deadline, not on every day between start and target.
    // The start time is usually just when it was noted, so spanning smeared one
    // task across the whole month and looked like old entries piling up.
    test('places a task on its target day only', async () => {
        await openCalendar([
            task('a', { startDateTime: at(12, '09:00'), targetDateTime: at(14, '18:00') })
        ])

        expect(chipsIn(12)).toHaveLength(0)
        expect(chipsIn(13)).toHaveLength(0)
        expect(chipsIn(14)).toHaveLength(1)
    })

    // Pushing the deadline back must move it, not add a second copy.
    test('moving the target date moves the task', async () => {
        const manager = await openCalendar([
            task('a', { startDateTime: at(12, '09:00'), targetDateTime: at(12, '18:00') })
        ])
        expect(chipsIn(12)).toHaveLength(1)

        manager.tasks[0].targetDateTime = at(20, '18:00')
        manager.renderTasks()

        expect(chipsIn(12)).toHaveLength(0)
        expect(chipsIn(20)).toHaveLength(1)
    })

    // Nothing else anchors it.
    test('falls back to the start day when there is no target', async () => {
        await openCalendar([
            task('a', { startDateTime: at(12, '09:00'), targetDateTime: '' })
        ])

        expect(chipsIn(12)).toHaveLength(1)
    })

    test('orders a day by target time', async () => {
        await openCalendar([
            task('late', { startDateTime: at(12, '15:00'), targetDateTime: at(12, '16:00') }),
            task('early', { startDateTime: at(12, '09:00'), targetDateTime: at(12, '10:00') })
        ])

        expect(chipsIn(12)).toEqual(['10:00task early', '16:00task late'])
    })

    // A task with no target has no length to draw. It goes at the top of the
    // day with no time, the way an all-day entry does.
    test('puts an ongoing task first and without a time', async () => {
        await openCalendar([
            task('timed', { startDateTime: at(12, '09:00'), targetDateTime: at(12, '10:00') }),
            task('ongoing', { startDateTime: at(12, '14:00'), targetDateTime: '' })
        ])

        expect(chipsIn(12)).toEqual(['task ongoing', '10:00task timed'])
    })

    test('carries the same status class the table and the strip use', async () => {
        const manager = await openCalendar([
            task('a', { startDateTime: at(12, '09:00'), targetDateTime: at(12, '18:00') })
        ])

        const chip = cellFor(12).querySelector('.cal-chip')
        expect(chip.className).toContain(manager.getTaskStatus(manager.tasks[0]).status)
    })

    test('marks a highlighted task instead of its status', async () => {
        await openCalendar([
            task('a', {
                highlighted: true,
                startDateTime: at(12, '09:00'),
                targetDateTime: at(12, '18:00')
            })
        ])

        expect(cellFor(12).querySelector('.cal-chip').className).toContain('highlighted')
    })

    test('marks today and greys the days outside the month', async () => {
        await openCalendar([task('a')])

        expect(document.querySelectorAll('#calGrid .cal-day.outside').length).toBeGreaterThan(0)
        // August 2026 opens on a Saturday, so a Monday-first grid starts on 27 July.
        expect(cells()[0].querySelector('.cal-date').textContent).toBe('27')
    })

    test('the arrows move a month at a time', async () => {
        const manager = await openCalendar([task('a')])

        document.getElementById('calNext').click()
        expect(document.getElementById('calLabel').textContent).toBe('2026-09')

        document.getElementById('calPrev').click()
        document.getElementById('calPrev').click()
        expect(manager.calendarMonth.getMonth()).toBe(6)
    })

    test('the search still narrows what the calendar shows', async () => {
        const manager = await openCalendar([
            task('a', {
                content: 'buy milk',
                startDateTime: at(12, '09:00'),
                targetDateTime: at(12, '10:00')
            }),
            task('b', {
                content: 'write report',
                startDateTime: at(12, '11:00'),
                targetDateTime: at(12, '12:00')
            })
        ])

        manager.searchQuery = 'milk'
        manager.renderTasks()

        expect(chipsIn(12)).toEqual(['10:00buy milk'])
    })

    // The cells are assembled as an HTML string, so a task titled with a tag
    // would otherwise break the grid open.
    test('escapes task content', async () => {
        await openCalendar([
            task('a', {
                content: '<b>ship</b>',
                startDateTime: at(12, '09:00'),
                targetDateTime: at(12, '10:00')
            })
        ])

        expect(cellFor(12).querySelector('.cal-chip b')).toBeNull()
        expect(chipsIn(12)).toEqual(['10:00<b>ship</b>'])
    })

    test('nothing in a cell is clickable', async () => {
        const manager = await openCalendar([
            task('a', { startDateTime: at(12, '09:00'), targetDateTime: at(12, '10:00') })
        ])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        cellFor(12).querySelector('.cal-chip').click()

        expect(manager.showModal).not.toHaveBeenCalled()
        expect(manager.selectedTaskIds.size).toBe(0)
    })

    test('the choice survives a restart', async () => {
        localStorage.setItem('viewMode', 'calendar')

        const manager = await boot([task('a')])

        expect(manager.viewMode).toBe('calendar')
        expect(document.getElementById('calendarView').style.display).not.toBe('none')
    })

    // 150px cannot hold seven columns, so the same idea narrows to one day
    // stood up in time order - still a calendar, not the task list.
    describe('collapsed', () => {
        const items = () => Array.from(document.querySelectorAll('#collapsedMiniTasksBody li'))

        const openCollapsed = async (tasks) => {
            const manager = await boot(tasks)
            manager.viewMode = 'calendar'
            manager.isCollapsed = true
            manager.applyViewMode()
            manager.renderTasks()
            return manager
        }

        const todayAt = (time) => {
            const now = new Date()
            const month = String(now.getMonth() + 1).padStart(2, '0')
            const day = String(now.getDate()).padStart(2, '0')
            return `${now.getFullYear()}-${month}-${day} ${time}`
        }

        test('shows only today, in time order, with the time in front', async () => {
            await openCollapsed([
                task('later', { startDateTime: todayAt('15:00'), targetDateTime: todayAt('16:00') }),
                task('sooner', { startDateTime: todayAt('09:00'), targetDateTime: todayAt('10:00') }),
                task('other', { startDateTime: at(1, '09:00'), targetDateTime: at(1, '10:00') })
            ])

            expect(items().map((li) => li.querySelector('.mini-index').textContent)).toEqual([
                '10:00',
                '16:00'
            ])
        })

        test('keeps the grid out of the strip', async () => {
            await openCollapsed([task('a', { startDateTime: todayAt('09:00') })])

            expect(document.getElementById('calendarView').style.display).toBe('none')
        })

        // Sizing the strip off every active task left a long empty tail, since
        // only today's rows are drawn.
        test('sizes the window to what it actually draws', async () => {
            const manager = await openCollapsed([
                task('today', { startDateTime: todayAt('09:00'), targetDateTime: todayAt('10:00') }),
                task('next-month', { startDateTime: at(1, '09:00'), targetDateTime: at(1, '10:00') })
            ])

            // two rows minimum, plus the mini grid's share
            expect(manager.collapsedRowCount()).toBe(9)
        })
    })
})

describe('quick filter presentation', () => {
    const chips = () => Array.from(document.querySelectorAll('#quickFilters .quick-chip'))
    const chip = (text) => chips().find((c) => c.textContent === text)

    // A tag that is red in the table and blue in the filter bar cannot be
    // matched up by eye.
    test('a coloured tag keeps its colour', async () => {
        await boot([task('a', { tags: '#[RED]urgent' })])

        expect(chip('#urgent').getAttribute('style')).toContain('background-color')
        expect(chip('#urgent').getAttribute('style')).not.toBe('')
    })

    // The invariant: whatever colour the table paints a tag, the filter bar
    // paints the same one.
    test.each(['#[RED]urgent', '#[GREEN]done', '#meeting'])(
        'matches the table chip for %s',
        async (tags) => {
            const manager = await boot([task('a', { tags })])
            const name = manager.displayTagTexts(manager.tasks[0])[0]

            const inTable = document.querySelector('#tasksBody .tag')
            expect(chip(name).style.backgroundColor).toBe(inTable.style.backgroundColor)
            expect(chip(name).style.color).toBe(inTable.style.color)
        }
    )

    // Twenty tags wrapping onto three lines push the table down and turn the
    // filters into an obstacle.
    test('caps the bar and says how many it left out', async () => {
        const many = Array.from({ length: 25 }, (_, i) =>
            task(`t${i}`, { tags: `#tag${i}` })
        )
        await boot(many)

        // All + statuses + tags, never more than the cap plus the All button.
        expect(chips().length).toBeLessThanOrEqual(16)
        expect(document.querySelector('#quickFilters .quick-more')).not.toBeNull()
    })

    test('keeps the most used tags when it has to choose', async () => {
        const tasks = [
            ...Array.from({ length: 5 }, (_, i) => task(`c${i}`, { tags: '#common' })),
            ...Array.from({ length: 20 }, (_, i) => task(`r${i}`, { tags: `#rare${i}` }))
        ]
        await boot(tasks)

        expect(chip('#common')).not.toBeUndefined()
    })

    test('says nothing about hidden tags when they all fit', async () => {
        await boot([task('a', { tags: '#one #two' })])

        expect(document.querySelector('#quickFilters .quick-more')).toBeNull()
    })
})

describe('view toggle', () => {
    const button = () => document.getElementById('viewModeBtn')

    // It belongs with the other screen-mode switch, not beside the quick
    // filters, where it read as one more filter chip.
    test('sits with collapse at the end of the header', async () => {
        await boot([task('a')])

        expect(button().closest('.header-buttons')).not.toBeNull()
        expect(button().closest('#quickFilters')).toBeNull()

        const ids = Array.from(document.querySelectorAll('.header-buttons > button'))
            .map((el) => el.id)
        expect(ids.slice(-2)).toEqual(['viewModeBtn', 'collapseBtn'])
    })

    // The icon shows what you get, not what you have - same rule as collapse.
    test('shows a calendar in list view and a list in calendar view', async () => {
        const manager = await boot([task('a')])

        expect(button().innerHTML).toContain('rect')
        expect(button().title).toBe('Calendar view')

        manager.toggleViewMode()

        expect(button().innerHTML).not.toContain('rect')
        expect(button().title).toBe('List view')
    })

    test('clicking it switches the view', async () => {
        const manager = await boot([task('a')])

        button().click()

        expect(manager.viewMode).toBe('calendar')
        expect(localStorage.getItem('viewMode')).toBe('calendar')
    })

    // 목록과 달력은 같은 것을 보는 두 방식이라 한 버튼으로 오간다. 완료는 다른
    // 데이터이므로 이 순환에 끼지 않는다.
    test('the toggle never lands on completed', async () => {
        const manager = await boot([task('a')])

        for (let press = 0; press < 6; press++) {
            button().click()
            expect(manager.viewMode).not.toBe('completed')
        }
    })
})

// <input> 은 값의 일부만 색을 달리할 수 없으므로, 같은 글자를 같은 자리에 겹쳐
// 그린 층이 자리표시자만 흐리게 칠한다.
describe('the unfilled part of a date reads as a placeholder', () => {
    const ghost = () => document.querySelector('[data-ghost="startDateTime"]')
    const dimmed = () => [...ghost().querySelectorAll('.dtf-placeholder')].map(e => e.textContent)

    const openWith = async (value) => {
        const manager = await boot([])
        manager.showModal()
        await settle()
        const input = document.getElementById('startDateTime')
        input.value = value
        manager.paintGhost(input)
        return manager
    }

    test('the overlay carries exactly what the field holds', async () => {
        await openWith('2026-08-DD HH:mm')

        expect(ghost().textContent).toBe('2026-08-DD HH:mm')
    })

    test('only the slots nobody filled are dimmed', async () => {
        await openWith('2026-08-DD HH:mm')

        expect(dimmed()).toEqual(['DD', 'HH', 'mm'])
    })

    test('a full date dims nothing', async () => {
        await openWith('2026-08-21 09:30')

        expect(dimmed()).toEqual([])
    })

    // The separator between two dimmed runs is its own text node. It has to
    // survive: 'DD HH' printed as 'DDHH' is what a flex container does to a
    // run of whitespace between two items.
    test('the space between two dimmed runs survives', async () => {
        await openWith('2026-08-DD HH:mm')

        expect(ghost().textContent).toContain('DD HH')
    })

    // A caret is one pixel wide and sits between a dark digit and a grey
    // placeholder, which is a bad place to look for it. The slot the next digit
    // will land in is marked instead - the same thing a native date input does.
    test('the slot the caret sits in is marked', async () => {
        const manager = await openWith('2026-08-DD HH:mm')
        const input = document.getElementById('startDateTime')
        input.focus()
        input.setSelectionRange(8, 8)
        manager.paintGhost(input)

        const active = ghost().querySelector('.dtf-active')
        expect(active).not.toBeNull()
        expect(active.textContent).toBe('D')
    })

    test('it follows the caret to the next slot', async () => {
        const manager = await openWith('2026-08-21 HH:mm')
        const input = document.getElementById('startDateTime')
        input.focus()
        input.setSelectionRange(11, 11)
        manager.paintGhost(input)

        expect(ghost().querySelector('.dtf-active').textContent).toBe('H')
    })

    // Nothing is being typed into a field nobody is in.
    test('an unfocused field marks nothing', async () => {
        const manager = await openWith('2026-08-DD HH:mm')
        const input = document.getElementById('startDateTime')
        input.blur()
        manager.paintGhost(input)

        expect(ghost().querySelector('.dtf-active')).toBeNull()
    })

    // Assigning .value fires no event, so the overlay cannot hear it - and with
    // the input's own text transparent, a stale overlay reads as "the value did
    // not go in". Every write goes through setDateValue for that reason; this
    // has leaked twice from patching call sites one at a time.
    test('a date chosen in the picker shows up in the field', async () => {
        const manager = await openWith('')
        const input = document.getElementById('startDateTime')

        manager.pickerTarget = 'startDateTime'
        manager.pickerDate = new Date(2026, 7, 1)
        manager.pickerHour = 9
        manager.pickerMinute = 30
        manager.applyDateTimePicker()

        expect(input.value).toBe('2026-08-01 09:30')
        expect(ghost().textContent).toBe(input.value)
    })

    test('setting a value always repaints the overlay', async () => {
        const manager = await openWith('2026-08-21 09:30')

        manager.setDateValue('startDateTime', '2027-01-02 03:04')

        expect(ghost().textContent).toBe('2027-01-02 03:04')
    })

    // The transparency is what makes a stale overlay dangerous, so clearing has
    // to lift it rather than leave a transparent field with old text under it.
    test('clearing a field leaves nothing behind', async () => {
        const manager = await openWith('2026-08-21 09:30')

        manager.setDateValue('startDateTime', '')

        expect(ghost().textContent).toBe('')
        expect(document.getElementById('startDateTime').style.color).toBe('')
    })

    test('an empty field draws nothing at all', async () => {
        await openWith('')

        expect(ghost().textContent).toBe('')
    })
})

describe('an empty list is where you start', () => {
    // The empty row points at the add button, so the row itself should open it.
    // It could not: the click handler looks for a checkbox and an empty row has
    // none, so it returned before doing anything.
    test('clicking the empty row opens the add form', async () => {
        const manager = await boot([])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        document.querySelector('#tasksBody .empty-message').click()

        expect(manager.showModal).toHaveBeenCalledWith()
    })

    test('and it does not fire on a row that has a task', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        document.querySelector('#tasksBody tr').click()
        await pastDoubleClick()

        expect(manager.showModal).not.toHaveBeenCalled()
    })
})

describe('overdue notification', () => {
    const minutesAgo = (n) => {
        const t = new Date(Date.now() - n * 60000)
        const pad = (v) => String(v).padStart(2, '0')
        return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ` +
            `${pad(t.getHours())}:${pad(t.getMinutes())}`
    }

    test('fires once when the target time has passed', async () => {
        const manager = await boot([task('a', { targetDateTime: minutesAgo(5) })])

        await manager.checkUpcomingTasks()
        const first = electronAPI.showNotification.mock.calls.length
        await manager.checkUpcomingTasks()

        expect(first).toBeGreaterThan(0)
        expect(electronAPI.showNotification.mock.calls.length).toBe(first)
    })

    // Every other notification is translated; this one was hardcoded English.
    test('says it in the chosen language', async () => {
        const manager = await boot([task('a', { targetDateTime: minutesAgo(5) })])

        await manager.checkUpcomingTasks()

        const said = electronAPI.showNotification.mock.calls.map((c) => c[0]).join(' ')
        expect(said).toContain(manager.getLocalizedText('overdueNotification'))
        expect(said).not.toContain('Task is now overdue')
    })
})

describe('the About dialog leaves other screens alone', () => {
    // showAboutModal used to force `display: inline-flex` on the log-folder
    // button, from when that button lived inside About. After the button moved
    // to Settings the line stayed, so opening the help once turned the button
    // into a flex container and its label rode 9px up from its neighbour's -
    // visible only after About had been opened, which is what made it look like
    // a dark-mode bug.
    test('opening it does not restyle the log folder button', async () => {
        const manager = await boot([task('a')])
        const button = document.getElementById('openLogFolderBtn')

        manager.showSettingsModal()
        const before = button.style.display

        await manager.showAboutModal()

        expect(button.style.display).toBe(before)
    })

    // Hiding it is a value; showing it is the stylesheet's business. Writing a
    // concrete display here is what caused the bug above.
    test('Settings restores the button to whatever CSS says', async () => {
        const manager = await boot([task('a')])
        const button = document.getElementById('openLogFolderBtn')
        button.style.display = 'inline-flex'

        manager.showSettingsModal()

        expect(button.style.display).toBe('')
    })
})

describe('always-on-top pin', () => {
    const pin = () => document.getElementById('alwaysOnTopBtn')

    test('starts pinned, because the window is created that way', async () => {
        const manager = await boot([task('a')])

        expect(manager.alwaysOnTop).toBe(true)
        expect(pin().classList.contains('active')).toBe(true)
    })

    // Pinning matters when the window is a strip sitting over other work, so
    // that is where the control lives. Expanded, Ctrl+M reaches it.
    test('lives in the collapsed strip, not the header', async () => {
        await boot([task('a')])

        expect(pin().closest('.collapsed-mini-layout')).not.toBeNull()
        expect(pin().closest('.header-buttons')).toBeNull()
    })

    // Unlike collapse and the view toggle, the icon never changes. Whether the
    // window is pinned is the thing you want to know at a glance, so the state
    // is the fill; only the tooltip says what pressing will do.
    test('keeps one icon and shows the state as fill', async () => {
        const manager = await boot([task('a')])
        const iconWhilePinned = pin().innerHTML

        pin().click()

        expect(manager.alwaysOnTop).toBe(false)
        expect(pin().classList.contains('active')).toBe(false)
        expect(pin().innerHTML).toBe(iconWhilePinned)
    })

    test('the tooltip says what the press will do, not what is', async () => {
        await boot([task('a')])

        expect(pin().title).toBe('Stop keeping this window on top')

        pin().click()

        expect(pin().title).toBe('Keep this window on top')
    })

    // main.js holds it in a plain variable, so the renderer has to push on every
    // launch - the same shape as unfocused opacity.
    test('remembers the choice across presses', async () => {
        const manager = await boot([task('a')])

        pin().click()
        expect(localStorage.getItem('alwaysOnTop')).toBe('false')
        expect(manager.alwaysOnTop).toBe(false)

        pin().click()
        expect(localStorage.getItem('alwaysOnTop')).toBe('true')
        expect(manager.alwaysOnTop).toBe(true)
    })

    // The window is created with alwaysOnTop: true and starts expanded, so this
    // push is what takes it back off. Without it a fresh launch floats over
    // everything with no pin in reach to explain why.
    test('starts the expanded window off the top', async () => {
        await boot([task('a')])

        expect(window.electronAPI.setAlwaysOnTop).toHaveBeenCalledWith(false)
    })

    // Expanded there is no pin, so there is no way to see the state or change
    // it. A 900px window sitting over everything with nothing to explain it
    // reads as a fault, so the setting only applies to the strip.
    test('only holds the window on top while collapsed', async () => {
        const manager = await boot([task('a')])
        expect(manager.alwaysOnTop).toBe(true)

        manager.toggleCollapse()
        expect(window.electronAPI.setAlwaysOnTop).toHaveBeenLastCalledWith(true)

        manager.toggleCollapse()
        expect(window.electronAPI.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    })

    test('a strip with the pin off stays off the top', async () => {
        const manager = await boot([task('a')])
        pin().click()

        manager.toggleCollapse()

        expect(window.electronAPI.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    })
})

describe('collapsed calendar with nothing today', () => {
    const pad = (n) => String(n).padStart(2, '0')
    const shift = (days, time) => {
        const now = new Date()
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
    }

    const openCollapsed = async (tasks) => {
        const manager = await boot(tasks)
        manager.viewMode = 'calendar'
        manager.isCollapsed = true
        manager.applyViewMode()
        manager.renderTasks()
        return manager
    }

    // The strip is the always-visible note. Blanking it whenever today happens
    // to be clear defeats the point of collapsing at all.
    test('rolls forward to the next day that has work', async () => {
        await openCollapsed([
            task('soon', { startDateTime: shift(3, '09:00'), targetDateTime: shift(3, '10:00') }),
            task('later', { startDateTime: shift(9, '09:00'), targetDateTime: shift(9, '10:00') })
        ])

        expect(document.getElementById('collapsedCalDate').textContent).toBe(
            shift(3, '00:00').slice(5, 10)
        )
        expect(document.querySelectorAll('#collapsedMiniTasksBody li')).toHaveLength(1)
    })

    test('prefers today when today has work', async () => {
        await openCollapsed([
            task('today', { startDateTime: shift(0, '09:00'), targetDateTime: shift(0, '10:00') }),
            task('later', { startDateTime: shift(3, '09:00'), targetDateTime: shift(3, '10:00') })
        ])

        expect(document.getElementById('collapsedCalDate').textContent).toBe(
            shift(0, '00:00').slice(5, 10)
        )
    })

    // Overdue work must not vanish just because its day has passed.
    test('falls back to the most recent past day', async () => {
        await openCollapsed([
            task('missed', { startDateTime: shift(-4, '09:00'), targetDateTime: shift(-4, '10:00') })
        ])

        expect(document.querySelectorAll('#collapsedMiniTasksBody li')).toHaveLength(1)
        expect(document.querySelector('#collapsedMiniTasksBody .empty-message')).toBeNull()
    })

    // "All tasks completed" was a lie whenever work simply sat on another day.
    test('says nothing is scheduled rather than claiming everything is done', async () => {
        await openCollapsed([])

        const message = document.querySelector('#collapsedMiniTasksBody .empty-message')
        expect(message.textContent).toBe('Nothing scheduled')
    })
})

// Saving an edit usually changes the status or the date, so the row often
// leaves the current filter - and an invisible row left ticked would be swept
// into the next bulk action.
describe('selection after an edit', () => {
    const pick = (id) => {
        const box = Array.from(document.querySelectorAll('.task-select')).find(
            (b) => b.dataset.taskId === id
        )
        box.checked = true
        box.dispatchEvent(new window.Event('change', { bubbles: true }))
    }

    test('clears the selection', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')

        manager.editTask('a')
        document.getElementById('taskContent').value = 'renamed'
        await manager.saveTask()
        await settle()

        expect(manager.selectedTaskIds.size).toBe(0)
    })

    // The toggles are the opposite case: undoing one needs a second press, so
    // the selection has to survive.
    test('but a highlight toggle keeps it', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')

        await document.querySelector('[data-bulk="highlight"]').click()
        await settle()

        expect(manager.selectedTaskIds.size).toBe(1)
    })
})

// The TSV log is the history and holds the id, both times, the tags and the
// content. Keeping a completed copy in tasks.json duplicated all of that, and
// no code ever read it - it only grew the file and every backup.
describe('completed tasks leave tasks.json', () => {
    test('old data is cleaned up on load and written back', async () => {
        const manager = await boot([
            task('a'),
            task('done', { completed: true }),
            task('older', { completed: true })
        ])

        expect(manager.tasks.map((t) => t.id)).toEqual(['a'])
        expect(electronAPI.saveTasks).toHaveBeenCalled()
        expect(electronAPI.saveTasks.mock.calls.at(-1)[0]).toHaveLength(1)
    })

    test('a clean file is not rewritten on every launch', async () => {
        await boot([task('a')])

        expect(electronAPI.saveTasks).not.toHaveBeenCalled()
    })

    // The rule lives on the row, so a repeating task must survive completion.
    test('a repeating row stays and moves to its next occurrence', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'advanceRecurringTask').mockReturnValue(true)

        await manager.doCompleteTask('a', null)
        await settle()

        expect(manager.tasks.map((t) => t.id)).toEqual(['a'])
    })

    // 이것이 산출물을 따로 두는 이유다. 행에 얹으면 이번 주에 낸 보고서가
    // 다음 주에도, 그 다음 주에도 첨부로 딸려 간다 - 그 행은 규칙이지 회차가
    // 아니기 때문이다.
    test('what came out of one occurrence does not follow the rule forward', async () => {
        const manager = await boot([task('a', {
            attachments: [{ name: 'form.xlsx', path: '/docs/form.xlsx' }]
        })])
        jest.spyOn(manager, 'advanceRecurringTask').mockReturnValue(true)

        await manager.doCompleteTask('a', null, '2026-08-22 17:00',
            [{ name: 'week34.docx', path: '/out/week34.docx' }])
        await settle()

        // 로그 줄에는 남는다
        const logged = electronAPI.addLog.mock.calls.map((c) => c[0])
            .find((entry) => entry.action === 'COMPLETE')
        expect(logged.outputs).toEqual([{ name: 'week34.docx', path: '/out/week34.docx' }])
        // 규칙에는 안 남는다
        const row = manager.tasks.find((t) => t.id === 'a')
        expect(row.attachments).toEqual([{ name: 'form.xlsx', path: '/docs/form.xlsx' }])
        expect(JSON.stringify(row)).not.toContain('week34')
    })

    // 작업에 붙어 있던 것은 그대로 로그에도 남는다. 회차마다 같은 것과 회차마다
    // 다른 것이 나란히 적혀야 이력이 읽힌다.
    test('the log line carries both, in their own places', async () => {
        const manager = await boot([task('a', {
            attachments: [{ name: 'form.xlsx', path: '/docs/form.xlsx' }]
        })])

        await manager.doCompleteTask('a', null, '2026-08-22 17:00',
            [{ name: 'week34.docx', path: '/out/week34.docx' }])
        await settle()

        const logged = electronAPI.addLog.mock.calls.map((c) => c[0])
            .find((entry) => entry.action === 'COMPLETE')
        expect(logged.task.attachments).toEqual([{ name: 'form.xlsx', path: '/docs/form.xlsx' }])
        expect(logged.outputs).toEqual([{ name: 'week34.docx', path: '/out/week34.docx' }])
    })

    test('completing with nothing to show sends an empty list', async () => {
        const manager = await boot([task('a')])

        await manager.doCompleteTask('a', null, '2026-08-22 17:00')
        await settle()

        const logged = electronAPI.addLog.mock.calls.map((c) => c[0])
            .find((entry) => entry.action === 'COMPLETE')
        expect(logged.outputs).toEqual([])
    })
})

// The strip has no other way to reach another day, so its dates are the one
// exception to the calendar being view-only.
describe('picking a day in the collapsed calendar', () => {
    const pad = (n) => String(n).padStart(2, '0')
    const shift = (days, time) => {
        const now = new Date()
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
    }
    const dayCell = (key) => document.querySelector(`#collapsedCalGrid [data-day="${key}"]`)
    const listed = () => document.getElementById('collapsedCalDate').textContent

    const openCollapsed = async (tasks) => {
        const manager = await boot(tasks)
        manager.viewMode = 'calendar'
        manager.isCollapsed = true
        manager.applyViewMode()
        manager.renderTasks()
        return manager
    }

    test('clicking a date lists that day instead', async () => {
        await openCollapsed([
            task('today', { startDateTime: shift(0, '09:00'), targetDateTime: shift(0, '10:00') }),
            task('later', { startDateTime: shift(2, '09:00'), targetDateTime: shift(2, '15:00') })
        ])
        expect(listed()).toBe(shift(0, '00:00').slice(5, 10))

        dayCell(shift(2, '00:00').slice(0, 10)).click()

        expect(listed()).toBe(shift(2, '00:00').slice(5, 10))
        expect(
            Array.from(document.querySelectorAll('#collapsedMiniTasksBody li')).map(
                (li) => li.querySelector('.mini-index').textContent
            )
        ).toEqual(['15:00'])
    })

    // "That day is empty" is an answer worth having, so an empty day is still
    // selectable rather than silently ignored.
    test('an empty day can be picked and says so', async () => {
        await openCollapsed([
            task('today', { startDateTime: shift(0, '09:00'), targetDateTime: shift(0, '10:00') })
        ])

        dayCell(shift(3, '00:00').slice(0, 10)).click()

        expect(document.querySelector('#collapsedMiniTasksBody .empty-message').textContent).toBe(
            'Nothing scheduled'
        )
    })

    test('clicking the same date again goes back to automatic', async () => {
        const manager = await openCollapsed([
            task('today', { startDateTime: shift(0, '09:00'), targetDateTime: shift(0, '10:00') }),
            task('later', { startDateTime: shift(2, '09:00'), targetDateTime: shift(2, '15:00') })
        ])
        const key = shift(2, '00:00').slice(0, 10)

        dayCell(key).click()
        dayCell(key).click()

        expect(manager.collapsedPickedKey).toBeNull()
        expect(listed()).toBe(shift(0, '00:00').slice(5, 10))
    })

    test('leaving calendar view drops the picked day', async () => {
        const manager = await openCollapsed([
            task('later', { startDateTime: shift(2, '09:00'), targetDateTime: shift(2, '15:00') })
        ])
        dayCell(shift(2, '00:00').slice(0, 10)).click()

        manager.toggleViewMode()

        expect(manager.collapsedPickedKey).toBeNull()
    })
})

// -webkit-app-region: drag hands an element's mouse events to the window
// manager, so anything clickable inside one stops responding.
describe('window drag grip', () => {
    test('exists and holds nothing clickable', async () => {
        await boot([task('a')])
        const grip = document.getElementById('dragBar')

        expect(grip).not.toBeNull()
        expect(grip.querySelectorAll('button, input, select, a, [data-bulk]')).toHaveLength(0)
    })
})

// It opens on a click, never on hover. Hovering meant the pointer only had to
// come to rest there - after the window moved, after a restore, on the way to
// the search box - and the panel covered the table uninvited.
describe('completed-today panel', () => {
    const panel = () => document.getElementById('completedList')
    const counter = () => document.getElementById('completionCounter')
    const open = () => panel().classList.contains('is-open')
    const show = async () => {
        counter().dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }))
        await settle()
    }

    // The window moving under a stationary pointer raises mouseenter but never
    // mousemove. That is the whole difference between "I pointed at it" and
    // "it slid under my cursor", and it is why the panel used to open itself
    // after leaving the strip or restoring from minimise.
    test('ignores the window sliding under a still pointer', async () => {
        await boot([task('a')])

        counter().dispatchEvent(new window.Event('mouseenter'))
        await settle()

        expect(open()).toBe(false)
    })

    test('opens once the pointer actually moves over it', async () => {
        await boot([task('a')])

        await show()

        expect(open()).toBe(true)
    })

    test('closes shortly after the pointer leaves', async () => {
        jest.useFakeTimers()
        try {
            await boot([task('a')])
            await show()
            expect(open()).toBe(true)

            counter().dispatchEvent(new window.Event('mouseleave'))
            jest.advanceTimersByTime(300)

            expect(open()).toBe(false)
        } finally {
            jest.useRealTimers()
        }
    })

    // The panel sits 6px below the counter, so reaching it to scroll crosses a
    // gap that belongs to neither. Closing on the spot would make the list
    // unreachable.
    test('survives crossing the gap on the way to the list', async () => {
        jest.useFakeTimers()
        try {
            await boot([task('a')])
            await show()

            counter().dispatchEvent(new window.Event('mouseleave'))
            jest.advanceTimersByTime(100)
            counter().dispatchEvent(new window.Event('mouseenter'))
            jest.advanceTimersByTime(500)

            expect(open()).toBe(true)
        } finally {
            jest.useRealTimers()
        }
    })

    test('closes when the window collapses or comes back', async () => {
        const manager = await boot([task('a')])
        await show()

        manager.toggleCollapse()

        expect(open()).toBe(false)
    })

    test('closes when the view changes', async () => {
        const manager = await boot([task('a')])
        await show()

        manager.toggleViewMode()

        expect(open()).toBe(false)
    })
})

// Minimising does not move the pointer, so mouseleave never fires and the panel
// was still open when the window came back - showing the previous fetch.
describe('completed-today panel and the window', () => {
    const openIt = async () => {
        document.getElementById('completionCounter')
            .dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true }))
        await settle()
    }
    const isOpen = () => document.getElementById('completedList').classList.contains('is-open')

    test('closes when the window loses focus', async () => {
        await boot([task('a')])
        await openIt()
        expect(isOpen()).toBe(true)

        window.dispatchEvent(new window.Event('blur'))

        expect(isOpen()).toBe(false)
    })

    test('closes when the window is hidden', async () => {
        await boot([task('a')])
        await openIt()

        Object.defineProperty(document, 'hidden', { value: true, configurable: true })
        document.dispatchEvent(new window.Event('visibilitychange'))

        expect(isOpen()).toBe(false)
    })
})

// The lead windows are [60, 15]. A task added with 40 minutes left is already
// inside the 60-minute window, so it fires at once - and used to announce
// "1 hour remaining" when 40 minutes were left. The same happens after a
// restart: reopening at 8 minutes left announced 15.
describe('notification wording', () => {
    const inMinutes = (n) => {
        const t = new Date(Date.now() + n * 60000)
        const pad = (v) => String(v).padStart(2, '0')
        return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ` +
            `${pad(t.getHours())}:${pad(t.getMinutes())}`
    }
    const said = () =>
        electronAPI.showNotification.mock.calls.map((c) => c.join(' ')).join(' | ')
    // Targets are stored to the minute, so the seconds already elapsed are lost
    // and the gap lands just under a whole number. What matters is that it
    // tracks the clock, not the window it tripped.
    const minutesSaid = () => Number((said().match(/(\d+) minutes?/) || [])[1])

    // A task registered when it is already inside the lead window has to ring
    // now. Waiting for the 30-second sweep reads as "notifications do not work".
    test('a task saved already inside the window notifies at once', async () => {
        const manager = await boot([])
        manager.showModal()
        document.getElementById('startDateTime').value =
            manager.formatDateTimeLocal(new Date())
        document.getElementById('targetDateTime').value =
            manager.formatDateTimeLocal(new Date(Date.now() + 20 * 60000))
        document.getElementById('taskContent').value = 'due very soon'
        document.getElementById('taskPosition').value = '1'

        await manager.saveTask()
        await settle()

        expect(electronAPI.showNotification).toHaveBeenCalled()
        expect(said()).toContain('due very soon')
    })

    test('reports the time actually left, not the lead it tripped', async () => {
        const manager = await boot([task('a', { targetDateTime: inMinutes(40) })])

        await manager.checkUpcomingTasks()

        expect(minutesSaid()).toBeGreaterThanOrEqual(39)
        expect(minutesSaid()).toBeLessThanOrEqual(40)
        expect(said()).not.toContain('hour')
    })

    // The wording itself is a pure function; test it there rather than trying to
    // hit an exact whole hour through the clock, which the minute-precision
    // target makes almost impossible.
    test('reads whole hours as hours and the rest as minutes', async () => {
        const manager = await boot([task('a')])

        expect(manager.describeLead(60)).toContain('1 hour')
        expect(manager.describeLead(120)).toContain('2 hour')
        expect(manager.describeLead(45)).toContain('45 minutes')
        expect(manager.describeLead(8)).toContain('8 minutes')
    })

    test('a task caught late reports what remains, not the window', async () => {
        const manager = await boot([task('a', { targetDateTime: inMinutes(8) })])

        await manager.checkUpcomingTasks()

        expect(minutesSaid()).toBeGreaterThanOrEqual(7)
        expect(minutesSaid()).toBeLessThanOrEqual(8)
    })
})

// The # column is the order the user arranged by hand - the up/down buttons and
// the position field write it. Sorting is a way of looking at that order for a
// moment, never a change to it.
// 내용 끝에 클립을 붙이면 내용 길이가 행마다 달라 매 행 다른 자리에 놓인다.
// 한 줄로 내려훑으려면 제 컬럼이어야 한다. 다만 대부분의 목록에는 첨부가 없으니
// 있을 때만 낸다.
describe('collapsing from outside the window', () => {
    const press = (key, mods = {}) => document.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...mods }))

    test('the global shortcut toggles even though no key reached the page', async () => {
        const manager = await boot([])

        expect(typeof toggleCollapseListener).toBe('function')
        toggleCollapseListener()
        await settle()

        expect(manager.isCollapsed).toBe(true)
    })

    // 전역 등록은 자기 창의 키까지 가로채므로 둘 다 걸면 보통은 한 번만 돈다.
    // 그것은 OS 의 사정이지 우리가 정한 규칙이 아니고, 둘 다 돌면 접었다 펴져
    // 아무 일도 없는 것처럼 보인다.
    test('the in-window handler stays off while the global one holds', async () => {
        const manager = await boot([])

        press('m', { ctrlKey: true, altKey: true, shiftKey: true })
        await settle()

        expect(manager.isCollapsed).toBe(false)
    })

    // 다른 프로그램이 먼저 잡았을 때. 조용히 넘어가되 창 안에서는 계속 들어야
    // 한다 - 그러지 않으면 단축키가 통째로 사라진다.
    test('a refused registration falls back to listening in the window', async () => {
        electronAPI = null
        const manager = await boot([])
        electronAPI.getCollapseShortcut.mockResolvedValue({
            accelerator: 'CommandOrControl+Alt+Shift+M', registered: false
        })
        await manager.setupCollapseShortcut()

        press('m', { ctrlKey: true, altKey: true, shiftKey: true })
        await settle()

        expect(manager.isCollapsed).toBe(true)
    })

    // 조합은 main.js 한 곳에서 나온다. 문구에 적어 두면 키를 바꾼 날 화면
    // 어딘가가 옛 키를 계속 안내한다.
    test('the help shows the combination main.js actually registered', async () => {
        const manager = await boot([])
        manager.showAboutModal()
        await settle()

        expect(document.getElementById('aboutCollapseViewKey').textContent)
            .toBe('Ctrl+Alt+Shift+M:')
        expect(document.getElementById('collapseBtn').title).toContain('Ctrl+Alt+Shift+M')
        expect(document.getElementById('aboutCollapsedViewDesc').textContent)
            .toContain('Ctrl+Alt+Shift+M')
    })
})

// 값은 OS 가 가지고 있고 앱은 읽기만 한다. 그래서 화면이 고른 상태를 그리지
// 못하면, 설정이 제대로 써지고 있어도 버튼이 죽은 것으로 보인다 - 실제로
// .backup-btn.active 규칙이 없어 그렇게 신고됐다.
describe('start at login', () => {
    const openSettings = async (manager) => {
        document.getElementById('settingsBtn').click()
        await settle()
        return manager
    }

    test('pressing on asks the OS and marks the button', async () => {
        const manager = await boot([])
        await openSettings(manager)

        document.getElementById('startupOnBtn').click()
        await settle()

        expect(electronAPI.setOpenAtLogin).toHaveBeenCalledWith(true)
        expect(document.getElementById('startupOnBtn').classList.contains('active')).toBe(true)
        expect(document.getElementById('startupOffBtn').classList.contains('active')).toBe(false)
    })

    test('pressing off asks the OS and marks the other one', async () => {
        const manager = await boot([])
        await openSettings(manager)

        document.getElementById('startupOnBtn').click()
        await settle()
        document.getElementById('startupOffBtn').click()
        await settle()

        expect(electronAPI.setOpenAtLogin).toHaveBeenLastCalledWith(false)
        expect(document.getElementById('startupOffBtn').classList.contains('active')).toBe(true)
    })

    // 요청한 값이 아니라 OS 가 실제로 받아들인 값을 그린다. Windows 가 거절하면
    // 화면은 꺼진 채로 있어야 한다.
    test('an OS that refuses leaves the switch off', async () => {
        const manager = await boot([])
        electronAPI.setOpenAtLogin.mockResolvedValueOnce(false)
        await openSettings(manager)

        document.getElementById('startupOnBtn').click()
        await settle()

        expect(document.getElementById('startupOnBtn').classList.contains('active')).toBe(false)
        expect(document.getElementById('startupOffBtn').classList.contains('active')).toBe(true)
    })

    // 이 결함은 동작이 아니라 스타일시트에 있었다. classList 는 제대로 붙는데
    // .backup-btn.active 규칙이 없어 두 버튼이 똑같이 보였고, 값은 OS 에 잘
    // 써지는데도 "안 눌린다"로 신고됐다. 위의 테스트들은 전부 통과했다.
    //
    // 그래서 고른 상태를 그리는 규칙이 있는지를 따로 묻는다. 설정 창의 세 토글을
    // 한꺼번에 보므로, 넷째가 생겨도 같은 자리에서 걸린다.
    test('a chosen button has a rule that draws it as chosen', async () => {
        await boot([])

        const groups = ['.choice-toggle', '.theme-toggle', '.language-toggle']
        const undrawn = []
        for (const group of groups) {
            const container = document.querySelector(group)
            expect(container).not.toBeNull()
            for (const button of container.querySelectorAll('button')) {
                // 선택자를 통째로 견준다. body.dark-mode 가 앞에 붙은 규칙은
                // 다른 선택자이므로 자연히 빠진다 - 다크에만 있으면 라이트에서는
                // 여전히 두 버튼이 같아 보이고, 그 어긋남은 이 파일에서 몇 번이나
                // 반복됐다.
                const declares = (selector) => CSS.split('}').some((block) =>
                    block.split('{')[0].split(',').some((s) => s.trim() === selector))
                const drawn = [...button.classList]
                    .filter((c) => c !== 'active')
                    .some((c) => declares(`.${c}.active`))
                if (!drawn) undrawn.push(`${group} > #${button.id}`)
            }
        }

        expect(undrawn).toEqual([])
    })

    // Linux 에서 Electron 은 이 API 를 구현하지 않는다. 눌러도 아무 일도 없는
    // 스위치를 보이느니 줄 전체를 감춘다.
    test('a platform that cannot do it hides the whole row', async () => {
        const manager = await boot([])
        electronAPI.getOpenAtLogin.mockResolvedValue({ supported: false, openAtLogin: false })
        await openSettings(manager)

        expect(document.getElementById('settingsStartupLabel').parentNode.style.display)
            .toBe('none')
    })
})

describe('the attachment column earns its place', () => {
    const withFile = (id) => task(id, {
        attachments: [{ name: 'spec.pdf', path: '/docs/spec.pdf' }]
    })
    const many = (count) => task('m', {
        attachments: Array.from({ length: count }, (_, i) =>
            ({ name: `file${i}.pdf`, path: `/docs/file${i}.pdf` }))
    })
    const shown = () =>
        document.getElementById('tasksTable').classList.contains('has-attachments')
    const names = () => [...document.querySelectorAll('#tasksBody .attach-link')]
        .map((a) => a.textContent)

    test('a list with no attachments does not show it', async () => {
        await boot([task('a'), task('b')])

        expect(shown()).toBe(false)
    })

    test('one attachment anywhere brings it out', async () => {
        await boot([task('a'), withFile('b')])

        expect(shown()).toBe(true)
        expect(names()).toEqual(['spec.pdf'])
    })

    // Deciding per page would add and remove the column as you page, and the
    // table is built on the promise that columns do not move.
    test('the whole list decides, not the page', async () => {
        const manager = await boot([...Array.from({ length: 12 }, (_, i) => task('t' + i)), withFile('z')])
        manager.tasksPerPage = 10
        manager.currentPage = 1
        manager.renderTasks()

        expect(shown()).toBe(true)
    })

    test('it sits after the task content, not before it', async () => {
        await boot([withFile('a')])

        const cells = [...document.querySelector('#tasksBody tr').cells]
        expect(cells.findIndex((c) => c.classList.contains('attach-col')))
            .toBe(cells.findIndex((c) => c.classList.contains('task-content')) + 1)
    })

    // 클립 하나로는 무엇이 붙어 있는지 알 수 없어, 알려면 매번 눌러 봐야 했다.
    // 이름이야말로 링크가 끊긴 뒤에도 남기려던 것이다.
    test('every name is written out, not just a count', async () => {
        await boot([task('a', { attachments: [
            { name: '견적서.xlsx', path: 'C:/docs/견적서.xlsx' },
            { name: 'notes.txt', path: '/docs/notes.txt' }
        ] })])

        expect(names()).toEqual(['견적서.xlsx', 'notes.txt'])
        expect(document.querySelector('#tasksBody .attach-link').title)
            .toBe('C:/docs/견적서.xlsx')
    })

    // 첨부는 행의 일부가 아니라 누르는 것이다. 멈추지 않으면 파일을 열면서
    // 행까지 선택된다.
    test('pressing a name opens that file and leaves the row alone', async () => {
        const manager = await boot([task('a', { attachments: [
            { name: 'spec.pdf', path: '/docs/spec.pdf' },
            { name: 'notes.txt', path: '/docs/notes.txt' }
        ] })])

        document.querySelectorAll('#tasksBody .attach-link')[1].click()
        await settle()

        expect(electronAPI.openAttachment).toHaveBeenCalledWith('/docs/notes.txt')
        expect(manager.selectedTaskIds.size).toBe(0)
    })

    // 자르지 않는다. 작업 내용은 열 줄이 되어도 그대로 늘어나고, 표는 그것을
    // 감당하도록 만들어져 있다.
    test('a long list is written out in full, not capped', async () => {
        await boot([many(10)])

        expect(names()).toHaveLength(10)
        expect(names()[9]).toBe('file9.pdf')
    })

    // 끊긴 링크는 감추지 않는다. 무엇이 붙어 있었는지가 남는 것이 첨부의 절반이고,
    // 이름이 늘 보이므로 그 표시도 늘 보여야 한다 - 눌러야 알 수 있으면 안 된다.
    test('a file that is gone is struck through without being clicked', async () => {
        const manager = await boot([many(3)])
        electronAPI.checkAttachments.mockResolvedValue({
            '/docs/file0.pdf': true, '/docs/file1.pdf': false, '/docs/file2.pdf': true
        })
        manager.renderTasks()
        await settle()

        const links = [...document.querySelectorAll('#tasksBody .attach-link')]
        expect(links.map((a) => a.classList.contains('missing')))
            .toEqual([false, true, false])
        expect(links[1].title).toContain('/docs/file1.pdf')
    })

    // 상태가 바뀌지 않으면 표는 몇 시간이고 다시 그려지지 않는다. 그동안 지운
    // 파일이 멀쩡해 보이면 표시를 믿을 수 없고, 못 믿을 표시는 없느니만 못하다.
    // 파일을 옮기려면 다른 프로그램으로 나갔다 와야 하므로 돌아오는 순간에 묻는다.
    test('coming back to the window asks again', async () => {
        await boot([many(2)])
        await settle()
        expect(document.querySelectorAll('#tasksBody .attach-link.missing')).toHaveLength(0)

        electronAPI.checkAttachments.mockResolvedValue({
            '/docs/file0.pdf': false, '/docs/file1.pdf': true
        })
        window.dispatchEvent(new Event('focus'))
        await settle()

        expect([...document.querySelectorAll('#tasksBody .attach-link')]
            .map((a) => a.classList.contains('missing'))).toEqual([true, false])
    })

    // 붙이기만 하고 떼지 않으면, 옮겼던 파일을 되돌려 놔도 계속 그어져 있다.
    test('a file put back loses the line again', async () => {
        await boot([many(1)])
        electronAPI.checkAttachments.mockResolvedValue({ '/docs/file0.pdf': false })
        window.dispatchEvent(new Event('focus'))
        await settle()
        expect(document.querySelector('#tasksBody .attach-link').classList
            .contains('missing')).toBe(true)

        electronAPI.checkAttachments.mockResolvedValue({ '/docs/file0.pdf': true })
        window.dispatchEvent(new Event('focus'))
        await settle()

        const link = document.querySelector('#tasksBody .attach-link')
        expect(link.classList.contains('missing')).toBe(false)
        expect(link.title).toBe('/docs/file0.pdf')
    })

    // 화면에 첨부가 하나도 없으면 아예 묻지 않는다 - 대부분의 목록이 그렇고,
    // 그 경우 렌더 경로에 IPC 왕복이 붙으면 순전히 낭비다.
    test('a list with no attachments asks the OS nothing', async () => {
        await boot([task('a'), task('b')])

        expect(electronAPI.checkAttachments).not.toHaveBeenCalled()
    })

    // 옆 칸들은 전부 말인데 여기만 그림이면 무슨 칸인지 읽히지 않는다.
    test('the header is a word, in the reader language', async () => {
        await boot([withFile('a')])

        expect(document.getElementById('thAttachments').textContent).toBe('Files')
    })

    test('an empty list still spans the whole row', async () => {
        await boot([])

        expect(document.querySelector('#tasksBody .empty-message').getAttribute('colspan'))
            .toBe('7')
    })
})

describe('sorting the table', () => {
    const at = (day, time) => `2026-08-${String(day).padStart(2, '0')} ${time}`
    const setup = () => [
        task('a', { startDateTime: at(12, '09:00'), targetDateTime: at(20, '18:00') }),
        task('b', { startDateTime: at(10, '09:00'), targetDateTime: at(14, '18:00') }),
        task('c', { startDateTime: at(15, '09:00'), targetDateTime: at(16, '18:00') })
    ]
    const header = (which) => document.querySelector(`th[data-sort="${which}"]`)
    const column = (n) =>
        rows().map((row) => row.cells[n].textContent.trim())
    // 컬럼 번호가 아니라 클래스로 잡는다. 첨부 컬럼이 생기면서 내용 칸이
    // 한 자리 밀렸고, 번호로 읽던 검사가 엉뚱한 칸을 보고 있었다.
    const contents = () =>
        rows().map((row) => row.querySelector('.task-content').textContent.trim())
    const numbers = () => column(1)

    test('leaves the stored order alone', async () => {
        const manager = await boot(setup())

        header('start').click()

        expect(contents()).toEqual(['task b', 'task a', 'task c'])
        // 화면만 바뀌었을 뿐, 저장된 순서는 그대로다
        expect(manager.tasks.map((t) => t.id)).toEqual(['a', 'b', 'c'])
        expect(electronAPI.saveTasks).not.toHaveBeenCalled()
    })

    // The numbers travelling with their rows is what says "this is temporary".
    // Renumbering 1,2,3 would look like the manual order had been rewritten.
    test('rows keep the number they had', async () => {
        await boot(setup())
        expect(numbers()).toEqual(['1', '2', '3'])

        header('start').click()

        expect(numbers()).toEqual(['2', '1', '3'])
    })

    test('cycles ascending, descending, then back to the original', async () => {
        const manager = await boot(setup())

        header('target').click()
        expect(contents()).toEqual(['task b', 'task c', 'task a'])

        header('target').click()
        expect(contents()).toEqual(['task a', 'task c', 'task b'])

        header('target').click()
        expect(contents()).toEqual(['task a', 'task b', 'task c'])
        expect(manager.sortBy).toBeNull()
    })

    test('switching columns starts ascending again', async () => {
        const manager = await boot(setup())
        header('start').click()
        header('start').click()
        expect(manager.sortAscending).toBe(false)

        header('target').click()

        expect(manager.sortBy).toBe('target')
        expect(manager.sortAscending).toBe(true)
    })

    // Up and down mean "swap with the neighbour". Under a sort the neighbour on
    // screen is not the neighbour in the list, so the row would jump somewhere
    // the user cannot see.
    test('locks reordering while sorted', async () => {
        await boot(setup())
        const box = document.querySelector('.task-select')
        box.checked = true
        box.dispatchEvent(new window.Event('change', { bubbles: true }))
        expect(document.querySelector('[data-bulk="up"]').disabled).toBe(false)

        header('start').click()

        expect(document.querySelector('[data-bulk="up"]').disabled).toBe(true)
        expect(document.querySelector('[data-bulk="down"]').disabled).toBe(true)
    })

    test('reordering comes back once the sort is cleared', async () => {
        await boot(setup())
        const box = document.querySelector('.task-select')
        box.checked = true
        box.dispatchEvent(new window.Event('change', { bubbles: true }))

        header('start').click()
        header('start').click()
        header('start').click()

        expect(document.querySelector('[data-bulk="up"]').disabled).toBe(false)
    })

    // A task with no target has nothing to compare. Letting it swap ends would
    // look like it had vanished from where you left it.
    test('keeps undated tasks at the end whichever way it sorts', async () => {
        await boot([
            task('dated', { targetDateTime: at(14, '18:00') }),
            task('undated', { targetDateTime: '' }),
            task('later', { targetDateTime: at(20, '18:00') })
        ])

        header('target').click()
        expect(contents()).toEqual(['task dated', 'task later', 'task undated'])

        header('target').click()
        expect(contents()).toEqual(['task later', 'task dated', 'task undated'])
    })

    // It is a way of looking, not a preference.
    test('is forgotten on restart', async () => {
        const manager = await boot(setup())
        header('start').click()

        const restarted = await boot(setup())

        expect(restarted.sortBy).toBeNull()
        expect(manager.sortBy).toBe('start')
    })
})

// Attachments are links, not copies. A completed task leaves tasks.json
// entirely, so a copied file would outlive every reference to it - and the
// original is sitting on the user's disk regardless.
describe('attachments', () => {
    const list = () =>
        Array.from(document.querySelectorAll('#attachmentList .attachment-item'))
    const names = () => list().map((li) => li.querySelector('[data-open]').textContent)
    const openModal = async (manager, task) => {
        manager.showModal(task)
        await settle()
    }

    test('stores the path and the name, and copies nothing', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])

        manager.addAttachments([{ name: 'quote.xlsx', path: 'C:/docs/quote.xlsx' }])
        document.getElementById('taskContent').value = 'with a file'
        await manager.saveTask()
        await settle()

        expect(manager.tasks[0].attachments).toEqual([
            { name: 'quote.xlsx', path: 'C:/docs/quote.xlsx' }
        ])
    })

    // The name is kept apart from the path precisely so a broken link still
    // says what was attached.
    test('shows the name and keeps the path as the tooltip', async () => {
        const manager = await boot([
            task('a', { attachments: [{ name: 'quote.xlsx', path: 'C:/docs/quote.xlsx' }] })
        ])

        await openModal(manager, manager.tasks[0])

        expect(names()).toEqual(['quote.xlsx'])
        expect(list()[0].querySelector('[data-open]').title).toBe('C:/docs/quote.xlsx')
    })

    // A path is an opaque string from the OS, handed straight back to it. The
    // app never parses one, so there is nothing to branch on per platform -
    // but the string does cross two boundaries where it could be mangled:
    // JSON storage, and the HTML attribute the tooltip is built into.
    test('carries a native path across platforms without touching it', async () => {
        const windowsPath = 'C:\\Users\\me\\내 문서\\견적서.xlsx'
        const posixPath = '/home/me/docs/quote.xlsx'
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])

        manager.addAttachments([
            { name: '견적서.xlsx', path: windowsPath },
            { name: 'quote.xlsx', path: posixPath }
        ])
        document.getElementById('taskContent').value = 'both shapes'
        await manager.saveTask()
        await settle()

        expect(manager.tasks[0].attachments.map((a) => a.path))
            .toEqual([windowsPath, posixPath])

        await openModal(manager, manager.tasks[0])
        expect(list()[0].querySelector('[data-open]').title).toBe(windowsPath)
        expect(list()[0].dataset.path).toBe(windowsPath)
        expect(list()[1].querySelector('[data-open]').title).toBe(posixPath)
    })

    // Deliberately not normalised: separators are the OS's business, and
    // rewriting them would be the app claiming to understand a path it does not.
    test('treats separators as part of the string, not something to normalise', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])

        manager.addAttachments([{ name: 'a.txt', path: 'C:\\docs\\a.txt' }])
        manager.addAttachments([{ name: 'a.txt', path: 'C:/docs/a.txt' }])

        expect(list().map((li) => li.dataset.path))
            .toEqual(['C:\\docs\\a.txt', 'C:/docs/a.txt'])
    })

    // A file dropped anywhere Chromium has not been told to ignore makes it
    // navigate to that file - which surfaces as "Downloads file not found" and
    // takes the whole screen with it. The document has to refuse the default
    // wherever the drop lands.
    test('the document refuses stray drops so the app cannot navigate away', async () => {
        await boot([task('a')])

        for (const type of ['dragover', 'drop']) {
            const event = new window.Event(type, { bubbles: true, cancelable: true })
            document.body.dispatchEvent(event)
            expect(event.defaultPrevented).toBe(true)
        }
    })

    // The dashed box says where the file is going; it is not the only place it
    // can land. Aiming at a thin bar is most of what made dropping miss.
    test('a drop anywhere in the edit form attaches', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])

        const event = new window.Event('drop', { bubbles: true, cancelable: true })
        event.dataTransfer = { files: [{ name: 'spec.txt' }] }
        document.getElementById('taskContent').dispatchEvent(event)
        await settle()

        expect(names()).toEqual(['spec.txt'])
    })

    // The button path never ran: every other test called addAttachments itself.
    test('choosing files through the button attaches them', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])
        electronAPI.pickAttachments.mockResolvedValue([
            { name: 'spec.pdf', path: '/docs/spec.pdf' }
        ])

        document.getElementById('attachmentPickBtn').click()
        await settle()

        expect(names()).toEqual(['spec.pdf'])
    })

    // The one path that learns the truth from the OS rather than from a stat:
    // opening failed, so the entry is redrawn and the user is told.
    test('a failed open says so and re-checks the list', async () => {
        const manager = await boot([
            task('a', { attachments: [{ name: 'gone.txt', path: '/gone.txt' }] })
        ])
        await openModal(manager, manager.tasks[0])
        electronAPI.openAttachment.mockResolvedValue({ ok: false, reason: 'missing' })
        electronAPI.checkAttachments.mockResolvedValue({ '/gone.txt': false })
        window.alert = jest.fn()

        list()[0].querySelector('[data-open]').click()
        await settle()
        await settle()

        expect(electronAPI.openAttachment).toHaveBeenCalledWith('/gone.txt')
        expect(window.alert).toHaveBeenCalled()
        expect(list()[0].classList.contains('missing')).toBe(true)
    })

    test('the folder icon reveals rather than opens', async () => {
        const manager = await boot([
            task('a', { attachments: [{ name: 'spec.pdf', path: '/docs/spec.pdf' }] })
        ])
        await openModal(manager, manager.tasks[0])

        list()[0].querySelector('[data-reveal]').click()
        await settle()

        expect(electronAPI.revealAttachment).toHaveBeenCalledWith('/docs/spec.pdf')
        expect(electronAPI.openAttachment).not.toHaveBeenCalled()
    })

    test('drops the same file twice into one entry', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])

        manager.addAttachments([{ name: 'a.txt', path: 'C:/a.txt' }])
        manager.addAttachments([{ name: 'a.txt', path: 'C:/a.txt' }])

        expect(names()).toEqual(['a.txt'])
    })

    test('removes one without touching the rest', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])
        manager.addAttachments([
            { name: 'a.txt', path: 'C:/a.txt' },
            { name: 'b.txt', path: 'C:/b.txt' }
        ])

        manager.removeAttachment('C:/a.txt')

        expect(names()).toEqual(['b.txt'])
    })

    // Most tasks have no attachment; adding an empty array to every row would
    // grow tasks.json and every backup for nothing.
    test('adds no field when there is nothing attached', async () => {
        const manager = await boot([task('a')])
        await openModal(manager, manager.tasks[0])

        document.getElementById('taskContent').value = 'plain'
        await manager.saveTask()
        await settle()

        expect('attachments' in manager.tasks[0]).toBe(false)
    })

    test('opening a task without attachments shows an empty list', async () => {
        const manager = await boot([
            task('a', { attachments: [{ name: 'x.txt', path: 'C:/x.txt' }] }),
            task('b')
        ])

        await openModal(manager, manager.tasks[0])
        expect(names()).toEqual(['x.txt'])

        await openModal(manager, manager.tasks[1])
        expect(names()).toEqual([])
    })

    // Silently doing nothing would look like the app was broken rather than
    // the file being gone.
    test('says so when the file is no longer there', async () => {
        const manager = await boot([task('a')])
        electronAPI.openAttachment = jest.fn().mockResolvedValue({ ok: false, reason: 'missing' })
        jest.spyOn(window, 'alert').mockImplementation(() => {})

        await manager.openAttachment('C:/gone.txt')

        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('C:/gone.txt'))
    })
})
