/**
 * @jest-environment jsdom
 */
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const HTML = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))

const TaskManager = new Function(
    `${fs.readFileSync(path.join(root, 'renderer.js'), 'utf8')}\nreturn TaskManager;`
)()

// index.html loads recurrence.js before renderer.js, so the class expects a
// Recurrence global to be present.
global.Recurrence = new Function(
    `${fs.readFileSync(path.join(root, 'recurrence.js'), 'utf8')}\nreturn Recurrence;`
)()

const settle = async () => {
    for (let i = 0; i < 40; i++) await Promise.resolve()
}

let storedTasks
let storedRules
let electronAPI

const boot = async ({ tasks = [], rules = [] } = {}) => {
    storedTasks = tasks
    storedRules = rules
    electronAPI = {
        loadTasks: jest.fn(async () => JSON.parse(JSON.stringify(storedTasks))),
        saveTasks: jest.fn(async (next) => {
            storedTasks = JSON.parse(JSON.stringify(next))
            return true
        }),
        loadRules: jest.fn(async () => JSON.parse(JSON.stringify(storedRules))),
        saveRules: jest.fn(async (next) => {
            storedRules = JSON.parse(JSON.stringify(next))
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

const fillTaskForm = ({ start, target, content, position = 1 }) => {
    document.getElementById('startDateTime').value = start
    document.getElementById('targetDateTime').value = target
    document.getElementById('taskContent').value = content
    document.getElementById('taskPosition').value = String(position)
}

const chooseRepeat = (freq, { interval, weekdays = [] } = {}) => {
    const select = document.getElementById('taskRepeat')
    select.value = freq
    select.dispatchEvent(new window.Event('change'))

    if (interval !== undefined) {
        document.getElementById('taskRepeatInterval').value = String(interval)
    }
    for (const day of weekdays) {
        document.querySelector(`#repeatWeekdays .weekday-btn[data-weekday="${day}"]`).click()
    }
}

const visible = (id) => document.getElementById(id).style.display !== 'none'

beforeEach(() => {
    document.body.innerHTML = BODY
    localStorage.clear()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(window, 'alert').mockImplementation(() => {})
    jest.spyOn(TaskManager.prototype, 'startNotificationCheck').mockImplementation(() => {})
})

afterEach(() => {
    jest.restoreAllMocks()
    delete window.electronAPI
})

describe('repeat controls', () => {
    test('are hidden until a frequency is chosen', async () => {
        await boot()

        expect(visible('repeatIntervalWrap')).toBe(false)
        expect(visible('repeatWeekdays')).toBe(false)
    })

    test('daily reveals the interval but not the weekday picker', async () => {
        await boot()

        chooseRepeat('daily')

        expect(visible('repeatIntervalWrap')).toBe(true)
        expect(visible('repeatWeekdays')).toBe(false)
        expect(document.getElementById('labelRepeatUnit').textContent).toBe('days')
    })

    test('weekly reveals the weekday picker with seven buttons', async () => {
        await boot()

        chooseRepeat('weekly')

        expect(visible('repeatWeekdays')).toBe(true)
        expect(document.querySelectorAll('#repeatWeekdays .weekday-btn')).toHaveLength(7)
    })

    test('weekday buttons toggle on click', async () => {
        await boot()
        chooseRepeat('weekly')

        const monday = document.querySelector('#repeatWeekdays .weekday-btn[data-weekday="1"]')
        monday.click()
        expect(monday.classList.contains('selected')).toBe(true)

        monday.click()
        expect(monday.classList.contains('selected')).toBe(false)
    })

    test('are localised with the selected language', async () => {
        localStorage.setItem('selectedLanguage', 'ko')
        await boot()

        expect(document.getElementById('labelRepeat').textContent).toBe('반복')
        expect(document.getElementById('taskRepeat').options[0].textContent).toBe('반복 안 함')

        chooseRepeat('weekly')
        const labels = Array.from(document.querySelectorAll('#repeatWeekdays .weekday-btn')).map(
            (b) => b.textContent
        )
        expect(labels).toEqual(['일', '월', '화', '수', '목', '금', '토'])
    })

    test('monthly and yearly reveal the interval without the weekday picker', async () => {
        await boot()

        chooseRepeat('monthly')
        expect(visible('repeatIntervalWrap')).toBe(true)
        expect(visible('repeatWeekdays')).toBe(false)
        expect(document.getElementById('labelRepeatUnit').textContent).toBe('months')

        chooseRepeat('yearly')
        expect(document.getElementById('labelRepeatUnit').textContent).toBe('years')
    })
})

describe('editing a task', () => {
    const repeatingSetup = () => ({
        rules: [
            {
                id: 'rule-1',
                content: 'weekly report',
                tags: '',
                freq: 'weekly',
                interval: 1,
                byWeekday: [1],
                anchorDate: '2026-08-03',
                startTimeOfDay: '09:00',
                targetTimeOfDay: '18:00',
                enabled: true
            }
        ],
        tasks: [
            {
                id: 'task-1',
                content: 'weekly report',
                tags: '',
                startDateTime: '2026-08-03 09:00',
                targetDateTime: '2026-08-03 18:00',
                completed: false,
                ruleId: 'rule-1',
            }
        ]
    })

    const plainTask = () => ({
        tasks: [
            {
                id: 'task-1',
                content: 'one-off',
                tags: '',
                startDateTime: '2026-08-04 09:00',
                targetDateTime: '2026-08-04 18:00',
                completed: false
            }
        ]
    })

    test('shows the repeat section filled in from the rule', async () => {
        const manager = await boot(repeatingSetup())

        manager.showModal(manager.tasks[0])

        expect(visible('repeatGroup')).toBe(true)
        expect(document.getElementById('taskRepeat').value).toBe('weekly')
        expect(
            document.querySelector('#repeatWeekdays .weekday-btn[data-weekday="1"]').classList
                .contains('selected')
        ).toBe(true)
    })

    test('leaves the repeat section blank for a non-repeating task', async () => {
        const manager = await boot(plainTask())

        manager.showModal(manager.tasks[0])

        expect(document.getElementById('taskRepeat').value).toBe('none')
        expect(visible('repeatWeekdays')).toBe(false)
    })

    test('updates the rule in place, keeping its id', async () => {
        const manager = await boot(repeatingSetup())
        manager.showModal(manager.tasks[0])

        fillTaskForm({
            start: '2026-08-03 09:00',
            target: '2026-08-03 18:00',
            content: 'weekly report'
        })
        chooseRepeat('weekly', { interval: 2, weekdays: [3] })

        await manager.saveTask()
        await settle()

        expect(storedRules).toHaveLength(1)
        expect(storedRules[0]).toMatchObject({
            id: 'rule-1',
            interval: 2,
            byWeekday: [1, 3]
        })
        // The id must survive, or the row loses its link to the rule.
        expect(storedTasks[0].ruleId).toBe('rule-1')
    })

    test('turning repeat off deletes the rule but keeps the task', async () => {
        const manager = await boot(repeatingSetup())
        manager.showModal(manager.tasks[0])

        fillTaskForm({
            start: '2026-08-03 09:00',
            target: '2026-08-03 18:00',
            content: 'weekly report'
        })
        chooseRepeat('none')

        await manager.saveTask()
        await settle()

        expect(storedRules).toEqual([])
        expect(storedTasks).toHaveLength(1)
        expect(storedTasks[0].ruleId).toBeUndefined()
        expect(document.querySelectorAll('#tasksBody .repeat-badge')).toHaveLength(0)
    })

    test('turning repeat on for a plain task creates a rule', async () => {
        const manager = await boot(plainTask())
        manager.showModal(manager.tasks[0])

        fillTaskForm({
            start: '2026-08-04 09:00',
            target: '2026-08-04 18:00',
            content: 'one-off'
        })
        chooseRepeat('monthly', { interval: 3 })

        await manager.saveTask()
        await settle()

        expect(storedRules).toHaveLength(1)
        expect(storedRules[0]).toMatchObject({
            freq: 'monthly',
            interval: 3,
            anchorDate: '2026-08-04'
        })
        expect(storedTasks[0].ruleId).toBe(storedRules[0].id)
    })
})

describe('creating a repeating task', () => {
    test('stores a rule and links the row to it', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-04 09:00',
            target: '2026-08-04 18:00',
            content: 'daily standup'
        })
        chooseRepeat('daily', { interval: 2 })

        await manager.saveTask()
        await settle()

        expect(storedRules).toHaveLength(1)
        expect(storedRules[0]).toMatchObject({
            content: 'daily standup',
            freq: 'daily',
            interval: 2,
            anchorDate: '2026-08-04',
            startTimeOfDay: '09:00',
            targetTimeOfDay: '18:00',
            enabled: true
        })

        const task = storedTasks.find((t) => t.content === 'daily standup')
        expect(task.ruleId).toBe(storedRules[0].id)
    })

    test('records the chosen weekdays for a weekly rule', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-03 09:00',
            target: '2026-08-03 18:00',
            content: 'gym'
        })
        chooseRepeat('weekly', { weekdays: [1, 3, 5] })

        await manager.saveTask()
        await settle()

        expect(storedRules[0].byWeekday).toEqual([1, 3, 5])
    })

    test('creates no rule when repeat is left off', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-04 09:00',
            target: '2026-08-04 18:00',
            content: 'one-off task'
        })

        await manager.saveTask()
        await settle()

        expect(storedRules).toEqual([])
        expect(storedTasks[0].ruleId).toBeUndefined()
    })

    test('shows the cadence once, under the start time', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-03 09:00',
            target: '2026-08-03 18:00',
            content: 'gym'
        })
        chooseRepeat('weekly', { weekdays: [1, 3] })

        await manager.saveTask()
        await settle()

        const row = document.querySelector('#tasksBody tr')
        const cadences = row.querySelectorAll('.repeat-cadence')

        // Both times share one rule, so printing it twice adds nothing.
        expect(cadences).toHaveLength(1)
        expect(cadences[0].textContent.trim()).toBe('Weekly Mon·Wed')
        // cells[0] select, cells[1] number, cells[2] Start Time.
        expect(row.cells[2].contains(cadences[0])).toBe(true)
        expect(row.querySelector('.task-content .repeat-cadence')).toBeNull()
    })

    test('spells out an interval greater than one', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-03 09:00',
            target: '2026-08-03 18:00',
            content: 'deep clean'
        })
        chooseRepeat('monthly', { interval: 3 })

        await manager.saveTask()
        await settle()

        expect(document.querySelector('.repeat-cadence').textContent.trim()).toBe(
            'every 3 months'
        )
    })

    test('marks the row with a repeat badge', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-04 09:00',
            target: '2026-08-04 18:00',
            content: 'daily standup'
        })
        chooseRepeat('daily')

        await manager.saveTask()
        await settle()

        expect(document.querySelectorAll('#tasksBody .repeat-badge')).toHaveLength(1)
    })
})

