// Надсилання листів із CRM від імені info@vdalo-robota.com.ua через Resend. Лише для власників (role = admin).
// Тіло: { to, subject, text, reply_to_id? } — reply_to_id = id вхідного листа з mail_messages (для ланцюжка).
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const escHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await sb.auth.getUser(token);
  if (!u?.user) return json({ error: "Увійдіть у CRM" }, 401);
  const { data: me } = await sb.from("profiles").select("role,full_name,first_name,last_name").eq("id", u.user.id).maybeSingle();
  if (me?.role !== "admin") return json({ error: "Лише для власників" }, 403);
  let b: any = {};
  try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const to = String(b.to || "").split(/[,;\s]+/).map((s: string) => s.trim()).filter((s: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));
  const subject = String(b.subject || "").trim().slice(0, 300), text = String(b.text || "").trim().slice(0, 50000);
  if (!to.length || !subject || !text) return json({ error: "Вкажіть адресу, тему й текст" }, 400);
  const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "resend_api_key").maybeSingle();
  if (!sec?.value) return json({ error: "Не задано ключ Resend (CRM → Пошта → Налаштувати)" }, 400);
  const headers: Record<string, string> = {};
  if (b.reply_to_id) {
    const { data: orig } = await sb.from("mail_messages").select("message_id").eq("id", b.reply_to_id).maybeSingle();
    if (orig?.message_id) { headers["In-Reply-To"] = orig.message_id; headers["References"] = orig.message_id; }
  }
  const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">' + escHtml(text).replace(/\n/g, "<br>") + "</div>";
  const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: "Bearer " + sec.value, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Вдало <info@vdalo-robota.com.ua>", to, subject, text, html, reply_to: "info@vdalo-robota.com.ua", headers }) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json({ error: "Resend: " + (out?.message || r.status) }, 502);
  const name = me.full_name || [me.first_name, me.last_name].filter(Boolean).join(" ");
  await sb.from("mail_messages").insert({ dir: "out", resend_id: out.id || null, from_addr: "info@vdalo-robota.com.ua", from_name: name || "Вдало",
    to_addr: to.join(", "), subject, text_body: text, html_body: html, in_reply_to: headers["In-Reply-To"] || null, sent_by: u.user.id, read_at: new Date().toISOString() });
  return json({ ok: true, id: out.id });
});
