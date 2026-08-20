// 진짜 Chromium 에서만 답이 나오는 것들을 확인한다. `npm run check:ui`
//
// Jest 는 jsdom 위에서 돈다. jsdom 은 레이아웃을 계산하지 않고(getBoundingClientRect
// 가 늘 0), 복합 선택자의 우선순위도 제대로 따지지 못한다. 그래서 아래 유형은
// 315개 테스트를 전부 통과하면서도 화면에서는 깨져 있었다:
//
//   - 다크 모드 표 머리가 밝아지지 않음      (계단식 우선순위)
//   - 아이콘 버튼 테두리가 테마마다 다름      (계단식 우선순위)
//   - 완료 목록이 표 아래로 깔림             (z-index / overflow)
//   - 페이저가 생기면 표가 10px 줄어듦        (요소 높이)
//   - 페이지를 넘기면 컬럼이 흔들림           (table-layout / 스크롤바)
//
// 전부 "재보면 바로 아는" 것들이라, 눈대중 대신 여기서 값을 읽고 비교한다.
const { app, BrowserWindow } = require('electron')
const path = require('path')

// 실제 사용자 데이터에 붙지 않는다. 이 스크립트는 앱의 renderer 를 그대로 돌리므로
// saveTasks 계열이 불리면 진짜 tasks.json 을 덮어쓴다.
app.setPath('userData', path.join(app.getPath('temp'), 'tasktory-check-ui'))

const ROOT = path.join(__dirname, '..')

const results = []
const check = (name, pass, detail) => {
    results.push({ name, pass, detail })
    console.log(`  ${pass ? 'OK  ' : '실패'}  ${name}${detail ? '  — ' + detail : ''}`)
}

const sample = (count) => Array.from({ length: count }, (_, i) => ({
    id: 't' + i,
    content: i % 3 === 0 ? '내용이 제법 긴 작업 ' + (i + 1) : '짧은 작업',
    tags: i % 2 ? '#[BLUE]보고' : '#회의',
    startDateTime: '2026-08-12 09:00',
    targetDateTime: '2026-08-12 18:00',
    completed: false
}))

const seed = (count, extra = '') => `
    document.getElementById('infoBar').style.display = 'none';
    taskManager.tasks = ${JSON.stringify(sample(count))};
    taskManager.viewMode = 'list';
    taskManager.isCollapsed = false;
    taskManager.currentPage = 1;
    taskManager.applyViewMode();
    taskManager.renderTasks();
    ${extra}
    'ok';`

