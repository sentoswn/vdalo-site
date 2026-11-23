// Заявки з форм Facebook/Instagram (Lead Ads) → CRM (public.leads) + Google-таблиця/Telegram «Вдало Заявки».
// Кожні 2 хв її викликає pg_cron (див. schema.sql), можна й вручну з CRM → Налаштування → «Перевірити зараз».
// Ключ сторінки (Page access token з дозволом leads_retrieval) лежить в app_secrets.meta_page_token —
// власник вставляє його в CRM; у браузері та в репозиторії його немає.
// Повтори виключені: кожна заявка має ext_id = "fb:<id заявки>" (унікальний індекс).
import { createClient } from "npm:@supabase/supabase-js@2";

const PAGE_ID = "1480825471786123";
const GRAPH = "https://graph.facebook.com/v21.0/";
const LEADS_URL = "https://script.google.com/macros/s/AKfycbzt87VLFDpZYR13V56RsBHyjLm0q_P1teyIWZAHMQvc8WinxwyTUi4N0Bx27t2kUTGS9Q/exec";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

type Field = { name: string; values: string[] };

// Оголошення → вакансія, щоб менеджер одразу бачив, яку вакансію хоче людина.
// Кампанія «ліди, 10 вакансій»: назви оголошень top-*. Для інших — номер у кінці назви (form-pary129 → №129).
const AD_VAC: Record<string, [string, string]> = {
  "top-shein": ["456", "SHEIN — оператор складу, Wrocław"],
  "top-aurora": ["606", "Aurora — оператор складських процесів, Krajków"],
  "top-arvato": ["218", "ARVATO — комплектувальник одягу, Stryków"],
  "top-martom": ["72", "Mar-Tom — виробництво вікон і дверей, Jędrzejów"],
  "top-kurka": ["2018823", "Курячий завод, Solec Kujawski"],
  "top-oetker": ["380", "Dr. Oetker — виробничий працівник, Łebcz"],
  "top-jeronimo": ["242", "Jeronimo Martins (Biedronka) — склад, Lubin"],
  "top-morozyvo": ["333", "Grycan — виробництво морозива, Majdan"],
  "top-sealogic": ["148", "Sealogic — переробка риби, Białogard"],
  "top-truvant": ["63", "TRUVANT — пакування бритв, Łódź"],
  "form-pary129": ["129", "PERLA — виробництво закусок, Głobino (для пар)"],
  // акційні вакансії (до 05.12), +200 zł бонус від нас за 2 тижні
  "promo-brand": ["1893635", "Склад брендового одягу, Bydgoszcz (акція)"],
  "promo-hanplast": ["2018833", "Hanplast — оператор машини, Bydgoszcz (акція)"],
  "promo-paleta": ["2238374", "Hanplast — палетувальник, Bydgoszcz (акція)"],
  "promo-osla": ["1893257", "Комплектація на електронавантажувачі, Osła (акція)"],
  "promo-katy": ["1893927", "SHEIN — склад, Kąty Wrocławskie (акція)"],
  "shein-katy-1": ["1893927", "SHEIN — склад, Kąty Wrocławskie (акція)"],
  "shein-katy-2": ["1893927", "SHEIN — склад, Kąty Wrocławskie (акція)"],
  "shein-katy-3": ["1893927", "SHEIN — склад, Kąty Wrocławskie (акція)"],
  "promo-sinsay": ["1893715", "SINSAY — склад, Jasionka/Rzeszów (акція)"],
};
function adVacancy(adName?: string): { id: string; title: string } | null {
  const n = String(adName || "").trim().toLowerCase();
  if (AD_VAC[n]) return { id: AD_VAC[n][0], title: AD_VAC[n][1] };
  const m = n.match(/(\d{2,7})$/);
  return m ? { id: m[1], title: "" } : null;
}

