// styles.css 를 텍스트로 검사한다. 계산된 스타일은 여기서 보지 않는다.
//
// 왜 텍스트만 보는가: jsdom 은 복합 선택자의 우선순위를 제대로 따지지 못한다.
// 실제로 재보면 다크 모드의 #addTaskBtn 은 초록(rgb(40,167,69))인데 jsdom 은
// rgb(45,45,45) 이라고 답한다 - body.dark-mode .btn.add-btn 을 무시하고 더 약한
// body.dark-mode .btn 을 적용한다. 잡으려는 결함이 바로 그 우선순위 문제이므로,
// jsdom 에 물으면 틀린 답을 받아든다. 계산된 값은 scripts/check-ui.js 가 진짜
// Chromium 에서 확인한다.
//
// 그래도 텍스트만으로 잡히는 것이 있다. 실제로 이 프로젝트에서 반복해 터진
// 유형은 "같은 선택자가 두 번 선언돼 뒤엣것이 조용히 이긴다" 였고, 그건 파일을
// 읽는 것만으로 확실히 잡힌다.
const fs = require('fs')
const path = require('path')

const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
const BEFORE_MEDIA = CSS.slice(0, CSS.indexOf('@media') === -1 ? CSS.length : CSS.indexOf('@media'))

// 주석을 먼저 걷어낸다. 남겨 두면 규칙 바로 앞의 주석이 선택자에 딸려 들어와
// `/*` 로 시작하는 문자열이 되고, 그런 규칙은 통째로 건너뛰었다 - 이 파일에서는
// 잘 적힌 규칙일수록 주석이 붙어 있으므로, 감사가 못 보던 쪽이 오히려 더 많았다.
const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')

// 선택자 하나가 어떤 속성을 몇 번 받았는지. 묶음은 쪼개서 센다 - 통째로 견주면
// `.a` 와 `.a, .b` 가 남남이 되어, 같은 선택자를 두 번 선언해도 한쪽을 묶음에
// 끼워 넣기만 하면 감사를 지나갔다. 실제로 .table-container 가 그렇게 두 번
// 선언됐고, 뒤엣것이 이겨 앞의 규칙이 조용히 죽어 있었다.
const declarationsIn = (source) => {
    const text = withoutComments(source)
    const found = new Map()
    const rule = /(^|\n)\s*([^{}\n][^{}]*?)\{([^{}]*)\}/g
    let match
    while ((match = rule.exec(text))) {
        const selector = match[2].trim().replace(/\s+/g, ' ')
        if (selector.startsWith('@')) continue
        if (/^(\d+%|from|to)$/.test(selector)) continue // @keyframes 안의 단계
        const properties = match[3].split(';')
            .map((line) => line.split(':')[0].trim())
            .filter(Boolean)
        for (const one of selector.split(',')) {
            const name = one.trim()
            if (!name) continue
            if (!found.has(name)) found.set(name, new Map())
            const counts = found.get(name)
            for (const property of properties) {
                counts.set(property, (counts.get(property) || 0) + 1)
            }
        }
    }
    return found
}

