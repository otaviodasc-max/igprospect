-- =====================================================================
-- IGProspect / Conalvo — P-01 · Modelo de pagamento por equipe + trava de
-- pagamentos confirmados (ADITIVA)
-- =====================================================================
-- NÃO APLICADO. Rodar só com autorização explícita, pelo SQL Editor e à mão,
-- seguindo db/pagamentos/PLANO.md. Fica fora de supabase/migrations/ de
-- propósito, para um `supabase db push` nunca aplicar sozinho.
--
-- O que faz (nada apaga, move, recalcula ou corrige dados):
--   P1. Trava em weekly_payments: pagamento confirmado não pode mais ser
--       alterado nem apagado (UPDATE/DELETE direto, inclusive o upsert do
--       painel antigo). Só o efeito em cascata de apagar a equipe ou o
--       usuário continua funcionando, como hoje.
--   P2. Tabela org_pay_plans: o modelo de pagamento de cada equipe, só com
--       inclusão de linhas e data de início ("vigente a partir de"). Equipe
--       sem linha nenhuma continua exatamente como está hoje (pagamento por
--       lead, com as metas e taxas que já tem em orgs.settings.goals).
--   P3. RPC org_schedule_pay_plan: o DONO da equipe (ou o admin da
--       plataforma) agenda um modelo a partir de uma data >= hoje (Brasília)
--       e posterior ao último pagamento confirmado da equipe. Nunca vale
--       para trás.
--   P4. RPC org_cancel_pay_plan: cancela um agendamento que AINDA NÃO
--       começou (data futura). Plano já vigente nunca muda.
--
-- Não mexe em: orgs, orgs.settings (metas e taxas), deals (comissões),
-- org_members, profiles, RLS/policies existentes, RPCs existentes,
-- extensão. Compatível com a Fase A de db/seguranca (ela não confere
-- triggers nem tabelas com estes nomes). Não cria policy em weekly_payments.
--
-- Uma transação só: qualquer precondição que falhe aborta o arquivo inteiro.
-- Rollback: P-01-rollback.sql.
-- =====================================================================

begin;

-- ------------------------------------------------------------------ P0
-- Precondições: o banco tem o que esperamos e nenhum nome novo já existe.
do $$
declare v_msg text;
begin
  select string_agg(t, ', ') into v_msg
    from unnest(array['orgs','profiles','org_members','weekly_payments']) t
   where to_regclass('public.' || t) is null;
  if v_msg is not null then raise exception 'P-01 abortada: falta tabela %', v_msg; end if;

  select string_agg(e.tab || '.' || e.col, ', ') into v_msg
    from (values ('weekly_payments','org_id'),('weekly_payments','member_id'),('weekly_payments','week_end'),
                 ('weekly_payments','created_by'),('org_members','role'),('org_members','user_id'),
                 ('profiles','status'),('profiles','platform_role')) e(tab, col)
   where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = e.tab and c.column_name = e.col);
  if v_msg is not null then raise exception 'P-01 abortada: falta coluna %', v_msg; end if;

  select string_agg(o, ', ') into v_msg from (
    select 'tabela public.org_pay_plans' o where to_regclass('public.org_pay_plans') is not null
    union all
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('weekly_payments_imutavel','org_pay_plans_imutavel',
           'org_schedule_pay_plan','org_cancel_pay_plan','pay_today_br')
    union all
    select t.tgname from pg_trigger t
     where not t.tgisinternal and t.tgname in ('weekly_payments_imutavel','org_pay_plans_imutavel')
  ) x;
  if v_msg is not null then raise exception 'P-01 abortada: já existe objeto com nome novo: %', v_msg; end if;
end $$;

-- ------------------------------------------------------------------ P1
-- "Hoje" no horário de Brasília (o painel usa a data local do usuário).
create function public.pay_today_br() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;
revoke all on function public.pay_today_br() from public, anon;
grant execute on function public.pay_today_br() to authenticated;

