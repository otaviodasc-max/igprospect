-- =====================================================================
-- ROLLBACK da FASE D — volta aos defaults e às policies da Fase A.
-- Não mexe em dados. Rode ANTES de qualquer rollback da C ou da A.
-- =====================================================================
begin;

drop trigger if exists leads_guard_author on public.leads;
drop function if exists public.guard_leads_author();

alter table public.leads              alter column org_id set default public.my_org();
alter table public.calls              alter column org_id set default public.my_org();
alter table public.deals              alter column org_id set default public.my_org();
alter table public.messages           alter column org_id set default public.my_org();
alter table public.weekly_payments    alter column org_id set default public.my_org();
alter table public.push_subscriptions alter column org_id set default public.my_org();

-- policies como ficam depois da Fase A
drop policy if exists leads_org on public.leads;
create policy leads_org on public.leads for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org() and public.is_active());
drop policy if exists calls_org on public.calls;
create policy calls_org on public.calls for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org() and public.is_active());
drop policy if exists deals_org on public.deals;
create policy deals_org on public.deals for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org() and public.is_active());
drop policy if exists weekly_payments_org on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org() and public.is_active());
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (org_id = public.my_org() and public.is_active());
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert
  with check (org_id = public.my_org() and public.is_active());

commit;
notify pgrst, 'reload schema';
