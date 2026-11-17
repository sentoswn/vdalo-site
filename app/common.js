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
          location.href = "https://oauth.telegram.org/auth?bot_id=" + TG_BOT_ID + "&origin=" + encodeURIComponent(location.origin) +
            "&request_access=write&return_to=" + encodeURIComponent(location.origin + location.pathname + location.search);
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
    var b = document.createElement("div"); b.id = "vd-app";
    b.setAttribute("style", "position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));z-index:9999;display:flex;align-items:center;gap:12px;padding:12px 12px 12px 14px;border-radius:18px;background:#0b0c0e;color:#fff;box-shadow:0 10px 30px rgba(0,0,0,.25);font-family:inherit;max-width:520px;margin:0 auto");
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
  addEventListener("beforeinstallprompt", function(e){ e.preventDefault(); evt = e; setTimeout(show, 4000); });
  addEventListener("appinstalled", function(){ hide(3650); });
  if (ios) setTimeout(show, 6000);
  window.VdaloInstall = function(){ if (evt) { evt.prompt(); evt = null; } else { try { localStorage.removeItem("vdalo-app-hide"); } catch (e) {} mobile = true; show(); var s = document.getElementById("vd-app-sub"); if (s && !evt) { s.textContent = ios ? L[3] : L[1]; } } };
})();
