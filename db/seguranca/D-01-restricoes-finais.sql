-- =====================================================================
-- IGProspect — Segunda camada · FASE D (restrições finais)
-- Revisão 2 (2026-09-22): valida NOT NULL e os defaults exatos antes de
-- remover, registra o estado para o rollback e exige autor ATIVO.
-- =====================================================================
-- NÃO RODAR antes de:
--   1. Fases A e C aplicadas (confere e aborta);
--   2. painel com org_id explícito publicado há pelo menos 48 h e todos
--      tendo recarregado (o painel antigo grava sem org_id e passaria a
--      falhar);
--   3. diagnóstico zerado (abaixo);
--   4. autorização explícita do proprietário.
--
-- O que faz (não apaga, não move, não corrige dados):
--   D1. Remove o default org_id = my_org() de leads, calls, deals,
--       messages, weekly_payments e push_subscriptions.
--   D2. RLS dessas tabelas passa a exigir associação ativa (is_org_member).
--   D3. Autor do lead (created_by) precisa ser membro ATIVO da equipe.
--
-- ROLLBACK: D-01-rollback.sql (restaura defaults e policies registrados).
-- =====================================================================

begin;

-- =====================================================================
-- 0) PRECONDIÇÕES
-- =====================================================================
do $$
declare v_msg text; v_n bigint;
begin
  ------------------------------------------------------------------ 0.1
  if to_regclass('public.seguranca_estado_anterior') is null
     or not exists (select 1 from public.seguranca_estado_anterior where fase = 'A') then
    raise exception 'Fase D abortada: Fase A não aplicada (falta o estado anterior)';
  end if;
  if not exists (select 1 from public.seguranca_estado_anterior where fase = 'C') then
    raise exception 'Fase D abortada: Fase C não aplicada';
  end if;
  if exists (select 1 from public.seguranca_estado_anterior where fase = 'D') then
    raise exception 'Fase D abortada: já existe registro de estado da Fase D';
  end if;
  if to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'Fase D abortada: is_org_member ausente';
  end if;
  if to_regprocedure('public.guard_leads_author()') is not null
     or exists (select 1 from pg_trigger where not tgisinternal and tgname = 'leads_guard_author') then
    raise exception 'Fase D abortada: já existe objeto com o nome novo (guard_leads_author) — revise à mão';
  end if;

  ------------------------------------------------------------------ 0.2
  -- org_id precisa ser NOT NULL em TODAS as tabelas envolvidas. Se alguma
  -- aceitar nulo, a fase para e relata — nenhum dado é alterado aqui.
  select string_agg(table_name, ', ') into v_msg
  from information_schema.columns
  where table_schema = 'public' and column_name = 'org_id' and is_nullable = 'YES'
    and table_name in ('leads','calls','deals','messages','weekly_payments','push_subscriptions');
  if v_msg is not null then
    raise exception 'Fase D abortada: org_id aceita nulo em: %. Corrija manualmente (avaliando as linhas existentes) antes de continuar — esta migration não altera dados.', v_msg;
  end if;

  ------------------------------------------------------------------ 0.3
  -- os defaults precisam ser EXATAMENTE os esperados antes de remover
  select string_agg(table_name || ' = ' || coalesce(column_default, '(nenhum)'), ', ') into v_msg
  from information_schema.columns
  where table_schema = 'public' and column_name = 'org_id'
    and table_name in ('leads','calls','deals','messages','weekly_payments','push_subscriptions')
    and coalesce(regexp_replace(lower(column_default), '[[:space:]]', '', 'g'), '')
        not in ('my_org()', 'public.my_org()');
  if v_msg is not null then
    raise exception 'Fase D abortada: default de org_id diferente do esperado em: %', v_msg;
  end if;

  ------------------------------------------------------------------ 0.4
  -- policies têm que estar exatamente como a Fase A deixou, sem extras
  with esperado(t, p, cmd, q, w) as (values
    ('leads','leads_org','ALL','org_id=my_organdis_active','org_id=my_organdis_active'),
    ('calls','calls_org','ALL','org_id=my_organdis_active','org_id=my_organdis_active'),
    ('deals','deals_org','ALL','org_id=my_organdis_active','org_id=my_organdis_active'),
    ('weekly_payments','weekly_payments_org','ALL','org_id=my_organdis_active','org_id=my_organdis_active'),
    ('messages','messages_select','SELECT','org_id=my_organdis_active',''),
    ('messages','messages_insert','INSERT','','org_id=my_organdis_active'),
    ('messages','messages_delete','DELETE','user_id=auth.uidoris_platform_admin','')
  ),
  atual as (
    select tablename t, policyname p, cmd, permissive perm, array(select r::text from unnest(roles) r) roles,
           lower(regexp_replace(coalesce(qual, ''),       '[()"''[:space:]]', '', 'g')) q,
           lower(regexp_replace(coalesce(with_check, ''), '[()"''[:space:]]', '', 'g')) w
    from pg_policies
    where schemaname = 'public' and tablename in ('leads','calls','deals','messages','weekly_payments')
  )
  select string_agg(coalesce(a.t, e.t) || '.' || coalesce(a.p, e.p), ', ') into v_msg
  from esperado e
  full outer join atual a on a.t = e.t and a.p = e.p
  where a.p is null or e.p is null
     or a.cmd is distinct from e.cmd or a.q is distinct from e.q or a.w is distinct from e.w
     or a.perm is distinct from 'PERMISSIVE' or a.roles is distinct from array['public']::text[];
  if v_msg is not null then
    raise exception 'Fase D abortada: policies divergentes do estado da Fase A (ou policy inesperada): %. Nada foi removido.', v_msg;
  end if;

  ------------------------------------------------------------------ 0.5
  -- ninguém pode perder acesso: perfil com equipe ativa sem associação
  select count(*) into v_n from public.profiles pr
  where pr.org_id is not null and not exists
    (select 1 from public.org_members m where m.org_id = pr.org_id and m.user_id = pr.id);
  if v_n > 0 then
    raise exception 'Fase D abortada: % perfil(is) com equipe ativa sem associação em org_members (perderiam acesso). Resolver caso a caso antes.', v_n;
  end if;
