// 앱 셸 캐시. 브라우저/모바일(PWA)에서만 등록된다 - Electron은 file:// 로
// 로드되므로 서비스 워커를 쓸 수 없고, 쓸 이유도 없다(이미 로컬 파일이다).
//
// 데이터는 캐시하지 않는다. 작업과 규칙은 localStorage에 있고, 여기서는
// 화면을 띄우는 데 필요한 파일만 다룬다.

// 캐시 이름은 SHELL 목록이 바뀔 때마다 올린다. 그대로 두면 예전 캐시가 살아남아
// 새 파일(i18n.js)만 빠진 화면이 뜬다.
const CACHE = 'tasktory-shell-v3';

const SHELL = [
    './',
    './index.html',
    './styles.css',
    './register-sw.js',
    './i18n.js',
    './recurrence.js',
    './renderer.js',
    './manifest.json',
    './assets/icon-192.png',
    './assets/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    // 예전 버전 캐시를 지운다. 남겨두면 파일이 섞여 오래된 화면이 뜬다.
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names.filter(name => name !== CACHE).map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // 네트워크를 먼저 시도하고 성공하면 캐시를 갱신한다. 실패하면 캐시로
    // 되돌아간다. 캐시 우선으로 하면 배포해도 예전 파일이 계속 나온다.
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() => caches.match(event.request).then(hit => hit || caches.match('./index.html')))
    );
});
