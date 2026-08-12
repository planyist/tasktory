/**
 * @jest-environment jsdom
 */
const fs = require('fs')
const path = require('path')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8')

// renderer.js is a classic browser script with no exports. Evaluate it and hand
// back the class rather than adding an export just for tests.
const I18N = fs.readFileSync(path.join(__dirname, '..', 'i18n.js'), 'utf8')
const TaskManager = new Function(`${I18N}\n${SOURCE}\nreturn TaskManager;`)()

// Build an instance without running the constructor, which kicks off async
// init() against a DOM that does not exist in this suite.
const makeManager = (overrides = {}) =>
    Object.assign(Object.create(TaskManager.prototype), {
        tasks: [],
        logs: [],
        locale: 'en',
        dateFormat: 'YYYY-MM-DD HH:mm',
        isElectron: false,
        searchQuery: '',
        currentPage: 1,
        tasksPerPage: 10,
        actionThrottleMap: new Map(),
        renderTasks: jest.fn(),
        ...overrides
    })

const task = (id, overrides = {}) => ({
    id,
    content: `task ${id}`,
    completed: false,
    ...overrides
})

beforeEach(() => {
    localStorage.clear()
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    jest.restoreAllMocks()
})

describe('getTaskStatus', () => {
    const manager = () => makeManager({ getLocalizedText: (key) => key })
    const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString()

    test('reports completed regardless of dates', () => {
        expect(
            manager().getTaskStatus({
                completed: true,
                startDateTime: hoursFromNow(-10),
                targetDateTime: hoursFromNow(-5)
            }).status
        ).toBe('completed')
    })

    test('reports overdue once the target time has passed', () => {
        expect(
            manager().getTaskStatus({
                startDateTime: hoursFromNow(-5),
                targetDateTime: hoursFromNow(-1)
            }).status
        ).toBe('overdue')
    })

    test('reports urgent within the last hour before the target', () => {
        expect(
            manager().getTaskStatus({
                startDateTime: hoursFromNow(-5),
                targetDateTime: hoursFromNow(0.5)
            }).status
        ).toBe('urgent')
    })

    test('reports inprogress after the start time', () => {
        expect(
            manager().getTaskStatus({
                startDateTime: hoursFromNow(-1),
                targetDateTime: hoursFromNow(5)
            }).status
        ).toBe('inprogress')
    })

    test('reports pending before the start time', () => {
        expect(
            manager().getTaskStatus({
                startDateTime: hoursFromNow(2),
                targetDateTime: hoursFromNow(5)
            }).status
        ).toBe('pending')
    })
})

describe('tag parsing', () => {
    const manager = () => makeManager()

    test('extractTags picks up ascii and hangul tags', () => {
        expect(manager().extractTags('fix #bug and #버그 today')).toEqual(['#bug', '#버그'])
    })

    test('extractTags returns an empty list when there are none', () => {
        expect(manager().extractTags('no tags here')).toEqual([])
    })

    test('formatContentWithTags wraps tags in a span', () => {
        expect(manager().formatContentWithTags('ship #v1 now')).toBe(
            'ship <span class="tag">#v1</span> now'
        )
    })

    test('parseTagsFromInput keeps only # prefixed words with content', () => {
        expect(manager().parseTagsFromInput('#work plain #  #home')).toEqual(['#work', '#home'])
    })

    test('parseTagWithColor resolves a known colour code', () => {
        const parsed = manager().parseTagWithColor('#[RED]urgent')

        expect(parsed.hasColor).toBe(true)
        expect(parsed.content).toBe('#urgent')
        expect(parsed.color.border).toBe('#d73a49')
    })

    test('parseTagWithColor falls back to the default colour for unknown codes', () => {
        const parsed = manager().parseTagWithColor('#[MAUVE]urgent')

        expect(parsed.hasColor).toBe(false)
        expect(parsed.content).toBe('#[MAUVE]urgent')
    })

    test('parseTagWithColor leaves a plain tag untouched', () => {
        expect(manager().parseTagWithColor('#work')).toMatchObject({
            hasColor: false,
            content: '#work'
        })
    })
})