describe('searching recurring tasks', () => {
    // Pin the clock to a date where nothing is due, so start-up catch-up does
    // not add occurrences and change the row counts under the assertions.
    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-08-01T12:00:00'))
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    const setup = () => ({
        rules: [
            {
                id: 'rule-daily', content: 'standup', tags: '', freq: 'daily', interval: 1,
                byWeekday: [], anchorDate: '2026-08-01', startTimeOfDay: '09:00',
                targetTimeOfDay: '10:00', enabled: true
            },
            {
                id: 'rule-weekly', content: 'report', tags: '', freq: 'weekly', interval: 1,
                byWeekday: [1], anchorDate: '2026-08-03', startTimeOfDay: '09:00',
                targetTimeOfDay: '18:00', enabled: true
            }
        ],
        tasks: [
            {
                id: 't1', content: 'standup', tags: '', startDateTime: '2026-08-01 09:00',
                targetDateTime: '2026-08-01 10:00', completed: false,
                ruleId: 'rule-daily'
            },
            {
                id: 't2', content: 'report', tags: '', startDateTime: '2026-08-03 09:00',
                targetDateTime: '2026-08-03 18:00', completed: false,
                ruleId: 'rule-weekly'
            },
            {
                id: 't3', content: 'one-off errand', tags: '',
                startDateTime: '2026-08-04 09:00', targetDateTime: '2026-08-04 18:00',
                completed: false
            }
        ]
    })

    const search = async (manager, query) => {
        manager.searchQuery = query.toLowerCase()
        manager.renderTasks()
        return Array.from(document.querySelectorAll('#tasksBody tr'))
            .filter((row) => !row.querySelector('.empty-message'))
    }

    test('the repeating label pulls out every recurring task at once', async () => {
        const manager = await boot(setup())

        const rows = await search(manager, 'repeating')

        expect(rows).toHaveLength(2)
        expect(document.getElementById('tasksBody').textContent).not.toContain('one-off errand')
    })

    test('a cadence word narrows to that frequency', async () => {
        const manager = await boot(setup())

        const rows = await search(manager, 'weekly')

        expect(rows).toHaveLength(1)
        expect(document.getElementById('tasksBody').textContent).toContain('report')
    })

    test('a weekday name finds the rule that uses it', async () => {
        const manager = await boot(setup())

        expect(await search(manager, 'mon')).toHaveLength(1)
    })

    test('non-repeating tasks are still found by content', async () => {
        const manager = await boot(setup())

        const rows = await search(manager, 'errand')

        expect(rows).toHaveLength(1)
    })

    // Typing the right keyword is undiscoverable and changes with the UI
    // language, so every chip in the table filters by itself when clicked.
    // Chips in a row no longer jump to a search - the quick filters do that,
    // and hold several at once. What has to keep working is that a chip's
    // displayed text is what matches.
    describe('filtering by what a chip shows', () => {
        const visibleRows = () =>
            Array.from(document.querySelectorAll('#tasksBody tr')).filter(
                (row) => !row.querySelector('.empty-message')
            )
        const quickChip = (text) =>
            Array.from(document.querySelectorAll('#quickFilters .quick-chip')).find(
                (c) => c.textContent === text
            )

        // A coloured tag is stored as '#[RED]issue' but rendered as '#issue'.
        // Matching the stored form meant what you saw on screen found nothing.
        test('a quick filter uses the tag as displayed, not as stored', async () => {
            const data = setup()
            data.tasks[2].tags = '#[RED]issue'
            await boot(data)

            expect(document.querySelector('#tasksBody .tag').textContent).toBe('#issue')
            quickChip('#issue').click()

            expect(visibleRows()).toHaveLength(1)
            expect(document.getElementById('tasksBody').textContent).toContain('errand')
        })

        test('a coloured tag is still found by typing its displayed text', async () => {
            const data = setup()
            data.tasks[2].tags = '#[BLUE]urgent'
            const manager = await boot(data)

            expect(await search(manager, '#urgent')).toHaveLength(1)
        })

        test('a quick filter goes back to the first page', async () => {
            const manager = await boot(setup())
            manager.currentPage = 3

            quickChip(manager.getTaskStatus(manager.tasks[0]).text).click()

            expect(manager.currentPage).toBe(1)
        })
    })
})

