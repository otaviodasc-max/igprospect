-- =====================================================================
-- IGProspect — DIAGNÓSTICO INTEGRAL DO BANCO (SOMENTE LEITURA)
-- =====================================================================
-- Rode ANTES de qualquer fase de db/seguranca. Ele extrai só METADADOS:
-- definições, permissões, policies, triggers, colunas, índices e
-- contagens agregadas. NÃO devolve lead, e-mail, token, código de equipe,
-- UUID, nome de pessoa nem qualquer dado pessoal.
--
-- COMO RODAR (Supabase > SQL Editor): um BLOCO POR VEZ (o editor mostra só
-- o resultado do último comando). A primeira linha de cada bloco trava a
-- sessão em somente leitura; não remova.
-- Ao terminar, feche a aba do editor (ou rode
-- "set session characteristics as transaction read write;").
--
-- O resultado deste diagnóstico é o que confirma (ou desmente) as
-- PRECONDIÇÕES da Fase A. Se algum bloco divergir do esperado, a Fase A
-- vai abortar sozinha — compare antes e ajuste o plano.
-- =====================================================================


-- ---------------------------------------------------------------------
-- BLOCO 1 — Versão do servidor e papéis da API
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select version() as servidor,
       current_setting('server_version_num') as versao_num,
       (select string_agg(rolname, ', ' order by rolname)
          from pg_roles where rolname in ('anon','authenticated','service_role','postgres')) as papeis_presentes;


-- ---------------------------------------------------------------------
-- BLOCO 2 — TODAS as funções do schema public: dono, SECURITY DEFINER,
-- proconfig (search_path) e quem pode executar. Sem corpo.
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select p.oid::regprocedure::text                      as funcao,
       pg_get_function_identity_arguments(p.oid)      as assinatura,
       pg_get_function_result(p.oid)                  as retorno,
       pg_get_userbyid(p.proowner)                    as dono,
       p.prosecdef                                    as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '(nenhum)') as proconfig,
       case p.provolatile when 'i' then 'immutable' when 's' then 'stable' else 'volatile' end as volatilidade,
       coalesce((select string_agg(distinct coalesce(nullif(a.grantee::regrole::text, '-'), 'public'), ', ')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE'), '(ninguém)') as executam,
       md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g'))        as hash_corpo,
       length(p.prosrc)                                             as tamanho_corpo
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname, assinatura;


-- ---------------------------------------------------------------------
-- BLOCO 3 — Funções SECURITY DEFINER executáveis por public, anon ou
-- authenticated (a superfície pública real do banco)
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select p.oid::regprocedure::text as funcao,
       coalesce((select string_agg(distinct coalesce(nullif(a.grantee::regrole::text, '-'), 'public'), ', ')
                   from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.privilege_type = 'EXECUTE'
                    and coalesce(nullif(a.grantee::regrole::text, '-'), 'public') in ('public','anon','authenticated')), '') as papeis_publicos,
       (p.prosrc ~* '\mjoin_code\M')                as usa_codigo_de_equipe,
       (p.prosrc ~* '\m(insert|update|delete)\M')   as escreve_dados,
       (p.prosrc ~* '\mauth\.uid\(\)')              as depende_de_login,
       coalesce(array_to_string(p.proconfig, ', '), '(nenhum)') as proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.privilege_type = 'EXECUTE'
                 and coalesce(nullif(a.grantee::regrole::text, '-'), 'public') in ('public','anon','authenticated'))
order by 1;


-- ---------------------------------------------------------------------
-- BLOCO 4 — DEFINIÇÃO COMPLETA (pg_get_functiondef) das funções afetadas
-- pelas fases A, C e D, incluindo todas as sobrecargas.
-- Contém código, não dados. É o que as precondições comparam.
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select p.oid::regprocedure::text as funcao,
       md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')) as hash_corpo,
       pg_get_functiondef(p.oid)  as definicao
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('org_by_join_code','org_members_by_join_code','org_pipeline_by_join_code',
                    'org_leads_by_join_code','extension_add_lead','extension_update_lead',
                    'extension_delete_lead','create_org','join_org','switch_org','my_orgs','my_features',
                    'promote_team_member','remove_team_member','admin_orgs','admin_users',
                    'admin_delete_org','admin_delete_user','admin_org_features','admin_set_org_feature',
                    'my_org','is_active','is_org_owner','is_platform_admin','ensure_deal_for_lead',
                    'handle_new_user','guard_profile_update','leads_set_called_at','leads_set_stage_dates',
                    'leads_set_status_changed_at')
order by 1;


-- ---------------------------------------------------------------------
-- BLOCO 5 — Os nomes que as fases vão CRIAR já existem?
-- Qualquer linha aqui faz a Fase A (ou D) abortar: o objeto precisa ser
-- novo, ou ter a definição revisada à mão antes.
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select 'funcao' as tipo, p.oid::regprocedure::text as objeto, pg_get_userbyid(p.proowner) as dono
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like 'ext2\_%'
       or p.proname in ('is_org_member','assert_org_member','guard_leads_org','guard_child_org','guard_leads_author'))