describe('language selection', () => {
    test('prefers the explicitly saved language', () => {
        localStorage.setItem('selectedLanguage', 'ja')

        expect(makeManager().getSelectedLanguage()).toBe('ja')
    })

    test.each([
        ['ko-KR', 'ko'],
        ['zh-CN', 'zh'],
        ['ja-JP', 'ja'],
        ['es-ES', 'es'],
        ['fr-FR', 'en']
    ])('falls back to the system locale %s -> %s', (systemLocale, expected) => {
        const manager = makeManager({ getSystemLocale: () => systemLocale })

        expect(manager.getSelectedLanguage()).toBe(expected)
    })
})

describe('getLocalizedText', () => {
    test('returns text for the active locale', () => {
        expect(makeManager({ locale: 'en' }).getLocalizedText('done')).toBe('Done')
        expect(makeManager({ locale: 'ko' }).getLocalizedText('done')).toBe('완료')
    })
})

describe('formatDateTimeLocal', () => {
    test('renders YYYY-MM-DD HH:MM in local time', () => {
        expect(makeManager().formatDateTimeLocal(new Date(2026, 7, 4, 9, 5))).toBe(
            '2026-08-04 09:05'
        )
    })
})

describe('generateId', () => {
    test('produces a task- prefixed uuid v4', () => {
        expect(makeManager().generateId()).toMatch(
            /^task-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
    })
})

describe('isActionThrottled', () => {
    test('blocks a repeat within the window and allows it after', () => {
        const manager = makeManager()
        let now = 1000
        jest.spyOn(Date, 'now').mockImplementation(() => now)

        expect(manager.isActionThrottled('a', 100)).toBe(false)
        now += 50
        expect(manager.isActionThrottled('a', 100)).toBe(true)
        now += 100
        expect(manager.isActionThrottled('a', 100)).toBe(false)
    })

    test('tracks each key independently', () => {
        const manager = makeManager()
        jest.spyOn(Date, 'now').mockReturnValue(1000)

        expect(manager.isActionThrottled('a', 100)).toBe(false)
        expect(manager.isActionThrottled('b', 100)).toBe(false)
    })
})

describe('moveTask', () => {
    const orderedManager = () =>
        makeManager({
            tasks: [task('a'), task('b'), task('c'), task('d')],
            addLog: jest.fn().mockResolvedValue(true),
            saveTasks: jest.fn().mockResolvedValue(true)
        })

    const ids = (manager) => manager.tasks.map((t) => t.id)

    test('moves a task up one position', async () => {
        const manager = orderedManager()

        await manager.moveTask('c', 'up')

        expect(ids(manager)).toEqual(['a', 'c', 'b', 'd'])
    })

    test('moves a task down one position', async () => {
        const manager = orderedManager()

        await manager.moveTask('b', 'down')

        expect(ids(manager)).toEqual(['a', 'c', 'b', 'd'])
    })

    test('does nothing at the top or bottom edge', async () => {
        const manager = orderedManager()

        await manager.moveTask('a', 'up')
        await manager.moveTask('d', 'down')

        expect(ids(manager)).toEqual(['a', 'b', 'c', 'd'])
    })

    test('skips completed tasks when computing neighbours', async () => {
        const manager = makeManager({
            tasks: [task('a'), task('done', { completed: true }), task('c')],
            addLog: jest.fn().mockResolvedValue(true),
            saveTasks: jest.fn().mockResolvedValue(true)
        })

        await manager.moveTask('c', 'up')

        expect(ids(manager)).toEqual(['c', 'a', 'done'])
    })

    // Regression: the throttle key was `move_${taskId}_${direction}` with a
    // 200ms window, so a user clicking "up" three times to shift a task three
    // rows only got the first click -- the task looked stuck.
    test('applies every deliberate repeat click in the same direction', async () => {
        const manager = orderedManager()
        let now = 1000
        jest.spyOn(Date, 'now').mockImplementation(() => now)

        await manager.moveTask('d', 'up')
        now += 60
        await manager.moveTask('d', 'up')
        now += 60
        await manager.moveTask('d', 'up')

        expect(ids(manager)).toEqual(['d', 'a', 'b', 'c'])
    })

    // The mirror image of the same defect: because the direction was part of
    // the key, an up/down double-fire used two different keys and was never
    // throttled at all -- exactly the rapid-fire sequence the throttle existed
    // to suppress.
    test('throttles an immediate reversal, which is a double-fire not a real click', async () => {
        const manager = orderedManager()
        jest.spyOn(Date, 'now').mockReturnValue(1000)

        await manager.moveTask('c', 'up')
        await manager.moveTask('c', 'down')

        expect(ids(manager)).toEqual(['a', 'c', 'b', 'd'])
    })
})

describe('toggleHighlight / toggleNotification persistence', () => {
    // Regression: both handlers fired addLog + saveTasks without awaiting. Each
    // save carried a snapshot of this.tasks taken at IPC-invoke time, and the
    // two writes hit tasks.json concurrently, so a slow earlier write could
    // land last and silently discard the later change.
    test('a slow earlier save cannot discard a later change', async () => {
        let persisted = null
        let call = 0

        const electronAPI = {
            addLog: jest.fn().mockResolvedValue(true),
            // Mirrors the real IPC boundary: the payload is structure-cloned at
            // invoke time, so each write carries its own snapshot.
            saveTasks: jest.fn(async (tasks) => {
                const snapshot = JSON.parse(JSON.stringify(tasks))
                const delay = ++call === 1 ? 50 : 0
                await new Promise((resolve) => setTimeout(resolve, delay))
                persisted = snapshot
                return true
            })
        }
        window.electronAPI = electronAPI

        const manager = makeManager({
            isElectron: true,
            tasks: [task('a'), task('b')]
        })

        await manager.toggleHighlight('a')
        await manager.toggleNotification('b')
        // Let the fire-and-forget background writes settle.
        await new Promise((resolve) => setTimeout(resolve, 100))

        expect(persisted.find((t) => t.id === 'a').highlighted).toBe(true)
        // Toggling a task that never carried the flag turns notifications off.
        expect(persisted.find((t) => t.id === 'b').notificationEnabled).toBe(false)

        delete window.electronAPI
    })
})

describe('getTodayCompletionCount', () => {
    // Regression: the Electron branch built the date key with toISOString()
    // (UTC) while main.js names log files by local date, so for several hours a
    // day it asked for the wrong file and reported 0.
    test('asks for the local date, matching how log files are named', async () => {
        jest.useFakeTimers()
        // 05:00 on 2026-08-05 in Asia/Seoul, still 2026-08-04 in UTC.
        jest.setSystemTime(new Date('2026-08-04T20:00:00Z'))

        const getCompletedTasksCount = jest.fn().mockResolvedValue(3)
        window.electronAPI = { getCompletedTasksCount }

        const manager = makeManager({ isElectron: true })
        await expect(manager.getTodayCompletionCount()).resolves.toBe(3)

        expect(getCompletedTasksCount).toHaveBeenCalledWith('2026-08-05')

        delete window.electronAPI
        jest.useRealTimers()
    })

    test('returns 0 when the log lookup fails', async () => {
        window.electronAPI = {
            getCompletedTasksCount: jest.fn().mockRejectedValue(new Error('nope'))
        }

        await expect(makeManager({ isElectron: true }).getTodayCompletionCount()).resolves.toBe(0)

        delete window.electronAPI
    })

    describe('browser mode', () => {
        test('returns the stored count when it belongs to today', async () => {
            localStorage.setItem('completionCountDate', new Date().toDateString())
            localStorage.setItem('completionCount', '7')

            await expect(makeManager().getTodayCompletionCount()).resolves.toBe(7)
        })

        // Regression: the new-day branch assigned an undefined `todayDateString`,
        // throwing a ReferenceError on the first run of every new day.
        test('resets to 0 and stamps today when the stored date is stale', async () => {
            localStorage.setItem('completionCountDate', 'Mon Jan 01 2024')
            localStorage.setItem('completionCount', '7')

            await expect(makeManager().getTodayCompletionCount()).resolves.toBe(0)

            expect(localStorage.getItem('completionCountDate')).toBe(new Date().toDateString())
            expect(localStorage.getItem('completionCount')).toBe('0')
        })
    })
})

describe('repositionTask', () => {
    test('moves an active task to the requested 1-based slot', () => {
        const manager = makeManager({
            tasks: [task('a'), task('b'), task('c'), task('done', { completed: true })]
        })

        manager.repositionTask('c', 1)

        expect(manager.tasks.map((t) => t.id)).toEqual(['c', 'a', 'b', 'done'])
    })
})
