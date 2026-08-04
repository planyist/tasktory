const fs = require('fs')
const path = require('path')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'recurrence.js'), 'utf8')

// recurrence.js is a classic browser script loaded via <script>; evaluate it
// rather than adding an export purely for tests.
const Recurrence = new Function(`${SOURCE}\nreturn Recurrence;`)()

const rule = (overrides = {}) => ({
    id: 'rule-1',
    content: 'weekly report',
    freq: 'daily',
    interval: 1,
    anchorDate: '2026-08-03',
    startTimeOfDay: '09:00',
    targetTimeOfDay: '18:00',
    lastGeneratedKey: null,
    enabled: true,
    ...overrides
})

// Local noon, so the assertions never depend on where the day boundary falls.
const at = (key, time = '12:00') => new Date(`${key}T${time}:00`)

const occurrences = (r, from, through) => Recurrence.occurrencesBetween(r, from, through)

describe('occurrence dates', () => {
    describe('daily', () => {
        test('every day from the anchor', () => {
            expect(occurrences(rule(), '2026-08-02', '2026-08-06')).toEqual([
                '2026-08-03',
                '2026-08-04',
                '2026-08-05',
                '2026-08-06'
            ])
        })

        test('honours an interval greater than one', () => {
            expect(occurrences(rule({ interval: 3 }), '2026-08-02', '2026-08-12')).toEqual([
                '2026-08-03',
                '2026-08-06',
                '2026-08-09',
                '2026-08-12'
            ])
        })

        test('never produces a date before the anchor', () => {
            expect(occurrences(rule(), '2026-07-01', '2026-08-03')).toEqual(['2026-08-03'])
        })
    })

    describe('weekly', () => {
        // 2026-08-03 is a Monday.
        test('fires on each selected weekday', () => {
            const weekly = rule({ freq: 'weekly', byWeekday: [1, 3] })

            expect(occurrences(weekly, '2026-08-02', '2026-08-16')).toEqual([
                '2026-08-03',
                '2026-08-05',
                '2026-08-10',
                '2026-08-12'
            ])
        })

        test('skips intervening weeks when interval is 2', () => {
            const biweekly = rule({ freq: 'weekly', byWeekday: [1], interval: 2 })

            expect(occurrences(biweekly, '2026-08-02', '2026-09-01')).toEqual([
                '2026-08-03',
                '2026-08-17',
                '2026-08-31'
            ])
        })

        test('defaults to the anchor weekday when none is given', () => {
            const weekly = rule({ freq: 'weekly' })

            expect(occurrences(weekly, '2026-08-02', '2026-08-18')).toEqual([
                '2026-08-03',
                '2026-08-10',
                '2026-08-17'
            ])
        })
    })

    describe('monthly', () => {
        test('fires on the same day each month', () => {
            const monthly = rule({ freq: 'monthly', byMonthDay: 15, anchorDate: '2026-01-15' })

            expect(occurrences(monthly, '2026-01-01', '2026-04-30')).toEqual([
                '2026-01-15',
                '2026-02-15',
                '2026-03-15',
                '2026-04-15'
            ])
        })

        // The classic recurrence trap: there is no 31st of February.
        test('clamps to the last day of shorter months', () => {
            const monthly = rule({ freq: 'monthly', byMonthDay: 31, anchorDate: '2026-01-31' })

            expect(occurrences(monthly, '2026-01-01', '2026-04-30')).toEqual([
                '2026-01-31',
                '2026-02-28',
                '2026-03-31',
                '2026-04-30'
            ])
        })

        test('clamps to 29 February in a leap year', () => {
            const monthly = rule({ freq: 'monthly', byMonthDay: 30, anchorDate: '2028-01-30' })

            expect(occurrences(monthly, '2028-01-01', '2028-03-31')).toEqual([
                '2028-01-30',
                '2028-02-29',
                '2028-03-30'
            ])
        })

        test('honours a quarterly interval', () => {
            const quarterly = rule({
                freq: 'monthly',
                byMonthDay: 1,
                interval: 3,
                anchorDate: '2026-01-01'
            })

            expect(occurrences(quarterly, '2025-12-31', '2026-12-31')).toEqual([
                '2026-01-01',
                '2026-04-01',
                '2026-07-01',
                '2026-10-01'
            ])
        })
    })
})

describe('materialize', () => {
    test('builds a normal task using the rule wall-clock times', () => {
        const task = Recurrence.materialize(rule(), '2026-08-05', 'task-x', at('2026-08-05'))

        expect(task).toMatchObject({
            id: 'task-x',
            content: 'weekly report',
            startDateTime: '2026-08-05T09:00',
            targetDateTime: '2026-08-05T18:00',
            completed: false,
            ruleId: 'rule-1',
            occurrenceKey: '2026-08-05'
        })
    })

    test('rolls the target to the next day for an overnight window', () => {
        const overnight = rule({ startTimeOfDay: '22:00', targetTimeOfDay: '02:00' })

        const task = Recurrence.materialize(overnight, '2026-08-05', 'task-x', at('2026-08-05'))

        expect(task.startDateTime).toBe('2026-08-05T22:00')
        expect(task.targetDateTime).toBe('2026-08-06T02:00')
    })
})

