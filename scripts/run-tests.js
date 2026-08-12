// `npm test` 의 실체. Jest 를 자식 프로세스로 띄우되 TZ 를 미리 넣어준다.
//
// 왜 이렇게까지 하는가: 시간대를 tests/setup-timezone.js 안에서
// process.env.TZ = ... 로 바꾸고 있었는데, 그건 Node 가 이미 시작한 뒤다.
// Node 는 처음 시각을 다룰 때 시간대를 캐시하고, Jest 는 시작 과정에서 이미
// Date 를 쓴다. 그래서 Linux 에서는 대입이 무시된다.
//
// 이 함정이 오래 안 보였던 이유는 개발 PC 의 시스템 시간대가 마침 Asia/Seoul
// 이라, 설정이 먹든 안 먹든 결과가 같았기 때문이다. UTC 로 도는 CI 에 올리고
// 나서야 드러났다 - 로그 파일 이름이 로컬 날짜라는 것을 지키는 테스트 두 개가
// 거기서만 깨졌다.
//
// 환경변수는 프로세스가 뜰 때 한 번 읽힌다. 그러니 우리가 띄우는 쪽에서 넣는다.
const { spawnSync } = require('child_process')

const TIMEZONE = 'Asia/Seoul'

const jest = require.resolve('jest/bin/jest')
const result = spawnSync(process.execPath, [jest, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TZ: TIMEZONE }
})

process.exit(result.status === null ? 1 : result.status)
