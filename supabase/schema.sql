-- «Вдало»: кабінет кандидата, реферальна програма й CRM.
-- Виконується один раз у Supabase → SQL Editor (або автоматично через GitHub Actions).
-- Повторний запуск безпечний: усе створюється «if not exists» / «or replace».

-- ============ Профілі (вхід через Telegram) ============
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  tg_id       bigint unique,
  tg_username text,
  first_name  text,
  last_name   text,
  photo_url   text,
  phone       text,
  ref_code    text unique,
  role        text not null default 'user' check (role in ('user','manager','admin')),
  created_at  timestamptz not null default now()
);

-- короткий реферальний код: 6 символів без схожих літер
create or replace function public.gen_ref_code() returns text language plpgsql as $$
declare c text; abc text := 'abcdefghjkmnpqrstuvwxyz23456789';
begin
  loop
    c := '';
    for i in 1..6 loop c := c || substr(abc, 1 + floor(random()*length(abc))::int, 1); end loop;
    exit when not exists (select 1 from public.profiles where ref_code = c);
  end loop;
  return c;
end $$;

create or replace function public.profiles_defaults() returns trigger language plpgsql as $$
begin
  if new.ref_code is null then new.ref_code := public.gen_ref_code(); end if;
  return new;
end $$;
drop trigger if exists profiles_defaults on public.profiles;
create trigger profiles_defaults before insert on public.profiles for each row execute function public.profiles_defaults();

-- хто зараз менеджер / адмін (security definer — щоб не зациклювати RLS)
create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('manager','admin'))
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

-- ============ Налаштування ============
create table if not exists public.settings (
  key   text primary key,
  value text not null
);
insert into public.settings(key, value) values ('bonus_amount', '0') on conflict do nothing;
insert into public.settings(key, value) values ('bonus_base', '2000'), ('bonus_step', '200'), ('bonus_max', '4000') on conflict do nothing;

-- ============ Заявки кандидатів ============
create table if not exists public.leads (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  name          text not null,
  phone         text not null,
  vacancy_id    text,
  vacancy_title text,
  who           text,
  when_go       text,
  contact_mode  text,
  channel       text,
  note          text,
  source        text,
  page          text,
  lang          text,
  ref_raw       text,                       -- що прийшло в ?ref= (код або телефон)
  referrer_id   uuid references public.profiles(id) on delete set null,
  status        text not null default 'new' check (status in
                ('new','contacted','matched','departed','working','paid','rejected')),
  employer      text,
  start_date    date,
  manager_note  text,
  manager_id    uuid references public.profiles(id) on delete set null,
  bonus_paid    boolean not null default false
);
create index if not exists leads_status on public.leads(status);
create index if not exists leads_referrer on public.leads(referrer_id);

-- історія змін статусу
create table if not exists public.lead_events (
  id         bigserial primary key,
  lead_id    bigint not null references public.leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  actor_id   uuid references public.profiles(id) on delete set null,
  old_status text,
  new_status text,
  note       text
);

-- ============ Заявки від роботодавців ============
create table if not exists public.employer_leads (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  company      text not null,
  contact_name text,
  phone        text,
  email        text,
  country      text,
  city         text,
  workers      text,
  positions    text,
  start_when   text,
  note         text,
  lang         text,
  page         text,
  status       text not null default 'new' check (status in ('new','in_progress','contract','rejected')),
  manager_note text
);

-- ============ Баланс: рух коштів ============
create table if not exists public.ledger (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  lead_id    bigint references public.leads(id) on delete set null,
  kind       text not null check (kind in ('bonus','payout','adjust')),
  amount     integer not null,              -- грн; виплата — від'ємна сума
  note       text,
  created_by uuid references public.profiles(id) on delete set null
);
create unique index if not exists ledger_one_bonus_per_lead on public.ledger(lead_id) where kind = 'bonus';
create index if not exists ledger_user on public.ledger(user_id);

-- запити на виплату з кабінету
create table if not exists public.payout_requests (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  amount     integer not null check (amount > 0),
  contact    text,                           -- як зв'язатися для виплати
  status     text not null default 'new' check (status in ('new','done','rejected')),
  ledger_id  bigint references public.ledger(id) on delete set null
);

