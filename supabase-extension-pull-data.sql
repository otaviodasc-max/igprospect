-- =====================================================================
-- IGProspect SaaS — Extensão puxa etapas reais + leads existentes da equipe
-- Execute no Supabase SQL Editor, APÓS supabase-extension-name-fix.sql.
--
-- Duas coisas que a extensão precisa pra parar de usar dado genérico:
--   1) org_pipeline_by_join_code — as etapas DE VERDADE configuradas pela
--      equipe (Configurações → Personalização), em vez dos 4 fixos
--      (Novo Lead/Chamado/Respondeu/Enviou Contato) que estavam sempre
--      hardcoded no código da extensão.
--   2) org_leads_by_join_code — os leads que já existem no sistema, pra
--      a extensão trazer tudo (nome, @, status, etc.) assim que conectar
--      a equipe, em vez de começar vazia. Também garante que todo lead
--      tenha um ext_id estável (usa o próprio id da linha, uma única vez),
--      pra extension_update_lead conseguir achar e atualizar esses leads
--      depois (ex.: quando alguém detecta resposta no Direct).
-- =====================================================================

create or replace function public.org_pipeline_by_join_code(p_code text)
returns table(id uuid, name text, stages jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.stages
  from public.orgs o
  join public.org_pipelines p on p.org_id = o.id and p.is_default
  where o.join_code = upper(trim(p_code))
  limit 1;
$$;
grant execute on function public.org_pipeline_by_join_code(text) to anon, authenticated;

create or replace function public.org_leads_by_join_code(p_code text, p_limit int default 2000, p_offset int default 0)
returns table(ext_id text, name text, username text, phone text, niche text, status text, tipo text, added_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  update public.leads l set ext_id = l.id::text
  where l.org_id = v_org and (l.ext_id is null or l.ext_id = '');

  return query
  select l.ext_id, l.name, l.username, l.phone, l.niche, l.status, l.tipo, l.added_at
  from public.leads l
  where l.org_id = v_org
  order by l.added_at desc nulls last
  limit p_limit offset p_offset;
end; $$;
grant execute on function public.org_leads_by_join_code(text,int,int) to anon, authenticated;
