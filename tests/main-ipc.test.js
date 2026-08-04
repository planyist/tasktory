const fs = require('fs')
const fsp = require('fs').promises
const os = require('os')
const path = require('path')

let electron
let userData
let logsDir

// YYYY-MM-DD in local time, matching getTodayLogFile() in main.js
const todayStr = () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

const readLog = async (dateStr = todayStr(), ext = 'tsv') =>
    fsp.readFile(path.join(logsDir, `${dateStr}.${ext}`), 'utf8')

// Data lines only (header and trailing blank line stripped)
const dataLines = (contents) =>
    contents.split('\n').filter((line) => line.trim() && !line.startsWith('TIMESTAMP'))

const makeEntry = (action, overrides = {}) => ({
    action,
    task: {
        id: 'task-1',
        content: 'write tests',
        status: 'pending',
        startDateTime: '2026-08-04T09:00',
        targetDateTime: '2026-08-04T18:00',
        tags: '#work',
        ...overrides
    },
    details: overrides.details ?? null
})

beforeEach(() => {
    // main.js logs verbosely on every IPC call; keep the test output readable.
    jest.spyOn(console, 'log').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})

    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktory-test-'))
    logsDir = path.join(userData, 'logs')
    process.env.TASKTORY_USERDATA = userData

    jest.resetModules()
    electron = require('electron')
    electron.__handlers.clear()
    require('../main.js')
})

afterEach(() => {
    jest.restoreAllMocks()
    fs.rmSync(userData, { recursive: true, force: true })
})

describe('load-tasks / save-tasks', () => {
    test('returns an empty list when no tasks file exists yet', async () => {
        await expect(electron.__invoke('load-tasks')).resolves.toEqual([])
    })

    test('round-trips tasks through disk', async () => {
        const tasks = [{ id: 'task-1', content: 'hello', completed: false }]

        await expect(electron.__invoke('save-tasks', tasks)).resolves.toBe(true)
        await expect(electron.__invoke('load-tasks')).resolves.toEqual(tasks)
    })

    test('save-tasks creates the data directory on first write', async () => {
        await electron.__invoke('save-tasks', [])

        expect(fs.existsSync(path.join(userData, 'data', 'tasks.json'))).toBe(true)
    })
})