describe('completing a repeating task', () => {
    const dailySetup = (overrides = {}) => ({
        rules: [
            {
                id: 'rule-1',
                content: 'standup',
                tags: '',
                freq: 'daily',
                interval: 1,
                byWeekday: [],
                anchorDate: '2026-08-01',
                startTimeOfDay: '09:00',
                targetTimeOfDay: '10:00',
                enabled: true,
                ...overrides
            }
        ],
        tasks: [
            {
                id: 'task-1',
                content: 'standup',
                tags: '',
                startDateTime: '2026-08-04 09:00',
                targetDateTime: '2026-08-04 10:00',
                completed: false,
                ruleId: 'rule-1'
            }
        ]
    })

    const visibleRows = () =>
        Array.from(document.querySelectorAll('#tasksBody tr')).filter(
            (row) => !row.querySelector('.empty-message')
        )

    // The row is the rule. Hiding it on completion would leave no way to see,
    // edit or stop the recurrence until the next occurrence came round.
    test('keeps the row and moves it to the next occurrence', async () => {
        const manager = await boot(dailySetup())

        await manager.doCompleteTask('task-1', null)
        await settle()

        expect(visibleRows()).toHaveLength(1)
        const task = manager.tasks.find((t) => t.id === 'task-1')
        expect(task.completed).toBe(false)
        expect(task.startDateTime).toBe('2026-08-05 09:00')
        expect(task.targetDateTime).toBe('2026-08-05 10:00')
    })

    test('logs the occurrence as completed so counters and stats still see it', async () => {
        const manager = await boot(dailySetup())

        await manager.doCompleteTask('task-1', null)
        await settle()

        expect(electronAPI.addLog).toHaveBeenCalledWith(
            expect.objectContaining({
                action: 'COMPLETE',
                task: expect.objectContaining({ completed: true })
            })
        )
    })

    test('advances one step at a time when several occurrences are overdue', async () => {
        const manager = await boot(dailySetup())

        await manager.doCompleteTask('task-1', null)
        await settle()
        await manager.doCompleteTask('task-1', null)
        await settle()

        // Two presses, two days. Skipping ahead is the user's call, by editing
        // the date, not something the app decides for them.
        expect(manager.tasks.find((t) => t.id === 'task-1').startDateTime).toBe('2026-08-06 09:00')
    })

    test('respects the interval when advancing', async () => {
        const manager = await boot(dailySetup({ interval: 3 }))

        await manager.doCompleteTask('task-1', null)
        await settle()

        expect(manager.tasks.find((t) => t.id === 'task-1').startDateTime).toBe('2026-08-07 09:00')
    })

    test('a disabled rule completes normally instead of advancing', async () => {
        const manager = await boot(dailySetup({ enabled: false }))

        await manager.doCompleteTask('task-1', null)
        await settle()

        expect(manager.tasks.find((t) => t.id === 'task-1')).toBeUndefined()
        expect(visibleRows()).toHaveLength(0)
    })

    test('a one-off task still disappears when completed', async () => {
        const manager = await boot({
            tasks: [
                {
                    id: 'task-1',
                    content: 'one-off',
                    startDateTime: '2026-08-04 09:00',
                    targetDateTime: '2026-08-04 18:00',
                    completed: false
                }
            ]
        })

        await manager.doCompleteTask('task-1', null)
        await settle()

        // The row leaves tasks.json entirely - the TSV log is the history, and
        // nothing ever read the completed copy kept here.
        expect(manager.tasks).toHaveLength(0)
        expect(visibleRows()).toHaveLength(0)
    })

    describe('deleting', () => {
        test('ends the recurrence along with the row', async () => {
            const manager = await boot(dailySetup())

            await manager.doDeleteTask('task-1', null)
            await settle()

            // Leaving the rule behind would resurrect the row on next launch,
            // with no way to reach it in between.
            expect(storedRules).toEqual([])
            expect(manager.tasks).toEqual([])
        })

        test('leaves other rules alone', async () => {
            const setup = dailySetup()
            setup.rules.push({ ...setup.rules[0], id: 'rule-2', content: 'other' })
            setup.tasks.push({
                id: 'task-2',
                content: 'other',
                startDateTime: '2026-08-04 09:00',
                targetDateTime: '2026-08-04 10:00',
                completed: false,
                ruleId: 'rule-2'
            })
            const manager = await boot(setup)

            await manager.doDeleteTask('task-1', null)
            await settle()

            expect(storedRules.map((r) => r.id)).toEqual(['rule-2'])
        })
    })

    // Old data (or an imported backup) can hold a rule whose occurrences were
    // all completed under the previous model, leaving nothing to click.
    test('gives an orphaned rule a row again on start-up', async () => {
        const setup = dailySetup()
        setup.tasks[0].completed = true

        const manager = await boot(setup)

        const active = manager.tasks.filter((t) => !t.completed && t.ruleId === 'rule-1')
        expect(active).toHaveLength(1)
        expect(electronAPI.saveTasks).toHaveBeenCalled()
    })

    test('does not add a second row when the rule already has one', async () => {
        const manager = await boot(dailySetup())

        expect(manager.tasks.filter((t) => t.ruleId === 'rule-1')).toHaveLength(1)
    })
})