union all
select 'trigger', t.tgname || ' em ' || t.tgrelid::regclass::text, '-'
from pg_trigger t
where not t.tgisinternal
  and t.tgname in ('leads_guard_org','deals_guard_org','calls_guard_org','leads_guard_author')
union all
select 'tabela', c.oid::regclass::text, pg_get_userbyid(c.relowner)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'seguranca_estado_anterior';


-- ---------------------------------------------------------------------
-- BLOCO 6 — Policies COMPLETAS das tabelas sensíveis (permissiva x
-- restritiva, papéis, USING e WITH CHECK)
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select tablename as tabela, policyname as policy, cmd as comando,
       permissive as tipo, roles::text as papeis,
       coalesce(qual, '(sem USING)')            as using_expr,
       coalesce(with_check, '(sem WITH CHECK)') as with_check_expr,
       -- forma normalizada: é ela que as precondições comparam
       lower(regexp_replace(coalesce(qual, ''),       '[()"''[:space:]]', '', 'g')) as using_normalizado,
       lower(regexp_replace(coalesce(with_check, ''), '[()"''[:space:]]', '', 'g')) as check_normalizado
from pg_policies
where schemaname = 'public'
  and tablename in ('leads','calls','deals','messages','weekly_payments',
                    'orgs','profiles','org_members','org_pipelines','push_subscriptions',
                    'org_niches','org_deal_stages','org_call_outcomes','features','org_features')
order by tablename, policyname;


-- ---------------------------------------------------------------------
-- BLOCO 7 — RLS ligado/forçado e privilégios de TABELA dos papéis da API
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select c.relname as tabela, c.relrowsecurity as rls_ligado, c.relforcerowsecurity as rls_forcado,
       (select count(*) from pg_policies pp where pp.schemaname = 'public' and pp.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by 1;

set session characteristics as transaction read only;
select grantee as papel, table_name as tabela, string_agg(privilege_type, ', ' order by privilege_type) as privilegios
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated','public')
group by 1, 2
order by 1, 2;


-- ---------------------------------------------------------------------
-- BLOCO 8 — Triggers existentes e suas definições
-- CORRIGIDO (REV4): a versão anterior comparava t.tgrelid::regclass::text com
-- 'public.leads' etc. Dependendo do search_path, regclass::text devolve o nome
-- SEM o schema ('leads'), e o bloco vinha VAZIO na produção — escondendo todos
-- os triggers. Agora a comparação é por OID (regclass direto), que independe
-- de como o nome é impresso.
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select t.tgrelid::regclass::text as tabela, t.tgname as trigger, t.tgenabled as habilitado,
       p.oid::regprocedure::text as funcao, pg_get_triggerdef(t.oid) as definicao
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and t.tgrelid = any (array['public.leads'::regclass, 'public.calls'::regclass, 'public.deals'::regclass,
                             'public.messages'::regclass, 'public.profiles'::regclass, 'public.orgs'::regclass,
                             'public.org_members'::regclass, 'public.weekly_payments'::regclass,
                             'public.push_subscriptions'::regclass, 'public.org_pipelines'::regclass])
order by 1, 2;

-- trigger de criação de perfil (fica no schema auth)
set session characteristics as transaction read only;
select t.tgrelid::regclass::text as tabela, t.tgname as trigger, pg_get_triggerdef(t.oid) as definicao
from pg_trigger t where not t.tgisinternal and t.tgrelid = 'auth.users'::regclass;


-- ---------------------------------------------------------------------
-- BLOCO 9 — Coluna org_id em todas as tabelas: tipo, nulabilidade e default
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select c.table_name as tabela, c.data_type as tipo, c.is_nullable as aceita_nulo,
       coalesce(c.column_default, '(sem default)') as padrao
from information_schema.columns c
where c.table_schema = 'public' and c.column_name = 'org_id'
order by 1;

-- colunas que as fases usam nos leads e nas tabelas filhas
set session characteristics as transaction read only;
select table_name as tabela, column_name as coluna, data_type as tipo, is_nullable as aceita_nulo
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'leads'   and column_name in ('id','org_id','pipeline_id','created_by','ext_id','status','source'))
    or (table_name in ('deals','calls') and column_name in ('id','org_id','lead_id'))
    or (table_name = 'org_pipelines' and column_name in ('id','org_id','is_default','stages'))
    or (table_name = 'org_members'   and column_name in ('org_id','user_id','role'))
    or (table_name = 'profiles'      and column_name in ('id','org_id','status','platform_role')))
order by 1, 2;


