// 반복 규칙 엔진.
//
// 반복 항목은 태스크가 아니라 "규칙"으로 저장하고, 실제 목록에 보이는 것은
// 규칙에서 찍어낸 인스턴스뿐이다. Tasktory는 상시 실행되는 서버가 아니므로
// 타이머로 생성하지 않고, 앱을 켤 때마다 catchUp()으로 밀린 회차를 따라잡는다.
// rule.lastGeneratedKey 덕분에 하루에 몇 번을 켜도 결과가 같다(멱등).
//
// 규칙 형태:
//   {
//     id, content, tags,
//     freq: 'daily' | 'weekly' | 'monthly',
//     interval: 1,                  // n일/주/개월마다
//     byWeekday: [1, 3],            // weekly 전용, 0=일요일
//     byMonthDay: 15,               // monthly 전용, 말일 초과 시 그 달 마지막 날로 클램프
//     anchorDate: 'YYYY-MM-DD',     // 규칙 시작일. interval 계산의 기준점
//     startTimeOfDay: 'HH:MM',      // 절대 시각이 아니라 "벽시계 시각"만 저장한다.
//     targetTimeOfDay: 'HH:MM',     // 타임존이 바뀌어도 "매일 09시"의 의미가 유지된다.
//     lastGeneratedKey: 'YYYY-MM-DD' | null,
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

    // (afterKey, throughKey] 구간의 회차 날짜들
    const occurrencesBetween = (rule, afterKey, throughKey) => {
        const start = dayNumber(parseKey(afterKey)) + 1
        const end = dayNumber(parseKey(throughKey))
        const found = []

        // 병적인 입력(수십 년 전 anchor 등)에서도 멈추도록 상한을 둔다
        const limit = Math.min(end, start + 366 * 10)
        for (let dn = start; dn <= limit; dn++) {
            if (matches(rule, dn)) found.push(toKey(fromDayNumber(dn)))
        }
        return found
    }

    // 회차 -> 실제 태스크. 목표 시각이 시작 시각보다 이르면 다음 날로 넘긴다
    // (예: 22:00 시작 ~ 02:00 목표).
    const materialize = (rule, occurrenceKey, id, now) => {
        const rollsOver = rule.targetTimeOfDay <= rule.startTimeOfDay
        const targetKey = rollsOver ? addDaysToKey(occurrenceKey, 1) : occurrenceKey

        return {
            id,
            content: rule.content,
            tags: rule.tags || '',
            startDateTime: `${occurrenceKey}T${rule.startTimeOfDay}`,
            targetDateTime: `${targetKey}T${rule.targetTimeOfDay}`,
            completed: false,
            createdAt: now.toISOString(),
            ruleId: rule.id,
            occurrenceKey
        }
    }

    // 이월 정책. 지금은 누적형이다: 이전 회차가 미완료로 남아 있어도 새 회차를
    // 그대로 추가하고, 같은 회차만 중복 생성하지 않는다. 갱신형(항상 1개만 유지)으로
    // 바꾸려면 이 함수만 고치면 된다.
    const shouldCreate = (rule, occurrenceKey, tasks) =>
        !tasks.some((task) => task.ruleId === rule.id && task.occurrenceKey === occurrenceKey)

    // 앱을 켤 때 밀린 회차를 따라잡는다.
    //   options.lookaheadDays - 며칠 앞까지 미리 만들지 (기본 0 = 오늘까지)
    //   options.maxPerRule    - 한 번에 규칙당 최대 몇 개까지 만들지 (기본 1)
    //   options.newId         - 새 태스크 id 생성기
    // 반환: { rules, created, skipped }
    //   skipped 는 상한 때문에 건너뛴 회차 수. 조용히 잘라내지 않고 호출자에게 알린다.
    const catchUp = (rules, tasks, now, options = {}) => {
        const lookaheadDays = options.lookaheadDays || 0
        const maxPerRule = options.maxPerRule || 1
        const newId = options.newId || (() => `task-${Math.random().toString(36).slice(2)}`)

        const throughKey = addDaysToKey(localKey(now), lookaheadDays)
        const created = []
        let skipped = 0

        const nextRules = rules.map((rule) => {
            if (rule.enabled === false) return rule

            const afterKey =
                rule.lastGeneratedKey || addDaysToKey(rule.anchorDate, -1)
            const due = occurrencesBetween(rule, afterKey, throughKey)
            if (due.length === 0) return rule

            skipped += Math.max(0, due.length - maxPerRule)

            for (const occurrenceKey of due.slice(-maxPerRule)) {
                if (shouldCreate(rule, occurrenceKey, tasks)) {
                    created.push(materialize(rule, occurrenceKey, newId(), now))
                }
            }

            // 건너뛴 회차도 소비된 것으로 처리해 다음 실행에서 되살아나지 않게 한다
            return { ...rule, lastGeneratedKey: due[due.length - 1] }
        })

        return { rules: nextRules, created, skipped }
    }

    return { matches, occurrencesBetween, materialize, catchUp, localKey, addDaysToKey }
})()
