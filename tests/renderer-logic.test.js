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

// 마스크는 클래스 밖의 순수 함수다. 형식 문자열 하나에서 출력·파싱·틀 셋이
// 나오므로, 그 셋이 같은 형식을 같게 읽는지는 여기서 확인한다.
const { maskRender, maskRead, maskWrite, maskErase } = new Function(
    `${I18N}
${SOURCE}
return { maskRender, maskRead, maskWrite, maskErase };`
)()

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

// 형식대로 구분자를 넣어 가며 치는 것은 번거롭다. 숫자만 붙여 쳐도, 다른
// 형식에서 복사해 와도 들어와야 한다.
// 형식대로 치려면 구분자를 손으로 넣어야 하고, 다 치기 전에는 무엇을 치는지
// 화면에 단서가 없다. 틀을 남기고 숫자가 덮어쓰게 하면 둘 다 사라진다.
describe('the date field wears its format as a mask', () => {
    const F = 'YYYY-MM-DD HH:mm'
    const render = (digits, meridiem = null) =>
        maskRender(F, digits, meridiem)

    test('an empty field shows the format itself', () => {
        expect(render('').text).toBe('YYYY-MM-DD HH:mm')
    })

    test('digits overwrite the placeholder from the left', () => {
        expect(render('2').text).toBe('2YYY-MM-DD HH:mm')
        expect(render('20').text).toBe('20YY-MM-DD HH:mm')
        expect(render('2026').text).toBe('2026-MM-DD HH:mm')
    })

    // The separator is never typed - four digits and the next one lands in MM.
    test('separators are stepped over', () => {
        expect(render('202608').text).toBe('2026-08-DD HH:mm')
        expect(render('20260821').text).toBe('2026-08-21 HH:mm')
        expect(render('202608210930').text).toBe('2026-08-21 09:30')
    })

    // The caret has to sit where the next digit will land, or the person is
    // watching a different place than the one they are typing into.
    test('the caret follows the last digit', () => {
        expect(render('').caret).toBe(0)
        expect(render('2026').caret).toBe(4)
        expect(render('20260821').caret).toBe(10)
        expect(render('202608210930').caret).toBe(16)
    })

    test('it stops at the format is full', () => {
        expect(render('20260821093012345').text).toBe('2026-08-21 09:30')
    })

    // Reading back has to ignore the placeholder, which is the only reason the
    // field can be re-rendered from its own contents on every keystroke.
    test('reading back keeps only what was typed', () => {
        expect(maskRead('2026-08-2D HH:mm', F)).toEqual({ digits: '2026082', meridiem: null })
        expect(maskRead('YYYY-MM-DD HH:mm', F)).toEqual({ digits: '', meridiem: null })
    })

    // Typing writes into the slot the caret is in, rather than appending. With
    // appending, a field already holding a full date has nowhere to put the next
    // digit and the key does nothing - and clicking into a field with the mouse
    // lands there constantly, because the browser moves the caret after focus
    // and undoes any select().
    describe('typing overwrites the slot under the caret', () => {
        const write = (text, caret, ch) => maskWrite(text, F, caret, ch)

        test('fills the first empty slot from the caret', () => {
            expect(write('YYYY-MM-DD HH:mm', 0, '2').text).toBe('2YYY-MM-DD HH:mm')
            expect(write('2YYY-MM-DD HH:mm', 1, '0').text).toBe('20YY-MM-DD HH:mm')
        })

        test('overwrites a full field in place', () => {
            expect(write('2026-08-21 09:30', 5, '9').text).toBe('2026-98-21 09:30')
        })

        test('the caret moves on to the next slot, over any separator', () => {
            expect(write('2026-MM-DD HH:mm', 4, '0').caret).toBe(6)
            expect(write('2026-08-21 HH:mm', 10, '0').caret).toBe(12)
        })

        test('a letter is refused where a digit belongs', () => {
            expect(write('YYYY-MM-DD HH:mm', 0, 'x')).toBeNull()
        })

        test('and there is nothing past the end', () => {
            expect(write('2026-08-21 09:30', 16, '1')).toBeNull()
        })
    })

    describe('erasing puts a slot back to its placeholder', () => {
        test('backspace clears the slot before the caret', () => {
            expect(maskErase('2026-08-21 09:30', F, 16).text).toBe('2026-08-21 09:3m')
            expect(maskErase('2026-08-21 09:30', F, 16).caret).toBe(15)
        })

        test('it steps back over a separator', () => {
            expect(maskErase('2026-08-21 09:30', F, 11).text).toBe('2026-08-2D 09:30')
            expect(maskErase('2026-08-21 09:30', F, 11).caret).toBe(9)
        })

        test('there is nothing before the first slot', () => {
            expect(maskErase('YYYY-MM-DD HH:mm', F, 0)).toBeNull()
        })
    })

    describe('a twelve-hour format', () => {
        const A = 'MM/DD/YYYY hh:mm A'

        test('leaves the meridiem waiting', () => {
            expect(maskRender(A, '082120260930', null).text).toBe('08/21/2026 09:30 --')
        })

        test('and fills it once it is chosen', () => {
            expect(maskRender(A, '082120260930', 'PM').text).toBe('08/21/2026 09:30 PM')
        })

        test('reading back picks the meridiem out', () => {
            expect(maskRead('08/21/2026 09:30 PM', A).meridiem).toBe('PM')
            expect(maskRead('08/21/2026 09:30 --', A).meridiem).toBeNull()
        })
    })

    // The mask comes from the same pattern string as the output and the parsing
    // regex, so a new format cannot be supported by two of the three.
    test('it follows whatever format is chosen', () => {
        expect(maskRender('DD/MM/YYYY HH:mm', '2108', null).text).toBe('21/08/YYYY HH:mm')
        expect(maskRender('YYYYMMDD HHmm', '20260821', null).text).toBe('20260821 HHmm')
    })
})

describe('typing a date without the separators', () => {
    const m = () => makeManager()
    const read = (text) => {
        const manager = m()
        manager.dateFormat = 'YYYY-MM-DD HH:mm'
        return manager.parseInputDateTime(text)
    }

    test('eight digits are a date at midnight', () => {
        expect(read('20250821')).toBe('2025-08-21 00:00')
    })

    test('twelve digits carry the time', () => {
        expect(read('202508210930')).toBe('2025-08-21 09:30')
    })

    // The separators are thrown away, so a value pasted from another format
    // lands correctly too.
    test('any separators at all are accepted', () => {
        expect(read('2025/08/21 09:30')).toBe('2025-08-21 09:30')
        expect(read('2025.08.21')).toBe('2025-08-21 00:00')
    })

    test('a date that does not exist is still refused', () => {
        expect(read('20250230')).toBeNull()
        expect(read('20251301')).toBeNull()
        expect(read('202508212560')).toBeNull()
    })

    test('and so is anything that is not a whole date', () => {
        expect(read('2025082')).toBeNull()
        expect(read('abc')).toBeNull()
    })
})

describe('tag parsing', () => {
    const manager = () => makeManager()

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
