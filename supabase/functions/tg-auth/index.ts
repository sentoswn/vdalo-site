// Вхід через Telegram для vdalo-robota.com.ua.
// Перевіряє підпис від віджета Telegram Login, створює (або знаходить) користувача
// і повертає одноразовий токен, яким сайт відкриває сесію Supabase.
//
// Секрети функції (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN — токен бота від @BotFather
//   ADMIN_TG           — через кому: Telegram-ніки (без @) або числові ID адміністраторів
// SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY Supabase підставляє сам.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

async function checkTelegram(data: Record<string, string>, botToken: string): Promise<boolean> {
  const { hash, ...rest } = data;
  if (!hash) return false;
  const check = Object.keys(rest).filter((k) => rest[k] !== undefined && rest[k] !== null && rest[k] !== "")
    .sort().map((k) => `${k}=${rest[k]}`).join("\n");
  const secret = await crypto.subtle.digest("SHA-256", enc.encode(botToken));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = hex(await crypto.subtle.sign("HMAC", key, enc.encode(check)));
  if (sig !== String(hash).toLowerCase()) return false;
  const age = Date.now() / 1000 - Number(rest.auth_date || 0);
  return age >= -60 && age < 86400;   // підпис дійсний добу
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return json({ error: "TELEGRAM_BOT_TOKEN is not set" }, 500);

  let tg: Record<string, string>;
  try { tg = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const data: Record<string, string> = {};
  for (const k of ["id", "first_name", "last_name", "username", "photo_url", "auth_date", "hash"]) {
    if (tg[k] !== undefined && tg[k] !== null) data[k] = String(tg[k]);
  }
  if (!(await checkTelegram(data, botToken))) return json({ error: "invalid telegram signature" }, 401);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const tgId = Number(data.id);
  const email = `tg${tgId}@tg.vdalo-robota.com.ua`;
  const meta = { tg_id: tgId, first_name: data.first_name || "", last_name: data.last_name || "", username: data.username || "" };

  // створюємо користувача (якщо вже є — Supabase поверне помилку, це нормально)
  await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: meta });
  const { data: link, error: linkErr } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (linkErr || !link?.user) return json({ error: linkErr?.message || "link" }, 500);
  const uid = link.user.id;

  const admins = (Deno.env.get("ADMIN_TG") || "").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
  const isAdmin = admins.includes(String(tgId)) || (!!data.username && admins.includes(data.username.toLowerCase()));

  const { data: existing } = await sb.from("profiles").select("id, role").eq("id", uid).maybeSingle();
  const row: Record<string, unknown> = {
    id: uid, tg_id: tgId, tg_username: data.username || null,
    first_name: data.first_name || null, last_name: data.last_name || null, photo_url: data.photo_url || null,
  };
  if (isAdmin) row.role = "admin";
  const { error: upErr } = existing
    ? await sb.from("profiles").update(row).eq("id", uid)
    : await sb.from("profiles").insert(row);
  if (upErr) return json({ error: upErr.message }, 500);

  return json({ token_hash: link.properties.hashed_token, email });
});
