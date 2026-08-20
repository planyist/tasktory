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
const TaskManager = new Function(`${I18N}\n${SOURCE}\nreturn TaskManager;`)()

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
        setAlwaysOnTop: jest.fn()
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
        expect(document.querySelector('#tasksBody tr').cells).toHaveLength(7)
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

        document
            .querySelector('#tasksBody tr')
            .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))

        expect(manager.showModal).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'a' })
        )
    })

    // Delaying the first click until a double-click could be ruled out would
    // freeze every ordinary selection for the OS threshold (500ms on Windows).
    // Instead both clicks toggle - and an even number of toggles lands back
    // where it started, so the selection is untouched.
    test('a double-click leaves the selection exactly as it was', async () => {
        const manager = await boot([task('a'), task('b')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})
        const row = document.querySelector('#tasksBody tr')
        const twoClicks = () => {
            row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
            row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
            row.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))
        }

        twoClicks()
        expect(manager.selectedTaskIds.has('a')).toBe(false)

        // and from the selected state it stays selected
        pick('a')
        twoClicks()
        expect(manager.selectedTaskIds.has('a')).toBe(true)
    })

    test('double-clicking the checkbox does not open the modal', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        document
            .querySelector('#tasksBody .task-select')
            .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))

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

        // The chosen time goes into the log body; the row itself is gone.
        const logged = electronAPI.addLog.mock.calls.map((c) => c[0]).find(
            (entry) => entry.action === 'COMPLETE'
        )
        expect(logged.details).toContain('at 2026-08-01 09:00')
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
    const HEADER = 'TIMESTAMP\tACTION\tSTATUS\tTASK_ID\tSTART_TIME\tTARGET_TIME\tTAGS\tCONTENT'
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

    test('splits a combined sheet back into dated files', async () => {
        const manager = await boot([])

        const files = manager.parseHistoryTsv(
            `${HEADER}\n${row('2026-08-04T09:00:00+09:00', 'ADD')}\n${row('2026-08-05T10:00:00+09:00', 'COMPLETE')}\n`
        )

        expect(Object.keys(files).sort()).toEqual(['2026-08-04.tsv', '2026-08-05.tsv'])
        expect(files['2026-08-04.tsv'].split('\n')[0]).toBe(HEADER)
    })

    test('ignores rows that do not start with a date', async () => {
        const manager = await boot([])

        expect(manager.parseHistoryTsv(`${HEADER}\ngarbage line\n\n`)).toEqual({})
    })

    test('a round trip preserves every row', async () => {
        const manager = await boot([])
        const original = {
            '2026-08-04.tsv': `${HEADER}\n${row('2026-08-04T09:00:00+09:00', 'ADD')}\n`,
            '2026-08-05.tsv': `${HEADER}\n${row('2026-08-05T10:00:00+09:00', 'COMPLETE')}\n`
        }

        expect(manager.parseHistoryTsv(manager.buildHistoryTsv(original))).toEqual(original)
    })

    test('exporting writes both the backup and the history sheet', async () => {
        const manager = await boot([task('a')])
        electronAPI.exportData.mockResolvedValue({
            tasks: [], rules: [], version: '1.2',
            logFiles: { '2026-08-04.tsv': `${HEADER}\n${row('2026-08-04T09:00:00+09:00', 'ADD')}\n` }
        })

        const names = []
        window.URL.createObjectURL = jest.fn(() => 'blob:fake')
        window.URL.revokeObjectURL = jest.fn()
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            names.push(this.download)
        })

        await manager.exportData()

        expect(names).toHaveLength(2)
        expect(names[0]).toMatch(/^tasktory-backup-\d{4}-\d{2}-\d{2}\.json$/)
        expect(names[1]).toMatch(/^tasktory-history-\d{4}-\d{2}-\d{2}\.tsv$/)
    })

    test('importing a history sheet keeps the current tasks and rules', async () => {
        const manager = await boot([task('a')])
        electronAPI.importData = jest.fn().mockResolvedValue(true)
        jest.spyOn(window, 'alert').mockImplementation(() => {})

        await manager.importHistoryTsv(`${HEADER}\n${row('2026-08-04T09:00:00+09:00', 'ADD')}\n`)

        const payload = electronAPI.importData.mock.calls[0][0]
        expect(Object.keys(payload.logFiles)).toEqual(['2026-08-04.tsv'])
        expect(payload.tasks.map((t) => t.id)).toEqual(['a'])
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
// View-only on purpose - nothing in a cell is clickable.
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

    // It belongs with the other screen-mode switches, not beside the quick
    // filters, where it read as one more filter chip. The row ends with the
    // three controls that change what the window is showing or doing; the
    // buttons that open a dialog come before them.
    test('sits with the other screen controls at the end of the header', async () => {
        await boot([task('a')])

        expect(button().closest('.header-buttons')).not.toBeNull()
        expect(button().closest('#quickFilters')).toBeNull()

        const ids = Array.from(document.querySelectorAll('.header-buttons > button'))
            .map((el) => el.id)
        expect(ids.slice(-3)).toEqual(['viewModeBtn', 'alwaysOnTopBtn', 'collapseBtn'])
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
})

describe('always-on-top pin', () => {
    const pin = () => document.getElementById('alwaysOnTopBtn')

    test('starts pinned, because the window is created that way', async () => {
        const manager = await boot([task('a')])

        expect(manager.alwaysOnTop).toBe(true)
        expect(pin().classList.contains('active')).toBe(true)
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

    // main.js holds it in a plain variable, so the renderer has to push the
    // stored value on every launch - the same shape as unfocused opacity.
    test('remembers the choice and pushes it to main', async () => {
        const manager = await boot([task('a')])

        pin().click()

        expect(localStorage.getItem('alwaysOnTop')).toBe('false')
        expect(window.electronAPI.setAlwaysOnTop).toHaveBeenLastCalledWith(false)

        pin().click()

        expect(localStorage.getItem('alwaysOnTop')).toBe('true')
        expect(window.electronAPI.setAlwaysOnTop).toHaveBeenLastCalledWith(true)
        expect(manager.alwaysOnTop).toBe(true)
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
    const contents = () => column(5)
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
