-- =====================================================================
-- IGProspect SaaS — ORIGEM do negócio no CRM (Hub do Corretor) por funil
-- =====================================================================
-- Sem origem definida, o Hub carimba todo negócio criado pela API com a
-- origem da integração ("IGProspect"), em vez da origem real do lead. Agora
-- cada funil do IGProspect aponta pra uma origem do CRM (ex.: funil
-- "Instagram" → origem "Instagram"; funil "Empresários" → o que a equipe
-- quiser), configurado em Configurações → Integração CRM.
--
-- Formato da coluna (jsonb, null = deixar o CRM decidir):
--   { "id": 12, "name": "Instagram", "field": "dealSource" }
-- "field" é o nome do campo que ESSA instalação do Hub usa pra gravar a
-- origem — descoberto pelo painel ao carregar os funis (a API não é
-- documentada e o nome varia). Fica salvo aqui pra que envios automáticos
-- não precisem redescobrir.
--
-- Execute no Supabase SQL Editor. Idempotente — pode rodar de novo.
-- =====================================================================

alter table public.org_pipelines
  add column if not exists agendor_origin jsonb;

comment on column public.org_pipelines.agendor_origin is
  'Origem do negócio no CRM para este funil: {id,name,field} ou null.';

-- A extensão do Instagram cria pessoa+negócio direto (sem passar pelo
-- painel), então ela também precisa receber a origem junto do mapeamento
-- de etapas — senão os leads cadastrados pela extensão continuariam indo
-- com a origem errada.
drop function if exists public.org_pipeline_by_join_code(text);

create or replace function public.org_pipeline_by_join_code(p_code text)
returns table(id uuid, name text, stages jsonb, agendor_map jsonb, agendor_origin jsonb)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.stages, p.agendor_map, p.agendor_origin
  from public.orgs o
  join public.org_pipelines p on p.org_id = o.id and p.is_default
  where o.join_code = upper(trim(p_code))
  limit 1;
$$;
grant execute on function public.org_pipeline_by_join_code(text) to anon, authenticated;
