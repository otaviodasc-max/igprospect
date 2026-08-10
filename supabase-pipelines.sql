-- =====================================================================
-- IGProspect SaaS — Funis, Nichos, Etapas de Negociação e Desfechos de
-- Ligação customizáveis por organização (owner-only).
-- Execute no SQL editor do Supabase, APÓS supabase-schema.sql,
-- supabase-deals.sql e supabase-modules.sql. É seguro rodar mais de
-- uma vez (idempotente).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) FUNIS DE LEAD — N por organização, cada um com etapas ordenadas.
--    Substitui o antigo "tipo" binário comum/empresário.
-- ---------------------------------------------------------------------
create table if not exists public.org_pipelines (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.orgs(id) on delete cascade,
  name                  text not null,
  icon                  text default '📋',
  order_idx             int not null default 0,
  is_default            boolean not null default false,
  counts_as_empresario  boolean not null default false, -- mantém compat com o recurso "pagamento semanal" do módulo Consórcio
  stages                jsonb not null default '[]'::jsonb,
  -- stages: [ {key:'novo', label:'Novo Lead', short:'Novos', color:'#64748B', order:0}, ... ]
  agendor_map           jsonb, -- {funnelId, stageId, funnelName, stageName} | null
  agendor_origin        jsonb, -- origem do negócio no CRM: {id, name, field} | null (ver supabase-agendor-origin.sql)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists org_pipelines_org_idx on public.org_pipelines(org_id);
create unique index if not exists org_pipelines_one_default on public.org_pipelines(org_id) where is_default;

-- ---------------------------------------------------------------------
-- 2) NICHOS — lista fechada por organização
-- ---------------------------------------------------------------------
create table if not exists public.org_niches (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  name        text not null,
  order_idx   int not null default 0,
  created_at  timestamptz not null default now(),
  unique(org_id, name)
);
create index if not exists org_niches_org_idx on public.org_niches(org_id);

-- ---------------------------------------------------------------------
-- 3) ESTÁGIOS DE NEGOCIAÇÃO — 1 conjunto por organização
-- ---------------------------------------------------------------------
create table if not exists public.org_deal_stages (
  org_id      uuid primary key references public.orgs(id) on delete cascade,
  stages      jsonb not null default '[]'::jsonb,
  won_stage   text,
  lost_stage  text,
  card_types  jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4) DESFECHOS DE LIGAÇÃO — 1 conjunto por organização
-- ---------------------------------------------------------------------
create table if not exists public.org_call_outcomes (
  org_id      uuid primary key references public.orgs(id) on delete cascade,
  outcomes    jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5) LEADS: pipeline_id substitui `tipo` como fonte de verdade do funil
--    (`tipo` continua existindo, sincronizado automaticamente pelo client
--     a partir de counts_as_empresario, só para não quebrar o recurso de
--     pagamento semanal do módulo Consórcio).
-- ---------------------------------------------------------------------
alter table public.leads add column if not exists pipeline_id uuid references public.org_pipelines(id) on delete set null;
create index if not exists leads_pipeline_idx on public.leads(pipeline_id);

-- ---------------------------------------------------------------------
-- 6) is_org_owner() — paralela a is_platform_admin(), lê o papel na
--    "equipe ativa" (profiles.org_role), igual a my_org().
-- ---------------------------------------------------------------------
create or replace function public.is_org_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and org_role = 'owner' and status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- 7) RLS — leitura para qualquer membro ativo da org; escrita só p/ dono.
--    Sem bypass de platform admin de propósito (suporte deve editar via
--    SQL direto, não reconfigurar funil de cliente pelo client).
-- ---------------------------------------------------------------------
alter table public.org_pipelines     enable row level security;
alter table public.org_niches        enable row level security;
alter table public.org_deal_stages   enable row level security;
alter table public.org_call_outcomes enable row level security;

drop policy if exists org_pipelines_select on public.org_pipelines;
create policy org_pipelines_select on public.org_pipelines
  for select using (org_id = public.my_org() and public.is_active());
drop policy if exists org_pipelines_write on public.org_pipelines;
create policy org_pipelines_write on public.org_pipelines
  for all using (org_id = public.my_org() and public.is_org_owner())
  with check (org_id = public.my_org() and public.is_org_owner());

