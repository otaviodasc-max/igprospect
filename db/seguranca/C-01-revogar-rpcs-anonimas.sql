-- =====================================================================
-- IGProspect — Segunda camada · FASE C (revogação do acesso antigo)
-- Revisão 2 (2026-09-22): precondições, registro dos grants atuais e
-- garantia de que só as RPCs por código de equipe são afetadas.
-- =====================================================================
-- NÃO RODAR antes de:
--   1. Fase A aplicada (confere e aborta);
--   2. extensão com login (ext2_*) publicada E instalada por TODOS os
--      usuários ativos (ver diagnóstico de adoção abaixo);
--   3. autorização explícita do proprietário.
-- Depois desta fase a extensão 1.10.4 PARA de sincronizar.
--
-- O que faz: tira EXECUTE de public/anon/authenticated de todas as
-- sobrecargas das RPCs por código de equipe. Nenhuma função é apagada e
-- nenhum dado é tocado. O rollback devolve exatamente os papéis que
-- existiam, lidos de public.seguranca_estado_anterior.
--
-- ANTES DE RODAR — diagnóstico de adoção (somente leitura):
--   select org_id, count(*) filter (where created_by is null) as sem_autor, count(*) as total
--   from public.leads
--   where source = 'extensao' and created_at > now() - interval '7 days'
--   group by 1;
--   E nos logs da API (Dashboard → Logs → API), nenhuma chamada a
--   "/rest/v1/rpc/extension_" ou "/rest/v1/rpc/org_" nos últimos dias.
--
-- ROLLBACK: C-01-rollback.sql
-- =====================================================================

begin;

-- =====================================================================
-- 0) PRECONDIÇÕES
-- =====================================================================
do $$
declare v_msg text; v_n int;
begin
  if to_regclass('public.seguranca_estado_anterior') is null
     or not exists (select 1 from public.seguranca_estado_anterior where fase = 'A') then
    raise exception 'Fase C abortada: Fase A não aplicada (ou aplicada por outro caminho) — falta o estado anterior';
  end if;
  if to_regprocedure('public.ext2_add_lead(uuid,text,text,text,text,text,text,text,timestamptz)') is null
     or to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'Fase C abortada: objetos da Fase A ausentes';
  end if;
  if exists (select 1 from public.seguranca_estado_anterior where fase = 'C') then
    raise exception 'Fase C abortada: já existe registro de estado da Fase C (ela já foi aplicada?)';
  end if;

  -- só funções que REALMENTE usam código de equipe podem ser afetadas:
  -- se alguma da lista não usar join_code, a definição em produção diverge
  -- do esperado e a fase para (para não revogar algo não relacionado).
  select string_agg(p.oid::regprocedure::text, ', ') into v_msg
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code',
                      'org_leads_by_join_code','extension_add_lead','extension_update_lead',
                      'extension_delete_lead')
    and p.prosrc !~* '\mjoin_code\M';
  if v_msg is not null then
    raise exception 'Fase C abortada: função com nome legado mas sem uso de join_code (definição divergente): %', v_msg;
  end if;

  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code',
                      'org_leads_by_join_code','extension_add_lead','extension_update_lead',
                      'extension_delete_lead');
  if v_n < 7 then
    raise exception 'Fase C abortada: esperado pelo menos 7 funções legadas (todas as sobrecargas), encontradas %', v_n;
  end if;
end $$;

-- =====================================================================
-- 1) ESTADO ANTERIOR (base do rollback exato)
-- =====================================================================
insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'C', 'grant_execute', p.oid::regprocedure::text,
       jsonb_build_object('roles', coalesce((
         select jsonb_agg(distinct g.role order by g.role)
         from (select coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as role
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.privilege_type = 'EXECUTE') g
         where g.role in ('public','anon','authenticated')), '[]'::jsonb))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code',
                    'org_leads_by_join_code','extension_add_lead','extension_update_lead',
                    'extension_delete_lead');

-- =====================================================================
-- 2) REVOGAÇÃO (só as funções registradas acima)
-- =====================================================================
do $$
declare r record;
begin
  for r in select objeto from public.seguranca_estado_anterior where fase = 'C' and tipo = 'grant_execute'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.objeto);
  end loop;
end $$;

-- =====================================================================
-- 3) VERIFICAÇÃO POSTERIOR
-- =====================================================================
do $$
declare v_bad text;
begin
  -- nenhuma função SECURITY DEFINER que aceite código de equipe pode
  -- continuar acessível (join_org e create_org só rodam logadas e são o
  -- convite legítimo do painel; admin_orgs devolve o código só para admin)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and p.prosrc ~* '\mjoin_code\M'
    and p.proname not in ('join_org','create_org','admin_orgs')
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then raise exception 'Fase C incompleta: %', v_bad; end if;

  if has_function_privilege('anon', 'public.join_org(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_org(text,text)', 'EXECUTE') then
    raise exception 'Fase C: anon ainda executa join_org/create_org (a Fase A deveria ter revogado)';
  end if;

  -- o caminho novo tem que continuar de pé para quem está logado
  if not has_function_privilege('authenticated', 'public.ext2_list_leads(uuid,int,int)', 'EXECUTE') then
    raise exception 'Fase C: ext2_* perdeu acesso de usuário logado';
  end if;

  if (select count(*) from public.seguranca_estado_anterior where fase = 'C') < 7 then
    raise exception 'Fase C: estado anterior incompleto — rollback exato ficaria impossível';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
