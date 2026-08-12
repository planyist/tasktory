// 반복 규칙 엔진.
//
// 반복 작업은 표에 행 하나로 존재한다. 그 행이 곧 규칙이고, 완료하면 사라지는
// 대신 날짜가 규칙에 따라 다음 회차로 한 칸 이동한다. 회차를 미리 만들어 쌓지
// 않으므로 앱을 오래 안 켜도 목록이 넘치지 않고, 규칙이 항상 눈에 보여서
// 언제든 수정하거나 중단할 수 있다.
//
// 밀린 회차를 앱이 세어주지는 않는다. 실제로 몇 건이 남았는지는 사용자만 알기
// 때문에, 몰아서 넘기려면 날짜를 직접 고치면 된다.
//
// 규칙 형태:
//   {
//     id, content, tags,
//     freq: 'daily' | 'weekly' | 'monthly' | 'yearly',
//     interval: 1,                  // n일/주/개월/년마다
//     byWeekday: [1, 3],            // weekly 전용, 0=일요일
//     byMonthDay: 15,               // monthly 전용, 말일 초과 시 그 달 마지막 날로 클램프
//     anchorDate: 'YYYY-MM-DD',     // 규칙 시작일. interval의 기준점(위상)
//     untilDate: 'YYYY-MM-DD',      // 있으면 그 날까지만 반복한다 (그 날 포함).
//                                   // 없으면 끝없이 이어진다.
//     startTimeOfDay: 'HH:MM',      // 절대 시각이 아니라 "벽시계 시각"만 저장한다.
//     targetTimeOfDay: 'HH:MM',     // 타임존이 바뀌어도 "매일 09시"의 의미가 유지된다.
//     enabled: true
//   }

const Recurrence = (() => {
    const DAY_MS = 24 * 60 * 60 * 1000

    // 날짜 산술은 전부 UTC 기준 day number로 한다. 로컬 자정 기준으로 계산하면
    // 서머타임이 있는 지역에서 하루가 23/25시간이 되어 어긋난다.
    const parseKey = (key) => {
        const [y, m, d] = key.split('-').map(Number)
        return { y, m, d }
    }

    const toKey = ({ y, m, d }) =>
        `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

    const dayNumber = ({ y, m, d }) => Date.UTC(y, m - 1, d) / DAY_MS

    const fromDayNumber = (n) => {
        const date = new Date(n * DAY_MS)
        return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() }
    }

    const weekdayOf = (n) => new Date(n * DAY_MS).getUTCDay()

    // 그 주의 일요일에 해당하는 day number
    const weekStartOf = (n) => n - weekdayOf(n)

    const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()

    // Date -> 'YYYY-MM-DD' (로컬 기준). 로그 파일명 규칙과 동일하게 맞춘다.
    const localKey = (date) =>
        toKey({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })

    const addDaysToKey = (key, days) => toKey(fromDayNumber(dayNumber(parseKey(key)) + days))

    // 해당 날짜가 규칙의 회차인가?
    const matches = (rule, dn) => {
        const anchor = dayNumber(parseKey(rule.anchorDate))
        if (dn < anchor) return false

        const interval = rule.interval || 1
        const parts = fromDayNumber(dn)
        const anchorParts = fromDayNumber(anchor)

        if (rule.freq === 'daily') {
            return (dn - anchor) % interval === 0
        }

        if (rule.freq === 'weekly') {
            const weekdays =
                rule.byWeekday && rule.byWeekday.length ? rule.byWeekday : [weekdayOf(anchor)]
            if (!weekdays.includes(weekdayOf(dn))) return false
            const weeksApart = (weekStartOf(dn) - weekStartOf(anchor)) / 7
            return weeksApart % interval === 0
        }

        if (rule.freq === 'yearly') {
            const yearsApart = parts.y - anchorParts.y
            if (yearsApart % interval !== 0) return false
            if (parts.m !== anchorParts.m) return false
            // 2월 29일 규칙은 평년에 2월 28일로 내린다
            return parts.d === Math.min(anchorParts.d, daysInMonth(parts.y, parts.m))
        }

        if (rule.freq === 'monthly') {
            const monthsApart = (parts.y - anchorParts.y) * 12 + (parts.m - anchorParts.m)
            if (monthsApart % interval !== 0) return false
            // 31일 규칙이 2월을 만나면 그 달 마지막 날로 내린다
            const wanted = Math.min(
                rule.byMonthDay || anchorParts.d,
                daysInMonth(parts.y, parts.m)
            )
            return parts.d === wanted
        }

        return false
    }

    // afterKey 다음으로 오는 회차 날짜. 없으면 null.
    const nextOccurrenceAfter = (rule, afterKey) => {
        const start = dayNumber(parseKey(afterKey)) + 1
        // 병적인 입력에서도 멈추도록 상한을 둔다. 가장 성긴 규칙(수년 간격)도
        // 이 안에서는 반드시 걸린다.
        let limit = start + 366 * 12

        // 종료일이 있으면 그 날까지만 본다. 그 다음은 없다(null)는 뜻이고,
        // 호출하는 쪽에서는 "더 이상 넘길 회차가 없다"로 읽혀 일반 작업처럼
        // 완료된다.
        if (rule.untilDate) {
            const until = dayNumber(parseKey(rule.untilDate))
            if (until < start) return null
            limit = Math.min(limit, until)
        }

        for (let dn = start; dn <= limit; dn++) {
            if (matches(rule, dn)) return toKey(fromDayNumber(dn))
        }
        return null
    }

    // 회차 날짜 -> 태스크가 쓰는 시작/목표 시각.
    // 목표 시각이 시작 시각보다 이르면 다음 날로 넘긴다 (예: 22:00 시작 ~ 02:00 목표).
    const occurrenceTimes = (rule, occurrenceKey) => {
        const rollsOver = rule.targetTimeOfDay <= rule.startTimeOfDay
        const targetKey = rollsOver ? addDaysToKey(occurrenceKey, 1) : occurrenceKey

        return {
            // 기존 태스크와 같은 'YYYY-MM-DD HH:MM' 저장 형식을 쓴다
            startDateTime: `${occurrenceKey} ${rule.startTimeOfDay}`,
            targetDateTime: `${targetKey} ${rule.targetTimeOfDay}`
        }
    }

    return { nextOccurrenceAfter, occurrenceTimes, localKey }
})()
