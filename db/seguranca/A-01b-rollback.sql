-- =====================================================================
-- Rollback da A-01b. Remove só o que ela criou. Recusa se a X-01 estiver
-- aplicada (a X-01 depende de assert_org_member): desfaça X-02 e X-01 antes.
-- =====================================================================
begin;
do $$
begin
  if to_regprocedure('public.assert_org_member(uuid)') is null then raise exception 'Rollback A-01b: A-01b não aplicada?'; end if;
  if to_regprocedure('public.ext2_registrar_acao(uuid,uuid,uuid,text)') is not null then raise exception 'Rollback A-01b recusado: desfaça a X-02 e a X-01 antes'; end if;
  if to_regclass('public.seguranca_estado_anterior') is not null then raise exception 'Rollback A-01b recusado: a Fase A completa está aplicada; use A-01-rollback.sql'; end if;
end $$;
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('ext2_my_orgs','ext2_org_context','ext2_org_members','ext2_list_leads','ext2_add_lead','ext2_update_lead','ext2_delete_lead','assert_org_member')
  loop execute format('drop function %s', r.fn); end loop;
end $$;
commit;
notify pgrst, 'reload schema';
