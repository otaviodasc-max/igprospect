-- =====================================================================
-- IGProspect SaaS — Migração: Múltiplas equipes por login (org_members)
-- Execute no Supabase SQL Editor.
--
-- Hoje um login só pertence a UMA organização por vez (profiles.org_id é
-- um ponteiro único, sobrescrito por create_org/join_org). Esta migração
-- adiciona uma tabela de associação usuário↔organização (many-to-many),
-- permitindo que o mesmo login pertença a várias equipes e alterne entre
-- elas. profiles.org_id/org_role continuam existindo como "equipe ativa
-- no momento" — é o que public.my_org() já lê — então NENHUMA política
-- de RLS existente (leads, calls, deals, messages, orgs) precisa mudar.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabela de associação
-- ---------------------------------------------------------------------
create table if not exists public.org_members (
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.org_members enable row level security;

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
  for select using (user_id = auth.uid() or public.is_platform_admin());
-- Sem policy de insert/update/delete para authenticated: só as funções
-- SECURITY DEFINER abaixo escrevem aqui (mesmo padrão de create_org/join_org).

-- Backfill: toda associação já existente (profiles.org_id atual) vira o
-- primeiro registro de org_members, preservando o papel atual.
insert into public.org_members (org_id, user_id, role)
select org_id, id, org_role from public.profiles where org_id is not null
on conflict (org_id, user_id) do nothing;

-- ---------------------------------------------------------------------
-- 2) create_org: cria a org E já registra o criador como owner em
--    org_members (a org nova também vira a equipe ativa, igual hoje).
-- ---------------------------------------------------------------------
create or replace function public.create_org(p_name text, p_module_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text;
begin
  v_code := upper(substring(md5(random()::text) from 1 for 6));
  insert into public.orgs(name, join_code, module_id)
    values (coalesce(nullif(trim(p_name),''),'Meu espaço'), v_code, coalesce(p_module_id,'consorcio'))
    returning id into v_org;
  insert into public.org_members(org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = 'owner' where id = auth.uid();
  return v_org;
end; $$;

-- ---------------------------------------------------------------------
-- 3) join_org: registra a associação em org_members (idempotente — não
--    rebaixa quem já é owner dali) e também troca a equipe ativa.
-- ---------------------------------------------------------------------
create or replace function public.join_org(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_role text;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código inválido'; end if;
  insert into public.org_members(org_id, user_id, role) values (v_org, auth.uid(), 'member')
    on conflict (org_id, user_id) do nothing;
  select role into v_role from public.org_members where org_id=v_org and user_id=auth.uid();
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = v_role where id = auth.uid();
  return v_org;
end; $$;
grant execute on function public.join_org(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) switch_org: troca a equipe ativa para outra que o usuário já
--    integra (não cria, não convida — só muda o ponteiro).
-- ---------------------------------------------------------------------
create or replace function public.switch_org(p_org_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from public.org_members where org_id=p_org_id and user_id=auth.uid();
  if v_role is null then raise exception 'Você não faz parte deste espaço'; end if;
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id=p_org_id, org_role=v_role where id=auth.uid();
end; $$;
grant execute on function public.switch_org(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5) my_orgs: lista as equipes do usuário p/ o seletor da barra lateral
--    (bypassa RLS de orgs de propósito — é o único jeito de listar
--    equipes que não são a ativa no momento).
-- ---------------------------------------------------------------------
create or replace function public.my_orgs()
returns table(id uuid, name text, role text, is_current boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, m.role,
         (o.id = (select org_id from public.profiles where id=auth.uid())) as is_current
  from public.org_members m join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name;
$$;
grant execute on function public.my_orgs() to authenticated;
