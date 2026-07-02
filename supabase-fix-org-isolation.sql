-- =====================================================================
-- IGProspect SaaS — Correção: vazamento de dados entre organizações
-- Execute no Supabase SQL Editor.
--
-- Causa raiz: as políticas "*_admin_read" davam SELECT irrestrito (sem
-- filtro de org_id) em leads/calls/deals sempre que o usuário logado
-- tinha platform_role = 'admin' (seu usuário, dono da plataforma).
-- Como o app carrega leads/calls/deals com um select('*') simples,
-- confiando 100% no RLS para isolar por organização, sua conta de admin
-- via TODOS os leads/calls/deals de TODAS as organizações misturados,
-- inclusive em espaços novos e vazios. "messages" tinha o mesmo problema.
--
-- Correção: essas políticas de bypass saem das tabelas. O painel Admin
-- (contagens por espaço + lista de usuários) passa a usar 2 funções
-- security definer dedicadas — únicos pontos que enxergam entre orgs,
-- e só para quem é platform_role='admin'. Isolamento por organização
-- volta a valer para 100% das consultas normais do app, inclusive as
-- suas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Remove os bypasses de admin nas tabelas de dados
-- ---------------------------------------------------------------------
drop policy if exists leads_admin_read on public.leads;
drop policy if exists calls_admin_read on public.calls;
drop policy if exists deals_admin_read on public.deals;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (org_id = public.my_org());
-- messages_delete continua permitindo admin apagar mensagens de qualquer
-- espaço (moderação pontual por id) — isso não expõe listagem nenhuma.

-- ---------------------------------------------------------------------
-- 2) Painel Admin: contagens/lista via funções (não mais views sobre
--    as tabelas base), com o próprio is_platform_admin() garantindo que
--    só o dono da plataforma recebe dados de outras organizações.
-- ---------------------------------------------------------------------
drop view if exists public.admin_orgs;
drop view if exists public.admin_users;

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
