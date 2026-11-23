/* Спільне для кабінету, форми роботодавців і CRM: налаштування, Supabase, вхід через Telegram */
window.Vdalo = window.Vdalo || (function(){
  var cfgP = null, sbP = null, TG_BOT_ID = "9297378003"; // id бота @vdalo_robota_bot
  function isApp(){ try { return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true; } catch (e) { return false; } }
  var CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
  function cfg(){
    return cfgP || (cfgP = fetch("/config.json", {cache: "no-store"}).then(function(r){ return r.ok ? r.json() : {}; }).catch(function(){ return {}; }));
  }
  function load(src){
    return new Promise(function(ok, fail){ var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  }
  function sb(){
    return sbP || (sbP = cfg().then(function(c){
      if (!c.supabaseUrl || !c.supabaseKey) return null;
      return (window.supabase ? Promise.resolve() : load(CDN)).then(function(){
        return window.supabase.createClient(c.supabaseUrl, c.supabaseKey, {auth: {persistSession: true, storageKey: "vdalo-auth"}});
      });
    }).catch(function(){ return null; }));
  }
  /* Кнопка «Увійти через Telegram» у контейнері box; після входу викликає done() */
  function tgRedirect(){ return "https://oauth.telegram.org/auth?bot_id=" + TG_BOT_ID + "&origin=" + encodeURIComponent(location.origin) +
    "&request_access=write&return_to=" + encodeURIComponent(location.origin + location.pathname + location.search); }
  function tgLogin(box, done, onErr){
    cfg().then(function(c){
      if (!c.tgBot) { onErr && onErr("Вхід через Telegram ще не налаштовано."); return; }
      window.VdaloTgAuth = function(user){
        box.setAttribute("aria-busy", "true");
        fetch(c.supabaseUrl + "/functions/v1/tg-auth", {method: "POST",
          headers: {"Content-Type": "application/json", apikey: c.supabaseKey, Authorization: "Bearer " + c.supabaseKey},
          body: JSON.stringify(user)})
          .then(function(r){ return r.json(); })
          .then(function(j){
            if (!j.token_hash) throw new Error(j.error || "auth");
            return sb().then(function(s){ return s.auth.verifyOtp({token_hash: j.token_hash, type: "magiclink"}); });
          })
          .then(function(res){ if (res.error) throw res.error; box.removeAttribute("aria-busy"); done && done(); })
          .catch(function(e){ box.removeAttribute("aria-busy"); onErr && onErr("Не вдалося увійти. Спробуйте ще раз."); console.warn(e); });
      };
      // Вхід, що повернувся з oauth.telegram.org (режим застосунку): #tgAuthResult=<base64 JSON>
      var m = location.hash.match(/tgAuthResult=([^&]+)/);
      if (m) {
        history.replaceState(null, "", location.pathname + location.search);
        try { var b = m[1].replace(/-/g, "+").replace(/_/g, "/"); while (b.length % 4) b += "=";
          var u = JSON.parse(decodeURIComponent(escape(atob(b)))); if (u && u.id && u.hash) { box.innerHTML = '<p style="margin:8px 0">Входимо…</p>'; window.VdaloTgAuth(u); return; } } catch (e) { console.warn(e); }
      }
      // У встановленому застосунку спливаюче вікно Telegram не працює — входимо через перехід на сторінку Telegram і назад.
      if (isApp()) {
        var lang = (window.VDALO_LANG || "uk");
        box.innerHTML = '<button type="button" class="tg-app-login" style="display:inline-flex;align-items:center;gap:10px;border:0;border-radius:14px;padding:12px 20px;background:#54a9eb;color:#fff;font:600 16px/1.2 inherit;cursor:pointer">' +
          '<svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5L20.6 2.9c.9-.3 1.6.2 1.3 1.4z"/></svg>' +
          ({uk: "Увійти через Telegram", ru: "Войти через Telegram", en: "Log in with Telegram", pl: "Zaloguj przez Telegram"}[lang] || "Увійти через Telegram") + '</button>';
        box.querySelector("button").onclick = function(){
          location.href = tgRedirect();
        };
        return;
      }
      var s = document.createElement("script");
      s.async = true; s.src = "https://telegram.org/js/telegram-widget.js?22";
      s.setAttribute("data-telegram-login", c.tgBot.replace(/^@/, ""));
      s.setAttribute("data-size", "large"); s.setAttribute("data-radius", "14");
      s.setAttribute("data-onauth", "VdaloTgAuth(user)"); s.setAttribute("data-request-access", "write");
      s.setAttribute("data-lang", (window.VDALO_LANG || "uk") === "uk" ? "uk" : window.VDALO_LANG);
      box.innerHTML = ""; box.appendChild(s);
      var alt = document.createElement("a"); alt.href = "#"; alt.style.cssText = "display:block;margin-top:10px;font-size:13px;opacity:.75;text-decoration:underline";
      alt.textContent = {uk: "Не відкривається вікно Telegram? Увійти інакше", ru: "Не открывается окно Telegram? Войти иначе", en: "Telegram window won’t open? Log in another way", pl: "Okno Telegram się nie otwiera? Zaloguj inaczej"}[window.VDALO_LANG || "uk"] || "Увійти інакше";
      alt.onclick = function(e){ e.preventDefault(); location.href = tgRedirect(); };
      box.appendChild(alt);
    });
  }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function money(n){ return (Number(n) || 0).toLocaleString("uk-UA").replace(/ /g, " ") + " грн"; }
  return {cfg: cfg, sb: sb, tgLogin: tgLogin, esc: esc, money: money, isApp: isApp};
})();

/* ===== Застосунок «Вдало» (PWA): встановлення на телефон, офлайн, вхід команди одразу в CRM ===== */
(function(){
  if (window.__vdaloPwa) return; window.__vdaloPwa = 1;
  var app = window.Vdalo && Vdalo.isApp && Vdalo.isApp();
  // Менеджер або власник, що відкрив застосунок з іконки, потрапляє одразу в CRM
  try { if (app && location.pathname === "/" && /source=app/.test(location.search) && localStorage.getItem("vdalo-staff") === "1") { location.replace("/crm/"); return; } } catch (e) {}
  if ("serviceWorker" in navigator) addEventListener("load", function(){ navigator.serviceWorker.register("/sw.js").catch(function(){}); });
  function head(tag, attrs){ if (document.querySelector(tag + '[rel="' + attrs.rel + '"]' + (attrs.sizes ? '[sizes="' + attrs.sizes + '"]' : ""))) return; var e = document.createElement(tag); for (var k in attrs) e.setAttribute(k, attrs[k]); document.head.appendChild(e); }
  function meta(n, c){ if (document.querySelector('meta[name="' + n + '"]')) return; var e = document.createElement("meta"); e.name = n; e.content = c; document.head.appendChild(e); }
  head("link", {rel: "manifest", href: "/manifest.webmanifest"});
  head("link", {rel: "apple-touch-icon", href: "/img/app/apple-touch-icon.png"});
  meta("apple-mobile-web-app-capable", "yes"); meta("mobile-web-app-capable", "yes");
  meta("apple-mobile-web-app-title", "Вдало"); meta("apple-mobile-web-app-status-bar-style", "default");
  if (app) return;
  var T = {uk: ["Встановіть застосунок «Вдало»", "Вакансії й кабінет — в один дотик з екрана телефону", "Встановити", "Натисніть «Поділитися» ⬆️ внизу екрана, потім «На екран Додому» ➕"],
           ru: ["Установите приложение «Вдало»", "Вакансии и кабинет — в одно касание с экрана телефона", "Установить", "Нажмите «Поделиться» ⬆️ внизу экрана, затем «На экран Домой» ➕"],
           en: ["Install the Vdalo app", "Jobs and your account — one tap from your home screen", "Install", "Tap Share ⬆️ at the bottom, then “Add to Home Screen” ➕"],
           pl: ["Zainstaluj aplikację Vdalo", "Oferty i konto — jednym dotknięciem z ekranu telefonu", "Zainstaluj", "Stuknij „Udostępnij” ⬆️ na dole, potem „Do ekranu początkowego” ➕"]};
  var L = T[(window.VDALO_LANG || document.documentElement.lang || "uk").slice(0, 2)] || T.uk;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  var mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  var evt = null;
  function hidden(){ try { return +localStorage.getItem("vdalo-app-hide") > Date.now(); } catch (e) { return false; } }
  function hide(days){ try { localStorage.setItem("vdalo-app-hide", Date.now() + days * 864e5); } catch (e) {} var b = document.getElementById("vd-app"); if (b) b.remove(); }
  function show(){
    if (document.getElementById("vd-app") || hidden() || !mobile || location.pathname.indexOf("/crm") === 0) return;
    // не заважаємо новим відвідувачам: у браузері Facebook/Instagram встановити застосунок неможливо, а з реклами людина прийшла по вакансію
    if (/FBAN|FBAV|FB_IAB|Instagram|Messenger/i.test(navigator.userAgent) || /[?&](fbclid|utm_medium=paid)/.test(location.search)) return;
    try { if (!sessionStorage.getItem("vdalo-sess")) { sessionStorage.setItem("vdalo-sess", "1"); localStorage.setItem("vdalo-visits", (+localStorage.getItem("vdalo-visits") || 0) + 1); }
          if ((+localStorage.getItem("vdalo-visits") || 0) < 2) return; } catch (e) {}
    var b = document.createElement("div"); b.id = "vd-app";
    b.setAttribute("style", "position:fixed;left:12px;right:12px;bottom:calc(88px + env(safe-area-inset-bottom));z-index:9999;display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border-radius:18px;background:#0b0c0e;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:inherit;max-width:520px;margin:0 auto");
    b.innerHTML = '<img src="/img/app/icon-192.png" alt="" width="40" height="40" style="border-radius:10px;flex:none">' +
      '<div style="flex:1;min-width:0;line-height:1.25"><b style="display:block;font-size:15px">' + L[0] + '</b><small id="vd-app-sub" style="opacity:.75;font-size:12.5px">' + L[1] + '</small></div>' +
      '<button type="button" id="vd-app-go" style="border:0;border-radius:12px;padding:10px 14px;background:#fff;color:#0b0c0e;font:700 14px/1 inherit;cursor:pointer;flex:none">' + L[2] + '</button>' +
      '<button type="button" id="vd-app-x" aria-label="×" style="border:0;background:none;color:#fff;opacity:.6;font-size:22px;line-height:1;padding:4px;cursor:pointer;flex:none">×</button>';
    document.body.appendChild(b);
    document.getElementById("vd-app-x").onclick = function(){ hide(14); };
    document.getElementById("vd-app-go").onclick = function(){
      if (evt) { evt.prompt(); evt.userChoice.then(function(c){ if (c.outcome === "accepted") hide(3650); }); evt = null; }
      else { document.getElementById("vd-app-sub").textContent = L[3]; document.getElementById("vd-app-sub").style.opacity = "1"; }
    };
  }
  addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); evt = e; });  // банер сам не показуємо — лише за кнопкою «Встановити застосунок» (VdaloInstall)
  addEventListener("appinstalled", function(){ hide(3650); });
  
  window.VdaloInstall = function(){ if (evt) { evt.prompt(); evt = null; } else { try { localStorage.removeItem("vdalo-app-hide"); } catch (e) {} mobile = true; show(); var s = document.getElementById("vd-app-sub"); if (s && !evt) { s.textContent = ios ? L[3] : L[1]; } } };
})();

