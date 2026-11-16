(function(){
  var f = document.getElementById("emp-form"); if (!f) return;
  var $ = function(id){ return document.getElementById(id); };
  function val(n){ return (f[n] && f[n].value || "").trim(); }
  function text(d){
    return "Запит від роботодавця\nКомпанія: " + d.company + "\nКонтакт: " + d.contact_name + "\nТелефон: " + d.phone +
      (d.email ? "\nE-mail: " + d.email : "") + "\nКраїна: " + d.country + (d.city ? ", " + d.city : "") +
      "\nКількість працівників: " + d.workers + "\nПозиції: " + d.positions + (d.start_when ? "\nКоли потрібні: " + d.start_when : "") + (d.note ? "\nКоментар: " + d.note : "");
  }
  function show(id){ ["emp-sent","emp-fallback"].forEach(function(x){ $(x).classList.toggle("show", x === id); }); f.hidden = !!id; }
  f.addEventListener("submit", function(e){
    e.preventDefault();
    var err = $("emp-err"); err.textContent = "";
    if (val("website")) { show("emp-sent"); return; }
    var d = {company: val("company"), contact_name: val("contact_name"), phone: val("phone"), email: val("email"),
      country: val("country"), city: val("city"), workers: val("workers"), positions: val("positions"),
      start_when: val("start_when"), note: val("note"), lang: window.VDALO_LANG || "uk", page: location.href};
    if (!d.company || !d.contact_name || (!d.phone && !d.email) || !d.positions) {
      err.textContent = "Заповніть назву компанії, контактну особу, телефон або e-mail і позиції."; return;
    }
    var btn = $("emp-submit"); btn.disabled = true; btn.textContent = "Надсилаємо…";
    var jobs = [];
    jobs.push(Vdalo.sb().then(function(s){ if (!s) return false; return s.from("employer_leads").insert(d).then(function(r){ return !r.error; }); }).catch(function(){ return false; }));
    var gs = window.VDALO_LEADS_URL;
    if (gs) jobs.push(fetch(gs, {method: "POST", body: JSON.stringify(Object.assign({kind: "employer", name: d.contact_name, source: "Роботодавцям"}, d))})
      .then(function(r){ return r.json(); }).then(function(j){ return !!(j && j.ok); }).catch(function(){ return false; }));
    Promise.all(jobs).then(function(res){
      btn.disabled = false; btn.textContent = "Надіслати запит";
      if (res.some(Boolean)) { show("emp-sent"); if (window.gtag) gtag("event", "generate_lead", {form: "employer"}); }
      else {
        var t = text(d); $("emp-msg").textContent = t;
        $("emp-wa").href = "https://wa.me/380736067700?text=" + encodeURIComponent(t);
        show("emp-fallback");
      }
    });
  });
  document.querySelectorAll("[data-emp-copy]").forEach(function(a){
    a.addEventListener("click", function(){ try { navigator.clipboard.writeText($("emp-msg").textContent); } catch(e){} });
  });
  document.querySelectorAll("[data-emp-again]").forEach(function(b){ b.addEventListener("click", function(){ f.reset(); show(""); }); });
})();
