/* Злиття вакансій для vacancies.json (виконується у вкладці github.com після кроку з Trello).
   Вхід:  window.__out    — вакансії з Trello (вже злиті й почищені),
          window.__pitems — вакансії з Planfix (масив з tools/planfix.js),
          window.__old    — старий vacancies.json.
   Вихід: window.__out — Trello (src:"trello") + Planfix (src:"planfix"), без дублікатів id.
   Для вакансій Planfix, що вже були на сайті, title/company/about беруться зі старого запису,
   щоб назви не «стрибали» щодня. */
(function () {
  const old = {}; (window.__old.items || []).forEach(v => { old[String(v.id)] = v; });
  const tr = (window.__out || []).map(v => Object.assign({}, v, { src: v.src || 'trello' }));
  const seen = new Set(tr.map(v => String(v.id)));
  const pf = (window.__pitems || []).filter(v => !seen.has(String(v.id))).map(v => {
    const o = old[String(v.id)]; const r = Object.assign({}, v, { src: 'planfix' });
    if (o && o.src === 'planfix') ['title', 'company', 'about'].forEach(k => { if (o[k]) r[k] = o[k]; });
    return r;
  });
  window.__out = tr.concat(pf);
  return { trello: tr.length, planfix: pf.length, total: window.__out.length,
    newPlanfix: pf.filter(v => !old[String(v.id)]).length };
})();
