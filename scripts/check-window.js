/**
 * Window behaviour, measured against the real window main.js creates.
 *
 * `check-ui.js` makes its own window with no preload, so `isElectron` is false
 * there and nothing reaches the resize IPC — collapsing in that script changes
 * the page and not the window. Anything about the window's own size has to run
 * against main.js's window, which is what this file does.
 *
 * Everything it asserts is something that shipped broken:
 *   - expanding restored a hardcoded 900x500, so widening the window and
 *     collapsing once threw the size away
 *   - a maximized window cannot be resized with setBounds, so Ctrl+M drew the
 *     strip and left the window covering the screen
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')

const ROOT = path.join(__dirname, '..')
app.setPath('userData', path.join(__dirname, '..', 'dist-build-check-window'))

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0

const check = (name, ok, detail) => {
    console.log((ok ? '  OK   ' : '  실패 ') + name + (detail ? '  — ' + detail : ''))
    if (!ok) failures += 1
}

require(path.join(ROOT, 'main.js'))

app.whenReady().then(async () => {
    await wait(2500)
    const win = BrowserWindow.getAllWindows()[0]
    const run = (js) => win.webContents.executeJavaScript(js)
    const collapse = async () => {
        await run('taskManager.toggleCollapse()')
        await wait(1800)
    }

    await run(`taskManager.tasks = [{ id: 't', content: 'x', tags: '',
        startDateTime: '2026-08-20 09:00', targetDateTime: '2026-08-20 18:00' }];
        taskManager.renderTasks(); 'ok'`)

    console.log('\n창 동작을 실제 창에서 확인 중...\n')

    // --- 접으면 스트립 폭이 된다 ------------------------------------------
    const before = win.getBounds()
    await collapse()
    const collapsed = win.getBounds()
    check('접으면 150px 스트립이 된다', collapsed.width === 150,
        collapsed.width + 'x' + collapsed.height)

    await collapse()
    check('펴면 접기 전 크기로 돌아온다',
        win.getBounds().width === before.width && win.getBounds().height === before.height,
        win.getBounds().width + 'x' + win.getBounds().height
        + ' vs ' + before.width + 'x' + before.height)

    // --- 사용자가 키워 둔 크기를 잃지 않는다 ------------------------------
    win.setBounds({ x: 60, y: 60, width: 1200, height: 800 })
    await wait(600)
    await collapse()
    await collapse()
    const kept = win.getBounds()
    check('키워 둔 크기가 접었다 펴도 남는다',
        kept.width === 1200 && kept.height === 800,
        kept.width + 'x' + kept.height)

    // --- 최대화 상태 -------------------------------------------------------
    win.maximize()
    await wait(900)
    const maximized = win.getBounds()
    await collapse()
    check('최대화에서도 접힌다', win.getBounds().width === 150,
        win.getBounds().width + 'x' + win.getBounds().height)

    await collapse()
    check('펴면 최대화로 돌아온다',
        win.isMaximized() && win.getBounds().width === maximized.width,
        (win.isMaximized() ? '최대화' : '보통') + ' '
        + win.getBounds().width + 'x' + win.getBounds().height)

    // --- 끌어 옮긴 스트립의 자리 -------------------------------------------
    // 여기서 진짜 마우스로 끌어야 하는 이유가 있다. setBounds 로 옮기고
    // win.emit('moved') 를 손으로 내면 이 확인은 통과하는데, 실제로는 통과하지
    // 않았다: .drag-bar 의 -webkit-app-region: drag 로 끌면 'move' 만 뜨고
    // 'moved' 는 끝내 오지 않기 때문이다. 이벤트를 흉내 낸 시험이 고장을 그대로
    // 가려 줬다. CDP 로 실제 드래그를 보내야 그 차이가 드러난다.
    win.unmaximize()
    win.setBounds({ x: 400, y: 200, width: 900, height: 900 })
    await wait(600)
    await collapse()
    const parked = win.getBounds()

    const bar = await run(`(() => {
        const el = document.querySelector('.drag-bar');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`)

    if (!bar) {
        check('드래그 바가 있다', false, '.drag-bar 를 찾지 못했다')
    } else {
        const debug = win.webContents.debugger
        if (!debug.isAttached()) debug.attach('1.3')
        const mouse = (type, x, y) => debug.sendCommand('Input.dispatchMouseEvent',
            { type, x, y, button: 'left', clickCount: 1 })

        await mouse('mousePressed', bar.x, bar.y)
        for (let step = 20; step <= 120; step += 20) {
            await mouse('mouseMoved', bar.x - step, bar.y + step)
            await wait(60)
        }
        await mouse('mouseReleased', bar.x - 120, bar.y + 120)
        await wait(1200)

        const dragged = win.getBounds()
        check('드래그 바로 스트립이 실제로 움직인다',
            dragged.x !== parked.x || dragged.y !== parked.y,
            parked.x + ',' + parked.y + ' → ' + dragged.x + ',' + dragged.y)

        await collapse()
        await collapse()
        const back = win.getBounds()
        check('끌어 둔 자리로 다시 접힌다',
            back.x === dragged.x && back.y === dragged.y,
            back.x + ',' + back.y)
    }

    console.log('\n' + (failures ? failures + '건 실패' : '전부 통과') + '\n')
    process.exit(failures ? 1 : 0)
}).catch((error) => {
    console.error(error)
    process.exit(1)
})