// Питання форми → поля CRM. Стандартні поля Meta мають фіксовані імена, власні питання — шукаємо за словами.
function mapFields(fd: Field[]) {
  const out: Record<string, string> = {}; const rest: string[] = [];
  let first = "", last = "";
  for (const f of fd || []) {
    const k = (f.name || "").toLowerCase(), v = (f.values || []).join(", ").replace(/_/g, " ").trim();
    if (!v) continue;
    if (k === "full_name") out.name = v;
    else if (k === "first_name") first = v;
    else if (k === "last_name") last = v;
    else if (k === "phone_number" || k === "phone") out.phone = v;
    else if (k === "date_of_birth" || k === "dob") { const d = new Date(v); out.age = isNaN(+d) ? v : String(Math.floor((Date.now() - +d) / 31557600000)); }
    else if (/вік|возраст|скільки.*рок|сколько.*лет|\bage\b|років|лет/.test(k)) out.age = v;
    else if (/хто|who/.test(k)) out.who = v;
    else if (/коли|when|почати/.test(k)) out.when_go = v;
    else if (/зв.?яз|contact|зручн/.test(k)) out.contact_mode = v;
    else if (/verified/.test(k)) continue;   // службове поле Meta «phone number verified»
    else if (/вік|age/.test(k)) out.age = v;   // форма v2: «Ваш вік?»
    else rest.push((f.name || "").replace(/_/g, " ").replace(/\?$/, "") + ": " + v);
  }
  if (!out.name) out.name = [first, last].filter(Boolean).join(" ") || "Без імені";
  // вік — першим рядком примітки; старше 55 позначаємо, щоб менеджер одразу бачив
  if (out.age) rest.unshift((/55\s*\+|більше|старше|56|60|65/i.test(out.age) ? "⚠️ " : "") + "Вік: " + out.age);
  out.note = rest.join("\n");
  return out;
}

async function g(path: string, token: string) {
  const r = await fetch(GRAPH + path + (path.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(token));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j?.error?.message || ("HTTP " + r.status));
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Прямий прийом заявки (Make.com / ручне перенесення з Центру лідів):
  // POST {"lead": {"id", "created_time", "form", "platform", "ad_name", "campaign_name", "adset_name", "field_data": [{name, values}]}}
  let body: any = {};
  try { body = await req.json(); } catch { /* порожнє тіло — режим опитування */ }
  if (body && body.lead) {
    const r = await ingest(sb, body.lead, body.lead.form || "Facebook form");
    return json(r);
  }
  const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "meta_page_token").maybeSingle();
  const token = sec?.value?.trim();
  if (!token) return json({ ok: false, error: "Ключ сторінки Facebook ще не вставлено (CRM → Налаштування)." });

  let forms: any[] = [];
  try { forms = (await g(PAGE_ID + "/leadgen_forms?fields=id,name,status&limit=100", token)).data || []; }
  catch (e) { return json({ ok: false, error: "Facebook: " + (e as Error).message }); }

  const since = Math.floor(Date.now() / 1000) - 14 * 86400;   // дивимось заявки за останні 14 днів
  let added = 0, seen = 0; const errors: string[] = [];
  for (const form of forms) {
    let leads: any[] = [];
    try {
      const filt = encodeURIComponent(JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: since }]));
      leads = (await g(form.id + "/leads?fields=id,created_time,field_data,ad_id,ad_name,adset_name,campaign_name,platform,is_organic&limit=100&filtering=" + filt, token)).data || [];
    } catch (e) { errors.push(form.name + ": " + (e as Error).message); continue; }
    if (!leads.length) continue;
    seen += leads.length;
    const ids = leads.map((l) => "fb:" + l.id);
    const { data: have } = await sb.from("leads").select("ext_id").in("ext_id", ids);
    const { data: seenRows } = await sb.from("meta_seen").select("ext_id").in("ext_id", ids);
    const known = new Set([...(have || []), ...(seenRows || [])].map((x: any) => x.ext_id));
    // усе, що є в CRM, запам'ятовуємо: якщо потім видалять — заново не завантажимо і в Telegram не надішлемо
    if (have && have.length) await sb.from("meta_seen").upsert(have.map((x: any) => ({ ext_id: x.ext_id })), { onConflict: "ext_id", ignoreDuplicates: true });

    for (const l of leads.sort((a, b) => a.created_time.localeCompare(b.created_time))) {
      if (known.has("fb:" + l.id)) continue;
      const r = await ingest(sb, l, form.name);
      if (r.added) added++; else if (r.error) errors.push(r.error);
    }
  }
  return json({ ok: errors.length === 0, forms: forms.length, seen, added, errors });
});

