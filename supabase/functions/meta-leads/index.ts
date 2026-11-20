// Заявки з форм Facebook/Instagram (Lead Ads) → CRM (public.leads) + Google-таблиця/Telegram «Вдало Заявки».
// Кожні 2 хв її викликає pg_cron (див. schema.sql), можна й вручну з CRM → Налаштування → «Перевірити зараз».
// Ключ сторінки (Page access token з дозволом leads_retrieval) лежить в app_secrets.meta_page_token —
// власник вставляє його в CRM; у браузері та в репозиторії його немає.
// Повтори виключені: кожна заявка має ext_id = "fb:<id заявки>" (унікальний індекс).
import { createClient } from "npm:@supabase/supabase-js@2";

const PAGE_ID = "1480825471786123";
const GRAPH = "https://graph.facebook.com/v21.0/";
const LEADS_URL = "https://script.google.com/macros/s/AKfycbzt87VLFDpZYR13V56RsBHyjLm0q_P1teyIWZAHMQvc8WinxwyTUi4N0Bx27t2kUTGS9Q/exec";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

type Field = { name: string; values: string[] };

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
    else if (/хто|who/.test(k)) out.who = v;
    else if (/коли|when|почати/.test(k)) out.when_go = v;
    else if (/зв.?яз|contact|зручн/.test(k)) out.contact_mode = v;
    else rest.push((f.name || "").replace(/_/g, " ").replace(/\?$/, "") + ": " + v);
  }
  if (!out.name) out.name = [first, last].filter(Boolean).join(" ") || "Без імені";
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
    const known = new Set((have || []).map((x: any) => x.ext_id));

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
  const row = {
    ext_id: "fb:" + String(l.id).replace(/\D/g, ""), created_at: l.created_time || new Date().toISOString(),
    name: m.name, phone: m.phone || "—", who: m.who || null, when_go: m.when_go || null,
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
    if ((same || []).some((x: any) => String(x.phone).replace(/\D/g, "").endsWith(d9))) return { added: false, dup: true };
  }
  const { error } = await sb.from("leads").insert(row);
  if (error) return /duplicate/i.test(error.message) ? { added: false, dup: true } : { added: false, error: m.name + ": " + error.message };
  const payload = { name: m.name, phone: m.phone || "", vacancyId: "", vacancyTitle: "", operator: "",
    who: m.who || "", when: m.when_go || "", mode: m.contact_mode || "", channel: "",
    note: [m.note, "Реклама: " + ([l.campaign_name, l.adset_name, l.ad_name].filter(Boolean).join(" / ") || "форма Facebook")].filter(Boolean).join("\n"),
    source: row.source, page: "Facebook Lead Ads — " + formName, website: "" };
  await fetch(LEADS_URL, { method: "POST", body: JSON.stringify(payload) }).catch(() => {});
  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const { data: st } = await sb.from("settings").select("value").eq("key", "leads_tg_chat").maybeSingle();
  if (bot && st?.value) {
    const msg = "📝 <b>Заявка з форми " + (plat === "instagram" ? "Instagram" : "Facebook") + "</b>\n<b>Ім'я:</b> " + esc(m.name) +
      "\n<b>Телефон:</b> " + esc(m.phone) + (m.who ? "\n<b>Хто їде:</b> " + esc(m.who) : "") + (m.when_go ? "\n<b>Коли:</b> " + esc(m.when_go) : "") +
      (m.contact_mode ? "\n<b>Зв'язок:</b> " + esc(m.contact_mode) : "") + (m.note ? "\n" + esc(m.note) : "") +
      "\n\n<a href=\"https://vdalo-robota.com.ua/crm/\">Відкрити CRM</a>";
    for (const chat of String(st.value).split(",").map((s: string) => s.trim()).filter(Boolean))
      await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: "HTML", disable_web_page_preview: true }) }).catch(() => {});
  }
  return { added: true };
}