// 언제까지 반복할지. 비워두면 예전처럼 끝없이 이어진다.
describe('repeat end date', () => {
    const until = () => document.getElementById('taskRepeatUntil')
    const row = () => document.getElementById('repeatUntilRow')

    test('appears only once a repeat is chosen', async () => {
        const manager = await boot()

        document.getElementById('taskRepeat').value = 'none'
        manager.updateRepeatVisibility()
        expect(row().style.display).toBe('none')

        document.getElementById('taskRepeat').value = 'daily'
        manager.updateRepeatVisibility()
        expect(row().style.display).not.toBe('none')
    })

    test('is written onto the rule in storage format', async () => {
        const manager = await boot()

        document.getElementById('taskRepeat').value = 'daily'
        until().value = '2026-12-31 00:00'

        const rule = manager.buildRuleFromForm({
            content: 'x', tags: '',
            startDateTime: '2026-08-12 09:00',
            targetDateTime: '2026-08-12 18:00'
        })

        expect(rule.untilDate).toBe('2026-12-31')
    })

    // 비워두는 것이 기본이고, 그 뜻은 "끝없이"다.
    test('an empty field means no end', async () => {
        const manager = await boot()

        document.getElementById('taskRepeat').value = 'daily'
        until().value = ''

        const rule = manager.buildRuleFromForm({
            content: 'x', tags: '',
            startDateTime: '2026-08-12 09:00',
            targetDateTime: '2026-08-12 18:00'
        })

        expect(rule.untilDate).toBeNull()
    })

    // 종료일을 넘긴 반복은 더 넘길 회차가 없으므로 보통 작업처럼 끝난다.
    test('completing past the end date finishes the task instead of advancing', async () => {
        const manager = await boot({
            rules: [{
                id: 'rule-1', content: 'standup', tags: '', freq: 'daily', interval: 1,
                byWeekday: [], anchorDate: '2026-08-01', startTimeOfDay: '09:00',
                targetTimeOfDay: '10:00', untilDate: '2026-08-05', enabled: true
            }],
            tasks: [{
                id: 'task-1', content: 'standup', tags: '',
                startDateTime: '2026-08-05 09:00', targetDateTime: '2026-08-05 10:00',
                completed: false, ruleId: 'rule-1'
            }]
        })

        await manager.doCompleteTask('task-1', null)
        await settle()

        expect(manager.tasks).toHaveLength(0)
    })

    test('before the end date it still advances', async () => {
        const manager = await boot({
            rules: [{
                id: 'rule-1', content: 'standup', tags: '', freq: 'daily', interval: 1,
                byWeekday: [], anchorDate: '2026-08-01', startTimeOfDay: '09:00',
                targetTimeOfDay: '10:00', untilDate: '2026-08-20', enabled: true
            }],
            tasks: [{
                id: 'task-1', content: 'standup', tags: '',
                startDateTime: '2026-08-05 09:00', targetDateTime: '2026-08-05 10:00',
                completed: false, ruleId: 'rule-1'
            }]
        })

        await manager.doCompleteTask('task-1', null)
        await settle()

        expect(manager.tasks[0].startDateTime).toBe('2026-08-06 09:00')
    })
})
