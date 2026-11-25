/* Злиття вакансій EWL (з tools/ewl.js) зі старим vacancies.json — виконується у вкладці github.com.
   Вхід:  window.__items — вакансії з EWL Platform (поле eid = correlationId оголошення),
          window.__old   — старий vacancies.json, window.__cfix — city-fix.json.
   Вихід: window.__out — вакансії EWL з номерами id (src:'trello' — так їх знають build.py і CRM),
          window.__ewlNext — лічильник для нових номерів (зберігається у vacancies.json як ewlNext),
          window.__fresh — id нових вакансій (їм агент вручну заповнює company/about і виправляє назву).
   Номер вакансії тримається за eid, тому адреса /vakansii/<id>/ не змінюється щодня.
   Для вакансій, що вже були на сайті, title/company/about беруться зі старого запису (назви не «стрибають»). */
(function () {
  const old = {}, byEid = {};
  (window.__old.items || []).forEach(v => { old[String(v.id)] = v; if (v.eid) byEid[v.eid] = String(v.id); });
  let next = window.__old.ewlNext || Math.max(611, ...(window.__old.items || []).filter(v => v.src === 'trello').map(v => +v.id || 0)) + 1;
  const fill = (window.__cfix || {}).fill || {}, rn = (window.__cfix || {}).rename || {};
  const fresh = [];
  const first = s => (s || '').split(/[ (]/)[0].toLowerCase();
  window.__out = (window.__items || []).map(n => {
    const id = byEid[n.eid] || String(next++);
    const o = old[id];
    const r = Object.assign({ id }, n);
    if (o && o.src === 'trello') {
      ['title', 'company', 'about'].forEach(k => { if (o[k]) r[k] = o[k]; });
      if (o.city && (!(r.city || '').trim() || first(o.city) === first(r.city))) r.city = o.city; // зберігаємо уточнення «(15 км від …)»
    } else fresh.push(id);
    if (!(r.city || '').trim() && fill[id]) r.city = fill[id];
    if (rn[r.city]) r.city = rn[r.city];
    delete r.companyName;
    return r;
  });
  window.__ewlNext = next; window.__fresh = fresh;
  return { ewl: window.__out.length, new: fresh.length, next,
    noCity: window.__out.filter(v => !(v.city || '').trim()).map(v => v.id).join(',') };
})();
