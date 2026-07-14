-- ============================================================
-- اسکیمای دیتابیس لیگ اتحاد برای Supabase (Postgres)
-- این فایل را در Supabase Dashboard > SQL Editor اجرا کنید (یک‌بار کافی است)
-- جایگزین firestore.rules و storage.rules نسخه‌ی قبلی (Firebase) است
-- ============================================================

-- ---------- افزونه‌ی لازم برای uuid ----------
create extension if not exists "pgcrypto";

-- ---------- تابع تشخیص مدیر ----------
-- به‌جای REPLACE_WITH_ADMIN_UID نسخه‌ی قبلی، همان UID مدیر را اینجا وارد کنید
-- (بعد از ساخت حساب مدیر در Authentication > Users)
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select auth.uid() = 'REPLACE_WITH_ADMIN_UID'::uuid;
$$;

-- ============================================================
-- جدول‌ها
-- ============================================================

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text,
  founded_year int,
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  team_id uuid references public.teams(id) on delete cascade,
  team_name text,
  shirt_number int not null,
  position text not null,
  photo_url text,
  stats jsonb not null default '{"matches":0,"goals":0,"assists":0,"yellowCards":0,"redCards":0}',
  auth_uid uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  home_team_id uuid references public.teams(id) on delete cascade,
  away_team_id uuid references public.teams(id) on delete cascade,
  home_team_name text,
  away_team_name text,
  home_team_logo text,
  away_team_logo text,
  date date not null,
  time time not null,
  venue text,
  status text not null default 'scheduled', -- scheduled | finished | postponed
  home_score int,
  away_score int,
  goals jsonb not null default '[]',
  cards jsonb not null default '[]',
  lineup jsonb not null default '[]',
  man_of_the_match_id uuid,
  man_of_the_match_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  image_url text,
  type text not null default 'news', -- news | announcement
  created_at timestamptz not null default now()
);

-- نگاشت حساب Auth بازیکن به پروفایل او (جایگزین playerLinks در Firestore)
create table if not exists public.player_links (
  auth_uid uuid primary key,
  player_id uuid references public.players(id) on delete cascade
);

-- ============================================================
-- فعال‌سازی Row Level Security
-- ============================================================
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.matches enable row level security;
alter table public.news enable row level security;
alter table public.player_links enable row level security;

-- خواندن عمومی برای همه (مثل allow read: if true در Firestore)
create policy "teams_public_read" on public.teams for select using (true);
create policy "players_public_read" on public.players for select using (true);
create policy "matches_public_read" on public.matches for select using (true);
create policy "news_public_read" on public.news for select using (true);

-- نوشتن فقط برای مدیر
create policy "teams_admin_write" on public.teams for all using (is_admin()) with check (is_admin());
create policy "players_admin_write" on public.players for all using (is_admin()) with check (is_admin());
create policy "matches_admin_write" on public.matches for all using (is_admin()) with check (is_admin());
create policy "news_admin_write" on public.news for all using (is_admin()) with check (is_admin());

-- player_links: هر بازیکن فقط سند خودش را می‌بیند، فقط مدیر می‌نویسد
create policy "player_links_self_read" on public.player_links for select using (auth.uid() = auth_uid);
create policy "player_links_admin_write" on public.player_links for all using (is_admin()) with check (is_admin());

