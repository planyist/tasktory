// 시간대가 실제로 고정됐는지 확인한다. 여기서 바꾸지는 않는다.
//
// 예전에는 이 파일이 process.env.TZ 에 대입했는데, 그 시점은 Node 가 이미 시작한
// 뒤라 Linux 에서는 무시된다. Node 는 처음 시각을 다룰 때 시간대를 캐시하고
// Jest 는 시작 과정에서 이미 Date 를 쓰기 때문이다. 개발 PC 의 시스템 시간대가
// 마침 Asia/Seoul 이어서 아무도 눈치채지 못했고, UTC 로 도는 CI 에서 로컬 날짜를
// 검증하는 테스트 두 개가 깨지고 나서야 드러났다.
//
// 이제 설정은 scripts/test.js 가 Jest 를 띄우기 전에 넣는다. 이 파일은 그것이
// 실제로 통했는지만 본다 - 조용히 다른 시간대로 도는 것이 가장 나쁘다.
// 로컬 날짜와 UTC 날짜가 갈리는 자리를 지키는 테스트들이 UTC 에서는 아무것도
// 검증하지 못한 채 통과해 버리기 때문이다.
const EXPECTED_OFFSET = -540 // Asia/Seoul, 서머타임 없음

const actual = new Date().getTimezoneOffset()
if (actual !== EXPECTED_OFFSET) {
    throw new Error(
        `테스트는 Asia/Seoul(offset ${EXPECTED_OFFSET}) 에서 돌아야 하는데 ` +
        `${actual} 로 실행되고 있습니다.\n` +
        `'npx jest' 대신 'npm test' 로 실행하세요 - TZ 는 Node 가 시작하기 전에 ` +
        `정해져야 하고, scripts/test.js 가 그 일을 합니다.`
    )
}
