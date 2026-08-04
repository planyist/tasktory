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

    test('are hidden when editing, since editing changes only that occurrence', async () => {
        const manager = await boot({
            tasks: [
                {
                    id: 'task-1',
                    content: 'existing',
                    startDateTime: '2026-08-04 09:00',
                    targetDateTime: '2026-08-04 18:00',
                    completed: false
                }
            ]
        })

        manager.showModal(manager.tasks[0])

        expect(visible('repeatGroup')).toBe(false)
    })
})

describe('creating a repeating task', () => {
    test('stores a rule and links the first occurrence to it', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
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
            // The task just created is occurrence one, so catch-up must not
            // produce it a second time.
            lastGeneratedKey: '2026-08-04',
            enabled: true
        })

        const task = storedTasks.find((t) => t.content === 'daily standup')
        expect(task.ruleId).toBe(storedRules[0].id)
        expect(task.occurrenceKey).toBe('2026-08-04')
    })

    test('records the chosen weekdays for a weekly rule', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-03T09:00',
            target: '2026-08-03T18:00',
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
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'one-off task'
        })

        await manager.saveTask()
        await settle()

        expect(storedRules).toEqual([])
        expect(storedTasks[0].ruleId).toBeUndefined()
    })

    test('marks the row with a repeat badge', async () => {
        const manager = await boot()
        fillTaskForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'daily standup'
        })
        chooseRepeat('daily')

        await manager.saveTask()
        await settle()

        expect(document.querySelectorAll('#tasksBody .repeat-badge')).toHaveLength(1)
    })
})

describe('catch-up on start', () => {
    const dailyRule = (overrides = {}) => ({
        id: 'rule-1',
        content: 'daily standup',
        tags: '',
        freq: 'daily',
        interval: 1,
        byWeekday: [],
        anchorDate: '2026-08-01',
        startTimeOfDay: '09:00',
        targetTimeOfDay: '18:00',
        lastGeneratedKey: '2026-08-01',
        enabled: true,
        ...overrides
    })

    beforeEach(() => {
        jest.useFakeTimers()
        jest.setSystemTime(new Date('2026-08-04T10:00:00'))
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    test('creates the occurrence due today and persists it', async () => {
        const manager = await boot({ rules: [dailyRule()] })

        const created = manager.tasks.filter((t) => t.ruleId === 'rule-1')
        expect(created).toHaveLength(1)
        expect(created[0].startDateTime).toBe('2026-08-04 09:00')
        expect(electronAPI.saveTasks).toHaveBeenCalled()
        expect(storedRules[0].lastGeneratedKey).toBe('2026-08-04')
    })

    test('logs the generated occurrence like any other new task', async () => {
        await boot({ rules: [dailyRule()] })

        expect(electronAPI.addLog).toHaveBeenCalledWith(
            expect.objectContaining({ action: 'ADD' })
        )
    })

    test('adds nothing on a second launch the same day', async () => {
        await boot({ rules: [dailyRule()] })
        const afterFirst = JSON.parse(JSON.stringify(storedTasks))

        const manager = await boot({ rules: storedRules, tasks: afterFirst })

        expect(manager.tasks.filter((t) => t.ruleId === 'rule-1')).toHaveLength(1)
    })

    test('leaves a pending earlier occurrence in place and adds the new one', async () => {
        const pending = {
            id: 'task-old',
            content: 'daily standup',
            startDateTime: '2026-08-03 09:00',
            targetDateTime: '2026-08-03 18:00',
            completed: false,
            ruleId: 'rule-1',
            occurrenceKey: '2026-08-03'
        }

        const manager = await boot({
            rules: [dailyRule({ lastGeneratedKey: '2026-08-03' })],
            tasks: [pending]
        })

        const forRule = manager.tasks.filter((t) => t.ruleId === 'rule-1')
        expect(forRule.map((t) => t.occurrenceKey).sort()).toEqual(['2026-08-03', '2026-08-04'])
    })

    test('does nothing when there are no rules', async () => {
        const manager = await boot()

        expect(manager.tasks).toEqual([])
        expect(electronAPI.saveRules).not.toHaveBeenCalled()
    })

    test('ignores a disabled rule', async () => {
        const manager = await boot({ rules: [dailyRule({ enabled: false })] })

        expect(manager.tasks).toEqual([])
    })
})
