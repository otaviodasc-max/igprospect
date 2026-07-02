-- =====================================================================
-- IGProspect SaaS — Migração: Módulos de Profissão (modules)
-- Execute no Supabase SQL Editor APÓS supabase-schema.sql e supabase-deals.sql.
-- Permite que cada organização escolha um "módulo" (Consórcio, Imóveis,
-- Seguros, SaaS/Infoproduto...) que customiza terminologia, funil de
-- negociações, campos extras de lead e KPIs — sem mudar o modelo de dados
-- central. O catálogo de módulos fica em modules.js (client), não no banco.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Organização: qual módulo está ativo + respostas do questionário
-- ---------------------------------------------------------------------
alter table public.orgs add column if not exists module_id text;
alter table public.orgs add column if not exists module_answers jsonb default '{}'::jsonb;

-- Toda organização já existente se comportava como "Consórcio" — backfill
-- explícito para não depender só do fallback do client.
update public.orgs set module_id = 'consorcio' where module_id is null;

-- ---------------------------------------------------------------------
-- 2) Deals: cada módulo tem seu próprio conjunto de etapas e tipos de
--    carta/produto, então os CHECKs fixos (pensados só p/ consórcio)
--    precisam sair. Validação de etapa/tipo passa a ser em camada de
--    app contra o module_config — mesmo padrão já usado em leads.status,
--    que nunca teve CHECK no banco.
-- ---------------------------------------------------------------------
alter table public.deals drop constraint if exists deals_status_check;
alter table public.deals drop constraint if exists deals_card_type_check;

-- ---------------------------------------------------------------------
-- 3) Leads: campos extras específicos de cada módulo (ex.: tipo de
--    imóvel de interesse, tipo de seguro, cargo do contato...)
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists custom_fields jsonb default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 4) create_org: passa a aceitar o módulo escolhido no questionário de
--    onboarding, gravando-o atomicamente na criação da organização.
-- ---------------------------------------------------------------------
drop function if exists public.create_org(text);

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

grant execute on function public.create_org(text, text) to authenticated;
