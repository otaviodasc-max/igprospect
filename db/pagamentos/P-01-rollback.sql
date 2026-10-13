-- =====================================================================
-- Rollback da P-01. NÃO APLICADO. Desfaz só o que a P-01 criou.
-- Recusa rodar se alguma equipe já tiver plano gravado (org_pay_plans com
-- linhas): apagar planos mudaria o modelo de pagamento dessas equipes.
-- Nesse caso, exporte a tabela e decida antes, à mão.
-- Rollback de P-02 (se aplicada) vem ANTES deste.
-- =====================================================================
begin;

do $$
begin
  if to_regclass('public.org_pay_plans') is null then
    raise exception 'Rollback P-01: org_pay_plans não existe (P-01 não aplicada?)';
  end if;
  if exists (select 1 from public.org_pay_plans) then
    raise exception 'Rollback P-01 recusado: há planos gravados em org_pay_plans. Exporte e decida antes.';
  end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname = 'orgs_plano_padrao_consorcio') then
    raise exception 'Rollback P-01 recusado: desfaça a P-02 antes (P-02-rollback.sql).';
  end if;
end $$;

drop trigger weekly_payments_imutavel on public.weekly_payments;
drop function public.weekly_payments_imutavel();
drop function public.org_cancel_pay_plan(uuid,uuid);
drop function public.org_schedule_pay_plan(uuid,text,numeric,numeric,integer,date);
drop table public.org_pay_plans;               -- leva o trigger e a policy junto
drop function public.org_pay_plans_imutavel();
drop function public.pay_today_br();

do $$
begin
  if to_regclass('public.org_pay_plans') is not null
     or exists (select 1 from pg_trigger where not tgisinternal and tgname in ('weekly_payments_imutavel','org_pay_plans_imutavel'))
     or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname in ('weekly_payments_imutavel','org_pay_plans_imutavel',
                       'org_schedule_pay_plan','org_cancel_pay_plan','pay_today_br')) then
    raise exception 'Rollback P-01: sobrou objeto da P-01';
  end if;
end $$;

commit;
