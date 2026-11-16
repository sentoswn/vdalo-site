/* Джерела залучення кандидатів: ?ref= і UTM-мітки.
   • Джерело пам'ятаємо 30 днів (localStorage) — переходи між сторінками його не гублять.
   • Явна мітка (?ref=, utm_*, рекламний клік) завжди перезаписує збережене джерело.
     Перехід з іншого сайту / пошуку — лише якщо явної мітки ще немає. Прямий захід нічого не змінює.
   • Кожен браузер має випадковий анонімний ID — за ним рахуємо унікальних відвідувачів.
   • Один запис «візит» на сесію й джерело (база ще й сама відкидає повтори протягом 30 хв).
   Ключі джерел: ref:<код>, utm:<source>[/<campaign>], ads:google|facebook|tiktok, seo:<пошуковик>, site:<домен>, direct */
window.VdaloTrack = window.VdaloTrack || (function(){
  var TTL = 30 * 864e5, KS = "vdalo_src2", KV = "vdalo_vid";
  function get(k){ try { return JSON.parse(localStorage.getItem(k) || "null"); } catch(e){ return null; } }
  function put(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  function clip(v, n){ return String(v == null ? "" : v).trim().slice(0, n || 100); }
  function low(v, n){ return clip(v, n).toLowerCase().replace(/\s+/g, "_"); }
  function uid(){
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch(e){}
    return "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
  }
  /* такий самий розбір ?ref=, як у формі заявки: код із кабінету або номер телефону */
  function refNorm(v){ v = clip(v, 40); return /^[a-z0-9]{4,12}$/i.test(v) && /[a-z]/i.test(v) ? v.toLowerCase() : v.replace(/\D/g, ""); }

  var q; try { q = new URLSearchParams(location.search); } catch(e){ q = {get: function(){ return null; }}; }
  var vid = get(KV); if (!vid || !vid.id) { vid = {id: uid(), t: Date.now()}; put(KV, vid); }

  var host = ""; try { host = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, "") : ""; } catch(e){}
  if (host && host === location.hostname.replace(/^www\./, "")) host = "";

  var utm = {};
  ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].forEach(function(k){ var v = q.get(k); if (v) utm[k.slice(4)] = clip(v, 100); });
  var ref = refNorm(q.get("ref") || "");
  if (!(ref.length >= 9 || /[a-z]/.test(ref))) ref = "";

  var now = null, strong = true;
  if (ref) now = {key: "ref:" + ref, ref: ref};
  else if (utm.source) now = {key: "utm:" + low(utm.source, 60) + (utm.campaign ? "/" + low(utm.campaign, 60) : "")};
  else if (q.get("gclid") || q.get("wbraid") || q.get("gbraid")) now = {key: "ads:google"};
  else if (q.get("fbclid")) now = {key: "ads:facebook"};
  else if (q.get("ttclid")) now = {key: "ads:tiktok"};
  else if (host) {
    strong = false;
    var se = host.match(/(^|\.)(google|bing|yahoo|duckduckgo|ecosia|yandex|ukr\.net|meta\.ua)\./);
    now = {key: se ? "seo:" + se[2] : "site:" + host.slice(0, 80)};
  }
  if (now) {
    now.utm = utm; now.ref = now.ref || ""; now.strong = strong; now.t = Date.now();
    now.landing = clip(location.pathname, 200); now.referrer = host;
  }

  var saved = get(KS);
  if (saved && !(Date.now() - saved.t < TTL)) saved = null;
  if (now && (strong || !saved || !saved.strong)) { saved = now; put(KS, saved); }
  var cur = saved || {key: "direct", utm: {}, ref: "", strong: false, t: Date.now()};

  /* Текст для заявки (Google-таблиця й Telegram) — у тому ж форматі, що й раніше */
  function label(){
    var p = [];
    if (cur.ref) p.push("рекомендація від " + cur.ref);
    ["source", "medium", "campaign", "content", "term"].forEach(function(k){ if (cur.utm && cur.utm[k]) p.push(k + "=" + cur.utm[k]); });
    if (/^ads:/.test(cur.key) && !p.length) p.push(cur.key === "ads:google" ? "google ads" : cur.key === "ads:facebook" ? "facebook/instagram" : "tiktok ads");
    if (!p.length && cur.referrer) p.push("перехід з " + cur.referrer);
    return p.join("; ");
  }

  /* Візит у статистику — раз на сесію для кожного джерела, без ботів */
  function isBot(){
    return navigator.webdriver || /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|telegrambot|whatsapp|viber/i.test(navigator.userAgent || "");
  }
  function logVisit(){
    if (isBot()) return;
    try { if (sessionStorage.getItem("vdalo_vlog") === cur.key) return; } catch(e){}
    if (!window.Vdalo || !Vdalo.cfg) return;
    function mark(v){ try { if (v) sessionStorage.setItem("vdalo_vlog", v); else sessionStorage.removeItem("vdalo_vlog"); } catch(e){} }
    mark(cur.key);
    Vdalo.cfg().then(function(c){
      if (!c || !c.supabaseUrl || !c.supabaseKey) return;
      return fetch(c.supabaseUrl + "/rest/v1/rpc/track_visit", {method: "POST", keepalive: true,
        headers: {"Content-Type": "application/json", apikey: c.supabaseKey},
        body: JSON.stringify({p_vid: vid.id, p_src: cur.key, p_utm: cur.utm || {}, p_landing: clip(location.pathname, 200),
          p_referrer: host || null, p_lang: clip(window.VDALO_LANG || document.documentElement.lang || "uk", 5)})})
        .then(function(r){ if (!r.ok) mark(""); });
    }).catch(function(){ mark(""); });
  }
  if (document.readyState === "complete") setTimeout(logVisit, 300);
  else addEventListener("load", function(){ setTimeout(logVisit, 300); });

  return {
    key: function(){ return cur.key; },
    vid: function(){ return vid.id; },
    label: label,
    /* поля для таблиці leads у Supabase */
    lead: function(){ return {src: cur.key, visitor_id: vid.id, utm: cur.utm && Object.keys(cur.utm).length ? cur.utm : null}; }
  };
})();
