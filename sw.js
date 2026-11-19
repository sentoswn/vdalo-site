/* Service worker застосунку «Вдало»: сторінки — спершу з мережі (завжди свіжі вакансії),
   без інтернету — остання збережена копія. Запити до бази (Supabase), Telegram і API не кешуються. */
const V = "vdalo-v4";
const CORE = ["/", "/kabinet/", "/crm/", "/manifest.webmanifest", "/img/app/icon-192.png", "/img/app/icon-512.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(CORE)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== "GET" || u.origin !== location.origin) return;
  const isPage = r.mode === "navigate" || (r.headers.get("accept") || "").includes("text/html");
  const isData = /\.json$/.test(u.pathname);
  if (isPage || isData) {
    e.respondWith(fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(V).then((x) => x.put(r, c)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then((m) => m || caches.match(u.pathname.startsWith("/crm") ? "/crm/" : "/"))));
    return;
  }
  if (/\.(png|svg|jpg|jpeg|webp|ico|js|css|woff2?)$/.test(u.pathname)) {
    e.respondWith(caches.match(r).then((m) => {
      const net = fetch(r).then((res) => { if (res.ok) { const c = res.clone(); caches.open(V).then((x) => x.put(r, c)); } return res; }).catch(() => m);
      return m || net;
    }));
  }
});