-- ============ Логіка ============
-- заявка: хто запросив (за кодом або за телефоном), чистимо службові поля від анонімів
create or replace function public.leads_before_insert() returns trigger language plpgsql security definer set search_path = public as $$
declare r text; d text;
begin
  if not public.is_staff() then
    new.status := 'new'; new.referrer_id := null; new.employer := null; new.start_date := null;
    new.manager_note := null; new.manager_id := null; new.bonus_paid := false;
  end if;
  r := lower(trim(coalesce(new.ref_raw, '')));
  if new.referrer_id is null and r <> '' then
    select id into new.referrer_id from public.profiles where ref_code = r;
    if new.referrer_id is null then
      d := regexp_replace(r, '\D', '', 'g');
      if length(d) >= 9 then
        select id into new.referrer_id from public.profiles
         where regexp_replace(coalesce(phone, ''), '\D', '', 'g') like '%' || right(d, 9) limit 1;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_before_insert on public.leads;
create trigger leads_before_insert before insert on public.leads for each row execute function public.leads_before_insert();

-- статус «paid» = відпрацював 2 тижні й оплату від роботодавця отримано → бонус тому, хто запросив
-- Бонус: перший друг у місяці — bonus_base (2000 грн), кожен наступний — +bonus_step (200 грн), не більше bonus_max (4000 грн).
-- Відлік щомісяця (за київським часом) починається знову.
create or replace function public.leads_after_update() returns trigger language plpgsql security definer set search_path = public as $$
declare amt int; base int; step int; mx int; n int;
begin
  if new.status is distinct from old.status then
    insert into public.lead_events(lead_id, actor_id, old_status, new_status) values (new.id, auth.uid(), old.status, new.status);
  end if;
  if new.status = 'paid' and old.status is distinct from 'paid' and new.referrer_id is not null then
    select coalesce((select nullif(value, '')::int from public.settings where key = 'bonus_base'), 2000) into base;
    select coalesce((select nullif(value, '')::int from public.settings where key = 'bonus_step'), 200) into step;
    select coalesce((select nullif(value, '')::int from public.settings where key = 'bonus_max'), 4000) into mx;
    select count(*) into n from public.ledger
      where user_id = new.referrer_id and kind = 'bonus'
        and date_trunc('month', created_at at time zone 'Europe/Kyiv') = date_trunc('month', now() at time zone 'Europe/Kyiv');
    amt := least(base + step * n, mx);
    if amt > 0 then
      insert into public.ledger(user_id, lead_id, kind, amount, note, created_by)
      values (new.referrer_id, new.id, 'bonus', amt, 'Бонус за ' || new.name, auth.uid())
      on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists leads_after_update on public.leads;
create trigger leads_after_update after update on public.leads for each row execute function public.leads_after_update();

create or replace function public.touch_updated() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads for each row execute function public.touch_updated();

-- ============ Для кабінету ============
-- мої запрошені: лише ім'я, дата й статус (телефони інших людей не показуємо)
create or replace function public.my_referrals()
returns table(id bigint, created_at timestamptz, name text, status text, bonus integer)
language sql stable security definer set search_path = public as $$
  select l.id, l.created_at,
         split_part(trim(l.name), ' ', 1) || coalesce(' ' || nullif(left(split_part(trim(l.name), ' ', 2), 1), '') || '.', ''),
         l.status,
         (select g.amount from public.ledger g where g.lead_id = l.id and g.kind = 'bonus' limit 1)
  from public.leads l where l.referrer_id = auth.uid()
  order by l.created_at desc
$$;

create or replace function public.my_balance()
returns table(balance integer, earned integer, paid integer, pending integer)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int,
         coalesce(sum(amount) filter (where kind = 'bonus'), 0)::int,
         coalesce(-sum(amount) filter (where kind = 'payout'), 0)::int,
         (select coalesce(sum(amount), 0)::int from public.payout_requests where user_id = auth.uid() and status = 'new')
  from public.ledger where user_id = auth.uid()
$$;

create or replace function public.request_payout(p_amount integer, p_contact text)
returns bigint language plpgsql security definer set search_path = public as $$
declare bal int; pend int; rid bigint;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select coalesce(sum(amount), 0) into bal from public.ledger where user_id = auth.uid();
  select coalesce(sum(amount), 0) into pend from public.payout_requests where user_id = auth.uid() and status = 'new';
  if p_amount is null or p_amount <= 0 or p_amount > bal - pend then raise exception 'amount exceeds balance'; end if;
  insert into public.payout_requests(user_id, amount, contact) values (auth.uid(), p_amount, left(p_contact, 200)) returning id into rid;
  return rid;
end $$;

