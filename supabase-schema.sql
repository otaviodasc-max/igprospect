-- =====================================================================
-- IGProspect SaaS — Esquema do banco (Supabase / PostgreSQL)
-- Modelo MULTI-INQUILINO POR ORGANIZAÇÃO (workspace):
--   • Cada chefia = uma "organização". As pessoas dentro dela
--     COMPARTILHAM os mesmos leads/ligações.
--   • Organizações diferentes NÃO enxergam os dados umas das outras.
--   • Existe um "admin da plataforma" (você) que gerencia todas.
-- Rode UMA vez: Supabase > SQL Editor > New query > cole tudo > Run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ORGANIZAÇÕES (workspaces)
-- ---------------------------------------------------------------------
create table if not exists public.orgs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  join_code     text unique not null,         -- código para um colega entrar no espaço
  agendor_token text default '',              -- integração compartilhada na organização
  agendor_proxy text default '',
  agendor_map   jsonb default '{}'::jsonb,
  settings      jsonb default '{}'::jsonb,
  module_id     text default 'consorcio',    -- módulo de profissão ativo (ver modules.js)
  module_answers jsonb default '{}'::jsonb,  -- respostas do questionário de onboarding
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2) PERFIS (1 por usuário do Auth)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  name          text,
  org_id        uuid references public.orgs(id) on delete set null,
  org_role      text not null default 'member' check (org_role in ('owner','member')),
  platform_role text not null default 'user'   check (platform_role in ('user','admin')),
  status        text not null default 'active' check (status in ('active','blocked')),
  created_at    timestamptz not null default now()
);

-- Cria o perfil automaticamente no cadastro (sem organização ainda;
-- a organização é escolhida na 1ª entrada: criar espaço novo ou entrar por código)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3) FUNÇÕES AUXILIARES (SECURITY DEFINER evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.my_org()
returns uuid language sql stable security definer set search_path = public as $$
  select org_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and platform_role = 'admin');
$$;

create or replace function public.is_active()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'active');
$$;

-- Protege campos sensíveis do perfil; troca de organização só via as RPCs abaixo
create or replace function public.guard_profile_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare allow text := current_setting('app.allow_org_change', true);
begin
  if public.is_platform_admin() then return new; end if;     -- admin pode tudo
  new.platform_role := old.platform_role;                    -- nunca via auto-edição
  new.status        := old.status;
  if allow is distinct from '1' then                         -- org só muda dentro das RPCs
    new.org_id   := old.org_id;
    new.org_role := old.org_role;
  end if;
  return new;
end; $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_update();

-- Cria uma organização nova e torna o usuário atual "dono"
-- p_module_id: módulo de profissão escolhido no questionário de onboarding
-- (ver modules.js); default 'consorcio' se não informado.
create or replace function public.create_org(p_name text, p_module_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  v_code := upper(substring(md5(random()::text) from 1 for 6));
  insert into public.orgs(name, join_code, module_id)
    values (coalesce(nullif(trim(p_name),''),'Meu espaço'), v_code, coalesce(p_module_id,'consorcio'))
    returning id into v_org;
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = 'owner' where id = auth.uid();
  return v_org;
end; $$;

-- Entra numa organização existente pelo código de convite
create or replace function public.join_org(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código inválido'; end if;
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = 'member' where id = auth.uid();
  return v_org;
end; $$;

grant execute on function public.create_org(text, text) to authenticated;
grant execute on function public.join_org(text)  to authenticated;

-- ---------------------------------------------------------------------
-- 4) LEADS (pertencem à ORGANIZAÇÃO; created_by = quem cadastrou)
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null default public.my_org() references public.orgs(id) on delete cascade,
  created_by        uuid default auth.uid() references auth.users(id) on delete set null,
  name              text,
  username          text,
  phone             text,
  email             text,
  niche             text,
  status            text default 'novo',     -- novo | chamado | respondeu | contato
  tipo              text default 'comum',    -- empresario | comum
  funil             text,
  cidade            text,
  estado            text,
  cnpj              text,
  notes             text,
  followers         int,
  following         int,
  source            text,                    -- manual | extensao | agendor
  added_at          timestamptz default now(),
  agendor_person_id text,
  agendor_deal_id   text,
  agendor_funnel    text,
  agendor_status    text,
  ext_id            text,                    -- id original na extensão (dedupe)
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists leads_org_idx       on public.leads(org_id);
create index if not exists leads_org_extid_idx on public.leads(org_id, ext_id);
create index if not exists leads_org_tipo_idx  on public.leads(org_id, tipo);

-- ---------------------------------------------------------------------
-- 5) LIGAÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.calls (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null default public.my_org() references public.orgs(id) on delete cascade,
  created_by     uuid default auth.uid() references auth.users(id) on delete set null,
  lead_id        uuid references public.leads(id) on delete set null,
  name           text,
  phone          text,
  outcome        text default 'nao_atendeu',
  duration       int,
  at             timestamptz default now(),
  notes          text,
  agendor        text,
  agendor_funnel text,
  created_at     timestamptz default now()
);
create index if not exists calls_org_idx on public.calls(org_id);

-- ---------------------------------------------------------------------
-- 6) RLS — isolamento por organização
-- ---------------------------------------------------------------------
alter table public.orgs     enable row level security;
alter table public.profiles enable row level security;
alter table public.leads    enable row level security;
alter table public.calls    enable row level security;

-- ORGS: membros leem a própria; membros ativos editam a própria; admin tudo
drop policy if exists orgs_select on public.orgs;
create policy orgs_select on public.orgs
  for select using (id = public.my_org() or public.is_platform_admin());
drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs
  for update using ((id = public.my_org() and public.is_active()) or public.is_platform_admin());

-- PROFILES: vê o próprio + colegas da mesma org; admin vê todos (trigger protege campos)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or org_id = public.my_org() or public.is_platform_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid() or public.is_platform_admin());

-- LEADS / CALLS: membros ativos da org fazem tudo na própria org; admin lê todos
drop policy if exists leads_org on public.leads;
create policy leads_org on public.leads
  for all using (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org());
drop policy if exists leads_admin_read on public.leads;
create policy leads_admin_read on public.leads
  for select using (public.is_platform_admin());

drop policy if exists calls_org on public.calls;
create policy calls_org on public.calls
  for all using (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org());
drop policy if exists calls_admin_read on public.calls;
create policy calls_admin_read on public.calls
  for select using (public.is_platform_admin());

-- ---------------------------------------------------------------------
-- 7) ADMIN — visões para o painel administrativo (só admin enxerga tudo)
-- ---------------------------------------------------------------------
create or replace view public.admin_orgs with (security_invoker = on) as
  select o.id, o.name, o.join_code, o.created_at,
         (select count(*) from public.profiles p where p.org_id = o.id) as members,
         (select count(*) from public.leads   l where l.org_id = o.id) as leads,
         (select count(*) from public.calls   c where c.org_id = o.id) as calls
  from public.orgs o;

create or replace view public.admin_users with (security_invoker = on) as
  select p.id, p.email, p.name, p.org_id, o.name as org_name,
         p.org_role, p.platform_role, p.status, p.created_at
  from public.profiles p left join public.orgs o on o.id = p.org_id;

-- ---------------------------------------------------------------------
-- 8) PROMOVER VOCÊ A ADMIN DA PLATAFORMA
--    Entre no app 1 vez (cria seu perfil), depois rode aqui:
--    update public.profiles set platform_role = 'admin' where email = 'SEU_EMAIL';
-- ---------------------------------------------------------------------
