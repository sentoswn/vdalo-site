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

-- анкета після першого входу
alter table public.profiles add column if not exists full_name    text;
alter table public.profiles add column if not exists city         text;
alter table public.profiles add column if not exists email        text;
alter table public.profiles add column if not exists heard_from   text;
alter table public.profiles add column if not exists manager_form jsonb;
alter table public.profiles add column if not exists consent_at   timestamptz;
alter table public.profiles add column if not exists onboarded_at timestamptz;

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
alter table public.leads add column if not exists traffic          text;         -- канал: manager, referral, social, seo, paid, direct, other, manual
alter table public.leads add column if not exists assigned_at      timestamptz;
alter table public.leads add column if not exists managers         uuid[] not null default '{}';  -- усі менеджери в роботі (перший = основний)  -- коли закріпили за менеджером
alter table public.leads add column if not exists first_contact_at timestamptz;  -- коли вперше змінили статус із «Нова заявка»
create index if not exists leads_status on public.leads(status);
update public.leads set managers = array[manager_id] where manager_id is not null and coalesce(array_length(managers, 1), 0) = 0;
create index if not exists leads_referrer on public.leads(referrer_id);
-- джерело залучення (app/track.js): ref:<код>, utm:<source>/<campaign>, ads:…, seo:…, site:…, direct; manual — додано в CRM
alter table public.leads add column if not exists src        text;
alter table public.leads add column if not exists visitor_id text;
alter table public.leads add column if not exists utm        jsonb;
create index if not exists leads_src on public.leads(src, created_at);

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
    new.manager_note := null; new.manager_id := null; new.managers := '{}'; new.bonus_paid := false;
    -- захист від спаму й «сміття»: обрізаємо довжину полів, номер має містити 9–15 цифр
    new.name := left(trim(new.name), 80); new.phone := left(trim(new.phone), 32);
    new.vacancy_id := left(new.vacancy_id, 40); new.vacancy_title := left(new.vacancy_title, 300);
    new.who := left(new.who, 40); new.when_go := left(new.when_go, 60); new.contact_mode := left(new.contact_mode, 40);
    new.channel := left(new.channel, 40); new.note := left(new.note, 1500); new.source := left(new.source, 120);
    new.page := left(new.page, 300); new.lang := left(new.lang, 5); new.ref_raw := left(new.ref_raw, 64);
    if length(regexp_replace(new.phone, '\D', '', 'g')) not between 9 and 15 then raise exception 'Невірний номер телефону'; end if;
    -- не більше 3 заявок з одного номера за 10 хвилин і не більше 40 анонімних заявок за 10 хвилин загалом
    if (select count(*) from public.leads where created_at > now() - interval '10 minutes'
          and right(regexp_replace(phone, '\D', '', 'g'), 9) = right(regexp_replace(new.phone, '\D', '', 'g'), 9)) >= 3
       or (select count(*) from public.leads where created_at > now() - interval '10 minutes' and manager_id is null) >= 40 then
      raise exception 'Забагато заявок, спробуйте трохи пізніше';
    end if;
  elsif not public.is_admin() then
    new.manager_id := auth.uid();              -- менеджер додає заявку — вона його
  end if;
  r := lower(trim(coalesce(new.ref_raw, '')));
  new.src := nullif(left(lower(trim(coalesce(new.src, ''))), 120), '');
  new.visitor_id := nullif(left(trim(coalesce(new.visitor_id, '')), 64), '');
  if pg_column_size(new.utm) > 2000 then new.utm := null; end if;
  if new.src is null and r <> '' then new.src := 'ref:' || case when r ~ '[a-z]' then r else regexp_replace(r, '\D', '', 'g') end; end if;
  if new.src is null and public.is_staff() then new.src := 'manual'; end if;
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
  -- прийшов за посиланням менеджера/власника → кандидат закріплюється за ним (бонус «Приведи друга» не нараховується)
  if new.referrer_id is not null and exists (select 1 from public.profiles where id = new.referrer_id and role in ('manager','admin')) then
    if new.manager_id is null then new.manager_id := new.referrer_id; end if;
    new.referrer_id := null;
    new.traffic := 'manager';
  elsif new.referrer_id is not null then
    new.traffic := 'referral';
  elsif public.is_staff() and coalesce(new.traffic, '') = '' then
    new.traffic := 'manual';
  elsif coalesce(new.traffic, '') not in ('social','seo','paid','direct','other') then
    new.traffic := 'direct';
  end if;
  new.first_contact_at := case when new.status <> 'new' then now() end;
  if new.manager_id is not null and not (new.manager_id = any(coalesce(new.managers, '{}'))) then new.managers := array[new.manager_id] || coalesce(new.managers, '{}'); end if;
  if new.manager_id is null and coalesce(array_length(new.managers, 1), 0) > 0 then new.manager_id := new.managers[1]; end if;
  new.assigned_at := case when new.manager_id is not null then now() end;
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