/* ===== Розумний пошук «Вдало»: однаково розуміє кирилицю (укр./рос.), польську й латиницю, різні написання міст ===== */
(function(){
  if (window.VdaloSearch) return;
  var SKC = {"а":"a","б":"b","в":"v","г":"g","ґ":"g","д":"d","е":"e","ё":"e","є":"e","ж":"zh","з":"z","и":"i","і":"i","ї":"i","й":"i","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"c","ч":"ch","ш":"sh","щ":"shch","ъ":"","ы":"i","ь":"","э":"e","ю":"iu","я":"ia","'":"","’":"","ʼ":"","`":""};
  function sk(s){
    s = (s || "").toLowerCase().replace(/szcz/g, "\u0001").replace(/sz/g, "\u0002").replace(/cz/g, "\u0003").replace(/rz/g, "\u0004").replace(/ż/g, "\u0004").replace(/ch/g, "h")
      .replace(/\u0001/g, "shch").replace(/\u0002/g, "sh").replace(/\u0003/g, "ch").replace(/\u0004/g, "zh").replace(/ł/g, "l").replace(/w/g, "v").replace(/y/g, "i").replace(/j/g, "i").replace(/x/g, "ks").replace(/q/g, "k");
    try { s = s.normalize("NFD").replace(/[̀-ͯ]/g, ""); } catch (e) {}
    var o = ""; for (var i = 0; i < s.length; i++) { var c = s[i]; o += (c in SKC) ? SKC[c] : c; }
    return " " + o.replace(/[^a-z0-9]+/g, " ").replace(/(ou|uv|iv|ov)(?=\s|$)/g, "ov").trim() + " ";
  }
  function stem(w){ return w.length <= 4 ? w : w.length <= 6 ? w.slice(0, -1) : w.slice(0, -2); }
  // Як люди пишуть міста (укр., рос., з помилками) → як місто записане у вакансіях
  var CITIES = {
    "Łódź": "лодзь лодз лодж лодзі лодзи лодзе лодзя лодь лодзь лудзь lodz lodzh",
    "Bydgoszcz": "быдгощ быдгош быдгощь быдгоща бидгощ бидгош бидгощ бідгощ бидгоща быгдощ bydgoshch bidgoshch",
    "Warszawa": "варшава варшаві варшаве варшави warsaw varshava",
    "Wrocław": "вроцлав вроцлаве вроцлаві вроцлава вроцлов wroclaw",
    "Kraków": "краков кракові кракове кракова кракив краків krakow cracow",
    "Gdańsk": "гданьск гданськ гданск гданське гданьске гданська gdansk",
    "Gdynia": "гдыня гдиня гдині гдыне gdynia",
    "Poznań": "познань познані познани познаня poznan",
    "Szczecin": "щецин щецін щецине щеціні щецина szczecin",
    "Wałbrzych": "валбжих вальбжих валбжих вавбжих вальбжиху walbrzych",
    "Lublin": "люблин люблін люблине любліні lublin",
    "Katowice": "катовице катовіце катовицах катовіцах katowice",
    "Białystok": "белосток білосток бялысток бялисток bialystok",
    "Rzeszów": "жешув жешов ряшів ряшев rzeszow",
    "Toruń": "торунь торуні торуне torun",
    "Częstochowa": "ченстохова ченстохові ченстохове czestochowa",
    "Grudziądz": "грудзёндз грудзендз грудзьондз грудзьонз грудзиондз grudziadz",
    "Tczew": "тчев тчеві тчеве tczew",
    "Chojnice": "хойнице хойніце chojnice",
    "Leszno": "лешно leszno",
    "Kościerzyna": "косцежина костежина косцєжина koscierzyna",
    "Świebodzin": "свебодзин свебодзін щвебодзин швебодзин swiebodzin",
    "Swarzędz": "сважендз сваженц свaжендз swarzedz",
    "Sosnowiec": "сосновец сосновець сосновце sosnowiec",
    "Suwałki": "сувалки сувалкі suwalki",
    "Stryków": "стрыкув стрикув стриків стрыков стриков strykow",
    "Tomaszów": "томашув томашов томашів tomaszow",
    "Chrzanów": "хшанув хжанув хшанов chrzanow",
    "Jędrzejów": "енджеюв енджеев jedrzejow",
    "Grójec": "груец груєць груець grojec",
    "Sokołów": "соколув соколов соколів sokolow",
    "Bielany": "беляны біляни беляни bielany",
    "Stare Babice": "старе бабице бабице babice",
    "Starachowice": "стараховице стараховіце starachowice",
    "Siemianowice": "семяновице сємяновіце siemianowice",
    "Białogard": "белогард білогард бялогард bialogard",
    "Opole": "ополе ополі opole",
    "Legnica": "легница легніца legnica",
    "Olsztyn": "ольштын ольштин olsztyn",
    "Kielce": "кельце кєльце kielce",
    "Gliwice": "гливице глівіце gliwice",
    "Zielona Góra": "зелена гура зелёна гура зелена гора zielona gora",
    "Vilnius": "вильнюс вільнюс вильно vilnius",
    "Kaunas": "каунас kaunas",
    "Panevėžys": "паневежис паневежіс panevezys",
    "Klaipėda": "клайпеда klaipeda",
    "Tauragė": "таураге таурагє taurage",
    "Praha": "прага праге празі praha prague",
    "Brno": "брно brno", "Ostrava": "острава ostrava", "Plzeň": "пльзень пльзень plzen pilsen",
    "Žilina": "жилина жиліна zilina", "Trenčín": "тренчин тренчін trencin", "Bratislava": "братислава bratislava",
    "Nové Mesto nad Váhom": "нове место нове мєсто nove mesto"
  };
  var AL = {};
  for (var c in CITIES) { var canon = sk(c).trim().split(" ")[0]; CITIES[c].split(" ").forEach(function(v){ var k = sk(v).trim(); if (k) AL[k] = canon; }); }
  function words(q){
    return sk(q).trim().split(" ").filter(Boolean).map(function(w){
      if (AL[w]) return AL[w];
      // лише явний початок назви міста (≥5 літер: «быдго») або відмінок («лодзі», «быдгоще») — щоб «жильё» не ставало «Žilina»
      for (var k in AL) if (k.length >= 4 && ((w.length >= 5 && k.indexOf(w) === 0) || (k.length >= 5 && w.indexOf(k.slice(0, -1)) === 0 && w.length - k.length <= 2) || (k.length === 4 && w.indexOf(k) === 0 && w.length - k.length <= 2))) return AL[k];
      return w;
    });
  }
  function match(hay, ws){ hay = hay.charAt(0) === " " ? hay : sk(hay); return ws.every(function(w){ return hay.indexOf(" " + stem(w)) >= 0; }); }
  // Вік кандидата в рядку пошуку: «45», «45 років», «45 лет», «вік 45», «age 45», «45 lat» → {age: 45, rest: решта запиту без віку}
  var AGE_RX = /(^|[\s,;])(?:(?:вік|возраст|age|wiek)\s*:?\s*)?(1[4-9]|[2-7]\d)(?:\s*(?:р\.?|рік|роки|років|рок|г\.?|год|года|лет|л\.?|years?|yo|lat|lata|r\.?))?(?=$|[\s,;.!?])/i;
  function age(q){ var m = (q || "").match(AGE_RX); if (!m) return null;
    return {age: +m[2], rest: ((q || "").slice(0, m.index) + m[1] + (q || "").slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim()}; }
  // Віковий діапазон вакансії з поля «Для кого» («Жінки, 18–45 р.», «Чоловіки, до 50 р.»); якщо обмежень не вказано — від 18 років
  function ageRange(v){ var w = (v && v.who) || "", m = w.match(/(\d{2})\s*[–-]\s*(\d{2})/); if (m) return [+m[1], +m[2]];
    m = w.match(/до\s*(\d{2})/); if (m) return [18, +m[1]]; m = w.match(/(?:від|з)\s*(\d{2})/); if (m) return [+m[1], 99]; return [18, 99]; }
  function ageOk(v, a){ var r = ageRange(v); return a >= r[0] && a <= r[1]; }
  window.VdaloSearch = {sk: sk, stem: stem, words: words, match: match, cities: CITIES, age: age, ageRange: ageRange, ageOk: ageOk};
})();
