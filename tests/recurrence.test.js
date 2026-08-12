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
    enabled: true,
    ...overrides
})

// Walk the rule forward from `from`, the way completing the task repeatedly does.
const walk = (r, from, steps) => {
    const dates = []
    let cursor = from
    for (let i = 0; i < steps; i++) {
        cursor = Recurrence.nextOccurrenceAfter(r, cursor)
        if (!cursor) break
        dates.push(cursor)
    }
    return dates
}

describe('nextOccurrenceAfter', () => {
    describe('daily', () => {
        test('steps one day at a time', () => {
            expect(walk(rule(), '2026-08-02', 4)).toEqual([
                '2026-08-03',
                '2026-08-04',
                '2026-08-05',
                '2026-08-06'
            ])
        })

        test('honours an interval greater than one', () => {
            expect(walk(rule({ interval: 3 }), '2026-08-02', 4)).toEqual([
                '2026-08-03',
                '2026-08-06',
                '2026-08-09',
                '2026-08-12'
            ])
        })

        test('never returns a date before the anchor', () => {
            expect(Recurrence.nextOccurrenceAfter(rule(), '2026-07-01')).toBe('2026-08-03')
        })
    })

    describe('weekly', () => {
        // 2026-08-03 is a Monday.
        test('visits each selected weekday in turn', () => {
            const weekly = rule({ freq: 'weekly', byWeekday: [1, 3] })

            expect(walk(weekly, '2026-08-02', 4)).toEqual([
                '2026-08-03',
                '2026-08-05',
                '2026-08-10',
                '2026-08-12'
            ])
        })

        test('skips intervening weeks when the interval is 2', () => {
            const biweekly = rule({ freq: 'weekly', byWeekday: [1], interval: 2 })

            expect(walk(biweekly, '2026-08-02', 3)).toEqual([
                '2026-08-03',
                '2026-08-17',
                '2026-08-31'
            ])
        })

        test('defaults to the anchor weekday when none is given', () => {
            expect(walk(rule({ freq: 'weekly' }), '2026-08-02', 3)).toEqual([
                '2026-08-03',
                '2026-08-10',
                '2026-08-17'
            ])
        })
    })

    describe('monthly', () => {
        test('lands on the same day each month', () => {
            const monthly = rule({ freq: 'monthly', byMonthDay: 15, anchorDate: '2026-01-15' })

            expect(walk(monthly, '2026-01-01', 4)).toEqual([
                '2026-01-15',
                '2026-02-15',
                '2026-03-15',
                '2026-04-15'
            ])
        })

        // The classic recurrence trap: there is no 31st of February.
        test('clamps to the last day of shorter months', () => {
            const monthly = rule({ freq: 'monthly', byMonthDay: 31, anchorDate: '2026-01-31' })

            expect(walk(monthly, '2026-01-01', 4)).toEqual([
                '2026-01-31',
                '2026-02-28',
                '2026-03-31',
                '2026-04-30'
            ])
        })

        test('clamps to 29 February in a leap year', () => {
            const monthly = rule({ freq: 'monthly', byMonthDay: 30, anchorDate: '2028-01-30' })

            expect(walk(monthly, '2028-01-01', 3)).toEqual([
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

            expect(walk(quarterly, '2025-12-31', 4)).toEqual([
                '2026-01-01',
                '2026-04-01',
                '2026-07-01',
                '2026-10-01'
            ])
        })
    })

    describe('yearly', () => {
        test('lands on the same month and day', () => {
            const yearly = rule({ freq: 'yearly', anchorDate: '2026-03-15' })

            expect(walk(yearly, '2026-01-01', 4)).toEqual([
                '2026-03-15',
                '2027-03-15',
                '2028-03-15',
                '2029-03-15'
            ])
        })

        test('clamps a 29 February anchor to the 28th in common years', () => {
            const yearly = rule({ freq: 'yearly', anchorDate: '2028-02-29' })

            expect(walk(yearly, '2028-01-01', 5)).toEqual([
                '2028-02-29',
                '2029-02-28',
                '2030-02-28',
                '2031-02-28',
                '2032-02-29'
            ])
        })

        test('honours an interval of two', () => {
            const biennial = rule({ freq: 'yearly', interval: 2, anchorDate: '2026-06-01' })

            expect(walk(biennial, '2026-01-01', 3)).toEqual([
                '2026-06-01',
                '2028-06-01',
                '2030-06-01'
            ])
        })
    })

    test('returns null for a frequency it does not know', () => {
        expect(Recurrence.nextOccurrenceAfter(rule({ freq: 'hourly' }), '2026-08-02')).toBeNull()
    })
})

describe('occurrenceTimes', () => {
    test('builds the stored datetime strings from the rule wall-clock times', () => {
        expect(Recurrence.occurrenceTimes(rule(), '2026-08-05')).toEqual({
            startDateTime: '2026-08-05 09:00',
            targetDateTime: '2026-08-05 18:00'
        })
    })

    test('rolls the target to the next day for an overnight window', () => {
        const overnight = rule({ startTimeOfDay: '22:00', targetTimeOfDay: '02:00' })

        expect(Recurrence.occurrenceTimes(overnight, '2026-08-05')).toEqual({
            startDateTime: '2026-08-05 22:00',
            targetDateTime: '2026-08-06 02:00'
        })
    })
})

describe('localKey', () => {
    test('formats a date as YYYY-MM-DD in local time', () => {
        expect(Recurrence.localKey(new Date(2026, 7, 5, 23, 30))).toBe('2026-08-05')
    })
})

// 언제까지 반복할지. 없으면 무기한이라는 기존 동작은 그대로다.
describe('untilDate', () => {
    const daily = (extra = {}) => ({
        freq: 'daily', interval: 1, byWeekday: [], anchorDate: '2026-08-01',
        startTimeOfDay: '09:00', targetTimeOfDay: '18:00', enabled: true, ...extra
    })

    test('stops after the end date', () => {
        const rule = daily({ untilDate: '2026-08-05' })

        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-03')).toBe('2026-08-04')
        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-04')).toBe('2026-08-05')
        // 종료일 다음은 없다
        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-05')).toBeNull()
    })

    test('includes the end date itself', () => {
        const rule = daily({ untilDate: '2026-08-10' })

        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-09')).toBe('2026-08-10')
    })

    test('returns null when the end date is already behind', () => {
        const rule = daily({ untilDate: '2026-08-02' })

        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-20')).toBeNull()
    })

    // 종료일이 회차가 아닌 날일 수도 있다. 그 앞의 마지막 회차까지만 나온다.
    test('does not invent an occurrence on the end date', () => {
        const rule = daily({
            freq: 'weekly', byWeekday: [1], anchorDate: '2026-08-03', untilDate: '2026-08-13'
        })

        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-03')).toBe('2026-08-10')
        expect(Recurrence.nextOccurrenceAfter(rule, '2026-08-10')).toBeNull()
    })

    test('without one it keeps going as before', () => {
        expect(Recurrence.nextOccurrenceAfter(daily(), '2027-05-01')).toBe('2027-05-02')
    })
})