drop policy if exists org_niches_select on public.org_niches;
create policy org_niches_select on public.org_niches
  for select using (org_id = public.my_org() and public.is_active());
drop policy if exists org_niches_write on public.org_niches;
create policy org_niches_write on public.org_niches
  for all using (org_id = public.my_org() and public.is_org_owner())
  with check (org_id = public.my_org() and public.is_org_owner());

drop policy if exists org_deal_stages_select on public.org_deal_stages;
create policy org_deal_stages_select on public.org_deal_stages
  for select using (org_id = public.my_org() and public.is_active());
drop policy if exists org_deal_stages_write on public.org_deal_stages;
create policy org_deal_stages_write on public.org_deal_stages
  for all using (org_id = public.my_org() and public.is_org_owner())
  with check (org_id = public.my_org() and public.is_org_owner());

drop policy if exists org_call_outcomes_select on public.org_call_outcomes;
create policy org_call_outcomes_select on public.org_call_outcomes
  for select using (org_id = public.my_org() and public.is_active());
drop policy if exists org_call_outcomes_write on public.org_call_outcomes;
create policy org_call_outcomes_write on public.org_call_outcomes
  for all using (org_id = public.my_org() and public.is_org_owner())
  with check (org_id = public.my_org() and public.is_org_owner());

-- NOTA: a policy `orgs_update` (que hoje deixa qualquer membro ativo dar
-- UPDATE em `orgs`, incluindo agendor_token/module_id) só é travada para
-- owner-only no arquivo separado `supabase-lock-orgs-owner.sql`, a ser
-- rodado DEPOIS que o client novo (que esconde esses campos de membros)
-- estiver em produção — ver esse arquivo para detalhes.

-- ---------------------------------------------------------------------
-- 8) BACKFILL — cria os funis/nichos/deal-stages/call-outcomes padrão de
--    cada org a partir do módulo de profissão atual (idempotente).
-- ---------------------------------------------------------------------

-- 9.1) Pipeline "Instagram" (prospecção) — igual ao prospectFunnel de todo módulo hoje.
insert into public.org_pipelines (org_id, name, icon, order_idx, is_default, counts_as_empresario, stages)
select o.id, 'Instagram', '📸', 0, true, false,
  '[
    {"key":"novo","label":"Novo Lead","short":"Novos","color":"#64748B","order":0},
    {"key":"chamado","label":"Chamado","short":"Chamados","color":"#6366F1","order":1},
    {"key":"respondeu","label":"Respondeu","short":"Responderam","color":"#F59E0B","order":2},
    {"key":"contato","label":"Enviou Contato","short":"Convertidos","color":"#10B981","order":3}
  ]'::jsonb
from public.orgs o
where not exists (select 1 from public.org_pipelines p where p.org_id = o.id);

-- 9.2) Pipeline "Empresários" — só para orgs no módulo consórcio (único com empFunnel hoje).
insert into public.org_pipelines (org_id, name, icon, order_idx, is_default, counts_as_empresario, stages)
select o.id, 'Empresários', '🏢', 1, false, true,
  '[
    {"key":"a_contatar","label":"A Contatar","short":"A Contatar","color":"#64748B","order":0},
    {"key":"em_conversa","label":"Em Conversa","short":"Conversa","color":"#6366F1","order":1},
    {"key":"reuniao","label":"Reunião","short":"Reunião","color":"#8B5CF6","order":2},
    {"key":"negociando","label":"Negociando","short":"Negociando","color":"#F59E0B","order":3}
  ]'::jsonb
from public.orgs o
where o.module_id = 'consorcio'
  and not exists (select 1 from public.org_pipelines p where p.org_id = o.id and p.name = 'Empresários');

-- 9.3) Backfill de leads.pipeline_id a partir do tipo antigo.
update public.leads l
set pipeline_id = p.id
from public.org_pipelines p
where l.pipeline_id is null
  and p.org_id = l.org_id
  and p.name = case when l.tipo = 'empresario' then 'Empresários' else 'Instagram' end;

update public.leads l
set pipeline_id = p.id
from public.org_pipelines p
where l.pipeline_id is null and p.org_id = l.org_id and p.is_default;