describe('catchUp', () => {
    const run = (rules, tasks, now, options = {}) => {
        let n = 0
        return Recurrence.catchUp(rules, tasks, now, {
            newId: () => `task-${++n}`,
            ...options
        })
    }

    test('creates the occurrence due today and records it on the rule', () => {
        const result = run([rule()], [], at('2026-08-03'))

        expect(result.created).toHaveLength(1)
        expect(result.created[0].startDateTime).toBe('2026-08-03T09:00')
        expect(result.rules[0].lastGeneratedKey).toBe('2026-08-03')
        expect(result.skipped).toBe(0)
    })

    test('creates nothing before the anchor date', () => {
        const result = run([rule()], [], at('2026-08-01'))

        expect(result.created).toEqual([])
        expect(result.rules[0].lastGeneratedKey).toBeNull()
    })

    test('is idempotent across repeated runs on the same day', () => {
        const first = run([rule()], [], at('2026-08-03'))
        const second = run(first.rules, first.created, at('2026-08-03'))
        const third = run(second.rules, first.created, at('2026-08-03'))

        expect(first.created).toHaveLength(1)
        expect(second.created).toEqual([])
        expect(third.created).toEqual([])
    })

    test('produces one new occurrence the next day', () => {
        const day1 = run([rule()], [], at('2026-08-03'))
        const day2 = run(day1.rules, day1.created, at('2026-08-04'))

        expect(day2.created).toHaveLength(1)
        expect(day2.created[0].occurrenceKey).toBe('2026-08-04')
    })

    test('skips disabled rules entirely', () => {
        const result = run([rule({ enabled: false })], [], at('2026-08-10'))

        expect(result.created).toEqual([])
        expect(result.rules[0].lastGeneratedKey).toBeNull()
    })

    describe('after a long gap with the app closed', () => {
        test('creates only the most recent missed occurrence and reports the rest', () => {
            // Anchor 3 Aug, first launch 20 Aug: 18 daily occurrences are due.
            const result = run([rule()], [], at('2026-08-20'))

            expect(result.created).toHaveLength(1)
            expect(result.created[0].occurrenceKey).toBe('2026-08-20')
            expect(result.skipped).toBe(17)
        })

        test('does not resurrect the skipped occurrences on the next run', () => {
            const first = run([rule()], [], at('2026-08-20'))
            const second = run(first.rules, first.created, at('2026-08-21'))

            expect(second.created).toHaveLength(1)
            expect(second.created[0].occurrenceKey).toBe('2026-08-21')
            expect(second.skipped).toBe(0)
        })

        test('maxPerRule lets the caller widen the catch-up window', () => {
            const result = run([rule()], [], at('2026-08-06'), { maxPerRule: 3 })

            expect(result.created.map((t) => t.occurrenceKey)).toEqual([
                '2026-08-04',
                '2026-08-05',
                '2026-08-06'
            ])
            expect(result.skipped).toBe(1)
        })
    })

    describe('accumulate policy', () => {
        test('adds the new occurrence even when the previous one is still pending', () => {
            const day1 = run([rule()], [], at('2026-08-03'))
            const pending = day1.created // deliberately left uncompleted

            const day2 = run(day1.rules, pending, at('2026-08-04'))

            expect(day2.created).toHaveLength(1)
            expect([...pending, ...day2.created]).toHaveLength(2)
        })

        test('adds the new occurrence even when the previous one was completed', () => {
            const day1 = run([rule()], [], at('2026-08-03'))
            const done = day1.created.map((t) => ({ ...t, completed: true }))

            const day2 = run(day1.rules, done, at('2026-08-04'))

            expect(day2.created).toHaveLength(1)
        })

        // Completed tasks stay in the array, so this guards against a duplicate
        // appearing if lastGeneratedKey is ever lost or reset.
        test('never duplicates an occurrence that already exists as a task', () => {
            const existing = [
                Recurrence.materialize(rule(), '2026-08-03', 'task-existing', at('2026-08-03'))
            ]

            const result = run([{ ...rule(), lastGeneratedKey: null }], existing, at('2026-08-03'))

            expect(result.created).toEqual([])
        })
    })

    test('lookaheadDays pre-creates upcoming occurrences', () => {
        const result = run([rule()], [], at('2026-08-03'), {
            lookaheadDays: 2,
            maxPerRule: 5
        })

        expect(result.created.map((t) => t.occurrenceKey)).toEqual([
            '2026-08-03',
            '2026-08-04',
            '2026-08-05'
        ])
    })

    test('handles several rules independently', () => {
        const daily = rule({ id: 'rule-daily' })
        const weekly = rule({ id: 'rule-weekly', freq: 'weekly', byWeekday: [1] })

        const result = run([daily, weekly], [], at('2026-08-04'))

        // Monday 3 Aug for the weekly rule, 4 Aug for the daily one.
        expect(result.created.map((t) => t.ruleId).sort()).toEqual(['rule-daily', 'rule-weekly'])
        expect(result.rules.find((r) => r.id === 'rule-weekly').lastGeneratedKey).toBe('2026-08-03')
    })
})