create or replace function public.leads_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.manager_id := old.manager_id;          -- перепризначати може лише власник
    new.managers := old.managers;
  end if;
  new.managers := coalesce(new.managers, '{}');
  if new.managers is distinct from old.managers or new.manager_id is distinct from old.manager_id then
    if coalesce(array_length(new.managers, 1), 0) = 0 then
      if new.manager_id is not null and new.managers is not distinct from old.managers then new.managers := array[new.manager_id];
      else new.manager_id := null; end if;
    elsif new.manager_id is null or not (new.manager_id = any(new.managers)) then
      new.manager_id := new.managers[1];
    end if;
  end if;
  -- час реакції: рахує база, підробити не можна
  new.assigned_at := case when new.manager_id is distinct from old.manager_id then (case when new.manager_id is not null then now() end) else old.assigned_at end;
  new.first_contact_at := coalesce(old.first_contact_at, case when old.status = 'new' and new.status <> 'new' then now() end);
  return new;
end $$;
drop trigger if exists leads_guard on public.leads;
create trigger leads_guard before update on public.leads for each row execute function public.leads_guard();

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
drop view if exists public.user_balances;
create view public.user_balances with (security_invoker = true) as
  select p.id, p.first_name, p.last_name, p.tg_username, p.phone, p.ref_code, p.role, p.created_at,
         p.full_name, p.city, p.email, p.heard_from, p.manager_form, p.onboarded_at,
         coalesce((select sum(amount) from public.ledger g where g.user_id = p.id), 0)::int as balance,
         coalesce((select sum(amount) from public.ledger g where g.user_id = p.id and g.kind = 'bonus'), 0)::int as earned,
         (select count(*) from public.leads l where l.referrer_id = p.id)::int as invited
  from public.profiles p;

