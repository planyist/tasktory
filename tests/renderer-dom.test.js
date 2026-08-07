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
        exportData: jest.fn(async () => ({
            tasks: JSON.parse(JSON.stringify(stored)),
            rules: [],
            logFiles: {},
            exportDate: '2026-08-04T00:00:00.000Z',
            version: '1.2'
        })),
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

    test('double-clicking a row opens it for editing', async () => {
        const manager = await boot([task('a')])
        jest.spyOn(manager, 'showModal').mockImplementation(() => {})

        document
            .querySelector('#tasksBody tr')
            .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }))

        expect(manager.showModal).toHaveBeenCalled()
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

    test('completing in bulk applies to every selected task', async () => {
        const manager = await boot([task('a'), task('b'), task('c')])
        pick('a')
        pick('c')

        await barBtn('complete').click()
        await settle()

        expect(manager.tasks.filter((t) => t.completed).map((t) => t.id)).toEqual(['a', 'c'])
        expect(manager.tasks.find((t) => t.id === 'b').completed).toBe(false)
    })

    test('deleting in bulk removes only the selected rows', async () => {
        const manager = await boot([task('a'), task('b'), task('c')])
        pick('b')

        await barBtn('delete').click()
        await settle()

        expect(manager.tasks.map((t) => t.id)).toEqual(['a', 'c'])
    })

    test('the selection clears after a bulk action', async () => {
        const manager = await boot([task('a'), task('b')])
        pick('a')

        await barBtn('highlight').click()
        await settle()

        expect(manager.selectedTaskIds.size).toBe(0)
        expect(barBtn('complete').disabled).toBe(true)
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
    test('binds each control exactly once', async () => {
        await boot([task('a')])

        document.getElementById('startDateTime').value = '2026-08-04 15:30'
        document.querySelector('.datetime-pick-btn[data-target="startDateTime"]').click()
        const label = () => document.getElementById('dtpMonthLabel').textContent

        expect(label()).toContain('August')
        document.getElementById('dtpNextMonth').click()
        expect(label()).toContain('September')
        document.getElementById('dtpPrevMonth').click()
        expect(label()).toContain('August')
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

    test('clicking a chip resets the scope so the match is not hidden', async () => {
        const manager = await boot(setup())
        search(manager, 'zzz', 'content')

        document.querySelector('#tasksBody .empty-message')
        manager.applyChipFilter('#home')

        expect(manager.searchColumn).toBe('all')
        expect(rowCount()).toBe(1)
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
