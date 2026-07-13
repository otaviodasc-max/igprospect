-- =====================================================================
-- IGProspect SaaS — BLOCO ÚNICO: tudo que ainda falta instalar
-- Cole TUDO no Supabase > SQL Editor > New query > Run. Rode uma vez.
-- É idempotente (pode rodar de novo sem quebrar nada).
--
-- Inclui:
--   A) Aprovação de cadastro  — todo cadastro novo nasce 'pending' e só
--      acessa depois que você (super admin) aprovar no painel Admin.
--   B) Painel Admin           — funções que listam espaços/usuários e
--      excluem espaço/usuário.
--   C) Módulos por equipe      — ligar/desligar abas por equipe; novidades
--      nascem ocultas até você liberar.
--
-- (A promoção do seu usuário a admin já foi feita antes — não repetimos
--  aqui pra não mexer no trigger de proteção.)
-- =====================================================================


-- =====================================================================
-- A) APROVAÇÃO DE CADASTRO
-- =====================================================================

-- 1) Permite o status 'pending' e torna ele o padrão de novos cadastros
alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('active','blocked','pending'));
alter table public.profiles alter column status set default 'pending';

-- 2) Novo cadastro nasce 'pending'
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, status)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), 'pending')
  on conflict (id) do nothing;
  return new;
end; $$;

-- 3) Só usuário aprovado (active) pode criar/entrar em equipe
create or replace function public.create_org(p_name text, p_module_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  if not public.is_active() then raise exception 'Cadastro em análise: aguarde a aprovação do administrador'; end if;
  v_code := upper(substring(md5(random()::text) from 1 for 6));
  insert into public.orgs(name, join_code, module_id)
    values (coalesce(nullif(trim(p_name),''),'Meu espaço'), v_code, coalesce(p_module_id,'consorcio'))
    returning id into v_org;
  insert into public.org_members(org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = 'owner' where id = auth.uid();
  return v_org;
end; $$;

create or replace function public.join_org(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text;
begin
  if not public.is_active() then raise exception 'Cadastro em análise: aguarde a aprovação do administrador'; end if;
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código inválido'; end if;
  insert into public.org_members(org_id, user_id, role) values (v_org, auth.uid(), 'member')
    on conflict (org_id, user_id) do nothing;
  select role into v_role from public.org_members where org_id=v_org and user_id=auth.uid();
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = v_role where id = auth.uid();
  return v_org;
end; $$;


-- =====================================================================
-- B) PAINEL ADMIN (listar espaços/usuários, excluir espaço/usuário)
-- =====================================================================

create or replace function public.admin_orgs()
returns table(id uuid, name text, join_code text, created_at timestamptz, members bigint, leads bigint, calls bigint)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.join_code, o.created_at,
         (select count(*) from public.profiles p where p.org_id = o.id) as members,
         (select count(*) from public.leads   l where l.org_id = o.id) as leads,
         (select count(*) from public.calls   c where c.org_id = o.id) as calls
  from public.orgs o
  where public.is_platform_admin()
  order by o.created_at desc;
$$;
grant execute on function public.admin_orgs() to authenticated;

create or replace function public.admin_users()
returns table(id uuid, email text, name text, org_id uuid, org_name text, org_role text, platform_role text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.name, p.org_id, o.name as org_name,
         p.org_role, p.platform_role, p.status, p.created_at
  from public.profiles p left join public.orgs o on o.id = p.org_id
  where public.is_platform_admin();
$$;
grant execute on function public.admin_users() to authenticated;

-- Excluir um espaço inteiro (cascata leva leads/calls/deals/messages/membros)
create or replace function public.admin_delete_org(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Apenas o administrador da plataforma'; end if;
  delete from public.orgs where id = p_org_id;
end; $$;
grant execute on function public.admin_delete_org(uuid) to authenticated;

-- Excluir um usuário (não pode a si mesmo nem outro admin)
create or replace function public.admin_delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Apenas o administrador da plataforma'; end if;
  if p_user_id = auth.uid() then raise exception 'Você não pode excluir a si mesmo'; end if;
  if exists (select 1 from public.profiles where id = p_user_id and platform_role = 'admin') then
    raise exception 'Não é possível excluir outro administrador';
  end if;
  delete from auth.users where id = p_user_id;
end; $$;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- =====================================================================
-- C) MÓDULOS / ABAS LIBERÁVEIS POR EQUIPE
-- =====================================================================

create table if not exists public.features (
  key        text primary key,
  label      text not null,
  default_on boolean not null default false,   -- novidade nasce oculta
  sort       int not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.org_features (
  org_id      uuid not null references public.orgs(id) on delete cascade,
  feature_key text not null references public.features(key) on delete cascade,
  enabled     boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (org_id, feature_key)
);

-- Abas atuais, todas ligadas por padrão
insert into public.features(key,label,default_on,sort) values
  ('dashboard','Dashboard',true,10),
  ('goals','Metas',true,20),
  ('leads','Leads',true,30),
  ('crm','CRM',true,40),
  ('deals','Negociações',true,50),
  ('calls','Ligações',true,60),
  ('relatorios','Relatórios',true,70),
  ('team','Equipe',true,80),
  ('settings','Configurações',true,90)
on conflict (key) do nothing;

alter table public.features     enable row level security;
alter table public.org_features enable row level security;

drop policy if exists features_select on public.features;
create policy features_select on public.features for select using (true);
drop policy if exists features_admin on public.features;
create policy features_admin on public.features
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

drop policy if exists org_features_select on public.org_features;
create policy org_features_select on public.org_features
  for select using (org_id = public.my_org() or public.is_platform_admin());
drop policy if exists org_features_admin on public.org_features;
create policy org_features_admin on public.org_features
  for all using (public.is_platform_admin()) with check (public.is_platform_admin());

create or replace function public.my_features()
returns table(key text)
language sql stable security definer set search_path = public as $$
  select f.key
  from public.features f
  left join public.org_features ofx
    on ofx.feature_key = f.key and ofx.org_id = public.my_org()
  where coalesce(ofx.enabled, f.default_on) = true;
$$;
grant execute on function public.my_features() to authenticated;

create or replace function public.admin_org_features(p_org_id uuid)
returns table(key text, label text, enabled boolean, is_override boolean, sort int)
language sql stable security definer set search_path = public as $$
  select f.key, f.label,
         coalesce(ofx.enabled, f.default_on) as enabled,
         (ofx.org_id is not null) as is_override,
         f.sort
  from public.features f
  left join public.org_features ofx
    on ofx.feature_key = f.key and ofx.org_id = p_org_id
  where public.is_platform_admin()
  order by f.sort, f.label;
$$;
grant execute on function public.admin_org_features(uuid) to authenticated;

create or replace function public.admin_set_org_feature(p_org_id uuid, p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Apenas o administrador da plataforma'; end if;
  insert into public.org_features(org_id, feature_key, enabled)
  values (p_org_id, p_key, p_enabled)
  on conflict (org_id, feature_key) do update set enabled = excluded.enabled, updated_at = now();
end; $$;
grant execute on function public.admin_set_org_feature(uuid, text, boolean) to authenticated;


-- Recarrega o cache de funções/tabelas do PostgREST
notify pgrst, 'reload schema';