-- ============================================================
-- تابع اتمیک ثبت نتیجه‌ی مسابقه
-- (جایگزین تراکنش Firestore در submitMatchResult سمت کلاینت)
-- ============================================================
create or replace function public.submit_match_result(
  p_match_id uuid,
  p_home_score int,
  p_away_score int,
  p_goals jsonb,
  p_cards jsonb,
  p_lineup jsonb,
  p_motm_id uuid,
  p_motm_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record;
  v_was_finished boolean;
  g jsonb;
  c jsonb;
  pid uuid;
begin
  if not is_admin() then
    raise exception 'دسترسی غیرمجاز: فقط مدیر می‌تواند نتیجه ثبت کند';
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    raise exception 'مسابقه یافت نشد';
  end if;

  v_was_finished := (v_match.status = 'finished');

  -- برگرداندن آمار قبلی اگر این مسابقه قبلاً نتیجه‌اش ثبت شده بود (حالت ویرایش)
  if v_was_finished then
    for g in select * from jsonb_array_elements(coalesce(v_match.goals, '[]'::jsonb)) loop
      update public.players set stats = jsonb_set(stats, '{goals}', to_jsonb(greatest(0, coalesce((stats->>'goals')::int,0) - 1)))
        where id = (g->>'playerId')::uuid;
      if (g->>'assistPlayerId') is not null and (g->>'assistPlayerId') <> '' then
        update public.players set stats = jsonb_set(stats, '{assists}', to_jsonb(greatest(0, coalesce((stats->>'assists')::int,0) - 1)))
          where id = (g->>'assistPlayerId')::uuid;
      end if;
    end loop;

    for c in select * from jsonb_array_elements(coalesce(v_match.cards, '[]'::jsonb)) loop
      if (c->>'type') = 'yellow' then
        update public.players set stats = jsonb_set(stats, '{yellowCards}', to_jsonb(greatest(0, coalesce((stats->>'yellowCards')::int,0) - 1)))
          where id = (c->>'playerId')::uuid;
      else
        update public.players set stats = jsonb_set(stats, '{redCards}', to_jsonb(greatest(0, coalesce((stats->>'redCards')::int,0) - 1)))
          where id = (c->>'playerId')::uuid;
      end if;
    end loop;

    for pid in select value::uuid from jsonb_array_elements_text(coalesce(v_match.lineup, '[]'::jsonb)) as value loop
      update public.players set stats = jsonb_set(stats, '{matches}', to_jsonb(greatest(0, coalesce((stats->>'matches')::int,0) - 1)))
        where id = pid;
    end loop;
  end if;

  -- اعمال آمار جدید
  for g in select * from jsonb_array_elements(coalesce(p_goals, '[]'::jsonb)) loop
    update public.players set stats = jsonb_set(stats, '{goals}', to_jsonb(coalesce((stats->>'goals')::int,0) + 1))
      where id = (g->>'playerId')::uuid;
    if (g->>'assistPlayerId') is not null and (g->>'assistPlayerId') <> '' then
      update public.players set stats = jsonb_set(stats, '{assists}', to_jsonb(coalesce((stats->>'assists')::int,0) + 1))
        where id = (g->>'assistPlayerId')::uuid;
    end if;
  end loop;

  for c in select * from jsonb_array_elements(coalesce(p_cards, '[]'::jsonb)) loop
    if (c->>'type') = 'yellow' then
      update public.players set stats = jsonb_set(stats, '{yellowCards}', to_jsonb(coalesce((stats->>'yellowCards')::int,0) + 1))
        where id = (c->>'playerId')::uuid;
    else
      update public.players set stats = jsonb_set(stats, '{redCards}', to_jsonb(coalesce((stats->>'redCards')::int,0) + 1))
        where id = (c->>'playerId')::uuid;
    end if;
  end loop;

  for pid in select value::uuid from jsonb_array_elements_text(coalesce(p_lineup, '[]'::jsonb)) as value loop
    update public.players set stats = jsonb_set(stats, '{matches}', to_jsonb(coalesce((stats->>'matches')::int,0) + 1))
      where id = pid;
  end loop;

  update public.matches set
    status = 'finished',
    home_score = p_home_score,
    away_score = p_away_score,
    goals = coalesce(p_goals, '[]'::jsonb),
    cards = coalesce(p_cards, '[]'::jsonb),
    lineup = coalesce(p_lineup, '[]'::jsonb),
    man_of_the_match_id = p_motm_id,
    man_of_the_match_name = p_motm_name
  where id = p_match_id;
end;
$$;

-- ============================================================
-- باکت‌های Storage (تصاویر تیم/بازیکن/خبر)
-- اگر این INSERT خطا داد، همین کار را از Dashboard > Storage > New bucket انجام دهید
-- و "Public bucket" را فعال کنید.
-- ============================================================
insert into storage.buckets (id, name, public) values ('teams', 'teams', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('players', 'players', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('news', 'news', true) on conflict (id) do nothing;

-- خواندن عمومی فایل‌ها، نوشتن فقط برای مدیر
create policy "storage_public_read" on storage.objects for select using (bucket_id in ('teams','players','news'));
create policy "storage_admin_write" on storage.objects for insert with check (bucket_id in ('teams','players','news') and is_admin());
create policy "storage_admin_update" on storage.objects for update using (bucket_id in ('teams','players','news') and is_admin());
create policy "storage_admin_delete" on storage.objects for delete using (bucket_id in ('teams','players','news') and is_admin());
