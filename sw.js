/* 필투두 서비스 워커 — 항상 최신 파일을 먼저 받고, 연결이 안 될 때만 저장해 둔 화면을 보여 준다.
   폴더 파일(/f/)·도우미(/api/)·동기화 주소는 저장하지 않는다.
   2026-11-21 고침(원장 261121-51): 파일 주소 끝의 ?v=번호 마다 따로 쌓여, PC 도우미가 꺼졌을 때 '가장 오래된'
   style.css·app.js 를 꺼내 새 화면에 옛 모양·옛 기능이 섞였다(찾기 칸 흰 글자·찾기 안 됨). 이제 파일마다
   ?v= 를 떼고 '가장 최근 것 하나'만 보관하고, 옛 보관함(v1)은 지운다. */
var CACHE = "philtodo-v2";
function keyOf(u) { return u.origin + u.pathname; }
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || /^\/(f|api)\//.test(u.pathname)) return;
  var key = keyOf(u);
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(key, copy); }); }
      return res;
    }).catch(function () {
      return caches.open(CACHE).then(function (c) { return c.match(key); }).then(function (hit) {
        return hit || caches.match(e.request, { ignoreSearch: true });
      });
    })
  );
});
