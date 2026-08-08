// 서비스 워커 등록. 브라우저/모바일에서만 의미가 있다.
// Electron은 file:// 로 로드되어 서비스 워커를 지원하지 않고, 이미 로컬
// 파일이라 캐시할 이유도 없다. 조건을 걸지 않으면 콘솔에 오류만 남는다.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('service-worker.js').catch(error => {
            console.warn('Service worker registration failed:', error);
        });
    });
}
