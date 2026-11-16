/* Вакансії з Planfix (gremi.planfix.com, фільтр «Вакансії (посередники)») → формат vacancies.json.
   Запуск: у вкладці https://gremi.planfix.com/?action=tasks&filter=5812558 (користувач залогінений):
     eval(await (await fetch('https://raw.githubusercontent.com/sentoswn/vdalo-site/main/tools/planfix.js?'+Date.now())).text())
   Скрипт працює у фоні: стан — window.__pf.status ('running' | 'done' | 'error: …'),
   результат — window.__pf.items (масив) і window.__pf.b64 (gzip+base64url JSON). */
(function () {
  const PF = window.__pf = { status: 'running', n: 0 };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rt = (document.cookie.match(/(?:^|;\s*)rtoken=([^;]+)/) || [])[1];
  const strip = s => { const d = document.createElement('div'); d.innerHTML = String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n');
    return d.textContent.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim(); };
  const HEAD = /^(❗\s*)?(вимоги( до кандидата)?|графік( роботи)?|умови (на підприємстві|роботи( на підприємстві)?)|ставка|доїзд|медогляд|проживання|завдання|обов[’']язки|робоч(ий|і|их) (одяг( та| і) взуття|одяг|годин[и]? (на|в) місяць|години (на|в) місяць)|кількість робочих годин на місяць|компенсація за (своє|власне) житло|важливо|тип навантажувача|заробітна плата та умови працевлаштування|місце роботи|місце оформлення документів)\s*[:!]?\s*(.*)$/i;
  function sections(t) { const o = {}; let cur = '_top';
    t.split('\n').forEach(l => { l = l.trim(); if (!l) return; const m = l.match(HEAD);
      if (m) { cur = m[2].toLowerCase().replace(/[’']/g, "'"); if (!o[cur]) o[cur] = []; if (m[m.length - 1]) o[cur].push(m[m.length - 1]); }
      else (o[cur] = o[cur] || []).push(l); });
    return o; }
  const clean = s => s.replace(/^[•\-–◾·\s]+/, '').replace(/[,;.:\s]+$/, '').trim();
  const join = (a, n, sep) => { if (!a) return ''; let s = a.map(clean).filter(x => x && !/\d{2}-\d{3}|ul\.|вул\.|телефон|\+48|координатор|gremi|kraz/i.test(x)).join(sep || '; ');
    if (s.length > n) s = s.slice(0, n).replace(/[\s;,]+\S*$/, '') + '…'; return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; };
  const num = s => parseFloat(String(s).replace(',', '.'));

  function build(o) {
    let ua = o['Опис UA'] || ''; const cut = ua.search(/Gremi Personal|Klauzula informacyjna|Numer KRAZ/i);
    const tail = cut >= 0 ? ua.slice(cut) : ''; if (cut >= 0) ua = ua.slice(0, cut);
    const S = sections(ua), top = S._top || [];
    const cm = tail.match(/Rekrutujemy dla naszego klienta\s*[–-]\s*([^\n]+)/i);
    let company = cm ? cm[1].replace(/\s*(Sp\.?\s*z\s*o\.?\s*o\.?|S\.A\.|sp\.\s*k\.|Spółka.*)\.?\s*$/i, '').replace(/[.\s]+$/, '').trim() : '';
    if (/gremi/i.test(company) || company.length > 40) company = '';
    let title = (top[0] && top[0].length < 70 && !/[:]/.test(top[0])) ? top[0] : (o['Назва вакансії'] || o.title.replace(/^\d+\s*-\s*/, ''));
    title = title.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/[.\s]+$/, '').trim();
    if (title === title.toUpperCase()) title = title.toLowerCase();
    title = title.charAt(0).toUpperCase() + title.slice(1);
    const br = num(o['Ставка брутто']), ri = o['Інформація для рекрутації'] || '';
    const nets = [];
    if (br && br < 200) ri.split('\n').forEach(l => { if (!/net+o|нетто/i.test(l) || /студент/i.test(l)) return;
      (l.match(/\d{2}[.,]\d{1,2}/g) || []).map(num).forEach(x => { if (x < br * 0.97 && x > br * 0.55) nets.push(x); }); });
    const net = nets.length ? [Math.min(...nets), Math.max(...nets), 'год', 'PLN', ''] : '';
    const g = (o['Допустима стать'] || '').replace(/\s/g, '');
    const age = o['Вік (допустимий)'];
    const who = (g === 'М' ? 'Чоловіки' : g === 'Ж' ? 'Жінки' : 'Жінки та чоловіки') + (age && +age >= 30 && +age <= 70 ? `, до ${age} р.` : '');
    let hours = join(S['робочих годин на місяць'] || S['робочі години на місяць'] || S['кількість робочих годин на місяць'] || S['робочі години в місяць'], 30, ', ');
    if (!hours || /[A-Za-zł]/.test(hours)) { const hm = ua.match(/(\d{2,3})\s*[–-]\s*(\d{2,3})\s*(?:год|робочих)/i); hours = hm ? hm[1] + '–' + hm[2] : ''; }
    const vh = o['Вартість житла'] || '';
    let housing = join(S['проживання'], 120, '. ');
    if (!housing) housing = /своим жиль|своїм житл|власн/i.test(vh) ? 'Лише зі своїм житлом' : (o['Є місця на нашому житлі'] === 'Так' && /\d/.test(vh) ? 'Житло від роботодавця: ' + vh.replace(/zł|зл\.?/i, '').trim() + ' zł/міс' : '');
    const night = o['Нічна зміна'];
    const r = { id: String(o.gid), src: 'planfix', title, company, country: 'Польща', city: (o['Місто виконання роботи'] || '').trim(),
      salary: !br ? '' : br < 200 ? br.toFixed(2) + ' PLN брутто/година' : br.toFixed(0) + ' PLN брутто/місяць',
      net, hours, contract: o['Тип договора'] || '', housing, who,
      desc: join(S["обов'язки"] || S['завдання'], 170, ', '), schedule: join(S['графік роботи'] || S['графік'], 80, ', '),
      night: night === 'Так' ? 'Є' : night === 'Ні' ? 'Ні' : '', transport: join(S['доїзд'], 90, '. '),
      req: join(S['вимоги'] || S['вимоги до кандидата'], 150, ', '),
      perks: join(S['умови на підприємстві'] || S['умови роботи'] || S['умови роботи на підприємстві'], 130, ', ') };
    if (/^(ні|немає|відсутні)$/i.test(r.perks)) r.perks = '';
    Object.keys(r).forEach(k => { if (r[k] === '' || r[k] == null) delete r[k]; });
    return r;
  }

  async function card(iid) {
    const r = await fetch('/ajax/', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest', 'X-RToken': rt },
      body: 'command=action%3AgetTaskCardData&task=' + iid + '&offset=0&pageSize=1&sort=&gid=0&taskType=task&taskcard=1' });
    return r.json();
  }

  (async () => {
    try {
      if (!rt) throw new Error('немає входу в Planfix (cookie rtoken)');
      // 1. підвантажити весь список фільтра прокручуванням
      let prev = -1;
      for (let i = 0; i < 80; i++) {
        document.querySelectorAll('*').forEach(e => { if (e.scrollHeight > e.clientHeight + 50 && /auto|scroll/.test(getComputedStyle(e).overflowY)) e.scrollTop = e.scrollHeight; });
        await sleep(700);
        const c = document.querySelectorAll('tr[class*="tr-taskid-"]').length;
        if (c === prev && i > 4) break; prev = c;
      }
      const ids = [...document.querySelectorAll('tr[class*="tr-taskid-"]')].map(tr => { const a = tr.querySelector('a[href*="/task/"]');
        return [tr.className.match(/tr-taskid-(\d+)/)[1], a ? a.href.match(/task\/(\d+)/)[1] : null]; }).filter(x => x[1]);
      if (!ids.length) throw new Error('список вакансій порожній');
      const raw = [];
      for (const [iid, gid] of ids) {
        const T = (await card(iid)).Task; const o = { gid, title: T.Title, status: T.StatusText || T.currentTaskStatusText || '' };
        const cd = T.CustomData || {};
        for (const k in cd) { const f = cd[k], n = f.Field && f.Field.Name; if (!n || /Опис (RU|EN|PL)/.test(n)) continue;
          const v = strip(f.PlainStringValue || f.Text || f.Value || ''); if (v) o[n.replace(/ \(N\).*$/, '')] = v; }
        raw.push(o); PF.n = raw.length;
      }
      PF.raw = raw;
      PF.items = raw.filter(o => !/Видна посередникам/.test(JSON.stringify(Object.keys(o))) || o['Видна посередникам?'] !== 'Ні').map(build).filter(x => x.salary);
      const s = new Blob([JSON.stringify(PF.items)]).stream().pipeThrough(new CompressionStream('gzip'));
      const buf = new Uint8Array(await new Response(s).arrayBuffer()); let b = ''; for (const x of buf) b += String.fromCharCode(x);
      PF.b64 = btoa(b).replace(/\+/g, '-').replace(/\//g, '_');
      PF.status = 'done';
    } catch (e) { PF.status = 'error: ' + (e && e.message || e); }
  })();
  return 'started';
})();
