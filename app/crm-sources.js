/* CRM → «Джерела»: відвідувачі, заявки й конверсія по кожному джерелу (лише для власників).
   Дані: функції source_stats / source_daily і таблиця traffic_sources у Supabase. */
window.VdaloSources = function(app, h){
  var E = Vdalo.esc, SITE = "https://vdalo-robota.com.ua/";
  var st = window.VdaloSources.st || (window.VdaloSources.st = {per: 30, sort: "leads", dir: -1, q: ""});
  var toast = h.toast || function(m){ alert(m); }, fail = h.fail || function(e){ toast("Помилка: " + (e && e.message || e)); };
  var rows = [], daily = [], sb = null;

  var KNOWN = {"direct": "Прямі заходи (без мітки)", "unknown": "Без джерела (до запуску відстеження)", "manual": "Додано вручну в CRM",
    "ads:google": "Реклама Google", "ads:facebook": "Facebook / Instagram (клік з реклами чи поста)", "ads:tiktok": "Реклама TikTok"};
  function autoLabel(k){
    if (KNOWN[k]) return KNOWN[k];
    var m = k.match(/^(\w+):(.*)$/); if (!m) return k;
    if (m[1] === "seo") return "Пошук " + m[2].charAt(0).toUpperCase() + m[2].slice(1);
    if (m[1] === "site") return "Перехід із сайту " + m[2];
    if (m[1] === "ref") return "Посилання ?ref=" + m[2];
    if (m[1] === "utm") return m[2].replace("/", " · ");
    return k;
  }
  function title(r){ return r.name || r.tg_group || r.auto_name || autoLabel(r.src); }
  function pct(a, b){ return b ? (Math.round(a / b * 1000) / 10) + "%" : "—"; }
  function range(){
    var to = new Date(Date.now() + 864e5), from;
    if (st.per === "custom") {
      from = st.from ? new Date(st.from + "T00:00:00") : new Date(Date.now() - 30 * 864e5);
      to = st.to ? new Date(new Date(st.to + "T00:00:00").getTime() + 864e5) : to;
    } else if (st.per === "today" || st.per === "yest") {
      from = new Date(); from.setHours(0, 0, 0, 0); if (st.per === "yest") from.setDate(from.getDate() - 1);
      to = new Date(from.getTime()); to.setDate(to.getDate() + 1);
    } else if (st.per === "all") from = new Date("2020-01-01T00:00:00");
    else { from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - st.per + 1); }
    return [from.toISOString(), to.toISOString()];
  }
  function perLabel(){
    if (st.per === "all") return "увесь час"; if (st.per === "today") return "сьогодні"; if (st.per === "yest") return "вчора"; if (st.per !== "custom") return "останні " + st.per + " дн.";
    return (st.from || "…") + " — " + (st.to || "сьогодні");
  }
  /* латиниця для мітки: «Робота Польща» → robota_polshcha */
  function slug(s){
    var T = {"а":"a","б":"b","в":"v","г":"h","ґ":"g","д":"d","е":"e","є":"ie","ж":"zh","з":"z","и":"y","і":"i","ї":"i","й":"i","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"kh","ц":"ts","ч":"ch","ш":"sh","щ":"shch","ь":"","ю":"iu","я":"ia","ы":"y","э":"e","ё":"io","ъ":""};
    return String(s || "").toLowerCase().replace(/^@/, "").split("").map(function(c){ return T[c] !== undefined ? T[c] : c; }).join("")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
  }

  function load(){
    app.innerHTML = '<div class="empty">Завантаження…</div>';
    Vdalo.sb().then(function(s){
      sb = s; var r = range();
      return Promise.all([s.rpc("source_stats", {p_from: r[0], p_to: r[1]}), s.rpc("source_daily", {p_from: r[0], p_to: r[1]})]);
    }).then(function(res){
      if (res[0].error) throw res[0].error;
      rows = res[0].data || []; daily = (res[1] && res[1].data) || [];
      draw();
    }).catch(function(e){
      console.warn(e);
      app.innerHTML = '<div class="card pad"><h3>Статистика джерел ще не підключена</h3><p class="note">Потрібно оновити базу: Supabase → SQL Editor → вставте весь файл <code>supabase/schema.sql</code> → Run (або запустіть GitHub Actions → «Supabase», якщо задано SUPABASE_DB_URL).</p><p class="note">' + E(e && e.message || "") + '</p></div>';
    });
  }

  function draw(){
    var list = rows.filter(function(r){ if (!st.q) return true; var q = st.q.toLowerCase(); return (title(r) + " " + r.src + " " + (r.tg_group || "") + " " + (r.note || "")).toLowerCase().indexOf(q) >= 0; });
    var val = function(r){ return st.sort === "name" ? title(r).toLowerCase() : st.sort === "conversion" ? (r.conversion === null ? -1 : +r.conversion) : +r[st.sort] || 0; };
    list.sort(function(a, b){ var x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * st.dir; });
    var tv = rows.reduce(function(a, r){ return a + (+r.visitors || 0); }, 0), tl = rows.reduce(function(a, r){ return a + (+r.leads || 0); }, 0);
    var tlTracked = rows.filter(function(r){ return r.src !== "unknown" && r.src !== "manual"; }).reduce(function(a, r){ return a + (+r.leads || 0); }, 0);
    var th = rows.reduce(function(a, r){ return a + (+r.hired || 0); }, 0);
    var maxC = Math.max.apply(null, list.map(function(r){ return +r.conversion || 0; }).concat([1]));
    var per = [["today", "Сьогодні"], ["yest", "Вчора"], [7, "7 днів"], [30, "30 днів"], [90, "90 днів"], ["all", "Увесь час"], ["custom", "Свої дати"]];
    var col = function(k, t){ return '<th data-sort="' + k + '" style="cursor:pointer;white-space:nowrap">' + t + (st.sort === k ? (st.dir < 0 ? " ↓" : " ↑") : "") + '</th>'; };

    app.innerHTML =
      '<div class="bar">' + per.map(function(x){ return '<button class="chip" data-per="' + x[0] + '" aria-pressed="' + (String(st.per) === String(x[0])) + '">' + x[1] + '</button>'; }).join("") +
        (st.per === "custom" ? '<input type="date" id="s-from" value="' + E(st.from || "") + '" class="chip"> — <input type="date" id="s-to" value="' + E(st.to || "") + '" class="chip"><button class="btn sm" id="s-apply">Показати</button>' : "") +
        '<span style="flex:1"></span><button class="btn ghost sm" id="s-new">+ Посилання для Telegram-групи</button><button class="btn green sm" id="s-xls">Експорт в Excel</button></div>' +
      '<div class="stats">' +
        '<div class="card stat"><span>Унікальних відвідувачів</span><b>' + tv + '</b></div>' +
        '<div class="card stat"><span>Заявок</span><b>' + tl + '</b></div>' +
        '<div class="card stat hl"><span>Конверсія сайту</span><b>' + pct(tlTracked, tv) + '</b></div>' +
        '<div class="card stat"><span>Виїхали / працюють</span><b>' + th + '</b></div>' +
        '<div class="card stat"><span>Джерел</span><b>' + rows.filter(function(r){ return +r.visitors || +r.leads; }).length + '</b></div></div>' +
      '<div class="card pad"><div class="bar" style="margin-bottom:10px"><h3 style="margin:0">Джерела · ' + E(perLabel()) + '</h3><span style="flex:1"></span><input type="search" id="s-q" placeholder="Пошук джерела чи групи" value="' + E(st.q) + '" style="max-width:280px"></div>' +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' + col("name", "Джерело") + '<th>Telegram-група</th>' + col("visitors", "Унік. відвідувачі") + col("sessions", "Візити") + col("leads", "Заявки") + col("hired", "Виїхали / працюють") + col("conversion", "Конверсія") + '<th></th></tr></thead><tbody>' +
      (list.length ? list.map(function(r){
        var c = r.conversion === null ? null : +r.conversion;
        return '<tr class="row" data-k="' + E(r.src) + '"><td><b>' + E(title(r)) + '</b><small><code>' + E(r.src) + '</code>' + (r.note ? " · " + E(r.note) : "") + '</small></td>' +
          '<td>' + (r.tg_group ? E(r.tg_group) : '<span class="note">—</span>') + '</td>' +
          '<td>' + r.visitors + '</td><td>' + r.sessions + '</td><td><b>' + r.leads + '</b></td><td>' + r.hired + '</td>' +
          '<td style="min-width:130px">' + (c === null ? '<span class="note">—</span>' : '<b>' + c + '%</b><div class="bars"><div class="t" style="margin-top:4px"><i style="width:' + Math.min(100, c / maxC * 100) + '%"></i></div></div>') + '</td>' +
          '<td><button class="btn ghost sm" data-edit="' + E(r.src) + '">Назва</button></td></tr>';
      }).join("") : '<tr><td colspan="8" class="empty">За цей період даних ще немає. Статистика з’являється з моменту оновлення сайту.</td></tr>') +
      '</tbody></table></div>' +
      '<p class="note" style="margin-bottom:0">Конверсія = заявки ÷ унікальні відвідувачі джерела. Джерело зберігається 30 днів: людина прийшла з групи, а заявку залишила через тиждень — заявка все одно зарахується групі. Нова мітка (?ref= чи utm) замінює стару.</p></div>';

    app.querySelectorAll("[data-per]").forEach(function(b){ b.onclick = function(){ var p = b.getAttribute("data-per"); st.per = /^\d+$/.test(p) ? +p : p; if (p !== "custom") load(); else draw(); }; });
    var ap = document.getElementById("s-apply"); if (ap) ap.onclick = function(){ st.from = document.getElementById("s-from").value; st.to = document.getElementById("s-to").value; load(); };
    app.querySelectorAll("[data-sort]").forEach(function(t){ t.onclick = function(){ var k = t.getAttribute("data-sort"); if (st.sort === k) st.dir = -st.dir; else { st.sort = k; st.dir = k === "name" ? 1 : -1; } draw(); }; });
    var q = document.getElementById("s-q"); q.oninput = function(){ st.q = q.value; var pos = q.selectionStart; draw(); var n = document.getElementById("s-q"); n.focus(); n.setSelectionRange(pos, pos); };
    app.querySelectorAll("tr.row").forEach(function(tr){ tr.onclick = function(){ edit(tr.getAttribute("data-k")); }; });
    document.getElementById("s-new").onclick = newLink;
    document.getElementById("s-xls").onclick = exportXlsx;
  }

  function modal(html){
    var w = document.createElement("div");
    w.style.cssText = "position:fixed;inset:0;background:rgba(13,15,18,.45);z-index:40;display:grid;place-items:center;padding:16px";
    w.innerHTML = '<div class="card" style="width:min(560px,100%);padding:22px;display:grid;gap:12px;max-height:90vh;overflow:auto">' + html + '</div>';
    w.onclick = function(e){ if (e.target === w) w.remove(); };
    document.body.appendChild(w); return w;
  }
  function save(key, patch){
    return sb.from("traffic_sources").upsert(Object.assign({key: key}, patch), {onConflict: "key"}).then(function(r){ if (r.error) throw r.error; });
  }

  function edit(key){
    var r = rows.filter(function(x){ return x.src === key; })[0] || {src: key};
    var w = modal('<h3 style="margin:0">Назва джерела</h3><p class="note" style="margin:0">Ключ: <code>' + E(key) + '</code> · ' + E(autoLabel(key)) + '</p>' +
      '<div class="fld"><label>Назва (як показувати в статистиці)</label><input id="e-name" value="' + E(r.name || "") + '" placeholder="' + E(r.auto_name || autoLabel(key)) + '"></div>' +
      '<div class="fld"><label>Telegram-група</label><input id="e-tg" value="' + E(r.tg_group || "") + '" placeholder="Напр. «Робота в Польщі» або @praca_polsha"></div>' +
      '<div class="fld"><label>Нотатка</label><input id="e-note" value="' + E(r.note || "") + '" placeholder="Напр. пост від 12.11, закріп"></div>' +
      '<div style="display:flex;gap:8px"><button class="btn" id="e-save">Зберегти</button><button class="btn ghost" id="e-x">Скасувати</button></div>');
    w.querySelector("#e-x").onclick = function(){ w.remove(); };
    w.querySelector("#e-save").onclick = function(){
      var v = function(id){ return w.querySelector(id).value.trim() || null; };
      save(key, {name: v("#e-name"), tg_group: v("#e-tg"), note: v("#e-note")}).then(function(){ w.remove(); toast("Збережено"); load(); }).catch(fail);
    };
  }

  function newLink(){
    var w = modal('<h3 style="margin:0">Посилання для Telegram-групи</h3><p class="note" style="margin:0">Розмістіть це посилання в групі — усі, хто перейде, будуть зараховані їй (30 днів), а заявки покажуть, скільки кандидатів дала група.</p>' +
      '<div class="fld"><label>Назва групи *</label><input id="n-tg" placeholder="Напр. Робота в Польщі для українців"></div>' +
      '<div class="g2"><div class="fld"><label>Мітка (латиницею)</label><input id="n-slug" placeholder="robota_v_polshchi"></div>' +
      '<div class="fld"><label>Сторінка сайту</label><select id="n-page"><option value="">Головна</option><option value="robota-v-polshchi/">Робота в Польщі</option><option value="robota-v-lytvi/">Робота в Литві</option><option value="robota-v-chekhii/">Робота в Чехії</option><option value="robota-na-skladi/">Робота на складі</option><option value="robota-dlia-zhinok/">Для жінок</option><option value="robota-dlia-par/">Для пар</option></select></div></div>' +
      '<div class="fld"><label>Посилання</label><input id="n-url" readonly></div><p class="err" id="n-err"></p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="n-save">Зберегти й скопіювати</button><button class="btn ghost" id="n-x">Закрити</button></div>');
    var tg = w.querySelector("#n-tg"), sl = w.querySelector("#n-slug"), pg = w.querySelector("#n-page"), url = w.querySelector("#n-url"), touched = false;
    function upd(){ if (!touched) sl.value = slug(tg.value); var s = slug(sl.value); url.value = s ? SITE + pg.value + "?utm_source=telegram&utm_medium=group&utm_campaign=" + s : ""; }
    tg.oninput = upd; pg.onchange = upd; sl.oninput = function(){ touched = true; upd(); };
    w.querySelector("#n-x").onclick = function(){ w.remove(); };
    w.querySelector("#n-save").onclick = function(){
      var s = slug(sl.value);
      if (!tg.value.trim() || !s) { w.querySelector("#n-err").textContent = "Вкажіть назву групи."; return; }
      save("utm:telegram/" + s, {tg_group: tg.value.trim(), name: "TG: " + tg.value.trim()}).then(function(){
        try { navigator.clipboard.writeText(url.value); toast("Посилання скопійовано"); } catch(e){ toast("Збережено"); }
        url.select(); load();
        w.querySelector("#n-save").textContent = "Готово ✓";
      }).catch(fail);
    };
    tg.focus();
  }

  function loadXlsx(){
    return window.XLSX ? Promise.resolve() : new Promise(function(ok, no){ var s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
  }
  function exportXlsx(){
    loadXlsx().then(function(){
      var sum = [["Джерело", "Ключ", "Telegram-група", "Нотатка", "Унікальні відвідувачі", "Візити", "Заявки", "Виїхали / працюють", "Конверсія, %", "Перший візит", "Останній візит"]];
      rows.forEach(function(r){ sum.push([title(r), r.src, r.tg_group || "", r.note || "", +r.visitors, +r.sessions, +r.leads, +r.hired,
        r.conversion === null ? "" : +r.conversion, r.first_visit ? new Date(r.first_visit) : "", r.last_visit ? new Date(r.last_visit) : ""]); });
      var names = {}; rows.forEach(function(r){ names[r.src] = title(r); });
      var day = [["Дата", "Джерело", "Ключ", "Унікальні відвідувачі", "Заявки"]];
      daily.forEach(function(d){ day.push([new Date(d.day + "T12:00:00"), names[d.src] || autoLabel(d.src), d.src, +d.visitors, +d.leads]); });
      var wb = XLSX.utils.book_new();
      var s1 = XLSX.utils.aoa_to_sheet(sum, {cellDates: true}), s2 = XLSX.utils.aoa_to_sheet(day, {cellDates: true});
      s1["!cols"] = [{wch: 34}, {wch: 30}, {wch: 26}, {wch: 24}, {wch: 12}, {wch: 9}, {wch: 9}, {wch: 12}, {wch: 12}, {wch: 17}, {wch: 17}];
      s2["!cols"] = [{wch: 12}, {wch: 34}, {wch: 30}, {wch: 12}, {wch: 9}];
      s1["!autofilter"] = {ref: "A1:K" + sum.length}; s2["!autofilter"] = {ref: "A1:E" + day.length};
      XLSX.utils.book_append_sheet(wb, s1, "Джерела"); XLSX.utils.book_append_sheet(wb, s2, "По днях");
      var d = new Date(), stamp = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
      XLSX.writeFile(wb, "vdalo-dzherela-" + stamp + ".xlsx", {cellDates: true});
    }).catch(function(e){ fail(e || "не вдалося завантажити Excel-модуль"); });
  }

  load();
};
