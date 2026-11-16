/* Спільне для кабінету, форми роботодавців і CRM: налаштування, Supabase, вхід через Telegram */
window.Vdalo = window.Vdalo || (function(){
  var cfgP = null, sbP = null;
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
  return {cfg: cfg, sb: sb, tgLogin: tgLogin, esc: esc, money: money};
})();
