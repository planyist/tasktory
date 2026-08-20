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

const selectorsIn = (text) => {
    const found = new Map()
    const rule = /(^|\n)([^{}\n][^{}]*?)\{([^{}]*)\}/g
    let match
    while ((match = rule.exec(text))) {
        const selector = match[2].trim().replace(/\s+/g, ' ')
        if (selector.startsWith('@') || selector.startsWith('/*')) continue
        if (/^(\d+%|from|to)$/.test(selector)) continue // @keyframes 안의 단계
        found.set(selector, (found.get(selector) || 0) + 1)
    }
    return found
}

describe('styles.css', () => {
    // 이 파일에서 중복 선언은 미관 문제였던 적이 없다. 매번 규칙 하나가 지고
    // 있었다: .btn 이 두 번이라 아이콘 버튼이 테두리를 잃었고,
    // body.dark-mode thead 가 두 번이라 밝게 바꾼 표 머리가 다크에 한 번도
    // 적용되지 않았으며, .color-example 색 여덟 개는 통째로 가려져 있었다.
    test('declares no selector twice', () => {
        const duplicated = [...selectorsIn(BEFORE_MEDIA)]
            .filter(([, count]) => count > 1)
            .map(([selector]) => selector)

        expect(duplicated).toEqual([])
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
    test('the seven column widths add up to 100%', () => {
        const widths = [...CSS.matchAll(/th:nth-child\(\d\)\s*\{\s*width:\s*([\d.]+)%/g)]
            .map((m) => Number(m[1]))

        expect(widths).toHaveLength(7)
        expect(widths.reduce((a, b) => a + b, 0)).toBe(100)
    })

    // 이 둘이 빠지면 페이지를 넘길 때마다 헤더와 칸이 좌우로 흔들린다.
    test('keeps the table from resizing as you page', () => {
        expect(CSS).toMatch(/^table\s*\{[^}]*table-layout:\s*fixed/m)
        expect(CSS).toMatch(/\.table-container\s*\{[^}]*scrollbar-gutter:\s*stable/)
    })

    // 호버로 열면 창이 옮겨가거나 최소화에서 돌아올 때 포인터가 얹히면서
    // 부르지도 않은 목록이 표를 덮었다. 여닫는 것은 JS 가 정한다.
    test('does not open the completed panel on hover', () => {
        expect(CSS).not.toMatch(/completion-counter:hover\s+\.completed-list/)
        expect(CSS).toMatch(/\.completed-list\.is-open/)
    })

    // main 이 overflow: hidden 이라 absolute 로는 표 경계에서 잘린다.
    test('floats the completed panel free of the table', () => {
        expect(CSS).toMatch(/\.completed-list\s*\{[^}]*position:\s*fixed/)
    })
})
