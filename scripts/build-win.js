// Windows 설치기를 만들어 dist/ 에 놓는다.
//
// electron-builder 를 dist 로 곧장 돌리면 dist/win-unpacked/resources/app.asar
// 를 지우지 못해 통째로 실패한다 - 보통은 설치된 앱이 떠 있어서지만, 프로세스가
// 하나도 안 보이는데 스캐너가 붙들고 있는 경우가 있다. 이 기기의 그 파일은
// 열흘째 잠겨 있고 폴더 이름조차 바꿀 수 없다.
//
// 핸들을 쫓는 대신 비켜 간다. 새 폴더에 만들고 설치기만 dist 로 올린 뒤 그
// 폴더를 지운다. 예전에는 dist-build2, dist-build3 … 처럼 번호를 올려 가며
// 남겨 두었는데, 21개가 쌓여 1.6GB 를 차지했고 어느 것이 최신인지도 알 수
// 없었다. 남는 것은 dist 안의 설치기 하나뿐이다.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')
const staging = path.join(dist, '.staging')

fs.rmSync(staging, { recursive: true, force: true })

execFileSync('npx', ['electron-builder', '--win', `-c.directories.output=${staging}`], {
    cwd: root,
    stdio: 'inherit',
    shell: true
})

fs.mkdirSync(dist, { recursive: true })
const built = fs.readdirSync(staging).filter((name) => name.startsWith('Tasktory Setup'))
for (const name of built) {
    fs.copyFileSync(path.join(staging, name), path.join(dist, name))
    console.log(`dist/${name}`)
}

// 지우지 못해도 빌드는 이미 끝났다. 다음 실행이 어차피 다시 비운다.
fs.rmSync(staging, { recursive: true, force: true })

if (built.length === 0) {
    console.error('설치기가 만들어지지 않았다')
    process.exit(1)
}