describe('styles.css', () => {
    // 이 파일에서 중복 선언은 미관 문제였던 적이 없다. 매번 규칙 하나가 지고
    // 있었다: .btn 이 두 번이라 아이콘 버튼이 테두리를 잃었고,
    // body.dark-mode thead 가 두 번이라 밝게 바꾼 표 머리가 다크에 한 번도
    // 적용되지 않았으며, .color-example 색 여덟 개는 통째로 가려져 있었다.
    // 세는 것은 선언 횟수가 아니라 *같은 속성이 같은 선택자에 두 번 오는가* 다.
    // `.a, .b { height }` 옆에 `.a { border }` 가 있는 것은 아무도 지지 않으므로
    // 묶어 쓴 죄로 걸리지 않아야 하고, 반대로 두 블록이 같은 속성을 말하면 한쪽은
    // 반드시 죽는다.
    test('declares no property twice for the same selector', () => {
        const clashes = []
        for (const [selector, counts] of declarationsIn(BEFORE_MEDIA)) {
            for (const [property, count] of counts) {
                if (count > 1) clashes.push(`${selector} { ${property} } x${count}`)
            }
        }

        expect(clashes).toEqual([])
    })

    // 어떤 클래스에도 붙지 않는 규칙은 지워진 기능의 잔해다. 행 버튼이 막대로
    // 옮겨간 뒤에도 .action-btn / .edit-btn / .highlight-btn 규칙이 한참 남아 있었다.
    test('styles no class that nothing carries', () => {
        const markup = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
            + fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8')
        const classes = new Set([...CSS.matchAll(/\.([a-zA-Z][\w-]+)/g)].map((m) => m[1]))
        // quick-pending 같은 것은 `quick-${kind}` 로 조립되므로 문자열로는 안 나온다
        const dead = [...classes].filter((c) => !markup.includes(c) && !/^quick-/.test(c))

        expect(dead).toEqual([])
    })

    // table-layout: fixed 에서 선언한 폭의 합이 100%가 아니면 마지막 칸이 어긋난다.
    // 첨부 컬럼이 있을 때와 없을 때, 두 벌 모두 100% 여야 한다. 한쪽만 맞으면
    // 첨부가 있는 목록에서만 폭이 어긋난다.
    test('each set of column widths adds up to 100%', () => {
        const base = [...CSS.matchAll(/^th:nth-child\((\d)\)\s*\{\s*width:\s*([\d.]+)%/gm)]
            .map((m) => ({ n: Number(m[1]), w: Number(m[2]) }))
        const withFiles = [...CSS.matchAll(
            /#tasksTable\.has-attachments th:nth-child\((\d)\)\s*\{\s*width:\s*([\d.]+)%/g)]
            .map((m) => ({ n: Number(m[1]), w: Number(m[2]) }))

        expect(base).toHaveLength(8)
        expect(base.reduce((a, c) => a + c.w, 0)).toBe(100)

        // 겹쳐 쓰는 것만 바꾸므로, 덮이지 않은 자리는 기본값이 그대로 쓰인다
        const merged = new Map(base.map((c) => [c.n, c.w]))
        for (const c of withFiles) merged.set(c.n, c.w)
        expect([...merged.values()].reduce((a, b) => a + b, 0)).toBe(100)
    })

    // 이 둘이 빠지면 페이지를 넘길 때마다 헤더와 칸이 좌우로 흔들린다. 두 번째는
    // *수단*이 아니라 약속을 묻는다: 스크롤바 자리는 늘 잡혀 있어야 한다.
    // scrollbar-gutter: stable 로도 되고 overflow-y: scroll 로도 되는데, 전자는
    // 넘치지 않는 목록에서 그 자리가 빈 흰 띠로 남아 줄무늬 행 옆에 흰 세로줄을
    // 그었다. 어느 쪽을 쓰든 컬럼이 안 움직이면 된다.
    test('keeps the table from resizing as you page', () => {
        expect(CSS).toMatch(/^table\s*\{[^}]*table-layout:\s*fixed/m)

        const shell = withoutComments(BEFORE_MEDIA).split('}').find((block) => block.split('{')[0]
            .split(',').some((s) => s.trim() === '.table-container'))
        expect(shell).toBeDefined()
        expect(shell).toMatch(/scrollbar-gutter:\s*stable|overflow-y:\s*scroll/)
    })

})

// 문서가 코드를 따라오는지 기계로 묻는다. 로그 컬럼은 세 번 늘었고 그때마다
// README 나 CLAUDE.md 가 뒤처졌다 - 아홉 칸이라고 적힌 채 세 릴리스가 지나간
// 적도 있다. 사람이 눈으로 훑는 대신 여기서 걸린다.

// 화면에 나가는 글은 전부 다섯 언어를 지나야 한다. 이 규칙은 여러 번 샜다:
// 위치 범위 경고, 태그 프리셋 둘, 내보내기 셋, 가져오기, 브라우저 저장이
// 영어만 말하고 있었고, 위치 칸의 placeholder 도 마크업에 영어로 박혀 있었다.
// 하나씩 발견해 고치는 방식으로는 다음에 또 새므로 여기서 막는다.
// 접힘과 펴기에서 .container 의 폭과 여백이 바뀐다. 거기에 전환이 걸려 있으면
// 창은 이미 제 크기로 떠 있는데 안쪽만 0.3 초에 걸쳐 벌어진다 - 재 보니 150px
// 에서 884px 까지 43 가지 폭을 42 프레임에 지나갔고, "내용이 퍼지듯 나온다"로
// 신고됐다. 크기는 창이 정하고, 창은 한 번에 정해진다.
describe('the container does not animate its own size', () => {
    test('.container declares no transition', () => {
        const block = CSS.split('}').find((part) => part.split('{')[0].trim() === '.container')
        // 주석에는 이 규칙이 왜 있는지가 적혀 있고 거기에도 그 단어가 나온다.
        // 선언만 본다.
        const declarations = block.split('{')[1].replace(/\/\*[\s\S]*?\*\//g, '')

        expect(block).toBeDefined()
        expect(declarations).not.toMatch(/transition\s*:/)
    })
})

describe('nothing shown to the user is written in one language', () => {
    const RENDERER = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8')
    const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')

    // alert('Tag already exists') 같은 것. 따옴표가 곧 하드코딩이다.
    test('no alert is handed a quoted string', () => {
        const quoted = [...RENDERER.matchAll(/alert\(\s*(['"])/g)].map((m) => m[0])

        expect(quoted).toEqual([])
    })

    // 백틱은 값을 끼워 넣으려고 쓴다. ${...} 를 걷어내고도 글자가 남으면
    // 그 글자는 번역을 지나지 않은 것이다.
    test('and no template literal in an alert carries words of its own', () => {
        const carried = [...RENDERER.matchAll(/alert\(\s*`([^`]*)`/g)]
            .map((m) => m[1].replace(/\$\{[^}]*\}/g, ''))
            .filter((rest) => /[A-Za-z]/.test(rest))

        expect(carried).toEqual([])
    })

    // placeholder 는 updateUIText 가 채운다. 마크업에 글자를 두면 그 글자가
    // 번역되지 않을 뿐 아니라, 채워지기 전 한순간 영어가 보인다.
    test('no placeholder carries its text in the markup', () => {
        const written = [...HTML.matchAll(/placeholder="([^"]+)"/g)].map((m) => m[1])

        expect(written).toEqual([])
    })
})

describe('the docs name the log columns the code writes', () => {
    const at = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8')
    const HEADER = at('renderer.js').match(/const LOG_HEADER = '([^']+)'/)[1]
    // 소스에 적힌 헤더는 탭이 아니라 두 글자 '\\t' 다. 진짜 탭으로 쪼개면
    // 아무것도 나뉘지 않는다.
    const READABLE = HEADER.split('\\t').join(' ')

    for (const file of ['README.md', 'CLAUDE.md']) {
        test(file + ' lists every column, in order', () => {
            expect(at(file).split(/\s+/).join(' ')).toContain(READABLE)
        })
    }

    // main.js 가 파일에 쓰는 헤더와 renderer 가 내보내기에 쓰는 것이 같아야 한다.
    // 한 번 어긋난 적이 있고, 내보내기 테스트가 둘을 견주기 전까지 몰랐다.
    test('main.js writes the same header the renderer exports', () => {
        expect(at('main.js').match(/const header = '([^']+)'/)[1]).toBe(HEADER + '\\n')
    })
})