describe('add-log', () => {
    test('creates a dated .tsv file with the TSV header', async () => {
        await electron.__invoke('add-log', makeEntry('ADD'))

        const contents = await readLog()
        expect(contents.split('\n')[0]).toBe(
            'TIMESTAMP\tACTION\tSTATUS\tTASK_ID\tSTART_TIME\tTARGET_TIME\tTAGS\tCONTENT'
        )
    })

    test('writes one tab-separated row per entry in column order', async () => {
        await electron.__invoke('add-log', makeEntry('COMPLETE', { status: 'completed' }))

        const [row] = dataLines(await readLog())
        const columns = row.split('\t')

        expect(columns).toHaveLength(8)
        expect(columns[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
        expect(columns[1]).toBe('COMPLETE')
        expect(columns[2]).toBe('COMPLETED')
        expect(columns[3]).toBe('task-1')
        expect(columns[4]).toBe('2026-08-04T09:00')
        expect(columns[5]).toBe('2026-08-04T18:00')
        expect(columns[6]).toBe('#work')
        expect(columns[7]).toBe('write tests')
    })

    test('falls back to PENDING status when the task has none', async () => {
        await electron.__invoke('add-log', makeEntry('ADD', { status: undefined }))

        expect(dataLines(await readLog())[0].split('\t')[2]).toBe('PENDING')
    })

    test('replaces tabs and newlines in content so the row stays parseable', async () => {
        await electron.__invoke(
            'add-log',
            makeEntry('ADD', { content: 'a\tb\nc\rd' })
        )

        const rows = dataLines(await readLog())
        expect(rows).toHaveLength(1)
        expect(rows[0].split('\t')).toHaveLength(8)
        expect(rows[0].split('\t')[7]).toBe('a b c d')
    })

    test('appends to an existing file without repeating the header', async () => {
        await electron.__invoke('add-log', makeEntry('ADD'))
        await electron.__invoke('add-log', makeEntry('EDIT'))

        const contents = await readLog()
        expect(contents.split('\n').filter((l) => l.startsWith('TIMESTAMP'))).toHaveLength(1)
        expect(dataLines(contents)).toHaveLength(2)
    })

    test('writes a single header when many logs land on a new file at once', async () => {
        const entries = Array.from({ length: 10 }, (_, i) =>
            makeEntry('ADD', { id: `task-${i}`, content: `task number ${i}` })
        )

        await Promise.all(entries.map((entry) => electron.__invoke('add-log', entry)))

        const contents = await readLog()
        expect(contents.split('\n').filter((l) => l.startsWith('TIMESTAMP'))).toHaveLength(1)
        expect(dataLines(contents)).toHaveLength(10)
    })

    // Regression: add-log did check-then-writeFile for the header, and the
    // renderer fires add-log without awaiting. Two calls on a brand-new file
    // both saw "missing"; if the second call's truncating writeFile landed
    // after the first had appended its row, that row was destroyed.
    //
    // The interleaving is real but rare -- unforced concurrent calls advance in
    // lockstep (all access, then all writeFile, then all append), which never
    // corrupts. So we delay the second header write to pin the bad ordering.
    test('a late header write cannot truncate a row another log already appended', async () => {
        const realWriteFile = fsp.writeFile
        let headerWrites = 0

        jest.spyOn(fsp, 'writeFile').mockImplementation((file, data, ...rest) => {
            const isHeader = typeof data === 'string' && data.startsWith('TIMESTAMP')
            if (isHeader && ++headerWrites === 2) {
                // Redundant second header write, delayed so it lands last.
                return new Promise((resolve) => setTimeout(resolve, 60)).then(() =>
                    realWriteFile.call(fsp, file, data, ...rest)
                )
            }
            return realWriteFile.call(fsp, file, data, ...rest)
        })

        await Promise.all([
            electron.__invoke('add-log', makeEntry('ADD', { id: 'task-a', content: 'first' })),
            electron.__invoke('add-log', makeEntry('ADD', { id: 'task-b', content: 'second' }))
        ])

        const contents = await readLog()
        expect(contents).toContain('first')
        expect(contents).toContain('second')
        expect(dataLines(contents)).toHaveLength(2)
    })
})

describe('get-completed-tasks-count', () => {
    test('returns 0 when no log exists for the date', async () => {
        await expect(
            electron.__invoke('get-completed-tasks-count', '2020-01-01')
        ).resolves.toBe(0)
    })

    test('counts only COMPLETE rows and ignores the header', async () => {
        await electron.__invoke('add-log', makeEntry('ADD'))
        await electron.__invoke('add-log', makeEntry('COMPLETE', { status: 'completed' }))
        await electron.__invoke('add-log', makeEntry('DELETE'))
        await electron.__invoke('add-log', makeEntry('COMPLETE', { status: 'completed' }))

        await expect(
            electron.__invoke('get-completed-tasks-count', todayStr())
        ).resolves.toBe(2)
    })

    // Regression: v0.2.6 renamed the log extension .log -> .tsv with no
    // migration, so every pre-upgrade day read as 0 -- the daily counter reset
    // mid-day and the 30-day chart flatlined.
    describe('legacy fixed-width .log files (<= v0.2.5)', () => {
        const LEGACY_HEADER =
            `${'TIMESTAMP'.padEnd(25)}${'ACTION'.padEnd(15)}${'STATUS'.padEnd(10)}` +
            `${'TASK-ID'.padEnd(45)}${'START-TIME'.padEnd(20)}${'TARGET-TIME'.padEnd(20)}TAGS\tCONTENT\n`

        const legacyRow = (action, status) =>
            `${'2025-07-26T10:00:00'.padEnd(25)}${action.padEnd(15)}${status.padEnd(10)}` +
            `${'task-legacy'.padEnd(45)}${''.padEnd(20)}${''.padEnd(20)}\told task\n`

        const writeLegacyLog = async (dateStr, rows) => {
            await fsp.mkdir(logsDir, { recursive: true })
            await fsp.writeFile(path.join(logsDir, `${dateStr}.log`), LEGACY_HEADER + rows.join(''))
        }

        test('counts COMPLETE rows from a legacy .log when no .tsv exists', async () => {
            await writeLegacyLog('2025-07-26', [
                legacyRow('ADD', 'PENDING'),
                legacyRow('COMPLETE', 'COMPLETED'),
                legacyRow('COMPLETE', 'COMPLETED'),
                legacyRow('DELETE', 'PENDING')
            ])

            await expect(
                electron.__invoke('get-completed-tasks-count', '2025-07-26')
            ).resolves.toBe(2)
        })

        test('prefers the .tsv when both formats exist for the same date', async () => {
            await writeLegacyLog(todayStr(), [legacyRow('COMPLETE', 'COMPLETED')])
            await electron.__invoke('add-log', makeEntry('COMPLETE', { status: 'completed' }))
            await electron.__invoke('add-log', makeEntry('COMPLETE', { status: 'completed' }))

            await expect(
                electron.__invoke('get-completed-tasks-count', todayStr())
            ).resolves.toBe(2)
        })
    })
})

describe('export-data / import-data', () => {
    test('exports the saved tasks with a version stamp', async () => {
        const tasks = [{ id: 'task-1', content: 'hello' }]
        await electron.__invoke('save-tasks', tasks)

        const exported = await electron.__invoke('export-data')

        expect(exported.tasks).toEqual(tasks)
        expect(exported.version).toBe('1.0')
    })

    test('exports an empty task list when nothing has been saved', async () => {
        await expect(electron.__invoke('export-data')).resolves.toMatchObject({ tasks: [] })
    })

    test('import-data overwrites the stored tasks', async () => {
        await electron.__invoke('save-tasks', [{ id: 'old' }])

        await expect(
            electron.__invoke('import-data', { tasks: [{ id: 'new' }] })
        ).resolves.toBe(true)
        await expect(electron.__invoke('load-tasks')).resolves.toEqual([{ id: 'new' }])
    })
})

describe('get-log-path', () => {
    test('points at the logs directory under userData', async () => {
        await expect(electron.__invoke('get-log-path')).resolves.toBe(logsDir)
    })
})