-- Trava de pagamento confirmado. Toda linha de weekly_payments É um
-- pagamento confirmado (o painel só grava ao clicar em "Confirmar").
create function public.weekly_payments_imutavel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    -- cascata de apagar a equipe ou o usuário (comportamento de hoje)
    if not exists (select 1 from public.orgs where id = old.org_id)
       or not exists (select 1 from auth.users where id = old.member_id) then
      return old;
    end if;
    raise exception 'Pagamento confirmado é imutável: não pode ser apagado.' using errcode = 'P0001';
  end if;
  -- UPDATE: só a cascata "on delete set null" de created_by (usuário apagado)
  if (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
     and new.created_by is null and old.created_by is not null
     and not exists (select 1 from auth.users where id = old.created_by) then
    return new;
  end if;
  raise exception 'Pagamento confirmado é imutável: não pode ser alterado.' using errcode = 'P0001';
end $$;
revoke all on function public.weekly_payments_imutavel() from public, anon, authenticated;

create trigger weekly_payments_imutavel
before update or delete on public.weekly_payments
for each row execute function public.weekly_payments_imutavel();

-- ------------------------------------------------------------------ P2
create table public.org_pay_plans (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  model            text not null check (model in ('por_lead','fixo_comissao')),
  -- só no fixo_comissao; o por_lead continua lendo orgs.settings.goals
  fixed_monthly    numeric(12,2) check (fixed_monthly >= 0 and fixed_monthly <= 1000000),
  commission_rate  numeric(9,6)  check (commission_rate >= 0 and commission_rate <= 1),   -- fração: 0.001 = 0,1%
  actions_per_day  integer       check (actions_per_day >= 0 and actions_per_day <= 10000),
  effective_from   date not null,
  created_by       uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (org_id, effective_from),
  check (model <> 'fixo_comissao' or (fixed_monthly is not null and commission_rate is not null and actions_per_day is not null)),
  check (model <> 'por_lead' or (fixed_monthly is null and commission_rate is null and actions_per_day is null))
);
create index org_pay_plans_org_idx on public.org_pay_plans(org_id, effective_from);

alter table public.org_pay_plans enable row level security;
-- Leitura: membro ATIVO daquela equipe (por org_members, não pela equipe
-- aberta) ou admin da plataforma. Escrita: só pelas RPCs abaixo.
create policy org_pay_plans_select on public.org_pay_plans for select to authenticated
  using (
    exists (select 1 from public.org_members m join public.profiles p on p.id = m.user_id
             where m.org_id = org_pay_plans.org_id and m.user_id = auth.uid() and p.status = 'active')
    or public.is_platform_admin()
  );
revoke all on public.org_pay_plans from public, anon, authenticated;
grant select on public.org_pay_plans to authenticated;

-- Só inclusão: plano já gravado não muda. Cancelar um agendamento FUTURO
-- passa pela RPC P4 (que liga a chave app.pay_plan_cancel na transação).
create function public.org_pay_plans_imutavel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.orgs where id = old.org_id) then return old; end if;   -- equipe apagada
    if current_setting('app.pay_plan_cancel', true) = old.id::text and old.effective_from > public.pay_today_br() then
      return old;
    end if;
    raise exception 'Plano de pagamento é imutável: só um agendamento futuro pode ser cancelado.' using errcode = 'P0001';
  end if;
  if (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by')
     and new.created_by is null and not exists (select 1 from auth.users where id = old.created_by) then
    return new;
  end if;
  raise exception 'Plano de pagamento é imutável.' using errcode = 'P0001';
end $$;
revoke all on function public.org_pay_plans_imutavel() from public, anon, authenticated;
create trigger org_pay_plans_imutavel
before update or delete on public.org_pay_plans
for each row execute function public.org_pay_plans_imutavel();

-- ------------------------------------------------------------------ P3
create function public.org_schedule_pay_plan(
  p_org_id uuid, p_model text, p_fixed_monthly numeric, p_commission_rate numeric,
  p_actions_per_day integer, p_effective_from date
) returns public.org_pay_plans
language plpgsql security definer set search_path = public as $$
declare v_row public.org_pay_plans; v_last date;
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  if not (public.is_platform_admin() or exists (
      select 1 from public.org_members m join public.profiles p on p.id = m.user_id
       where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'owner' and p.status = 'active')) then
    raise exception 'Só o dono da equipe pode mudar o modelo de pagamento.' using errcode = '42501';
  end if;
  if p_model not in ('por_lead','fixo_comissao') then
    raise exception 'Modelo inválido.' using errcode = '22023';
  end if;
  if p_effective_from is null or p_effective_from < public.pay_today_br() then
    raise exception 'A data de início não pode ser no passado (o modelo nunca vale para trás).' using errcode = '22023';
  end if;
  select max(week_end) into v_last from public.weekly_payments where org_id = p_org_id;
  if v_last is not null and p_effective_from <= v_last then
    raise exception 'Já existe pagamento confirmado até %; escolha uma data posterior.', to_char(v_last, 'DD/MM/YYYY') using errcode = '22023';
  end if;
  if p_model = 'fixo_comissao' then
    if p_fixed_monthly is null or p_commission_rate is null or p_actions_per_day is null then
      raise exception 'Informe o fixo mensal, a comissão e a meta de ações por dia.' using errcode = '22023';
    end if;
    insert into public.org_pay_plans(org_id, model, fixed_monthly, commission_rate, actions_per_day, effective_from, created_by)
    values (p_org_id, p_model, p_fixed_monthly, p_commission_rate, p_actions_per_day, p_effective_from, auth.uid())
    returning * into v_row;
  else
    insert into public.org_pay_plans(org_id, model, effective_from, created_by)
    values (p_org_id, p_model, p_effective_from, auth.uid())
    returning * into v_row;
  end if;
  return v_row;
end $$;
revoke all on function public.org_schedule_pay_plan(uuid,text,numeric,numeric,integer,date) from public, anon;
grant execute on function public.org_schedule_pay_plan(uuid,text,numeric,numeric,integer,date) to authenticated;

-- ------------------------------------------------------------------ P4
create function public.org_cancel_pay_plan(p_org_id uuid, p_plan_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  if not (public.is_platform_admin() or exists (
      select 1 from public.org_members m join public.profiles p on p.id = m.user_id
       where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'owner' and p.status = 'active')) then
    raise exception 'Só o dono da equipe pode cancelar um agendamento.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.org_pay_plans where id = p_plan_id and org_id = p_org_id and effective_from > public.pay_today_br()) then
    raise exception 'Só um agendamento futuro desta equipe pode ser cancelado.' using errcode = '22023';
  end if;
  perform set_config('app.pay_plan_cancel', p_plan_id::text, true);
  delete from public.org_pay_plans where id = p_plan_id and org_id = p_org_id;
  perform set_config('app.pay_plan_cancel', '', true);
end $$;
revoke all on function public.org_cancel_pay_plan(uuid,uuid) from public, anon;
grant execute on function public.org_cancel_pay_plan(uuid,uuid) to authenticated;

-- ------------------------------------------------------------------ P5
-- Verificação posterior: aborta tudo se algo não bater.
do $$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('weekly_payments_imutavel','org_pay_plans_imutavel')) <> 2 then
    raise exception 'P-01: triggers ausentes';
  end if;
  if exists (select 1 from public.org_pay_plans) then
    raise exception 'P-01: org_pay_plans deveria nascer vazia (nenhuma equipe muda de modelo sozinha)';
  end if;
  if has_table_privilege('anon', 'public.org_pay_plans', 'select')
     or has_table_privilege('authenticated', 'public.org_pay_plans', 'insert')
     or has_table_privilege('authenticated', 'public.org_pay_plans', 'update')
     or has_table_privilege('authenticated', 'public.org_pay_plans', 'delete') then
    raise exception 'P-01: privilégios de org_pay_plans mais amplos que o esperado';
  end if;
  if has_function_privilege('anon', 'public.org_schedule_pay_plan(uuid,text,numeric,numeric,integer,date)', 'execute') then
    raise exception 'P-01: anon não pode agendar plano';
  end if;
end $$;

commit;