-- виплата менеджером: запис у ledger + закриття запиту
create or replace function public.make_payout(p_user uuid, p_amount integer, p_note text, p_request bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare lid bigint;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  insert into public.ledger(user_id, kind, amount, note, created_by) values (p_user, 'payout', -abs(p_amount), p_note, auth.uid()) returning id into lid;
  if p_request is not null then update public.payout_requests set status = 'done', ledger_id = lid where id = p_request; end if;
  return lid;
end $$;

-- ============ Задачі (нагадування) ============
create table if not exists public.tasks (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  title       text not null,
  note        text,
  due_at      timestamptz,
  lead_id     bigint references public.leads(id) on delete cascade,
  assignee_id uuid references public.profiles(id) on delete set null,
  created_by  uuid references public.profiles(id) on delete set null,
  done_at     timestamptz
);
create index if not exists tasks_assignee on public.tasks(assignee_id, done_at);

create or replace function public.tasks_defaults() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    if new.assignee_id is null or not public.is_admin() then new.assignee_id := auth.uid(); end if;
  elsif not public.is_admin() then
    new.assignee_id := old.assignee_id;
  end if;
  return new;
end $$;
drop trigger if exists tasks_defaults on public.tasks;
create trigger tasks_defaults before insert or update on public.tasks for each row execute function public.tasks_defaults();

-- ============ Права доступу (RLS) ============
alter table public.profiles        enable row level security;
alter table public.settings        enable row level security;
alter table public.leads           enable row level security;
alter table public.lead_events     enable row level security;
alter table public.employer_leads  enable row level security;
alter table public.ledger          enable row level security;
alter table public.payout_requests enable row level security;

drop policy if exists p_self on public.profiles;
create policy p_self on public.profiles for select using (id = auth.uid() or public.is_admin()
  or (public.is_staff() and role in ('manager','admin')));
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
create policy l_staff on public.leads for select using (public.is_admin() or (public.is_staff() and (manager_id = auth.uid() or auth.uid() = any(managers))));
drop policy if exists l_staff_upd on public.leads;
create policy l_staff_upd on public.leads for update using (public.is_admin() or (public.is_staff() and (manager_id = auth.uid() or auth.uid() = any(managers)))) with check (public.is_staff());
drop policy if exists l_staff_del on public.leads;
create policy l_staff_del on public.leads for delete using (public.is_admin());

drop policy if exists le_staff on public.lead_events;
create policy le_staff on public.lead_events for select using (public.is_admin() or exists (select 1 from public.leads l where l.id = lead_id and (l.manager_id = auth.uid() or auth.uid() = any(l.managers))));

drop policy if exists e_insert on public.employer_leads;
create policy e_insert on public.employer_leads for insert with check (status = 'new' and manager_note is null);
drop policy if exists e_staff on public.employer_leads;
create policy e_staff on public.employer_leads for select using (public.is_admin());
drop policy if exists e_staff_upd on public.employer_leads;
create policy e_staff_upd on public.employer_leads for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists g_read on public.ledger;
create policy g_read on public.ledger for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists g_staff on public.ledger;
create policy g_staff on public.ledger for insert with check (public.is_admin() and kind in ('payout','adjust'));

drop policy if exists r_read on public.payout_requests;
create policy r_read on public.payout_requests for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists r_staff on public.payout_requests;
create policy r_staff on public.payout_requests for update using (public.is_admin()) with check (public.is_admin());

alter table public.tasks enable row level security;
drop policy if exists t_read on public.tasks;
create policy t_read on public.tasks for select using (public.is_admin() or (public.is_staff() and assignee_id = auth.uid()));
drop policy if exists t_ins on public.tasks;
create policy t_ins on public.tasks for insert with check (public.is_staff());
drop policy if exists t_upd on public.tasks;
create policy t_upd on public.tasks for update using (public.is_admin() or (public.is_staff() and assignee_id = auth.uid())) with check (public.is_staff());
drop policy if exists t_del on public.tasks;
create policy t_del on public.tasks for delete using (public.is_admin() or (public.is_staff() and created_by = auth.uid()));

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
grant select, insert, update, delete on public.tasks to authenticated;
grant usage, select on sequence public.tasks_id_seq to authenticated;
grant execute on function public.my_referrals(), public.my_balance(), public.request_payout(integer, text),
                          public.make_payout(uuid, integer, text, bigint), public.is_staff(), public.is_admin() to authenticated;


-- ============ Джерела залучення: відвідувачі, заявки, конверсія ============
-- візити: один рядок на сесію й джерело; visitor_id — випадковий анонімний ID браузера
create table if not exists public.visits (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  visitor_id text not null,
  src        text not null,
  utm        jsonb,
  landing    text,
  referrer   text,
  lang       text
);
create index if not exists visits_src_time on public.visits(src, created_at);
create index if not exists visits_vid_time on public.visits(visitor_id, created_at);

-- назви джерел (напр. Telegram-група) — задає власник у CRM → «Джерела»
create table if not exists public.traffic_sources (
  key        text primary key,
  name       text,
  tg_group   text,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- запис візиту з сайту (анонімно). Повтор того самого відвідувача й джерела протягом 30 хв ігнорується.
create or replace function public.track_visit(p_vid text, p_src text, p_utm jsonb default null, p_landing text default null,
                                              p_referrer text default null, p_lang text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s text := left(lower(trim(coalesce(p_src, ''))), 120);
begin
  if coalesce(p_vid, '') !~ '^[A-Za-z0-9-]{8,64}$' or s = '' then return; end if;
  if exists (select 1 from public.visits where visitor_id = p_vid and src = s and created_at > now() - interval '30 minutes') then return; end if;
  insert into public.visits(visitor_id, src, utm, landing, referrer, lang)
  values (p_vid, s, case when pg_column_size(p_utm) <= 2000 then p_utm end, left(p_landing, 300), left(p_referrer, 200), left(p_lang, 5));
end $$;

-- назва за замовчуванням для ref:<код> — ім'я власника посилання
create or replace function public.src_auto_name(p_key text) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(p.full_name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), '@' || p.tg_username)
         || case p.role when 'manager' then ' (менеджер)' when 'admin' then ' (власник)' else '' end
  from public.profiles p where public.is_admin() and p_key like 'ref:%' and p.ref_code = substr(p_key, 5) limit 1
$$;

-- зведення по джерелах за період [p_from, p_to): унікальні відвідувачі, візити, заявки, працевлаштовані, конверсія
create or replace function public.source_stats(p_from timestamptz, p_to timestamptz)
returns table(src text, name text, tg_group text, note text, auto_name text, visitors bigint, sessions bigint,
              leads bigint, lead_visitors bigint, hired bigint, conversion numeric, first_visit timestamptz, last_visit timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (
    select x.src, count(distinct x.visitor_id) as visitors, count(*) as sessions, min(x.created_at) as f, max(x.created_at) as l
    from public.visits x where x.created_at >= p_from and x.created_at < p_to group by x.src
  ), l as (
    select coalesce(y.src, 'unknown') as src, count(*) as leads, count(distinct y.visitor_id) as lv,
           count(*) filter (where y.status in ('departed','working','paid')) as hired
    from public.leads y where y.created_at >= p_from and y.created_at < p_to group by 1
  ), k as (
    select v.src from v union select l.src from l union select t.key from public.traffic_sources t
  )
  select k.src, t.name, t.tg_group, t.note, public.src_auto_name(k.src),
         coalesce(v.visitors, 0), coalesce(v.sessions, 0), coalesce(l.leads, 0), coalesce(l.lv, 0), coalesce(l.hired, 0),
         case when coalesce(v.visitors, 0) > 0 then round(coalesce(l.leads, 0)::numeric * 100 / v.visitors, 2) end,
         v.f, v.l
  from k left join v on v.src = k.src left join l on l.src = k.src left join public.traffic_sources t on t.key = k.src
  where public.is_admin()
  order by coalesce(l.leads, 0) desc, coalesce(v.visitors, 0) desc, k.src
$$;

-- по днях (Київ) — для графіка й експорту
create or replace function public.source_daily(p_from timestamptz, p_to timestamptz)
returns table(day date, src text, visitors bigint, leads bigint)
language sql stable security definer set search_path = public as $$
  with v as (
    select (x.created_at at time zone 'Europe/Kyiv')::date as d, x.src, count(distinct x.visitor_id) as n
    from public.visits x where x.created_at >= p_from and x.created_at < p_to group by 1, 2
  ), l as (
    select (y.created_at at time zone 'Europe/Kyiv')::date as d, coalesce(y.src, 'unknown') as src, count(*) as n
    from public.leads y where y.created_at >= p_from and y.created_at < p_to group by 1, 2
  )
  select coalesce(v.d, l.d), coalesce(v.src, l.src), coalesce(v.n, 0), coalesce(l.n, 0)
  from v full join l on l.d = v.d and l.src = v.src
  where public.is_admin()
  order by 1, 2
$$;

create or replace function public.traffic_sources_touch() returns trigger language plpgsql as $$
begin new.key := left(lower(trim(new.key)), 120); new.updated_at := now(); return new; end $$;
drop trigger if exists traffic_sources_touch on public.traffic_sources;
create trigger traffic_sources_touch before insert or update on public.traffic_sources for each row execute function public.traffic_sources_touch();

alter table public.visits          enable row level security;
alter table public.traffic_sources enable row level security;
drop policy if exists v_admin on public.visits;
create policy v_admin on public.visits for select using (public.is_admin());
drop policy if exists ts_admin on public.traffic_sources;
create policy ts_admin on public.traffic_sources for all using (public.is_admin()) with check (public.is_admin());

revoke all on public.visits from anon;
grant select on public.visits to authenticated;
grant select, insert, update, delete on public.traffic_sources to authenticated;
grant execute on function public.track_visit(text, text, jsonb, text, text, text) to anon, authenticated;
grant execute on function public.source_stats(timestamptz, timestamptz), public.source_daily(timestamptz, timestamptz),
                          public.src_auto_name(text) to authenticated;

-- ============ Робочий час команди (присутність у CRM, сповіщення власникам) ============
alter table public.profiles add column if not exists last_seen_at timestamptz;
create table if not exists public.work_log (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  day           date not null,                 -- київська дата
  first_seen    timestamptz,
  last_seen     timestamptz,
  active_min    int not null default 0,        -- хвилини активної роботи в CRM
  late_alert_at timestamptz,
  idle_alert_at timestamptz,
  idle_alerts   int not null default 0,
  primary key (user_id, day)
);
insert into public.settings(key, value) values ('work_start', '10:00'), ('work_end', '17:00'), ('work_days', '1,2,3,4,5'),
  ('idle_min', '45'), ('late_min', '30') on conflict do nothing;

-- Пінг із CRM раз на хвилину, поки менеджер активний на сторінці
create or replace function public.crm_ping() returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); d date := (now() at time zone 'Europe/Kyiv')::date;
begin
  if u is null or not public.is_staff() then return; end if;
  insert into public.work_log as w (user_id, day, first_seen, last_seen, active_min) values (u, d, now(), now(), 1)
  on conflict (user_id, day) do update set
    first_seen    = coalesce(w.first_seen, now()),
    active_min    = w.active_min + case when w.last_seen is null or w.last_seen < now() - interval '50 seconds' then 1 else 0 end,
    last_seen     = case when w.last_seen is null or w.last_seen < now() - interval '50 seconds' then now() else w.last_seen end,
    idle_alert_at = null;
  update public.profiles set last_seen_at = now() where id = u and (last_seen_at is null or last_seen_at < now() - interval '50 seconds');
end $$;

-- Перевірка для сповіщень (викликає лише сервер — GitHub Actions через SUPABASE_DB_URL)
create or replace function public.work_alerts() returns table(chat bigint, msg text)
language plpgsql security definer set search_path = public as $$
declare
  t timestamp := now() at time zone 'Europe/Kyiv'; d date := t::date;
  ws time; we time; idle int; late int; days text; txt text := ''; r record; sent text;
  tz text := 'Europe/Kyiv';
begin
  select coalesce((select value from settings where key = 'work_start'), '10:00')::time into ws;
  select coalesce((select value from settings where key = 'work_end'), '17:00')::time into we;
  select coalesce((select nullif(value, '')::int from settings where key = 'idle_min'), 45) into idle;
  select coalesce((select nullif(value, '')::int from settings where key = 'late_min'), 30) into late;
  select coalesce((select value from settings where key = 'work_days'), '1,2,3,4,5') into days;
  if not (extract(isodow from d)::text = any(string_to_array(replace(days, ' ', ''), ','))) then return; end if;

  if t::time >= ws and t::time < we then
    -- не почав роботу
    for r in select p.id, coalesce(nullif(p.full_name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), '@' || p.tg_username) as nm
             from profiles p left join work_log w on w.user_id = p.id and w.day = d
             where p.role = 'manager' and w.first_seen is null and w.late_alert_at is null and t::time >= ws + make_interval(mins => late) loop
      insert into work_log as w (user_id, day, late_alert_at) values (r.id, d, now())
        on conflict (user_id, day) do update set late_alert_at = now();
      txt := txt || '• ' || r.nm || ' — досі не з’явився(лась) у CRM (робочий день з ' || to_char(ws, 'HH24:MI') || ')' || chr(10);
    end loop;
    -- довго неактивний
    for r in select p.id, coalesce(nullif(p.full_name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), '@' || p.tg_username) as nm, w.last_seen
             from profiles p join work_log w on w.user_id = p.id and w.day = d
             where p.role = 'manager' and w.first_seen is not null and w.idle_alert_at is null
               and w.last_seen < now() - make_interval(mins => idle) loop
      update work_log set idle_alert_at = now(), idle_alerts = idle_alerts + 1 where user_id = r.id and day = d;
      txt := txt || '• ' || r.nm || ' — не працює в CRM уже ' || floor(extract(epoch from now() - r.last_seen) / 60)::int || ' хв (востаннє о '
             || to_char(r.last_seen at time zone tz, 'HH24:MI') || ')' || chr(10);
    end loop;
    if txt <> '' then txt := 'Увага, команда «Вдало»:' || chr(10) || txt; end if;
  elsif t::time >= we and t::time < we + interval '3 hours' then
    select value into sent from settings where key = 'work_summary_day';
    if sent is distinct from d::text then
      insert into settings(key, value) values ('work_summary_day', d::text) on conflict (key) do update set value = excluded.value;
      for r in select coalesce(nullif(p.full_name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), '@' || p.tg_username) as nm,
                      w.first_seen, w.last_seen, coalesce(w.active_min, 0) as am, coalesce(w.idle_alerts, 0) as ia,
                      (select count(*) from lead_events e where e.actor_id = p.id and (e.created_at at time zone tz)::date = d) as ev,
                      (select count(*) from tasks k where k.assignee_id = p.id and (k.done_at at time zone tz)::date = d) as tk
               from profiles p left join work_log w on w.user_id = p.id and w.day = d
               where p.role = 'manager' order by 1 loop
        txt := txt || '• ' || r.nm || ': ' || case when r.first_seen is null then 'не заходив(ла) у CRM'
          else to_char(r.first_seen at time zone tz, 'HH24:MI') || '–' || to_char(r.last_seen at time zone tz, 'HH24:MI')
               || ', активно ' || (r.am / 60) || ' год ' || (r.am % 60) || ' хв, змін статусів: ' || r.ev || ', задач виконано: ' || r.tk
               || case when r.ia > 0 then ', простоїв: ' || r.ia else '' end end || chr(10);
      end loop;
      if txt <> '' then txt := 'Підсумок робочого дня ' || to_char(d, 'DD.MM') || ':' || chr(10) || txt; end if;
    end if;
  end if;

  if txt = '' then return; end if;
  return query select p.tg_id, txt from profiles p where p.role = 'admin' and p.tg_id is not null;
end $$;

alter table public.work_log enable row level security;
drop policy if exists wl_read on public.work_log;
create policy wl_read on public.work_log for select using (public.is_admin() or user_id = auth.uid());
revoke all on public.work_log from anon;
grant select on public.work_log to authenticated;
revoke all on function public.crm_ping() from public, anon;
grant execute on function public.crm_ping() to authenticated;
revoke all on function public.work_alerts() from public, anon, authenticated;

-- ============ Оплата за кандидата по вакансіях (бачать і змінюють лише власники) ============
-- pay_auto — щоденно з Trello (множник × ставка), pay_manual — вписано вручну в CRM (має пріоритет).
create table if not exists public.vacancy_pay (
  id          text primary key,
  src         text,
  pay_auto    integer,
  pay_manual  integer,
  note        text,
  updated_at  timestamptz not null default now()
);
alter table public.vacancy_pay enable row level security;
drop policy if exists vp_admin on public.vacancy_pay;
create policy vp_admin on public.vacancy_pay for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.vacancy_pay to authenticated;
alter table public.vacancy_pay add column if not exists promo_pay   integer;   -- акція (напр. з повідомлення оператора)
alter table public.vacancy_pay add column if not exists promo_until date;      -- до якої дати діє акція (включно)
alter table public.vacancy_pay add column if not exists promo_note  text;
alter table public.vacancy_pay add column if not exists promo2_pay   integer;   -- друга сходинка акції («далі 1300 zł до 30.11»)
alter table public.vacancy_pay add column if not exists promo2_until date;
alter table public.vacancy_pay add column if not exists bonus_note  text;      -- додаткові бонуси оператора за умови (обсяг стартів тощо) — з CRM
-- Фактична сума: діюча акція → вписано вручну → автоматично.
create or replace function public.vacancy_pay_eff(v public.vacancy_pay) returns integer language sql stable as $$
  select case when v.promo_pay is not null and (v.promo_until is null or v.promo_until >= (now() at time zone 'Europe/Kyiv')::date)
              then v.promo_pay
              when v.promo2_pay is not null and (v.promo2_until is null or v.promo2_until >= (now() at time zone 'Europe/Kyiv')::date)
              then v.promo2_pay
              else coalesce(v.pay_manual, v.pay_auto) end
$$;
-- Менеджерам — лише порядок вакансій за вигідністю, без сум.
drop function if exists public.vacancy_pay_rank();
-- Менеджерам: порядок і їхній бонус — 5% від нашої суми, округлено до 5 zł (саму нашу суму не видно).
create or replace function public.vacancy_pay_rank() returns table(id text, rnk integer, bonus integer)
language sql stable security definer set search_path = public as $$
  select v.id, (row_number() over (order by public.vacancy_pay_eff(v) desc, (v.bonus_note is not null) desc, length(v.id), v.id))::int,
         (round(public.vacancy_pay_eff(v) * 0.05 / 5) * 5)::int
  from public.vacancy_pay v
  where public.is_staff() and public.vacancy_pay_eff(v) is not null
$$;
revoke all on function public.vacancy_pay_rank() from public, anon;
grant execute on function public.vacancy_pay_rank() to authenticated;
-- Сайту — лише порядок (без сум), щоб гарячі вакансії йшли від найвигіднішої. Хто відкриє — бачить тільки номери й місця.
create or replace function public.hot_order() returns table(id text, rnk integer)
language sql stable security definer set search_path = public as $$
  select v.id, (row_number() over (order by public.vacancy_pay_eff(v) desc, (v.bonus_note is not null) desc, length(v.id), v.id))::int
  from public.vacancy_pay v where public.vacancy_pay_eff(v) is not null
$$;
grant execute on function public.hot_order() to anon, authenticated;
-- Щоденне завантаження сум із задачі оновлення вакансій (без входу в CRM): лише з секретним ключем.
-- Тут зберігається тільки SHA-256 ключа; сам ключ — у налаштуваннях задачі.
create extension if not exists pgcrypto with schema extensions;
create or replace function public.sync_vacancy_pay(p_token text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_token is null or encode(extensions.digest(p_token, 'sha256'), 'hex') <> '2d1636c057882351667c4a6fec09ed0112682f339afb4ecf0d5a378a68a7f15e' then raise exception 'forbidden'; end if;
  insert into public.vacancy_pay(id, src, pay_auto, updated_at)
    select x->>0, coalesce(x->>2, 'trello'), nullif(x->>1, '')::int, now() from jsonb_array_elements(p_rows) x where x->>0 is not null
  on conflict (id) do update set pay_auto = excluded.pay_auto, src = excluded.src, updated_at = now();
  update public.vacancy_pay v set promo_pay = (x->>3)::int, promo_until = nullif(x->>4, '')::date,
         promo2_pay = nullif(x->>5, '')::int, promo2_until = nullif(x->>6, '')::date
    from jsonb_array_elements(p_rows) x where v.id = x->>0 and jsonb_array_length(x) > 3 and x->>3 is not null;
  return jsonb_array_length(p_rows);
end $$;
revoke all on function public.sync_vacancy_pay(text, jsonb) from public;
grant execute on function public.sync_vacancy_pay(text, jsonb) to anon, authenticated;

-- ============ Чат співробітників: загальний чат («all») і особисті («dm:<uuid>:<uuid>») ============
create table if not exists public.chat_messages (
  id          bigserial primary key,
  room        text not null,
  sender_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists chat_messages_room on public.chat_messages(room, created_at desc);
create or replace function public.chat_can(p_room text) returns boolean language sql stable as $$
  select public.is_staff() and (p_room = 'all' or (p_room like 'dm:%' and position(auth.uid()::text in p_room) > 0))
$$;
alter table public.chat_messages enable row level security;
drop policy if exists chat_sel on public.chat_messages;
create policy chat_sel on public.chat_messages for select using (public.chat_can(room));
drop policy if exists chat_ins on public.chat_messages;
create policy chat_ins on public.chat_messages for insert with check (public.chat_can(room) and sender_id = auth.uid());
drop policy if exists chat_del on public.chat_messages;
create policy chat_del on public.chat_messages for delete using (sender_id = auth.uid() or public.is_admin());
grant select, insert, delete on public.chat_messages to authenticated;
grant usage, select on sequence public.chat_messages_id_seq to authenticated;

create table if not exists public.chat_reads (
  user_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  room      text not null,
  last_id   bigint not null default 0,
  primary key (user_id, room)
);
alter table public.chat_reads enable row level security;
drop policy if exists chat_reads_own on public.chat_reads;
create policy chat_reads_own on public.chat_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.chat_reads to authenticated;

-- Хто є в чаті (усі менеджери й власники) — менеджерам теж потрібен цей список
create or replace function public.chat_people() returns table(id uuid, name text, tg_username text, role text, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), p.tg_username, 'Співробітник'),
         p.tg_username, p.role, p.last_seen_at
  from public.profiles p where public.is_staff() and p.role in ('manager', 'admin') order by p.role desc, 2
$$;
grant execute on function public.chat_people() to authenticated;

-- Скільки непрочитаних у кожній кімнаті
create or replace function public.chat_unread() returns table(room text, n integer, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.room, count(*) filter (where m.id > coalesce(r.last_id, 0) and m.sender_id <> auth.uid())::int, max(m.created_at)
  from public.chat_messages m left join public.chat_reads r on r.user_id = auth.uid() and r.room = m.room
  where public.chat_can(m.room) group by m.room
$$;
grant execute on function public.chat_unread() to authenticated;

-- Нові повідомлення — одразу в CRM (Realtime)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_messages') then
    execute 'alter publication supabase_realtime add table public.chat_messages';
  end if;
end $$;

-- ============ Пошта info@vdalo-robota.com.ua в CRM (Resend): бачать і пишуть лише власники ============
create table if not exists public.app_secrets (key text primary key, value text not null, updated_at timestamptz not null default now());
alter table public.app_secrets enable row level security;   -- політик немає: читає лише service role (функції)
revoke all on public.app_secrets from anon, authenticated;
create or replace function public.set_secret(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_key not in ('resend_api_key', 'meta_page_token') then raise exception 'unknown key'; end if;
  insert into public.app_secrets(key, value, updated_at) values (p_key, trim(p_value), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;
create or replace function public.has_secret(p_key text) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and exists (select 1 from public.app_secrets where key = p_key and value <> '')
$$;
grant execute on function public.set_secret(text, text), public.has_secret(text) to authenticated;

create table if not exists public.mail_messages (
  id          bigserial primary key,
  dir         text not null check (dir in ('in', 'out')),
  resend_id   text unique,
  message_id  text,
  in_reply_to text,
  from_addr   text,
  from_name   text,
  to_addr     text,
  subject     text,
  text_body   text,
  html_body   text,
  sent_by     uuid references public.profiles(id) on delete set null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists mail_messages_created on public.mail_messages(created_at desc);
alter table public.mail_messages enable row level security;
drop policy if exists mail_admin on public.mail_messages;
create policy mail_admin on public.mail_messages for select using (public.is_admin());
drop policy if exists mail_admin_upd on public.mail_messages;
create policy mail_admin_upd on public.mail_messages for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists mail_admin_del on public.mail_messages;
create policy mail_admin_del on public.mail_messages for delete using (public.is_admin());
grant select, update, delete on public.mail_messages to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'mail_messages') then
    execute 'alter publication supabase_realtime add table public.mail_messages';
  end if;
end $$;


-- ============ Заявки з форм Facebook/Instagram (Lead Ads) → CRM + Telegram ============
-- Функція meta-leads забирає нові заявки через Graph API (ключ сторінки в app_secrets.meta_page_token).
alter table public.leads add column if not exists ext_id text;          -- fb:<id заявки> — щоб не було дублів
create unique index if not exists leads_ext_id on public.leads(ext_id) where ext_id is not null;
-- Заявки з форм, які вже забрали хоч раз. Видалена в CRM заявка не повертається при наступному опитуванні.
create table if not exists public.meta_seen (ext_id text primary key, seen_at timestamptz not null default now());
alter table public.meta_seen enable row level security;   -- політик немає: лише service role (функція meta-leads)
revoke all on public.meta_seen from anon, authenticated;
insert into public.meta_seen(ext_id) select ext_id from public.leads where ext_id like 'fb:%' on conflict do nothing;
-- кожні 2 хвилини викликаємо функцію (pg_cron + pg_net)
do $$
begin
  create extension if not exists pg_cron;
  create extension if not exists pg_net;
  perform cron.unschedule(jobid) from cron.job where jobname = 'meta-leads';
  perform cron.schedule('meta-leads', '*/2 * * * *',
    $j$ select net.http_post(url := 'https://paifsxbbdnnctspowizy.supabase.co/functions/v1/meta-leads',
         headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) $j$);
exception when others then
  raise notice 'pg_cron/pg_net недоступні: %', sqlerrm;
end $$;

-- проміжні статуси: «Чекає дзвінка», «Ведеться діалог (Viber / Telegram)» і «Зідзвонились — чекає вакансію»
alter table public.leads drop constraint if exists leads_status_check;
alter table public.leads add constraint leads_status_check check (status in
  ('new','call','contacted','dialog','waiting','matched','departed','working','paid','rejected'));

-- коли востаннє змінювали статус (у CRM: «без змін 3 год» — червоне)
alter table public.leads add column if not exists status_at timestamptz;
update public.leads set status_at = coalesce(first_contact_at, created_at) where status_at is null;
alter table public.leads alter column status_at set default now();
create or replace function public.leads_status_at() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.status_at := coalesce(new.status_at, now());
  elsif new.status is distinct from old.status then new.status_at := now(); end if;
  return new;
end $$;
drop trigger if exists leads_status_at on public.leads;
create trigger leads_status_at before insert or update on public.leads for each row execute function public.leads_status_at();

-- «Свій статус» — вільний текст поверх основного статусу (напр. «Чекає паспорт»)
alter table public.leads add column if not exists status_note text;
create or replace function public.leads_status_at() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.status_at := coalesce(new.status_at, now());
  elsif new.status is distinct from old.status or new.status_note is distinct from old.status_note then new.status_at := now(); end if;
  new.status_note := nullif(left(trim(coalesce(new.status_note, '')), 80), '');
  return new;
end $$;

-- ============ Пакет задач «Новий кандидат» — автоматично на кожну нову заявку ============
-- (задачі з тригера: auth.uid() порожній → залишаємо виконавця, якого передав тригер; анонім напряму задачі створити не може — RLS t_ins)
create or replace function public.tasks_defaults() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then return new; end if;
    new.created_by := auth.uid();
    if new.assignee_id is null or not public.is_admin() then new.assignee_id := auth.uid(); end if;
  elsif auth.uid() is not null and not public.is_admin() then
    new.assignee_id := old.assignee_id;
  end if;
  return new;
end $$;

create or replace function public.lead_start_tasks(lid bigint, who uuid, t0 timestamptz default now()) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.tasks(title, lead_id, assignee_id, due_at, note) values
    ('Зателефонувати / написати', lid, who, t0 + interval '15 minutes', 'Набір «Новий кандидат»'),
    ('Надіслати 2–3 вакансії',    lid, who, t0 + interval '2 hours',    'Набір «Новий кандидат»'),
    ('Нагадати, якщо не відповів', lid, who, ((t0 at time zone 'Europe/Kyiv')::date + 1 + time '10:00') at time zone 'Europe/Kyiv', 'Набір «Новий кандидат»');
end $$;
revoke all on function public.lead_start_tasks(bigint, uuid, timestamptz) from public, anon, authenticated;

create or replace function public.leads_after_insert() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.lead_start_tasks(new.id, new.manager_id, now());
  return new;
end $$;
drop trigger if exists leads_after_insert on public.leads;
create trigger leads_after_insert after insert on public.leads for each row execute function public.leads_after_insert();

-- призначили / змінили менеджера → його відкриті задачі по кандидату переходять до нового менеджера
create or replace function public.leads_tasks_follow_mgr() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.manager_id is distinct from old.manager_id and new.manager_id is not null then
    update public.tasks set assignee_id = new.manager_id
     where lead_id = new.id and done_at is null and (assignee_id is null or assignee_id is not distinct from old.manager_id);
  end if;
  return new;
end $$;
drop trigger if exists leads_tasks_follow_mgr on public.leads;
create trigger leads_tasks_follow_mgr after update on public.leads for each row execute function public.leads_tasks_follow_mgr();

-- один раз: пакет для нових заявок (статус «Нова заявка», без жодної задачі)
do $$
begin
  if not exists (select 1 from public.settings where key = 'start_tasks_backfill') then
    perform public.lead_start_tasks(l.id, l.manager_id, now())
       from public.leads l where l.status = 'new' and not exists (select 1 from public.tasks t where t.lead_id = l.id);
    insert into public.settings(key, value) values ('start_tasks_backfill', now()::text);
  end if;
end $$;
