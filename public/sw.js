// 11단계 설치형 웹앱 서비스 워커.
// 오프라인 안내 화면과 아이콘만 저장합니다. 메모·API 응답·로그인 정보·기기 증명값은 저장하지 않습니다.
const CACHE = 'vault-shell-v1';
const SHELL = ['/offline.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // 자료 요청은 항상 서버로, 저장하지 않음
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith(caches.match(request).then(hit => hit || fetch(request)));
  }
});
