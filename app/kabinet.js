(function(){
  var root = document.getElementById("cab"); if (!root) return;
  var E = Vdalo.esc, M = Vdalo.money;
  var LANG = window.VDALO_LANG || "uk", LP = LANG === "uk" ? "" : "/" + LANG;
  var ST = {
    "new": "Заявка отримана", "call": "Менеджер скоро зателефонує", "contacted": "На зв’язку з менеджером", "dialog": "На зв’язку з менеджером", "waiting": "Менеджер підбирає вакансію", "matched": "Підібрано вакансію",
    "departed": "У дорозі", "working": "Працює", "paid": "Бонус нараховано", "rejected": "Не поїхав"
  };
  var KIND = {"bonus": "Бонус", "payout": "Виплата", "adjust": "Коригування"};
  var LOC = {uk: "uk-UA", ru: "ru-RU", en: "en-GB", pl: "pl-PL"}[LANG] || "uk-UA";
  function date(d){ try { return new Date(d).toLocaleDateString(LOC, {day: "numeric", month: "short", year: "numeric"}); } catch(e){ return ""; } }

  /* ---------- дані: справжні або демо ---------- */
  function realApi(s){
    var uid = null;
    function ok(r){ if (r.error) throw r.error; return r.data; }
    return {
      session: function(){ return s.auth.getSession().then(function(r){ uid = r.data.session && r.data.session.user.id; return !!uid; }); },
      load: function(){
        return Promise.all([
          s.from("profiles").select("*").eq("id", uid).maybeSingle().then(ok),
          s.rpc("my_referrals").then(ok),
          s.from("ledger").select("created_at,kind,amount,note").eq("user_id", uid).order("created_at", {ascending: false}).then(ok),
          s.from("payout_requests").select("created_at,amount,contact,status").eq("user_id", uid).order("created_at", {ascending: false}).then(ok),
          s.rpc("my_balance").then(ok),
          s.from("settings").select("value").eq("key", "bonus_amount").maybeSingle().then(ok)
        ]).then(function(r){
          return {profile: r[0] || {}, refs: r[1] || [], ledger: r[2] || [], requests: r[3] || [], bal: (r[4] || [])[0] || {}, bonus: Number(r[5] && r[5].value) || 0};
        });
      },
      requestPayout: function(a, c){ return s.rpc("request_payout", {p_amount: a, p_contact: c}).then(ok); },
      savePhone: function(p){ return s.from("profiles").update({phone: p}).eq("id", uid).then(ok); },
      saveProfile: function(p){ return s.from("profiles").update(p).eq("id", uid).then(ok); },
      logout: function(){ return s.auth.signOut().then(function(){ location.reload(); }); }
    };
  }

  /* ---------- екрани ---------- */
  function notReady(){
    root.innerHTML = '<div class="card cab-box"><h2>Кабінет запрацює найближчим часом</h2>' +
      '<p>Поки що отримати посилання для друга можна за номером телефону — бонус ми все одно врахуємо.</p>' +
      '<div class="ph-cta"><a class="btn" href="' + LP + '/pryvedy-druha/">Отримати посилання</a></div></div>';
  }
  function login(){
    root.innerHTML = '<div class="card cab-box cab-login"><h2>Увійдіть через Telegram</h2>' +
      '<p>Без паролів і SMS: натисніть кнопку й підтвердіть вхід у Telegram. Ми бачимо лише ваше ім’я та нік — не телефон і не переписку.</p>' +
      '<div id="tg-btn" class="cab-tg"></div><p class="err" id="cab-err" role="alert"></p>' +
      '<ul class="cab-why"><li>Особисте посилання для друзів</li><li>Статуси всіх, кого ви запросили</li><li>Баланс бонусів і запит на виплату</li></ul></div>';
    Vdalo.tgLogin(document.getElementById("tg-btn"), start, function(m){ document.getElementById("cab-err").textContent = m; });
  }
  function stat(label, value, cls){ return '<div class="card cab-stat ' + (cls || "") + '"><span>' + E(label) + '</span><b>' + E(value) + '</b></div>'; }

  var HEARD = ["Від знайомих", "Telegram", "Viber", "Facebook / Instagram", "TikTok", "OLX", "Google", "Інше"];
  var SAFE = '<div class="cab-safe"><b><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>Ваші дані захищені</b><span>Їх бачать лише власники «Вдало». Дані передаються зашифровано й зберігаються в захищеній базі в ЄС. Ми не передаємо їх третім особам і не використовуємо для реклами. Видалити дані можна на запит менеджеру.</span></div>';
  function anketa(api, d, edit){
    var p = d.profile;
    var name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" ");
    root.innerHTML = '<div class="card cab-box cab-form"><h2>' + (edit ? "Мої дані" : "Ще один крок — розкажіть про себе") + '</h2>' +
      '<p>' + (edit ? "Перевірте й оновіть дані, якщо щось змінилося." : "Ці дані потрібні, щоб зарахувати вам бонуси за друзів і зв’язатися щодо виплат.") + '</p>' +
      '<form id="an" novalidate><div class="row2"><div><label class="lbl" for="an-name">Ім’я та прізвище</label><input id="an-name" autocomplete="name" value="' + E(name) + '" required></div>' +
      '<div><label class="lbl" for="an-phone">Телефон</label><input id="an-phone" type="tel" autocomplete="tel" placeholder="+380 …" value="' + E(p.phone || "") + '" required></div></div>' +
      '<div class="row2"><div><label class="lbl" for="an-city">Місто або село, область</label><input id="an-city" placeholder="Напр. Біла Церква, Київська" value="' + E(p.city || "") + '" required></div>' +
      '<div><label class="lbl" for="an-heard">Звідки дізналися про нас</label><select id="an-heard"><option value="">Оберіть…</option>' + HEARD.map(function(h){ return '<option' + (p.heard_from === h ? " selected" : "") + '>' + E(h) + '</option>'; }).join("") + '</select></div></div>' +
      '<label class="cab-check"><input type="checkbox" id="an-ok"' + (p.consent_at ? " checked" : "") + '> <span>Погоджуюся на обробку моїх персональних даних відповідно до <a href="#privacy">політики конфіденційності</a></span></label>' +
      SAFE + '<p class="err" id="an-err" role="alert"></p><div class="ph-cta"><button class="btn" type="submit">' + (edit ? "Зберегти" : "Продовжити") + '</button>' + (edit ? '<button class="btn ghost" type="button" id="an-back">Назад</button>' : "") + '</div></form></div>';
    if (edit) document.getElementById("an-back").onclick = function(){ dash(api, d); };
    document.getElementById("an").onsubmit = function(e){
      e.preventDefault();
      var v = function(id){ return document.getElementById(id).value.trim(); }, err = document.getElementById("an-err");
      if (!v("an-name") || v("an-phone").replace(/\D/g, "").length < 9 || !v("an-city")) { err.textContent = "Заповніть ім’я, телефон і місто."; return; }
      if (!document.getElementById("an-ok").checked) { err.textContent = "Потрібна згода на обробку даних."; return; }
      var now = new Date().toISOString();
      api.saveProfile({full_name: v("an-name"), phone: v("an-phone"), city: v("an-city"), heard_from: v("an-heard") || null, consent_at: p.consent_at || now, onboarded_at: p.onboarded_at || now})
        .then(function(){ refresh(api); }).catch(function(){ err.textContent = "Не вдалося зберегти. Спробуйте ще раз."; });
    };
  }

  function dash(api, d){
    var p = d.profile, b = d.bal, avail = (b.balance || 0) - (b.pending || 0);
    var link = location.origin + LP + "/?ref=" + encodeURIComponent(p.ref_code || "");
    var share = "Шукаєш роботу за кордоном? Ось вакансії з житлом і офіційним договором: " + link;
    var refs = d.refs.length ? '<div class="cab-table"><table><thead><tr><th>Друг</th><th>Дата</th><th>Статус</th><th>Бонус</th></tr></thead><tbody>' +
      d.refs.map(function(r){ return '<tr><td>' + E(r.name) + '</td><td>' + E(date(r.created_at)) + '</td><td><span class="cab-st st-' + E(r.status) + '">' + E(ST[r.status] || r.status) + '</span></td><td>' + (r.bonus ? E(M(r.bonus)) : "—") + '</td></tr>'; }).join("") +
      '</tbody></table></div>' : '<p class="cab-empty">Поки що нікого. Надішліть посилання другові — щойно він залишить заявку, ви побачите його тут.</p>';
    var hist = d.ledger.concat(d.requests.filter(function(x){ return x.status === "new"; }).map(function(x){ return {created_at: x.created_at, kind: "request", amount: -x.amount, note: "Запит на виплату — в обробці"}; }))
      .sort(function(a, c){ return new Date(c.created_at) - new Date(a.created_at); });
    var histHtml = hist.length ? '<ul class="cab-hist">' + hist.map(function(x){
      return '<li><span>' + E(x.kind === "request" ? "Запит на виплату" : (KIND[x.kind] || x.kind)) + '<small>' + E(date(x.created_at)) + (x.note ? " · " + E(x.note) : "") + '</small></span><b class="' + (x.amount >= 0 ? "pos" : "neg") + '">' + (x.amount >= 0 ? "+" : "−") + E(M(Math.abs(x.amount))) + '</b></li>'; }).join("") + '</ul>' : '<p class="cab-empty">Тут з’являться нарахування й виплати.</p>';
    var bonusTxt = "2 000 грн за першого друга, який відпрацює 2 тижні, далі на 200 грн більше за кожного наступного в місяці, до 4 000 грн за друга.";

    root.innerHTML =
      '<div class="cab-head">' + (p.photo_url ? '<img src="' + E(p.photo_url) + '" alt="" width="48" height="48">' : '<span class="cab-ava">' + E((p.first_name || "?").charAt(0)) + '</span>') +
        '<div><b>Вітаємо, ' + E(p.first_name || "друже") + '!</b><small>' + (p.tg_username ? "@" + E(p.tg_username) : "") + '</small></div>' +
        '<button class="btn ghost sm" type="button" id="cab-me">Мої дані</button><button class="btn ghost sm" type="button" id="cab-out">Вийти</button></div>' +
      '<div class="cab-stats">' + stat("Доступно до виплати", M(avail), "main") + stat("Зароблено всього", M(b.earned)) + stat("Виплачено", M(b.paid)) + '</div>' +
      (b.pending ? '<p class="cab-note">Запит на виплату ' + E(M(b.pending)) + ' в обробці — менеджер зв’яжеться з вами.</p>' : "") +
      '<div class="cab-grid">' +
        '<div class="card"><h3>Ваше посилання для друзів</h3><p class="hint">' + E(bonusTxt) + '</p>' +
          '<div class="ref-link"><input id="cab-link" readonly value="' + E(link) + '" aria-label="Ваше посилання"><button class="btn sm" type="button" id="cab-copy">Копіювати</button></div>' +
          '<div class="cab-share">' +
            '<a class="msgr" target="_blank" rel="noopener" href="https://t.me/share/url?url=' + encodeURIComponent(link) + '&text=' + encodeURIComponent("Шукаєш роботу за кордоном? Ось вакансії з житлом і офіційним договором") + '"><span class="dot tg"></span>Telegram</a>' +
            '<a class="msgr" href="viber://forward?text=' + encodeURIComponent(share) + '"><span class="dot vb"></span>Viber</a>' +
            '<a class="msgr" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(share) + '"><span class="dot wa"></span>WhatsApp</a></div>' +
          '<p class="hint">Друг переходить за посиланням і залишає заявку на сайті — ми автоматично запишемо, що він від вас.</p></div>' +
        '<div class="card"><h3>Отримати виплату</h3>' +
          (avail > 0 ? '<form id="cab-pay" class="cab-pay"><div class="row2"><div><label class="lbl" for="cab-am">Сума, грн</label><input id="cab-am" type="number" min="1" max="' + avail + '" value="' + avail + '" inputmode="numeric"></div>' +
            '<div><label class="lbl" for="cab-ct">Як з вами зв’язатися</label><input id="cab-ct" value="' + E(p.tg_username ? "Telegram @" + p.tg_username : (p.phone || "")) + '"></div></div>' +
            '<button class="btn wide" type="submit">Запросити виплату</button><p class="err" id="cab-pay-err" role="alert"></p></form>'
            : '<p class="cab-empty">Коли на балансі з’являться гроші, тут можна буде запросити виплату. Менеджер зв’яжеться з вами й домовиться про спосіб.</p>') +
          '<form id="cab-ph" class="cab-ph"><label class="lbl" for="cab-phone">Ваш телефон</label><div class="ref-link"><input id="cab-phone" type="tel" placeholder="+380 …" value="' + E(p.phone || "") + '"><button class="btn ghost sm" type="submit">Зберегти</button></div>' +
          '<p class="hint" id="cab-ph-hint">Потрібен для виплат. Якщо друг назве менеджеру ваш номер, ми теж зарахуємо його вам.</p></form></div>' +
      '</div>' +
      '<div class="card cab-wide"><h3>Кого ви запросили</h3>' + refs + '</div>' +
      '<div class="card cab-wide"><h3>Історія балансу</h3>' + histHtml + '</div>' +
      '<p class="hint cab-foot">Бонус нараховується, коли друг відпрацює 2 тижні й ми отримаємо оплату від роботодавця. Питання — пишіть менеджеру: <a href="https://t.me/+380660050060">Telegram</a>, <a href="tel:+380660050060">+380 66 005 00 60</a>.</p>';

    document.getElementById("cab-out").onclick = function(){ api.logout(); };
    document.getElementById("cab-me").onclick = function(){ anketa(api, d, true); };
    document.getElementById("cab-copy").onclick = function(){
      var i = document.getElementById("cab-link"); i.select();
      try { navigator.clipboard.writeText(i.value); } catch(e){ document.execCommand("copy"); }
      this.textContent = "Скопійовано"; var b = this; setTimeout(function(){ b.textContent = "Копіювати"; }, 1800);
    };
    var pay = document.getElementById("cab-pay");
    if (pay) pay.onsubmit = function(e){
      e.preventDefault();
      var a = parseInt(document.getElementById("cab-am").value, 10), c = document.getElementById("cab-ct").value.trim(), err = document.getElementById("cab-pay-err");
      if (!(a > 0) || a > avail) { err.textContent = "Сума має бути від 1 до " + avail + " грн."; return; }
      if (!c) { err.textContent = "Вкажіть, як з вами зв’язатися."; return; }
      api.requestPayout(a, c).then(function(){ refresh(api); }).catch(function(){ err.textContent = "Не вдалося надіслати запит. Спробуйте ще раз."; });
    };
    document.getElementById("cab-ph").onsubmit = function(e){
      e.preventDefault();
      var v = document.getElementById("cab-phone").value.trim(), h = document.getElementById("cab-ph-hint");
      api.savePhone(v).then(function(){ h.textContent = "Збережено."; }).catch(function(){ h.textContent = "Не вдалося зберегти."; });
    };
  }

  function refresh(api){
    return api.load().then(function(d){
      // менеджери й адміни одразу потрапляють у CRM
      if (d.profile && (d.profile.role === "manager" || d.profile.role === "admin")) { location.replace("/crm/"); return; }
      if (!d.profile.onboarded_at) { anketa(api, d); return; }
      dash(api, d);
    }).catch(function(e){
      console.warn(e); root.innerHTML = '<div class="card cab-box"><h2>Не вдалося завантажити кабінет</h2><p>Оновіть сторінку або напишіть менеджеру.</p></div>';
    });
  }
  function start(){
    Vdalo.sb().then(function(s){
      if (!s) return notReady();
      var api = realApi(s);
      api.session().then(function(ok){ ok ? refresh(api) : login(); });
    });
  }
  start();
})();