async function ingest(sb: any, l: any, formName: string): Promise<{ added: boolean; error?: string; dup?: boolean }> {
  if (!l?.id || !Array.isArray(l.field_data)) return { added: false, error: "bad lead" };
  const m = mapFields(l.field_data);
  const plat = l.platform === "ig" ? "instagram" : "facebook";
  const vac = adVacancy(l.ad_name);
  const seen = () => sb.from("meta_seen").upsert({ ext_id: "fb:" + String(l.id).replace(/\D/g, "") }, { onConflict: "ext_id", ignoreDuplicates: true });
  const row = {
    vacancy_id: vac?.id || null, vacancy_title: vac?.title || null,
    ext_id: "fb:" + String(l.id).replace(/\D/g, ""), created_at: l.created_time || new Date().toISOString(),
    name: m.name, phone: m.phone || "—", age: m.age || null, who: m.who || null, when_go: m.when_go || null,
    contact_mode: m.contact_mode || null, note: m.note || null,
    source: "Форма " + (plat === "instagram" ? "Instagram" : "Facebook") + (l.ad_name ? " · " + l.ad_name : ""),
    page: "lead form: " + formName, lang: "uk", traffic: l.is_organic ? "social" : "paid",
    src: "ads:" + plat + "/leadform",
    utm: { utm_source: plat, utm_medium: l.is_organic ? "organic" : "paid", utm_campaign: l.campaign_name || null,
           utm_term: l.adset_name || null, utm_content: l.ad_name || null, form: formName },
  };
  // той самий номер уже приходив із форми за останні 60 днів — не дублюємо (захист від повторного перенесення)
  const d9 = String(m.phone || "").replace(/\D/g, "").slice(-9);
  if (d9.length === 9) {
    const { data: same } = await sb.from("leads").select("id, phone").like("src", "ads:%leadform")
      .gte("created_at", new Date(Date.now() - 60 * 86400e3).toISOString()).limit(500);
    if ((same || []).some((x: any) => String(x.phone).replace(/\D/g, "").endsWith(d9))) { await seen(); return { added: false, dup: true }; }
  }
  const { data: ins, error } = await sb.from("leads").insert(row).select("id").single();
  if (error) { if (/duplicate/i.test(error.message)) { await seen(); return { added: false, dup: true }; } return { added: false, error: m.name + ": " + error.message }; }
  await seen();
  const payload = { name: m.name + (m.age ? ", " + m.age : ""), phone: m.phone || "", vacancyId: vac?.id || "", vacancyTitle: vac?.title || "", operator: "",
    who: m.who || "", when: m.when_go || "", mode: m.contact_mode || "", channel: "",
    note: [m.note, "Реклама: " + ([l.campaign_name, l.adset_name, l.ad_name].filter(Boolean).join(" / ") || "форма Facebook")].filter(Boolean).join("\n"),
    source: row.source, page: "Facebook Lead Ads — " + formName, website: "" };
  await fetch(LEADS_URL, { method: "POST", body: JSON.stringify(payload) }).catch(() => {});
  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const { data: st } = await sb.from("settings").select("value").eq("key", "leads_tg_chat").maybeSingle();
  if (bot && st?.value) {
    const vacLine = vac
      ? "\n🎯 <b>Вакансія:</b> <a href=\"https://vdalo-robota.com.ua/vakansii/" + vac.id + "/\">№" + vac.id + "</a>" + (vac.title ? " — " + esc(vac.title) : "")
      : "";
    const adLine = "\n📣 <b>Реклама:</b> " + esc([l.campaign_name, l.ad_name].filter(Boolean).join(" → ") || (l.is_organic ? "без реклами (органіка)" : "невідомо"));
    const msg = "📝 <b>Заявка з форми " + (plat === "instagram" ? "Instagram" : "Facebook") + (ins?.id ? " · №" + ins.id : "") + "</b>" + vacLine + adLine + "\n<b>Ім'я:</b> " + esc(m.name) + (m.age ? "\n<b>Вік:</b> " + esc(m.age) : "") +
      "\n<b>Телефон:</b> " + esc(m.phone) + (m.who ? "\n<b>Хто їде:</b> " + esc(m.who) : "") + (m.when_go ? "\n<b>Коли:</b> " + esc(m.when_go) : "") +
      (m.contact_mode ? "\n<b>Зв'язок:</b> " + esc(m.contact_mode) : "") + (m.note ? "\n" + esc(m.note) : "") +
      "\n\n<a href=\"https://vdalo-robota.com.ua/crm/\">Відкрити CRM</a>";
    // кнопка «Написати у Viber»: сторінка /v/ складає готове привітання й відкриває Viber з цим номером
    const vurl = "https://vdalo-robota.com.ua/v/?n=" + encodeURIComponent(String(m.phone || "").replace(/\D/g, "")) +
      "&nm=" + encodeURIComponent(m.name || "") + (vac?.id ? "&v=" + encodeURIComponent(vac.id) : "");
    const kb = { inline_keyboard: [[{ text: "💬 Написати у Viber", url: vurl }], [{ text: "Відкрити CRM", url: "https://vdalo-robota.com.ua/crm/" }]] };
    for (const chat of String(st.value).split(",").map((s: string) => s.trim()).filter(Boolean))
      await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: kb }) }).catch(() => {});
  }
  return { added: true };
}
