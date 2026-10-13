-- =====================================================================
-- Rollback da A-01a. NÃO APLICADO. Devolve as policies EXATAS da produção
-- (orgs_update e weekly_payments_org) e remove as funções e a trava de comissão.
-- Não apaga nem altera dado: metas, valores e destinatário gravados ficam.
-- O painel Conalvo continua funcionando (sem org_set_goals ele grava as
-- metas pelo caminho antigo, um UPDATE na própria equipe).
-- Recusa rodar se a Fase A completa (A-01) estiver aplicada: aí o rollback
-- certo é o A-01-rollback.sql.
-- =====================================================================
begin;
do $$
begin
  if to_regprocedure('public.org_set_goals(uuid,jsonb)') is null then raise exception 'Rollback A-01a: A-01a não aplicada?'; end if;
  if to_regclass('public.seguranca_estado_anterior') is not null then
    raise exception 'Rollback A-01a recusado: a Fase A completa (A-01) está aplicada; use A-01-rollback.sql';
  end if;
end $$;
drop trigger deals_comissao_so_dono on public.deals;
drop function public.deals_comissao_so_dono();
drop policy weekly_payments_select on public.weekly_payments;
drop policy weekly_payments_insert on public.weekly_payments;
drop policy weekly_payments_dono on public.weekly_payments;
drop policy weekly_payments_dono_delete on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org());
drop function public.org_set_pay_recipient(uuid, text);
drop function public.org_set_goals(uuid, jsonb);
drop function public.is_org_member(uuid);
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update
  using ((id = public.my_org() and public.is_active()) or public.is_platform_admin());
commit;
notify pgrst, 'reload schema';
