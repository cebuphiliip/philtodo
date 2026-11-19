/* 필투두 서비스 워커 — 항상 최신 파일을 먼저 받고, 인터넷이 안 될 때만 저장해 둔 화면을 보여 준다.
   폴더 파일(/f/)·도우미(/api/)·동기화 주소는 저장하지 않는다. */
var CACHE = "philtodo-v1";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || /^\/(f|api)\//.test(u.pathname)) return;
  e.respondWith(
    fetch(e.request, { cache: "no-store" }).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () { return caches.match(e.request, { ignoreSearch: true }); })
  );
});