-- ---------------------------------------------------------------------
-- BLOCO 10 — Constraints e índices relevantes
-- ---------------------------------------------------------------------
-- CORRIGIDO (REV4): "constraint" é palavra reservada e dava erro de sintaxe
-- no PostgreSQL 17.6 — virou nome_constraint. A comparação também passou a ser
-- por OID (regclass), como no bloco 8.
set session characteristics as transaction read only;
select conrelid::regclass::text as tabela, conname as nome_constraint, contype as tipo,
       pg_get_constraintdef(oid) as definicao
from pg_constraint
where conrelid = any (array['public.leads'::regclass, 'public.deals'::regclass, 'public.calls'::regclass,
                            'public.orgs'::regclass, 'public.profiles'::regclass, 'public.org_members'::regclass,
                            'public.org_pipelines'::regclass, 'public.messages'::regclass,
                            'public.weekly_payments'::regclass, 'public.push_subscriptions'::regclass])
order by 1, 2;

set session characteristics as transaction read only;
select tablename as tabela, indexname as indice, indexdef as definicao
from pg_indexes
where schemaname = 'public'
  and tablename in ('leads','deals','calls','orgs','org_members','org_pipelines','messages','weekly_payments','push_subscriptions')
order by 1, 2;


-- ---------------------------------------------------------------------
-- BLOCO 11 — CONFIRMAÇÃO da unicidade compatível com
-- "on conflict (org_id, ext_id)"
-- Tem que existir índice ÚNICO, NÃO PARCIAL, exatamente em (org_id, ext_id).
-- Índice único PARCIAL (com WHERE) não serve pro ON CONFLICT do supabase-js.
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select i.indexrelid::regclass::text as indice,
       i.indisunique   as e_unico,
       (i.indpred is null) as sem_where_parcial,
       (i.indexprs is null) as sem_expressao,
       array(select a.attname::text from unnest(i.indkey) k join pg_attribute a
              on a.attrelid = i.indrelid and a.attnum = k) as colunas,
       case when i.indisunique and i.indpred is null and i.indexprs is null
             and array(select a.attname::text from unnest(i.indkey) k join pg_attribute a
                        on a.attrelid = i.indrelid and a.attnum = k) = array['org_id','ext_id']::text[]
            then 'COMPATÍVEL com on conflict (org_id, ext_id)'
            else 'não serve para on conflict (org_id, ext_id)' end as veredito
from pg_index i
where i.indrelid = 'public.leads'::regclass
order by 1;


-- ---------------------------------------------------------------------
-- BLOCO 12 — Contagens agregadas e anônimas (sem nenhum dado pessoal).
-- Servem para dimensionar impacto e para as precondições da Fase D.
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select 'equipes'                                          as metrica, count(*)::bigint as valor from public.orgs
union all select 'equipes com código curto (<12)',        count(*) from public.orgs where length(join_code) < 12
union all select 'perfis',                                count(*) from public.profiles
union all select 'perfis por status: active',             count(*) from public.profiles where status = 'active'
union all select 'perfis por status: blocked',            count(*) from public.profiles where status = 'blocked'
union all select 'perfis por status: pending',            count(*) from public.profiles where status = 'pending'
union all select 'perfis com equipe ativa SEM associação (bloqueia Fase D)',
                 count(*) from public.profiles pr
                  where pr.org_id is not null
                    and not exists (select 1 from public.org_members m where m.org_id = pr.org_id and m.user_id = pr.id)
union all select 'usuários em mais de uma equipe',
                 count(*) from (select user_id from public.org_members group by user_id having count(*) > 1) x
union all select 'leads',                                  count(*) from public.leads
union all select 'leads com funil de OUTRA equipe',
                 count(*) from public.leads l join public.org_pipelines p on p.id = l.pipeline_id where p.org_id <> l.org_id
union all select 'leads cujo autor não é membro da equipe',
                 count(*) from public.leads l
                  where l.created_by is not null
                    and not exists (select 1 from public.org_members m where m.org_id = l.org_id and m.user_id = l.created_by)
union all select 'leads sem ext_id',                       count(*) from public.leads where coalesce(ext_id, '') = ''
union all select 'negociações apontando lead de outra equipe',
                 count(*) from public.deals d join public.leads l on l.id = d.lead_id where l.org_id <> d.org_id
union all select 'ligações apontando lead de outra equipe',
                 count(*) from public.calls c join public.leads l on l.id = c.lead_id where l.org_id <> c.org_id
union all select 'inscrições de push',                     count(*) from public.push_subscriptions;


-- ---------------------------------------------------------------------
-- BLOCO 13 — Publicações do Realtime (quem recebe eventos)
-- ---------------------------------------------------------------------
set session characteristics as transaction read only;
select pubname as publicacao, schemaname as schema, tablename as tabela
from pg_publication_tables order by 1, 3;

-- FIM. Nenhum comando deste arquivo altera dados, estrutura ou permissões.
