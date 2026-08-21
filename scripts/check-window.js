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

    console.log('\n' + (failures ? failures + '건 실패' : '전부 통과') + '\n')
    process.exit(failures ? 1 : 0)
}).catch((error) => {
    console.error(error)
    process.exit(1)
})
