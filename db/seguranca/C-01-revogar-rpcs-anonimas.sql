-- =====================================================================
-- IGProspect — Segunda camada · FASE C (revogação do acesso antigo)
-- =====================================================================
-- NÃO RODAR antes de:
--   1. Fase A aplicada (esta fase confere e aborta se não estiver);
--   2. extensão com login (ext2_*) publicada E instalada por TODOS os
--      usuários ativos — confirmar pelo diagnóstico abaixo;
--   3. autorização explícita do proprietário.
-- Depois desta fase, a extensão 1.10.4 (e qualquer anterior) PARA de
-- sincronizar: ela só sabe falar com as RPCs por código de equipe.
--
-- O que faz: tira EXECUTE de public/anon/authenticated de TODAS as
-- sobrecargas das RPCs por código de equipe. Não apaga nenhuma função
-- (rollback é só devolver o grant) e não mexe em dados. join_org continua:
-- é o "entrar na equipe pelo convite" do painel, que exige login.
--
-- ANTES DE RODAR — diagnóstico de adoção (somente leitura):
--   -- escritas da extensão pelo caminho novo (ext2_add_lead grava created_by
--   -- = auth.uid(); o antigo grava created_by escolhido ou nulo). Compare os
--   -- últimos 7 dias por equipe: o caminho antigo tem que estar zerado.
--   select org_id, count(*) filter (where created_by is null) as sem_autor,
--          count(*) as total
--   from public.leads
--   where source = 'extensao' and created_at > now() - interval '7 days'
--   group by 1;
--   -- e nos logs da API do Supabase (Dashboard → Logs → API), filtrando por
--   -- "/rest/v1/rpc/extension_" e "/rest/v1/rpc/org_", nenhuma chamada nos
--   -- últimos dias.
--
-- ROLLBACK: db/seguranca/C-01-rollback.sql
-- =====================================================================

begin;

do $$
begin
  if to_regprocedure('public.ext2_add_lead(uuid,text,text,text,text,text,text,text,timestamptz)') is null
     or to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'Fase A não aplicada — abortando Fase C';
  end if;
end $$;

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
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

-- VERIFICAÇÃO POSTERIOR: nenhuma função SECURITY DEFINER que aceite código
-- de equipe pode continuar executável por anon/authenticated (exceto join_org,
-- que exige login e é o convite legítimo do painel).
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prosrc ~* 'join_code'
    and p.proname not in ('join_org','create_org','admin_orgs')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then raise exception 'Fase C incompleta: %', v_bad; end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('join_org','create_org','admin_orgs')
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then raise exception 'Fase C: anon ainda executa %', v_bad; end if;
end $$;

commit;
notify pgrst, 'reload schema';