end $$;

-- =====================================================================
-- 1) ESTADO ANTERIOR (base do rollback exato)
-- =====================================================================
insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'D', 'column_default', 'public.' || table_name || '.org_id',
       jsonb_build_object('tabela', table_name, 'coluna', 'org_id', 'default', column_default)
from information_schema.columns
where table_schema = 'public' and column_name = 'org_id'
  and table_name in ('leads','calls','deals','messages','weekly_payments','push_subscriptions');

insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'D', 'policy', tablename || '.' || policyname,
       jsonb_build_object('tabela', tablename, 'policy', policyname, 'cmd', cmd,
                          'permissive', permissive, 'roles', array(select r::text from unnest(roles) r),
                          'qual', qual, 'with_check', with_check)
from pg_policies
where schemaname = 'public'
  and (tablename, policyname) in (('leads','leads_org'), ('calls','calls_org'), ('deals','deals_org'),
                                  ('weekly_payments','weekly_payments_org'),
                                  ('messages','messages_select'), ('messages','messages_insert'));

-- =====================================================================
-- 2) D1 — remove os defaults (confirmados na precondição 0.3)
-- =====================================================================
alter table public.leads              alter column org_id drop default;
alter table public.calls              alter column org_id drop default;
alter table public.deals              alter column org_id drop default;
alter table public.messages           alter column org_id drop default;
alter table public.weekly_payments    alter column org_id drop default;
alter table public.push_subscriptions alter column org_id drop default;

-- =====================================================================
-- 3) D2 — RLS exige também associação ativa à equipe
-- =====================================================================
drop policy leads_org on public.leads;
create policy leads_org on public.leads for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy calls_org on public.calls;
create policy calls_org on public.calls for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy deals_org on public.deals;
create policy deals_org on public.deals for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy weekly_payments_org on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy messages_select on public.messages;
create policy messages_select on public.messages for select
  using (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

-- =====================================================================
-- 4) D3 — autor do lead precisa ser membro ATIVO da equipe
-- =====================================================================
create function public.guard_leads_author()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- sem equipe: deixa o NOT NULL de org_id recusar com a mensagem certa
  if new.org_id is null then return new; end if;
  if new.created_by is not null
     and (tg_op = 'INSERT' or new.created_by is distinct from old.created_by)
     and not exists (select 1
                       from public.org_members m
                       join public.profiles p on p.id = m.user_id
                      where m.org_id = new.org_id
                        and m.user_id = new.created_by
                        and p.status = 'active') then
    raise exception 'Autor do lead não é membro ativo da equipe' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke execute on function public.guard_leads_author() from public, anon, authenticated;

create trigger leads_guard_author before insert or update on public.leads
  for each row execute function public.guard_leads_author();

insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
values ('D', 'objeto_criado', 'public.guard_leads_author()', '{"classe":"function"}'::jsonb),
       ('D', 'objeto_criado', 'leads_guard_author|public.leads', '{"classe":"trigger"}'::jsonb);

-- =====================================================================
-- 5) VERIFICAÇÃO POSTERIOR
-- =====================================================================
do $$
declare v_bad text;
begin
  select string_agg(table_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'public' and column_name = 'org_id' and column_default is not null
    and table_name in ('leads','calls','deals','messages','weekly_payments','push_subscriptions');
  if v_bad is not null then raise exception 'Fase D: default de org_id ainda presente em %', v_bad; end if;

  if not exists (select 1 from pg_trigger where not tgisinternal and tgname = 'leads_guard_author') then
    raise exception 'Fase D: trigger de autor ausente';
  end if;

  if (select count(*) from public.seguranca_estado_anterior where fase = 'D') < 12 then
    raise exception 'Fase D: estado anterior incompleto — rollback exato ficaria impossível';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
