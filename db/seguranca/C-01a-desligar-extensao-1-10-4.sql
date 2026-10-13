-- =====================================================================
-- Conalvo — C-01a · Desligar a extensão 1.10.4 (acesso por código de equipe)
-- =====================================================================
-- NÃO APLICAR NESTA ETAPA. É o passo FINAL da transição para a 1.11
-- (db/PUBLICACAO.md, "Transição dos usuários"). Variante da Fase C (C-01)
-- para o caminho A-01a + A-01b: a C-01 original depende do estado gravado
-- pela Fase A completa e aborta neste caminho.
--
-- Rodar só quando: a 1.11 estiver instalada por TODOS os usuários ativos e
-- o diagnóstico abaixo mostrar zero uso da 1.10.4 nos últimos dias.
-- Depois desta, a 1.10.4 PARA de sincronizar (adicionar, listar e mudar etapa).
--
-- Diagnóstico de adoção (somente leitura):
--   select org_id, count(*) filter (where actor_id is null) as sem_responsavel, count(*) as total
--     from public.lead_activity_events where occurred_at > now() - interval '7 days' group by 1;
--   (sem_responsavel > 0 = alguém ainda usa a 1.10.4 nessa equipe)
--   E nos logs da API: nenhuma chamada a /rest/v1/rpc/extension_ ou /rest/v1/rpc/org_*_by_join_code.
--
-- O que faz: tira EXECUTE de public/anon/authenticated das RPCs por código
-- de equipe (todas as sobrecargas). Nenhuma função é apagada, nenhum dado
-- é tocado. Guarda os papéis atuais em public.c01a_grants_anteriores para o
-- rollback (C-01a-rollback.sql) devolver exatamente o que havia.
-- =====================================================================
begin;
do $$
declare v_msg text; v_n int;
begin
  if to_regprocedure('public.assert_org_member(uuid)') is null or to_regprocedure('public.ext2_list_leads(uuid,int,int)') is null then
    raise exception 'C-01a abortada: aplique a A-01b antes (a 1.11 depende dela)';
  end if;
  if to_regprocedure('public.ext2_registrar_acao(uuid,uuid,uuid,text)') is null or to_regprocedure('public.ext2_contexto(uuid)') is null then
    raise exception 'C-01a abortada: aplique a X-01 e a X-02 antes (a 1.11 depende delas)';
  end if;
  if to_regclass('public.c01a_grants_anteriores') is not null then raise exception 'C-01a abortada: já aplicada'; end if;
  if to_regclass('public.seguranca_estado_anterior') is not null then raise exception 'C-01a abortada: a Fase A completa está aplicada; use a C-01'; end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_msg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code','org_leads_by_join_code',
                       'extension_add_lead','extension_update_lead','extension_delete_lead')
     and p.prosrc !~* '\mjoin_code\M';
  if v_msg is not null then raise exception 'C-01a abortada: função com nome legado sem uso de join_code: %', v_msg; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code','org_leads_by_join_code',
                                                'extension_add_lead','extension_update_lead','extension_delete_lead');
  if v_n < 7 then raise exception 'C-01a abortada: esperado pelo menos 7 funções legadas, encontradas %', v_n; end if;
end $$;

create table public.c01a_grants_anteriores (objeto text primary key, roles jsonb not null, registrado_em timestamptz not null default now());
alter table public.c01a_grants_anteriores enable row level security;   -- sem policy: a API não lê
revoke all on public.c01a_grants_anteriores from public, anon, authenticated;
insert into public.c01a_grants_anteriores (objeto, roles)
select p.oid::regprocedure::text, coalesce((
         select jsonb_agg(distinct g.role order by g.role)
           from (select coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as role
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type = 'EXECUTE') g
          where g.role in ('public','anon','authenticated')), '[]'::jsonb)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code','org_leads_by_join_code',
                                              'extension_add_lead','extension_update_lead','extension_delete_lead');
do $$
declare r record;
begin
  for r in select objeto from public.c01a_grants_anteriores loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.objeto);
  end loop;
end $$;

do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.prosrc ~* '\mjoin_code\M'
     and p.proname not in ('join_org','create_org','_create_org_base','admin_orgs','admin_approve_org_request')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_bad is not null then raise exception 'C-01a incompleta: %', v_bad; end if;
  if not has_function_privilege('authenticated', 'public.ext2_list_leads(uuid,int,int)', 'EXECUTE') then
    raise exception 'C-01a: a 1.11 perdeu acesso';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
