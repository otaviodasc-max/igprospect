-- =====================================================================
-- ROLLBACK da FASE C — devolve às RPCs por código de equipe o acesso
-- anônimo que a extensão 1.10.4 usa. Não mexe em dados.
-- Use se, depois da Fase C, alguém ainda depender da extensão antiga.
-- =====================================================================
begin;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code',
                        'org_leads_by_join_code','extension_add_lead','extension_update_lead',
                        'extension_delete_lead')
  loop
    execute format('grant execute on function %s to anon, authenticated', r.fn);
  end loop;
end $$;

commit;
notify pgrst, 'reload schema';
