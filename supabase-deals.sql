-- =====================================================================
-- IGProspect SaaS — Migração: Negociações (Deals)
-- Execute NO Supabase SQL Editor APÓS ter rodado o supabase-schema.sql original.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) TABELA DE NEGOCIAÇÕES
-- ---------------------------------------------------------------------
create table if not exists public.deals (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null default public.my_org() references public.orgs(id) on delete cascade,
  lead_id          uuid not null unique references public.leads(id) on delete cascade,
  created_by       uuid references auth.users(id) on delete set null,
  prospector_name  text,                                -- nome de quem prospectou (capturado no trigger)
  status           text not null default 'contato'
                   check (status in ('contato','reuniao','reuniao_agendada','negociando','vendido','perdido')),
  card_type        text check (card_type in ('Imóvel','Veículo','Investimentos')),
  card_value       numeric,                             -- valor da carta em R$
  commission_value numeric,                             -- comissão em R$
  commission_pct   numeric,                             -- comissão em %
  notes            text,
  closed_at        timestamptz,                         -- data de fechamento (vendido ou perdido)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists deals_org_idx  on public.deals(org_id);
create index if not exists deals_lead_idx on public.deals(lead_id);

-- ---------------------------------------------------------------------
-- 2) RLS — mesmo isolamento por organização dos outros módulos
-- ---------------------------------------------------------------------
alter table public.deals enable row level security;

drop policy if exists deals_org on public.deals;
create policy deals_org on public.deals
  for all using (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org());

-- Sem bypass de admin aqui — ver supabase-schema.sql seção 7 (funções
-- admin_orgs/admin_users), único lugar que pode ver mais de uma org.
drop policy if exists deals_admin_read on public.deals;

-- ---------------------------------------------------------------------
-- 3) TRIGGER — cria negociação automaticamente quando lead → 'contato'
-- ---------------------------------------------------------------------
create or replace function public.ensure_deal_for_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status = 'contato' then
    -- captura o nome de quem cadastrou o lead
    select coalesce(p.name, p.email) into v_name
      from public.profiles p where p.id = new.created_by;
    insert into public.deals(org_id, lead_id, created_by, prospector_name)
      values (new.org_id, new.id, new.created_by, v_name)
      on conflict (lead_id) do nothing;
  end if;
  return new;
end; $$;

drop trigger if exists leads_create_deal on public.leads;
create trigger leads_create_deal
  after insert or update of status on public.leads
  for each row execute function public.ensure_deal_for_lead();

-- ---------------------------------------------------------------------
-- 4) BACKFILL — cria negociações para leads que já têm status 'contato'
-- ---------------------------------------------------------------------
insert into public.deals(org_id, lead_id, created_by, prospector_name)
select l.org_id, l.id, l.created_by,
       coalesce(p.name, p.email)
  from public.leads l
  left join public.profiles p on p.id = l.created_by
 where l.status = 'contato'
on conflict (lead_id) do nothing;
