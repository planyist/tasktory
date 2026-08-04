/**
 * @jest-environment jsdom
 */
const fs = require('fs')
const path = require('path')

// tasktory-standalone.html is the self-contained browser build: its own copy of
// TaskManager lives in an inline <script> and persists to localStorage only.
const HTML = fs.readFileSync(
    path.join(__dirname, '..', 'tasktory-standalone.html'),
    'utf8'
)
const BODY = HTML.slice(HTML.indexOf('<body>') + '<body>'.length, HTML.indexOf('</body>'))
const SCRIPT = HTML.slice(
    HTML.indexOf('<script>') + '<script>'.length,
    HTML.indexOf('</script>')
)

const TaskManager = new Function(`${SCRIPT}\nreturn TaskManager;`)()

const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

const boot = async () => {
    const manager = new TaskManager()
    await settle()
    return manager
}

const fillForm = ({ start, target, content }) => {
    document.getElementById('startDateTime').value = start
    document.getElementById('targetDateTime').value = target
    document.getElementById('taskContent').value = content
}

const savedTasks = () => JSON.parse(localStorage.getItem('tasklogger_tasks') || '[]')
const savedLogs = () => JSON.parse(localStorage.getItem('tasklogger_logs') || '[]')

const rows = () =>
    Array.from(document.querySelectorAll('#tasksBody tr')).filter(
        (row) => !row.querySelector('.empty-message')
    )

beforeEach(() => {
    document.body.innerHTML = BODY
    localStorage.clear()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(window, 'alert').mockImplementation(() => {})
})

afterEach(() => {
    jest.restoreAllMocks()
})

describe('startup', () => {
    test('starts empty and shows the empty message', async () => {
        const manager = await boot()

        expect(manager.tasks).toEqual([])
        expect(document.querySelector('#tasksBody .empty-message')).not.toBeNull()
    })

    test('restores tasks previously saved to localStorage', async () => {
        localStorage.setItem(
            'tasklogger_tasks',
            JSON.stringify([
                {
                    id: '1',
                    content: 'restored task',
                    startDateTime: '2026-08-04T09:00',
                    targetDateTime: '2026-08-04T18:00',
                    completed: false
                }
            ])
        )

        await boot()

        expect(rows()).toHaveLength(1)
        expect(document.getElementById('tasksBody').textContent).toContain('restored task')
    })

    test('recovers from corrupted localStorage instead of throwing', async () => {
        localStorage.setItem('tasklogger_tasks', '{not json')

        const manager = await boot()

        expect(manager.tasks).toEqual([])
    })
})

describe('saveTask', () => {
    test('adds a task, persists it and logs ADD', async () => {
        const manager = await boot()
        fillForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'ship the build'
        })

        manager.saveTask()

        expect(manager.tasks).toHaveLength(1)
        expect(savedTasks()[0].content).toBe('ship the build')
        expect(savedLogs().map((l) => l.action)).toEqual(['ADD'])
        expect(rows()).toHaveLength(1)
    })

    test('rejects an incomplete form', async () => {
        const manager = await boot()
        fillForm({ start: '2026-08-04T09:00', target: '', content: 'no target' })

        manager.saveTask()

        expect(manager.tasks).toHaveLength(0)
        expect(window.alert).toHaveBeenCalled()
    })

    test('rejects a target time that is not after the start time', async () => {
        const manager = await boot()
        fillForm({
            start: '2026-08-04T18:00',
            target: '2026-08-04T09:00',
            content: 'backwards'
        })

        manager.saveTask()

        expect(manager.tasks).toHaveLength(0)
        expect(window.alert).toHaveBeenCalled()
    })

    test('editing an existing task replaces it and logs EDIT', async () => {
        const manager = await boot()
        fillForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'original'
        })
        manager.saveTask()

        manager.editingTaskId = manager.tasks[0].id
        fillForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'edited'
        })
        manager.saveTask()

        expect(manager.tasks).toHaveLength(1)
        expect(manager.tasks[0].content).toBe('edited')
        expect(savedLogs().map((l) => l.action)).toEqual(['ADD', 'EDIT'])
    })
})

describe('completeTask / deleteTask', () => {
    const withOneTask = async () => {
        const manager = await boot()
        fillForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'a task'
        })
        manager.saveTask()
        return manager
    }

    test('completing marks the task done, stamps it and logs COMPLETE', async () => {
        const manager = await withOneTask()

        manager.completeTask(manager.tasks[0].id)

        expect(manager.tasks[0].completed).toBe(true)
        expect(manager.tasks[0].completedAt).toBeTruthy()
        expect(savedLogs().map((l) => l.action)).toEqual(['ADD', 'COMPLETE'])
    })

    test('deleting removes the task once confirmed and logs DELETE', async () => {
        jest.spyOn(window, 'confirm').mockReturnValue(true)
        const manager = await withOneTask()

        manager.deleteTask(manager.tasks[0].id)

        expect(manager.tasks).toHaveLength(0)
        expect(savedTasks()).toHaveLength(0)
        expect(savedLogs().map((l) => l.action)).toEqual(['ADD', 'DELETE'])
    })

    test('cancelling the confirm dialog keeps the task', async () => {
        jest.spyOn(window, 'confirm').mockReturnValue(false)
        const manager = await withOneTask()

        manager.deleteTask(manager.tasks[0].id)

        expect(manager.tasks).toHaveLength(1)
        expect(savedLogs().map((l) => l.action)).toEqual(['ADD'])
    })
})

describe('getTaskStatus', () => {
    const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString()

    test.each([
        ['completed', { completed: true, targetDateTime: hoursFromNow(5) }],
        ['overdue', { completed: false, targetDateTime: hoursFromNow(-1) }],
        ['pending', { completed: false, targetDateTime: hoursFromNow(5) }]
    ])('reports %s', async (expected, task) => {
        const manager = await boot()

        expect(manager.getTaskStatus(task).status).toBe(expected)
    })
})

describe('exportData', () => {
    test('serialises tasks and logs into a downloadable blob', async () => {
        const manager = await boot()
        fillForm({
            start: '2026-08-04T09:00',
            target: '2026-08-04T18:00',
            content: 'exported task'
        })
        manager.saveTask()

        window.URL.createObjectURL = jest.fn(() => 'blob:fake')
        window.URL.revokeObjectURL = jest.fn()

        manager.exportData()

        expect(window.URL.createObjectURL).toHaveBeenCalled()
        const blob = window.URL.createObjectURL.mock.calls[0][0]
        expect(blob.type).toContain('application/json')
    })
})
