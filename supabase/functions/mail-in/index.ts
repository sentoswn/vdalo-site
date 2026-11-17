// Вхідні листи на @vdalo-robota.com.ua (Resend → веб-перехоплювач email.received).
// URL у Resend: https://<project>.supabase.co/functions/v1/mail-in?k=<секретний ключ> (у коді — лише його SHA-256).
// Функція забирає повний текст листа з Resend, кладе його в mail_messages (видно у CRM → «Пошта»)
// і надсилає сповіщення в Telegram власникам (або в чат із налаштування mail_tg_chat).
import { createClient } from "npm:@supabase/supabase-js@2";

const KEY_SHA256 = "a0f10122b2435eef077f72ff805cbe3554ed135bd4451d4b8cef295d8462ef3d";
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const addr = (v: unknown) => Array.isArray(v) ? v.join(", ") : String(v ?? "");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (hex(await crypto.subtle.digest("SHA-256", enc.encode(url.searchParams.get("k") || ""))) !== KEY_SHA256) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("ok");
  let ev: any = {};
  try { ev = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (ev.type !== "email.received") return new Response("ignored");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const meta = ev.data || {};
  const id = String(meta.email_id || meta.id || "");
  const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "resend_api_key").maybeSingle();
  let full: any = {};
  if (sec?.value && id) {
    const r = await fetch("https://api.resend.com/emails/receiving/" + id, { headers: { Authorization: "Bearer " + sec.value } });
    if (r.ok) full = await r.json();
  }
  const fromRaw = String(full?.headers?.from || meta.from || full.from || "");
  const m = fromRaw.match(/^\s*"?([^"<]*)"?\s*<([^>]+)>/);
  const row = {
    dir: "in", resend_id: id || null,
    message_id: full?.headers?.["message-id"] || full.message_id || meta.message_id || null,
    in_reply_to: full?.headers?.["in-reply-to"] || null,
    from_addr: m ? m[2].trim() : (meta.from || fromRaw), from_name: m ? m[1].trim() : null,
    to_addr: addr(meta.to || full.to), subject: meta.subject || full.subject || "(без теми)",
    text_body: full.text || (full.html ? strip(full.html) : null), html_body: full.html || null,
  };
  const { error } = await sb.from("mail_messages").upsert(row, { onConflict: "resend_id" });
  if (error) console.error(error);

  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (bot) {
    const chats: string[] = [];
    const { data: st } = await sb.from("settings").select("value").eq("key", "mail_tg_chat").maybeSingle();
    if (st?.value && String(st.value).trim()) chats.push(...String(st.value).split(",").map((s) => s.trim()).filter(Boolean));
    else { const { data: a } = await sb.from("profiles").select("tg_id").eq("role", "admin").not("tg_id", "is", null); (a || []).forEach((x: any) => chats.push(String(x.tg_id))); }
    const text = (row.text_body || "").slice(0, 700);
    const msg = "📧 <b>Новий лист на " + esc(row.to_addr || "info@vdalo-robota.com.ua") + "</b>\n<b>Від:</b> " + esc(row.from_name ? row.from_name + " <" + row.from_addr + ">" : row.from_addr) +
      "\n<b>Тема:</b> " + esc(row.subject) + (text ? "\n\n" + esc(text) : "") + "\n\n<a href=\"https://vdalo-robota.com.ua/crm/#mail\">Відкрити в CRM</a>";
    for (const chat of chats) await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: "HTML", disable_web_page_preview: true }) }).catch(() => {});
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
