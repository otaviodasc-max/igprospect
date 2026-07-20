-- =====================================================================
-- IGProspect SaaS — my_orgs() agora traz dados pro seletor em cards
-- Execute no Supabase SQL Editor.
--
-- O seletor de equipes (modal "Minhas equipes") virou uma grade de
-- cards com mais informação — número de membros, de leads e quem são
-- os donos de cada equipe. my_orgs() precisa devolver essas colunas.
-- Como o tipo de retorno mudou, precisa DROP antes do CREATE (Postgres
-- não deixa só substituir quando as colunas mudam).
-- =====================================================================

drop function if exists public.my_orgs();

create or replace function public.my_orgs()
returns table(id uuid, name text, role text, is_current boolean, members bigint, leads bigint, owners text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, m.role,
         (o.id = (select org_id from public.profiles where id = auth.uid())) as is_current,
         (select count(*) from public.org_members om where om.org_id = o.id) as members,
         (select count(*) from public.leads l where l.org_id = o.id) as leads,
         (select string_agg(coalesce(p.name, p.email), ', ' order by coalesce(p.name, p.email))
            from public.org_members om2
            join public.profiles p on p.id = om2.user_id
            where om2.org_id = o.id and om2.role = 'owner') as owners
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  where m.user_id = auth.uid()
  order by o.name;
$$;
grant execute on function public.my_orgs() to authenticated;
