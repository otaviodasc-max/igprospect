-- =====================================================================
-- IGProspect — Segunda camada · FASE D (restrições finais)
-- =====================================================================
-- NÃO RODAR antes de:
--   1. Fases A e C aplicadas (esta fase confere e aborta);
--   2. painel com org_id explícito (Fase B) publicado há tempo suficiente
--      pra ninguém mais estar com o app.js antigo aberto — o antigo grava
--      sem org_id e, sem o default, essas gravações passam a FALHAR;
--   3. diagnóstico abaixo zerado;
--   4. autorização explícita do proprietário.
--
-- O que faz (não apaga, não move, não corrige dados):
--   D1. Remove o default org_id = my_org() de leads, calls, deals, messages,
--       weekly_payments e push_subscriptions. Gravação sem equipe explícita
--       passa a ser RECUSADA (org_id é NOT NULL) em vez de cair na equipe
--       ativa em silêncio.
--   D2. RLS dessas tabelas passa a exigir também associação ativa à equipe
--       (is_org_member), além de org_id = equipe ativa.
--   D3. Lead novo (ou com created_by alterado) só aceita autor que seja
--       membro da equipe do lead.
--
-- ANTES DE RODAR — diagnóstico (somente leitura). A fase ABORTA sozinha se
-- (a) não estiver zerado, porque essas pessoas perderiam acesso:
--   -- a) perfis com equipe ativa sem associação em org_members
--   select count(*) from public.profiles pr
--   where pr.org_id is not null and not exists
--     (select 1 from public.org_members m where m.org_id = pr.org_id and m.user_id = pr.id);
--   -- b) (informativo) leads cujo autor não é mais membro da equipe
--   select count(*) from public.leads l where l.created_by is not null and not exists
--     (select 1 from public.org_members m where m.org_id = l.org_id and m.user_id = l.created_by);
--   Linhas de (b) continuam válidas: D3 só olha INSERT ou created_by alterado.
--
-- ROLLBACK: db/seguranca/D-01-rollback.sql
-- =====================================================================

begin;

do $$
declare v_n bigint;
begin
  if to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'Fase A não aplicada — abortando Fase D';
  end if;
  if has_function_privilege('anon', 'public.org_by_join_code(text)', 'EXECUTE') then
    raise exception 'Fase C não aplicada — abortando Fase D';
  end if;
  select count(*) into v_n from public.profiles pr
  where pr.org_id is not null and not exists
    (select 1 from public.org_members m where m.org_id = pr.org_id and m.user_id = pr.id);
  if v_n > 0 then
    raise exception 'Fase D abortada: % perfil(is) com equipe ativa sem associação em org_members (perderiam acesso). Resolver antes, caso a caso.', v_n;
  end if;
end $$;

-- D1 ------------------------------------------------------------------
alter table public.leads              alter column org_id drop default;
alter table public.calls              alter column org_id drop default;
alter table public.deals              alter column org_id drop default;
alter table public.messages           alter column org_id drop default;
alter table public.weekly_payments    alter column org_id drop default;
alter table public.push_subscriptions alter column org_id drop default;

-- D2 ------------------------------------------------------------------
drop policy if exists leads_org on public.leads;
create policy leads_org on public.leads for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy if exists calls_org on public.calls;
create policy calls_org on public.calls for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy if exists deals_org on public.deals;
create policy deals_org on public.deals for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy if exists weekly_payments_org on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using      (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id))
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (org_id = public.my_org() and public.is_active() and public.is_org_member(org_id));

-- D3 ------------------------------------------------------------------
create or replace function public.guard_leads_author()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  -- sem equipe: deixa o NOT NULL de org_id recusar com a mensagem certa
  if new.org_id is null then return new; end if;
  if new.created_by is not null
     and (tg_op = 'INSERT' or new.created_by is distinct from old.created_by)
     and not exists (select 1 from public.org_members m
                      where m.org_id = new.org_id and m.user_id = new.created_by) then
    raise exception 'Autor do lead não é membro da equipe' using errcode = '42501';
  end if;
  return new;
end; $$;
revoke execute on function public.guard_leads_author() from public, anon, authenticated;

drop trigger if exists leads_guard_author on public.leads;
create trigger leads_guard_author before insert or update on public.leads
  for each row execute function public.guard_leads_author();

-- VERIFICAÇÃO POSTERIOR -------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(table_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'public' and column_name = 'org_id' and column_default is not null
    and table_name in ('leads','calls','deals','messages','weekly_payments','push_subscriptions');
  if v_bad is not null then raise exception 'Fase D: default de org_id ainda presente em %', v_bad; end if;
end $$;

commit;
notify pgrst, 'reload schema';