-- 9.4) Estágios de negociação por módulo.
insert into public.org_deal_stages (org_id, stages, won_stage, lost_stage, card_types)
select o.id,
  case o.module_id
    when 'imoveis' then '[
      {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
      {"key":"visita","label":"Visita Agendada","short":"Visita","color":"#6366F1","order":1},
      {"key":"proposta","label":"Proposta","short":"Proposta","color":"#8B5CF6","order":2},
      {"key":"documentacao","label":"Documentação","short":"Docs","color":"#F59E0B","order":3},
      {"key":"vendido","label":"Fechado","short":"Fechados","color":"#10B981","order":4},
      {"key":"perdido","label":"Perdido","short":"Perdidos","color":"#EF4444","order":5}
    ]'::jsonb
    when 'seguros' then '[
      {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
      {"key":"cotacao","label":"Cotação","short":"Cotação","color":"#6366F1","order":1},
      {"key":"proposta","label":"Proposta","short":"Proposta","color":"#F59E0B","order":2},
      {"key":"apolice_emitida","label":"Apólice Emitida","short":"Emitidas","color":"#10B981","order":3},
      {"key":"renovacao_perdida","label":"Perdida","short":"Perdidas","color":"#EF4444","order":4}
    ]'::jsonb
    when 'saas' then '[
      {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
      {"key":"demo_agendada","label":"Demo Agendada","short":"Agendada","color":"#6366F1","order":1},
      {"key":"demo_realizada","label":"Demo Realizada","short":"Realizada","color":"#8B5CF6","order":2},
      {"key":"proposta","label":"Proposta","short":"Proposta","color":"#F59E0B","order":3},
      {"key":"trial","label":"Em Trial","short":"Trial","color":"#0EA5E9","order":4},
      {"key":"fechado","label":"Fechado","short":"Fechados","color":"#10B981","order":5},
      {"key":"perdido","label":"Perdido","short":"Perdidos","color":"#EF4444","order":6}
    ]'::jsonb
    else '[
      {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
      {"key":"reuniao","label":"Reunião","short":"Reunião","color":"#6366F1","order":1},
      {"key":"reuniao_agendada","label":"Reunião Agendada","short":"Agendada","color":"#8B5CF6","order":2},
      {"key":"negociando","label":"Negociando","short":"Negociando","color":"#F59E0B","order":3},
      {"key":"vendido","label":"Vendido","short":"Vendidos","color":"#10B981","order":4},
      {"key":"perdido","label":"Perdido","short":"Perdidos","color":"#EF4444","order":5}
    ]'::jsonb
  end,
  case o.module_id when 'imoveis' then 'vendido' when 'seguros' then 'apolice_emitida' when 'saas' then 'fechado' else 'vendido' end,
  case o.module_id when 'seguros' then 'renovacao_perdida' else 'perdido' end,
  case o.module_id
    when 'imoveis' then '["Apartamento","Casa","Terreno","Comercial"]'::jsonb
    when 'seguros' then '["Auto","Vida","Residencial","Saúde","Empresarial"]'::jsonb
    when 'saas'    then '["Plano Starter","Plano Pro","Plano Enterprise","Infoproduto"]'::jsonb
    else '["Imóvel","Veículo","Investimentos"]'::jsonb
  end
from public.orgs o
where not exists (select 1 from public.org_deal_stages d where d.org_id = o.id);

-- 9.5) Desfechos de ligação — iguais para todo módulo hoje.
insert into public.org_call_outcomes (org_id, outcomes)
select o.id, '[
  {"key":"interessado","label":"Interessado","color":"#10B981","order":0},
  {"key":"retornar","label":"Retornar depois","color":"#F59E0B","order":1},
  {"key":"sem_interesse","label":"Sem interesse","color":"#EF4444","order":2},
  {"key":"nao_atendeu","label":"Não atendeu","color":"#64748B","order":3},
  {"key":"fechado","label":"Fechou negócio","color":"#6366F1","order":4}
]'::jsonb
from public.orgs o
where not exists (select 1 from public.org_call_outcomes c where c.org_id = o.id);

-- 9.6) Nichos — deduplicados a partir do texto livre já usado pelos clientes.
insert into public.org_niches (org_id, name, order_idx)
select org_id, niche, (row_number() over (partition by org_id order by cnt desc))::int - 1
from (
  select org_id, trim(niche) as niche, count(*) as cnt
  from public.leads
  where niche is not null and trim(niche) <> ''
  group by org_id, trim(niche)
) x
on conflict (org_id, name) do nothing;