-- ============ Для CRM ============
create or replace view public.user_balances with (security_invoker = true) as
  select p.id, p.first_name, p.last_name, p.tg_username, p.phone, p.ref_code, p.role, p.created_at,
         coalesce((select sum(amount) from public.ledger g where g.user_id = p.id), 0)::int as balance,
         coalesce((select sum(amount) from public.ledger g where g.user_id = p.id and g.kind = 'bonus'), 0)::int as earned,
         (select count(*) from public.leads l where l.referrer_id = p.id)::int as invited
  from public.profiles p;

-- виплата менеджером: запис у ledger + закриття запиту
create or replace function public.make_payout(p_user uuid, p_amount integer, p_note text, p_request bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare lid bigint;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  insert into public.ledger(user_id, kind, amount, note, created_by) values (p_user, 'payout', -abs(p_amount), p_note, auth.uid()) returning id into lid;
  if p_request is not null then update public.payout_requests set status = 'done', ledger_id = lid where id = p_request; end if;
  return lid;
end $$;

-- ============ Права доступу (RLS) ============
alter table public.profiles        enable row level security;
alter table public.settings        enable row level security;
alter table public.leads           enable row level security;
alter table public.lead_events     enable row level security;
alter table public.employer_leads  enable row level security;
alter table public.ledger          enable row level security;
alter table public.payout_requests enable row level security;

drop policy if exists p_self on public.profiles;
create policy p_self on public.profiles for select using (id = auth.uid() or public.is_staff());
drop policy if exists p_self_upd on public.profiles;
create policy p_self_upd on public.profiles for update using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- звичайний користувач не може сам собі змінити роль
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;   -- сервер (функція входу, SQL Editor)
  if new.role is distinct from old.role and not public.is_admin() then new.role := old.role; end if;
  if new.ref_code is distinct from old.ref_code and not public.is_admin() then new.ref_code := old.ref_code; end if;
  if new.tg_id is distinct from old.tg_id and not public.is_admin() then new.tg_id := old.tg_id; end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

drop policy if exists s_read on public.settings;
create policy s_read on public.settings for select using (key like 'bonus%' or public.is_staff());
drop policy if exists s_write on public.settings;
create policy s_write on public.settings for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists l_insert on public.leads;
create policy l_insert on public.leads for insert with check (true);
drop policy if exists l_staff on public.leads;
create policy l_staff on public.leads for select using (public.is_staff());
drop policy if exists l_staff_upd on public.leads;
create policy l_staff_upd on public.leads for update using (public.is_staff()) with check (public.is_staff());
drop policy if exists l_staff_del on public.leads;
create policy l_staff_del on public.leads for delete using (public.is_admin());

drop policy if exists le_staff on public.lead_events;
create policy le_staff on public.lead_events for select using (public.is_staff());

drop policy if exists e_insert on public.employer_leads;
create policy e_insert on public.employer_leads for insert with check (status = 'new' and manager_note is null);
drop policy if exists e_staff on public.employer_leads;
create policy e_staff on public.employer_leads for select using (public.is_staff());
drop policy if exists e_staff_upd on public.employer_leads;
create policy e_staff_upd on public.employer_leads for update using (public.is_staff()) with check (public.is_staff());

drop policy if exists g_read on public.ledger;
create policy g_read on public.ledger for select using (user_id = auth.uid() or public.is_staff());
drop policy if exists g_staff on public.ledger;
create policy g_staff on public.ledger for insert with check (public.is_staff() and kind in ('payout','adjust'));

drop policy if exists r_read on public.payout_requests;
create policy r_read on public.payout_requests for select using (user_id = auth.uid() or public.is_staff());
drop policy if exists r_staff on public.payout_requests;
create policy r_staff on public.payout_requests for update using (public.is_staff()) with check (public.is_staff());

grant usage on schema public to anon, authenticated;
grant insert on public.leads, public.employer_leads to anon, authenticated;
grant usage, select on sequence public.leads_id_seq, public.employer_leads_id_seq to anon, authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.settings to anon, authenticated;
grant insert, update, delete on public.settings to authenticated;
grant select, update, delete on public.leads to authenticated;
grant select on public.lead_events to authenticated;
grant select, update on public.employer_leads to authenticated;
grant select, insert on public.ledger to authenticated;
grant usage, select on sequence public.ledger_id_seq to authenticated;
grant select, update on public.payout_requests to authenticated;
grant select on public.user_balances to authenticated;
grant execute on function public.my_referrals(), public.my_balance(), public.request_payout(integer, text),
                          public.make_payout(uuid, integer, text, bigint), public.is_staff(), public.is_admin() to authenticated;
