// Нові листи на info@vdalo-robota.com.ua → сповіщення в Telegram від бота @vdalo_robota_bot.
// Zoho Mail («Налаштування → Веб-перехоплювачі») надсилає сюди POST про кожен вхідний лист:
//   https://<project>.supabase.co/functions/v1/mail-in?k=<секретний ключ>
// У коді зберігається лише SHA-256 ключа. Куди слати: якщо в CRM-налаштуваннях (таблиця settings)
// задано mail_tg_chat — у цей чат/групу; інакше — особисто всім власникам (role = admin).
import { createClient } from "npm:@supabase/supabase-js@2";

const KEY_SHA256 = "a0f10122b2435eef077f72ff805cbe3554ed135bd4451d4b8cef295d8462ef3d";
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
const strip = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ").replace(/<br\s*\/?>|<\/p>|<\/div>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const k = url.searchParams.get("k") || "";
  if (hex(await crypto.subtle.digest("SHA-256", enc.encode(k))) !== KEY_SHA256) return new Response("forbidden", { status: 403 });
  if (req.method !== "POST") return new Response("ok");   // перевірка URL з боку Zoho

  let raw = await req.text(), d: Record<string, unknown> = {};
  try { d = JSON.parse(raw); } catch { try { d = Object.fromEntries(new URLSearchParams(raw)); } catch { d = {}; } }
  const pick = (...ks: string[]) => { for (const x of ks) { const v = d[x]; if (v !== undefined && v !== null && String(v).trim()) return String(v); } return ""; };
  const from = pick("fromAddress", "from", "sender");
  const subject = pick("subject") || "(без теми)";
  let text = pick("summary", "content", "text", "body", "html");
  if (/<[a-z][\s\S]*>/i.test(text)) text = strip(text);
  text = text.slice(0, 900);
  const to = pick("toAddress", "to");

  const bot = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!bot) return new Response("no bot", { status: 500 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const chats: string[] = [];
  const { data: st } = await sb.from("settings").select("value").eq("key", "mail_tg_chat").maybeSingle();
  if (st?.value && String(st.value).trim()) chats.push(...String(st.value).split(",").map((s) => s.trim()).filter(Boolean));
  else {
    const { data: admins } = await sb.from("profiles").select("tg_id").eq("role", "admin").not("tg_id", "is", null);
    (admins || []).forEach((a: { tg_id: number }) => chats.push(String(a.tg_id)));
  }
  const msg = "📧 <b>Новий лист на " + esc(to || "info@vdalo-robota.com.ua") + "</b>\n" +
    "<b>Від:</b> " + esc(from) + "\n<b>Тема:</b> " + esc(subject) + (text ? "\n\n" + esc(text) : "") +
    "\n\n<a href=\"https://mail.zoho.eu/zm/\">Відкрити пошту</a>";
  let sent = 0;
  for (const chat of chats) {
    const r = await fetch("https://api.telegram.org/bot" + bot + "/sendMessage", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: msg, parse_mode: "HTML", disable_web_page_preview: true }) });
    if (r.ok) sent++;
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { "Content-Type": "application/json" } });
});
