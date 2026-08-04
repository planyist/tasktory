// Pin a non-UTC timezone so tests that depend on the difference between local
// dates and UTC dates behave the same on every machine and in CI.
process.env.TZ = 'Asia/Seoul'