app.whenReady().then(async () => {
    // 창을 띄운다. 숨긴 창에서는 :hover 가 걸리지 않아 호버 검사를 할 수 없다.
    const win = new BrowserWindow({ width: 900, height: 500, show: true })
    await win.loadFile(path.join(ROOT, 'index.html'))
    // init() 이 loadTasks 를 비동기로 마친 뒤라야 씨앗이 살아남는다
    await new Promise((r) => setTimeout(r, 2500))
    const run = (js) => win.webContents.executeJavaScript(js)

    console.log('\n실제 Chromium 에서 확인 중...\n')

    // --- 1. 테마: 테두리 유무가 갈리면 같은 버튼이 테마마다 달라 보인다 -----
    await run(seed(8))
    const SELECTORS = [
        '#importBtn', '#exportBtn', '#settingsBtn', '#addTaskBtn', '#collapseBtn',
        '.clear-search-btn', '.search-input', '#searchColumn', '.completion-counter',
        '.task-action-bar', '.bar-btn', '.quick-chip', '.page-size-select',
        '.pagination-btn', 'table', 'thead', 'th', 'td', '.table-container'
    ]
    const borderProbe = (sels) => `(() => {
        const out = {};
        for (const sel of ${JSON.stringify(sels)}) {
            const el = document.querySelector(sel);
            if (!el) { out[sel] = null; continue; }
            const cs = getComputedStyle(el);
            out[sel] = ['Top','Right','Bottom','Left'].map(side => {
                const w = parseFloat(cs['border' + side + 'Width']) || 0;
                const c = cs['border' + side + 'Color'];
                return w > 0 && !/rgba\\(.*,\\s*0\\)$/.test(c) ? 1 : 0;
            }).join('');
        }
        return JSON.stringify(out);
    })()`
    const theme = {}
    for (const dark of [false, true]) {
        await run(`taskManager.darkMode = ${dark}; taskManager.applyTheme(); 'ok';`)
        theme[dark ? 'dark' : 'light'] = JSON.parse(await run(borderProbe(SELECTORS)))
    }
    const mismatched = SELECTORS.filter(
        (s) => theme.light[s] !== null && theme.light[s] !== theme.dark[s]
    )
    check('테두리 유무가 두 테마에서 같다', mismatched.length === 0, mismatched.join(', '))

    // 유일한 주요 동작이라 두 테마 모두 채운 초록이어야 한다
    const addBg = (dark) => run(
        `taskManager.darkMode = ${dark}; taskManager.applyTheme();
         getComputedStyle(document.getElementById('addTaskBtn')).backgroundColor`)
    const [addLight, addDark] = [await addBg(false), await addBg(true)]
    check('추가 버튼이 두 테마 모두 초록', addLight === addDark && addLight.includes('40, 167, 69'),
        `light=${addLight} dark=${addDark}`)

    // 호버까지 재야 한다. 다크에서 마우스를 올리면 초록이 회색으로 바뀌는 버그가
    // 있었는데, 정지 상태만 보는 위 검사는 그것을 통과시켰다. 범인은 파일 뒤쪽의
    // body.dark-mode .btn:hover:not(:disabled) 로, 순위가 같아 순서로 이겼다.
    const dbg = win.webContents.debugger
    dbg.attach('1.3')
    const moveTo = (x, y) => dbg.sendCommand('Input.dispatchMouseEvent',
        { type: 'mouseMoved', x, y })

    const addHoverBg = async (dark) => {
        await run(`taskManager.darkMode = ${dark}; taskManager.applyTheme(); 'ok'`)
        const box = JSON.parse(await run(`(() => {
            const r = document.getElementById('addTaskBtn').getBoundingClientRect();
            return JSON.stringify({ x: Math.round(r.left + r.width / 2),
                                    y: Math.round(r.top + r.height / 2) });
        })()`))
        await moveTo(box.x, box.y)
        // 배경색에 transition 이 걸려 있어, 바로 읽으면 중간 색이 나온다
        await new Promise((r) => setTimeout(r, 400))
        const bg = await run(
            `getComputedStyle(document.getElementById('addTaskBtn')).backgroundColor`)
        await moveTo(2, 2)
        await new Promise((r) => setTimeout(r, 300))
        return bg
    }
    const [hoverLight, hoverDark] = [await addHoverBg(false), await addHoverBg(true)]
    dbg.detach()
    check('추가 버튼이 호버에서도 두 테마 모두 초록',
        hoverLight === hoverDark && hoverLight.includes('47, 158, 79'),
        `light=${hoverLight} dark=${hoverDark}`)

    // 표 머리는 테마마다 색이 달라야 한다 (같으면 한쪽 규칙이 지고 있다는 뜻)
    const headBg = (dark) => run(
        `taskManager.darkMode = ${dark}; taskManager.applyTheme();
         getComputedStyle(document.querySelector('thead')).backgroundColor`)
    const [headLight, headDark] = [await headBg(false), await headBg(true)]
    check('표 머리가 테마별로 다른 색', headLight !== headDark, `light=${headLight} dark=${headDark}`)
    await run(`taskManager.darkMode = false; taskManager.applyTheme(); 'ok';`)

    // --- 2. 페이지를 넘겨도 표가 흔들리지 않는다 ---------------------------
    const geometry = `(() => {
        const cols = [...document.querySelectorAll('thead th')]
            .map(th => Math.round(th.getBoundingClientRect().width));
        const c = document.querySelector('.table-container');
        return JSON.stringify({
            cols,
            container: Math.round(c.getBoundingClientRect().height),
            pager: Math.round(document.querySelector('.pagination-container')
                .getBoundingClientRect().height)
        });
    })()`
    await run(seed(14))
    const page1 = JSON.parse(await run(geometry))
    await run(`taskManager.currentPage = 2; taskManager.renderTasks(); 'ok';`)
    const page2 = JSON.parse(await run(geometry))
    check('페이지를 넘겨도 컬럼 폭이 같다',
        page1.cols.join(',') === page2.cols.join(','),
        `${page1.cols.join(',')} vs ${page2.cols.join(',')}`)

    // --- 3. 페이저가 생겼다 사라져도 표 높이가 그대로 -----------------------
    await run(seed(5))
    const few = JSON.parse(await run(geometry))
    await run(seed(34))
    const many = JSON.parse(await run(geometry))
    check('페이저 유무가 표 높이를 바꾸지 않는다',
        few.container === many.container && few.pager === many.pager,
        `표 ${few.container}/${many.container}, 줄 ${few.pager}/${many.pager}`)

    // --- 4. 완료 목록이 표 위로 뜬다 ---------------------------------------
    const panel = JSON.parse(await run(`(() => {
        taskManager.placeCompletedList();
        const list = document.getElementById('completedList');
        list.innerHTML = Array.from({length: 12},
            (_, i) => '<div class="completed-row">끝낸 작업 ' + i + '</div>').join('');
        list.classList.add('is-open');
        const r = list.getBoundingClientRect();
        const cs = getComputedStyle(list);
        const at = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
        return JSON.stringify({
            position: cs.position,
            z: Number(cs.zIndex),
            headerZ: Number(getComputedStyle(document.querySelector('thead')).zIndex),
            height: Math.round(r.height),
            topmostClass: at ? String(at.className) : null
        });
    })()`))
    check('완료 목록이 sticky 헤더보다 위',
        panel.position === 'fixed' && panel.z > panel.headerZ,
        `${panel.position}, z=${panel.z} vs 헤더 ${panel.headerZ}`)
    check('완료 목록이 잘리지 않고 최상단에 그려진다',
        panel.height > 100 && /completed/.test(panel.topmostClass || ''),
        `높이 ${panel.height}, 그 자리 최상위=${panel.topmostClass}`)

    // --- 5. 달력: 요일 머리와 격자 열이 어긋나지 않는다 ---------------------
    const calendar = JSON.parse(await run(`
        taskManager.viewMode = 'calendar'; taskManager.applyViewMode(); taskManager.renderTasks();
        (() => {
            const head = [...document.querySelectorAll('#calWeekdays > div')]
                .map(d => Math.round(d.getBoundingClientRect().left));
            const first = [...document.querySelectorAll('#calGrid .cal-day')].slice(0, 7)
                .map(d => Math.round(d.getBoundingClientRect().left));
            return JSON.stringify({ head, first });
        })()`))
    check('달력 요일 머리가 격자 열과 맞는다',
        calendar.head.join(',') === calendar.first.join(','),
        `${calendar.head.join(',')} vs ${calendar.first.join(',')}`)

    const failed = results.filter((r) => !r.pass)
    console.log(`\n${results.length}건 중 ${failed.length}건 실패\n`)
    win.destroy()
    process.exit(failed.length ? 1 : 0)
}).catch((err) => {
    console.error(err)
    process.exit(1)
})
