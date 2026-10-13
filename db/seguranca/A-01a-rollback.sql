-- =====================================================================
-- Rollback da A-01a. NÃO APLICADO. Devolve a policy orgs_update EXATA da
-- produção (qualquer membro ativo, sem WITH CHECK) e remove as três funções.
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
drop function public.org_set_pay_recipient(uuid, text);
drop function public.org_set_goals(uuid, jsonb);
drop function public.is_org_member(uuid);
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update
  using ((id = public.my_org() and public.is_active()) or public.is_platform_admin());
commit;
notify pgrst, 'reload schema';
