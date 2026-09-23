-- =====================================================================
-- IGProspect — Segunda camada de isolamento · FASE A (aditiva, compatível)
-- Revisão 2 (2026-09-22): precondições que abortam antes de qualquer
-- alteração, criação de objetos só quando inexistentes, e registro do
-- estado anterior para o rollback restaurar EXATAMENTE o que havia.
-- Revisão 4 (2026-09-23): alinhada ao DIAGNÓSTICO REAL da produção
-- (PostgreSQL 17.6). Mudanças desta revisão:
--   • a precondição de `orgs_update` passa a esperar a policy que existe DE
--     VERDADE lá (qualquer membro ativo atualiza a organização). A REV3
--     esperava a versão de supabase-lock-orgs-owner.sql, que nunca foi
--     executada em produção — a Fase A abortaria logo na primeira tentativa;
--   • `orgs_update` é substituída de propósito por uma policy de DONO ou
--     ADMIN, com USING e WITH CHECK explícitos (A7);
--   • entra a RPC mínima `org_set_goals` para o que membro comum faz hoje
--     (metas e destinatário do pagamento), sem devolver UPDATE amplo (A8);
--   • precondições agregadas de integridade (A0.8), sem exibir dado nenhum.
-- =====================================================================
-- NÃO RODAR sem autorização. Rode antes DIAGNOSTICO-00-somente-leitura.sql
-- e compare o resultado com as precondições abaixo. Ver PLANO.md.
--
-- Tudo acontece numa transação só: qualquer precondição que falhe aborta
-- o arquivo inteiro sem deixar nada pela metade.
--
-- O que esta fase faz (nada apaga, move ou corrige dados):
--   A1. is_org_member / assert_org_member — "é membro ATIVO desta equipe?"
--   A2. Travas de integridade em leads/deals/calls (org_id imutável, funil
--       e lead da mesma equipe).
--   A3. RLS: usuário bloqueado ou pendente não grava mais e não lê o chat.
--   A4. org_members_by_join_code para de devolver e-mail (mesma assinatura).
--   A5. RPCs do painel deixam de ser executáveis por public/anon.
--   A6. RPCs novas ext2_* (exigem login e associação ativa).
--   A7. orgs_update passa a ser só do DONO da equipe ativa ou do admin da
--       plataforma, com USING e WITH CHECK explícitos.
--   A8. org_set_goals: RPC mínima para a única escrita em orgs que membro
--       comum faz hoje no painel (metas e destinatário do pagamento).
--
-- Compatibilidade: a extensão 1.10.4 continua funcionando (as RPCs por
-- código de equipe não são tocadas aqui — isso é a Fase C).
--
-- ROLLBACK: A-01-rollback.sql (usa a tabela public.seguranca_estado_anterior
-- criada aqui; sem ela, o rollback se recusa a rodar).
-- =====================================================================

begin;

-- =====================================================================
-- 0) PRECONDIÇÕES — qualquer divergência aborta TUDO antes de mudar nada
-- =====================================================================
do $$
declare
  v_msg  text;
  v_hash text;
  -- hash do corpo de org_members_by_join_code esperado (versão do repositório,
  -- supabase-extension-prospector.sql). Confirme com o BLOCO 4 do diagnóstico.
  c_omjc_hash constant text := 'e0f0726f5cbcc0b33c6894ce2e5fa436';
begin
  ------------------------------------------------------------------ 0.1
  -- tabelas, colunas e tipos usados pelas travas e pelas ext2_*
  select string_agg(x.falta, ', ') into v_msg from (
    select 'tabela ' || t as falta
    from unnest(array['orgs','profiles','org_members','org_pipelines','leads','deals','calls',
                      'messages','weekly_payments','push_subscriptions']) t
    where to_regclass('public.' || t) is null
  ) x;
  if v_msg is not null then raise exception 'Fase A abortada: %', v_msg; end if;

  select string_agg(e.tab || '.' || e.col || ' (esperado ' || e.tipo || ')', ', ') into v_msg
  from (values
    ('leads','org_id','uuid'), ('leads','pipeline_id','uuid'), ('leads','created_by','uuid'),
    ('leads','ext_id','text'), ('leads','status','text'),
    ('deals','org_id','uuid'), ('deals','lead_id','uuid'),
    ('calls','org_id','uuid'), ('calls','lead_id','uuid'),
    ('org_pipelines','org_id','uuid'), ('org_pipelines','is_default','boolean'), ('org_pipelines','stages','jsonb'),
    ('org_members','org_id','uuid'), ('org_members','user_id','uuid'),
    ('profiles','org_id','uuid'), ('profiles','status','text')
  ) as e(tab, col, tipo)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = e.tab and c.column_name = e.col
      and c.data_type = case e.tipo when 'uuid' then 'uuid' when 'jsonb' then 'jsonb'
                                    when 'boolean' then 'boolean' else 'text' end);
  if v_msg is not null then raise exception 'Fase A abortada: coluna ausente ou com tipo diferente: %', v_msg; end if;

  ------------------------------------------------------------------ 0.2
  -- unicidade compatível com "on conflict (org_id, ext_id)": índice único,
  -- NÃO parcial, sem expressão, exatamente nessas duas colunas
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.leads'::regclass
      and i.indisunique and i.indpred is null and i.indexprs is null
      and array(select a.attname::text from unnest(i.indkey) k
                 join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k) = array['org_id','ext_id']::text[]
  ) then
    raise exception 'Fase A abortada: não há índice único NÃO PARCIAL em leads(org_id, ext_id) — ext2_add_lead depende dele (ver BLOCO 11 do diagnóstico)';
  end if;

  ------------------------------------------------------------------ 0.3
  -- funções auxiliares usadas nas policies precisam existir
  select string_agg(f, ', ') into v_msg
  from unnest(array['public.my_org()','public.is_active()','public.is_org_owner()','public.is_platform_admin()']) f
  where to_regprocedure(f) is null;
  if v_msg is not null then raise exception 'Fase A abortada: função auxiliar ausente: %', v_msg; end if;

  ------------------------------------------------------------------ 0.4
  -- nenhum objeto com os nomes NOVOS pode existir (nem com definição
  -- desconhecida): a fase cria, nunca substitui
  select string_agg(o.obj, ', ') into v_msg from (
    select p.oid::regprocedure::text as obj
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'ext2\_%' or p.proname in ('is_org_member','assert_org_member','guard_leads_org','guard_child_org','org_set_goals'))
    union all
    select t.tgname || ' em ' || t.tgrelid::regclass::text
      from pg_trigger t
     where not t.tgisinternal and t.tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')
    union all
    select 'tabela public.seguranca_estado_anterior'
     where to_regclass('public.seguranca_estado_anterior') is not null
  ) o;
  if v_msg is not null then
    raise exception 'Fase A abortada: já existe objeto com nome novo (definição desconhecida): %. Revise à mão antes.', v_msg;
  end if;

  ------------------------------------------------------------------ 0.5
  -- org_members_by_join_code: assinatura, retorno e DEFINIÇÃO esperados
  if to_regprocedure('public.org_members_by_join_code(text)') is null then
    raise exception 'Fase A abortada: org_members_by_join_code(text) não existe com a assinatura esperada';
  end if;
  select count(*) into v_msg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'org_members_by_join_code';
  if v_msg::int <> 1 then
    raise exception 'Fase A abortada: org_members_by_join_code tem % sobrecargas (esperado 1)', v_msg;
  end if;
  select md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')), pg_get_function_result(p.oid)
    into v_hash, v_msg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'org_members_by_join_code';
  if v_msg is distinct from 'TABLE(user_id uuid, name text, email text)' then
    raise exception 'Fase A abortada: retorno de org_members_by_join_code diferente do esperado (%). A extensão 1.10.4 depende dessas colunas.', v_msg;
  end if;
  if v_hash is distinct from c_omjc_hash then
    raise exception 'Fase A abortada: definição de org_members_by_join_code divergente (hash % ≠ esperado %). Rode o BLOCO 4 do diagnóstico, revise e só então atualize c_omjc_hash.', v_hash, c_omjc_hash;
  end if;

  ------------------------------------------------------------------ 0.6
  -- grants atuais das RPCs do painel: precisam estar no estado que o
  -- rollback vai restaurar (anon E authenticated com EXECUTE)
  select string_agg(x.obj, ', ') into v_msg from (
    select p.oid::regprocedure::text as obj
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_delete_org','admin_delete_user','admin_org_features','admin_orgs',
                        'admin_set_org_feature','admin_users','create_org','join_org','switch_org',
                        'my_orgs','my_features','promote_team_member','remove_team_member')
      -- ACL EXPLÍCITA: has_function_privilege() daria "true" só por causa do
      -- PUBLIC e esconderia um grant específico que já tivesse sido tirado
      and not (select coalesce(bool_and(papel = any(g.roles)), false)
                 from (select array(select distinct coalesce(nullif(a.grantee::regrole::text, '-'), 'public')
                                      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                     where a.privilege_type = 'EXECUTE') as roles) g,
                      unnest(array['anon','authenticated']) papel)
  ) x;
  if v_msg is not null then
    raise exception 'Fase A abortada: grants diferentes do esperado (anon+authenticated) em: %', v_msg;
  end if;

  ------------------------------------------------------------------ 0.7
  -- policies: todas as das tabelas sensíveis precisam bater EXATAMENTE com
  -- o esperado, e não pode existir nenhuma policy a mais (permissiva ou
  -- restritiva). Nada é removido automaticamente: só aborta e relata.
  with esperado(t, p, cmd, perm, q, w) as (values
    ('leads','leads_org','ALL','PERMISSIVE','org_id=my_organdis_active','org_id=my_org'),
    ('calls','calls_org','ALL','PERMISSIVE','org_id=my_organdis_active','org_id=my_org'),
    ('deals','deals_org','ALL','PERMISSIVE','org_id=my_organdis_active','org_id=my_org'),
    ('weekly_payments','weekly_payments_org','ALL','PERMISSIVE','org_id=my_organdis_active','org_id=my_org'),
    ('messages','messages_select','SELECT','PERMISSIVE','org_id=my_org',''),
    ('messages','messages_insert','INSERT','PERMISSIVE','','org_id=my_organdis_active'),
    ('messages','messages_delete','DELETE','PERMISSIVE','user_id=auth.uidoris_platform_admin',''),
    ('org_members','org_members_select','SELECT','PERMISSIVE','user_id=auth.uidoris_platform_admin',''),
    ('org_pipelines','org_pipelines_select','SELECT','PERMISSIVE','org_id=my_organdis_active',''),
    ('org_pipelines','org_pipelines_write','ALL','PERMISSIVE','org_id=my_organdis_org_owner','org_id=my_organdis_org_owner'),
    ('orgs','orgs_select','SELECT','PERMISSIVE','id=my_orgoris_platform_admin',''),
    -- ESTADO REAL DA PRODUÇÃO (diagnóstico, bloco 6): qualquer MEMBRO ATIVO
    -- atualiza a organização, e não há WITH CHECK. O repositório tem
    -- supabase-lock-orgs-owner.sql (dono), mas ele nunca foi rodado lá.
    -- É esta policy que a fase substitui, na seção A7.
    ('orgs','orgs_update','UPDATE','PERMISSIVE','id=my_organdis_activeoris_platform_admin',''),
    ('profiles','profiles_select','SELECT','PERMISSIVE','id=auth.uidororg_id=my_orgoris_platform_admin',''),
    ('profiles','profiles_update','UPDATE','PERMISSIVE','id=auth.uidoris_platform_admin',''),
    ('push_subscriptions','push_subs_select','SELECT','PERMISSIVE','user_id=auth.uidoris_platform_admin',''),
    ('push_subscriptions','push_subs_insert','INSERT','PERMISSIVE','','user_id=auth.uidandorg_id=my_organdis_active'),
    ('push_subscriptions','push_subs_update','UPDATE','PERMISSIVE','user_id=auth.uid','user_id=auth.uid'),
    ('push_subscriptions','push_subs_delete','DELETE','PERMISSIVE','user_id=auth.uidoris_platform_admin','')
  ),
  atual as (
    select tablename t, policyname p, cmd, permissive perm, array(select r::text from unnest(roles) r) roles,
           lower(regexp_replace(coalesce(qual, ''),       '[()"''[:space:]]', '', 'g')) q,
           lower(regexp_replace(coalesce(with_check, ''), '[()"''[:space:]]', '', 'g')) w
    from pg_policies
    where schemaname = 'public'
      and tablename in ('leads','calls','deals','messages','weekly_payments',
                        'orgs','profiles','org_members','org_pipelines','push_subscriptions')
  )
  select string_agg(d.obj || ' (' || d.motivo || ')', '; ') into v_msg
  from (
    select coalesce(a.t, e.t) || '.' || coalesce(a.p, e.p) as obj,
           case when a.p is null then 'policy esperada ausente'
                when e.p is null then 'policy inesperada'
                when a.roles is distinct from array['public']::text[] then 'papéis diferentes de public'
                else 'definição diferente do esperado' end as motivo
    from esperado e
    full outer join atual a on a.t = e.t and a.p = e.p
    where a.p is null or e.p is null
       or a.cmd is distinct from e.cmd or a.perm is distinct from e.perm
       or a.q is distinct from e.q or a.w is distinct from e.w
       or a.roles is distinct from array['public']::text[]
  ) d;
  if v_msg is not null then
    raise exception 'Fase A abortada: policies divergentes nas tabelas sensíveis: %. Nenhuma policy foi removida. Revise com o BLOCO 6 do diagnóstico.', v_msg;
  end if;
  ------------------------------------------------------------------ 0.8
  -- INTEGRIDADE ATUAL: as travas desta fase valem para escrita nova, mas
  -- instalar guard num banco que já tem cruzamento esconde o problema. Só
  -- contagens agregadas — nenhum id, nome ou conteúdo é exibido, e NADA é
  -- corrigido automaticamente.
  declare
    v_deals_cruzados  bigint;
    v_calls_cruzadas  bigint;
    v_leads_funil     bigint;
    v_deals_sem_lead  bigint;
    v_leads_autor     bigint;
  begin
    select count(*) into v_deals_cruzados
      from public.deals d join public.leads l on l.id = d.lead_id where l.org_id <> d.org_id;
    select count(*) into v_calls_cruzadas
      from public.calls c join public.leads l on l.id = c.lead_id where l.org_id <> c.org_id;
    select count(*) into v_leads_funil
      from public.leads l join public.org_pipelines p on p.id = l.pipeline_id where p.org_id <> l.org_id;
    select count(*) into v_deals_sem_lead
      from public.deals d where d.lead_id is null or not exists (select 1 from public.leads l where l.id = d.lead_id);
    select count(*) into v_leads_autor
      from public.leads l where l.created_by is not null
        and not exists (select 1 from public.org_members m where m.org_id = l.org_id and m.user_id = l.created_by);

    if v_deals_cruzados > 0 or v_calls_cruzadas > 0 or v_leads_funil > 0
       or v_deals_sem_lead > 0 or v_leads_autor > 0 then
      raise exception 'Fase A abortada por inconsistência histórica (nada foi criado ou alterado). Negociações com lead de outra equipe: %; ligações com lead de outra equipe: %; leads com funil de outra equipe: %; negociações sem lead: %; leads cujo autor não é membro: %. Trate cada caso à mão, com backup, antes de repetir.',
        v_deals_cruzados, v_calls_cruzadas, v_leads_funil, v_deals_sem_lead, v_leads_autor;
    end if;
  end;
end $$;

-- =====================================================================
-- 1) ESTADO ANTERIOR — base do rollback exato (sem dados pessoais)
-- =====================================================================
create table public.seguranca_estado_anterior (
  id            bigserial primary key,
  fase          text        not null check (fase in ('A','C','D')),
  tipo          text        not null check (tipo in ('grant_execute','policy','function_def','column_default','objeto_criado')),
  objeto        text        not null,
  detalhe       jsonb       not null default '{}'::jsonb,
  registrado_em timestamptz not null default now()
);
comment on table public.seguranca_estado_anterior is
  'Estado anterior às migrations de db/seguranca (grants, policies, definições e defaults). Só o rollback lê. Sem dados de clientes.';
alter table public.seguranca_estado_anterior enable row level security;
-- sem policy: nenhum papel da API (anon/authenticated) enxerga esta tabela

-- 1.1 grants atuais das RPCs do painel (só os papéis que serão mexidos)
insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'A', 'grant_execute', p.oid::regprocedure::text,
       jsonb_build_object('roles', coalesce((
         select jsonb_agg(distinct g.role order by g.role)
         from (select coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as role
               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.privilege_type = 'EXECUTE') g
         where g.role in ('public','anon','authenticated')), '[]'::jsonb))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_delete_org','admin_delete_user','admin_org_features','admin_orgs',
                    'admin_set_org_feature','admin_users','create_org','join_org','switch_org',
                    'my_orgs','my_features','promote_team_member','remove_team_member');

-- 1.2 policies que serão substituídas
insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'A', 'policy', tablename || '.' || policyname,
       jsonb_build_object('tabela', tablename, 'policy', policyname, 'cmd', cmd,
                          'permissive', permissive, 'roles', array(select r::text from unnest(roles) r),
                          'qual', qual, 'with_check', with_check)
from pg_policies
where schemaname = 'public'
  and (tablename, policyname) in (('leads','leads_org'), ('calls','calls_org'), ('deals','deals_org'),
                                  ('weekly_payments','weekly_payments_org'), ('messages','messages_select'),
                                  ('orgs','orgs_update'));

-- 1.3 definição completa da função que será substituída
insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'A', 'function_def', p.oid::regprocedure::text,
       jsonb_build_object('definicao', pg_get_functiondef(p.oid),
                          'hash', md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'org_members_by_join_code';

-- =====================================================================
-- 2) A1 — associação ativa à equipe (objetos NOVOS: create, não replace)
-- =====================================================================
create function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_org_id is not null and exists (
    select 1
    from public.org_members m
    join public.profiles p on p.id = m.user_id
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and p.status = 'active'
  );
$$;
revoke execute on function public.is_org_member(uuid) from public, anon;
grant  execute on function public.is_org_member(uuid) to authenticated;

create function public.assert_org_member(p_org_id uuid)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Login obrigatório' using errcode = '42501';
  end if;
  if not public.is_org_member(p_org_id) then
    raise exception 'Sem acesso a esta equipe' using errcode = '42501';
  end if;
end; $$;
revoke execute on function public.assert_org_member(uuid) from public, anon;
grant  execute on function public.assert_org_member(uuid) to authenticated;

-- =====================================================================
-- 3) A2 — travas de integridade entre equipe e referências
-- =====================================================================
create function public.guard_leads_org()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'org_id do lead não pode ser alterado' using errcode = '42501';
  end if;
  if new.pipeline_id is not null
     and (tg_op = 'INSERT' or new.pipeline_id is distinct from old.pipeline_id)
     and not exists (select 1 from public.org_pipelines p
                      where p.id = new.pipeline_id and p.org_id = new.org_id) then
    raise exception 'Funil de outra equipe' using errcode = '42501';
  end if;
  return new;
end; $$;

create function public.guard_child_org()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
    raise exception 'org_id não pode ser alterado (%)', tg_table_name using errcode = '42501';
  end if;
  if new.lead_id is not null
     and (tg_op = 'INSERT' or new.lead_id is distinct from old.lead_id)
     and not exists (select 1 from public.leads l
                      where l.id = new.lead_id and l.org_id = new.org_id) then
    raise exception 'Lead de outra equipe (%)', tg_table_name using errcode = '42501';
  end if;
  return new;
end; $$;

revoke execute on function public.guard_leads_org() from public, anon, authenticated;
revoke execute on function public.guard_child_org() from public, anon, authenticated;

create trigger leads_guard_org before insert or update on public.leads
  for each row execute function public.guard_leads_org();
create trigger deals_guard_org before insert or update on public.deals
  for each row execute function public.guard_child_org();
create trigger calls_guard_org before insert or update on public.calls
  for each row execute function public.guard_child_org();

-- =====================================================================
-- 4) A3 — RLS: gravar também exige usuário ativo; chat só pra ativo
-- =====================================================================
drop policy leads_org on public.leads;
create policy leads_org on public.leads for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy calls_org on public.calls;
create policy calls_org on public.calls for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy deals_org on public.deals;
create policy deals_org on public.deals for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy weekly_payments_org on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy messages_select on public.messages;
create policy messages_select on public.messages for select
  using (org_id = public.my_org() and public.is_active());

-- =====================================================================
-- 5) A4 — RPC anônima de membros para de expor e-mail
--     Mesma assinatura e mesmas colunas (email sai sempre nulo).
--     A listagem continua por profiles.org_id (equipe ATIVA), igual a hoje:
--     mudar para org_members alteraria o comportamento da extensão 1.10.4
--     (passaria a listar quem está com outra equipe aberta). O caminho novo
--     (ext2_org_members) usa org_members, que é o correto para quem
--     participa de várias equipes.
-- =====================================================================
create or replace function public.org_members_by_join_code(p_code text)
returns table(user_id uuid, name text, email text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p.id, coalesce(nullif(trim(p.name), ''), 'Membro sem nome'), null::text
  from public.orgs o
  join public.profiles p on p.org_id = o.id and p.status = 'active'
  where o.join_code = upper(trim(p_code))
  order by 2;
$$;

-- =====================================================================
-- 6) A5 — RPCs do painel saem de public/anon (continuam para logado)
-- =====================================================================
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_delete_org','admin_delete_user','admin_org_features','admin_orgs',
                        'admin_set_org_feature','admin_users','create_org','join_org','switch_org',
                        'my_orgs','my_features','promote_team_member','remove_team_member')
  loop
    execute format('grant execute on function %s to authenticated', r.fn);
    execute format('revoke execute on function %s from public, anon', r.fn);
  end loop;
end $$;

-- =====================================================================
-- 7) A6 — RPCs autenticadas para a extensão (substitutas das por código)
-- =====================================================================
create function public.ext2_my_orgs()
returns table(org_id uuid, org_name text, role text)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name, m.role
  from public.org_members m
  join public.orgs o on o.id = m.org_id
  join public.profiles p on p.id = m.user_id and p.status = 'active'
  where m.user_id = auth.uid()
  order by o.name;
$$;

create function public.ext2_org_context(p_org_id uuid)
returns table(org_id uuid, org_name text, pipeline_id uuid, stages jsonb,
              agendor_map jsonb, agendor_origin jsonb, agendor_token text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_org_member(p_org_id);
  -- agendor_token: mesmo acesso que o membro já tem hoje (orgs_select); a
  -- extensão precisa dele pra enviar ao CRM. Restringir ao dono é outra tarefa.
  return query
  select o.id, o.name, pl.id, pl.stages, pl.agendor_map, pl.agendor_origin, o.agendor_token
  from public.orgs o
  left join public.org_pipelines pl on pl.org_id = o.id and pl.is_default
  where o.id = p_org_id
  limit 1;
end; $$;

-- Lista TODOS os membros ativos da equipe (org_members), não só quem está
-- com ela aberta — é o que "quem é você" precisa quando a pessoa participa
-- de várias equipes.
create function public.ext2_org_members(p_org_id uuid)
returns table(user_id uuid, name text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_org_member(p_org_id);
  return query
  select p.id, coalesce(nullif(trim(p.name), ''), 'Membro sem nome')
  from public.org_members m
  join public.profiles p on p.id = m.user_id and p.status = 'active'
  where m.org_id = p_org_id
  order by 2;
end; $$;

-- Somente leitura (diferente de org_leads_by_join_code, que grava ext_id).
create function public.ext2_list_leads(p_org_id uuid, p_limit int default 500, p_offset int default 0)
returns table(ext_id text, name text, username text, phone text, niche text,
              status text, tipo text, notes text, added_at timestamptz)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_org_member(p_org_id);
  return query
  select coalesce(nullif(l.ext_id, ''), l.id::text), l.name, l.username, l.phone, l.niche,
         l.status, l.tipo, l.notes, l.added_at
  from public.leads l
  where l.org_id = p_org_id
  order by l.added_at desc nulls last, l.id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
end; $$;

create function public.ext2_add_lead(
  p_org_id uuid, p_ext_id text, p_name text, p_username text default '',
  p_phone text default '', p_niche text default '', p_notes text default '',
  p_status text default null, p_added_at timestamptz default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_pipeline uuid; v_first text; v_id uuid;
begin
  perform public.assert_org_member(p_org_id);
  if coalesce(trim(p_ext_id), '') = '' then
    raise exception 'ext_id obrigatório' using errcode = '22023';
  end if;
  select pl.id, pl.stages -> 0 ->> 'key' into v_pipeline, v_first
    from public.org_pipelines pl where pl.org_id = p_org_id and pl.is_default limit 1;

  insert into public.leads(org_id, name, username, phone, niche, notes, status, tipo,
                           pipeline_id, source, ext_id, added_at, created_by)
  values (p_org_id, nullif(p_name, ''), nullif(lower(p_username), ''), nullif(p_phone, ''),
          nullif(p_niche, ''), nullif(p_notes, ''),
          coalesce(nullif(p_status, ''), v_first, 'novo'), 'comum', v_pipeline, 'extensao',
          trim(p_ext_id), coalesce(p_added_at, now()), auth.uid())
  on conflict (org_id, ext_id) do nothing
  returning id into v_id;
  return v_id;  -- nulo = já existia (mesmo org_id + ext_id)
end; $$;

create function public.ext2_update_lead(
  p_org_id uuid, p_ext_id text, p_status text default null, p_phone text default null,
  p_name text default null, p_notes text default null, p_agendor_person_id text default null,
  p_agendor_deal_id text default null, p_agendor_funnel text default null
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  perform public.assert_org_member(p_org_id);
  update public.leads l set
    status            = coalesce(nullif(p_status, ''), l.status),
    phone             = coalesce(nullif(p_phone, ''), l.phone),
    name              = coalesce(nullif(p_name, ''), l.name),
    notes             = coalesce(p_notes, l.notes),
    agendor_person_id = coalesce(nullif(p_agendor_person_id, ''), l.agendor_person_id),
    agendor_deal_id   = coalesce(nullif(p_agendor_deal_id, ''), l.agendor_deal_id),
    agendor_funnel    = coalesce(nullif(p_agendor_funnel, ''), l.agendor_funnel),
    agendor_status    = case when coalesce(p_agendor_person_id, '') <> '' then 'ok' else l.agendor_status end,
    updated_at        = now()
  where l.org_id = p_org_id
    and (l.ext_id = p_ext_id or (coalesce(l.ext_id, '') = '' and l.id::text = p_ext_id));
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

create function public.ext2_delete_lead(p_org_id uuid, p_ext_id text)
returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_n integer;
begin
  perform public.assert_org_member(p_org_id);
  delete from public.leads l
  where l.org_id = p_org_id
    and (l.ext_id = p_ext_id or (coalesce(l.ext_id, '') = '' and l.id::text = p_ext_id));
  get diagnostics v_n = row_count;
  return v_n;
end; $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'ext2\_%'
  loop
    execute format('revoke execute on function %s from public, anon', r.fn);
    execute format('grant execute on function %s to authenticated', r.fn);
  end loop;
end $$;

-- =====================================================================
-- 7.1) A7 — orgs_update: só dono da equipe ativa ou admin da plataforma
-- ---------------------------------------------------------------------
-- Hoje (produção) QUALQUER MEMBRO ATIVO pode alterar a linha da organização:
-- nome, settings, module_id, agendor_token e até o join_code. No painel, as
-- telas que mexem nisso são do dono, MENOS duas — metas e destinatário do
-- pagamento —, resolvidas pela RPC da seção 7.2. Por isso o UPDATE amplo sai.
-- WITH CHECK explícito impede também mudar a linha para um estado que a
-- própria policy não permitiria.
-- =====================================================================
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update
  using      ((id = public.my_org() and public.is_org_owner()) or public.is_platform_admin())
  with check ((id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());

-- =====================================================================
-- 7.2) A8 — org_set_goals: o mínimo que o membro comum precisa
-- ---------------------------------------------------------------------
-- Substitui o UPDATE amplo em orgs para o caso legítimo que existe hoje:
-- salvar METAS (aba Metas) e o DESTINATÁRIO DO PAGAMENTO. Mexe só na chave
-- `goals` de orgs.settings, preserva todo o resto, exige login e associação
-- ATIVA à equipe e aceita apenas chaves conhecidas, com valores numéricos ou
-- texto curto (o id de quem recebe). Não dá acesso a token, join_code,
-- module_id nem nome da equipe.
-- =====================================================================
create function public.org_set_goals(p_org_id uuid, p_goals jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_goals jsonb; v_chaves text[]; v_ruim text;
begin
  perform public.assert_org_member(p_org_id);
  if p_goals is null or jsonb_typeof(p_goals) <> 'object' then
    raise exception 'Metas inválidas' using errcode = '22023';
  end if;
  v_chaves := array['contacts','sales','revenue','commission','payRate','payBonusRate',
                    'payBonusMinPerDay','payBasis','payRecipientId','dailyTarget','weeklyTarget'];
  select string_agg(k, ', ') into v_ruim
    from jsonb_object_keys(p_goals) k where k <> all(v_chaves);
  if v_ruim is not null then
    raise exception 'Metas com chave desconhecida: %', v_ruim using errcode = '22023';
  end if;
  select string_agg(k, ', ') into v_ruim
    from jsonb_each(p_goals) e(k, v)
   where jsonb_typeof(v) not in ('number','null')
     and not (jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 64);
  if v_ruim is not null then
    raise exception 'Metas com valor inválido em: %', v_ruim using errcode = '22023';
  end if;

  update public.orgs o
     set settings = coalesce(o.settings, '{}'::jsonb) || jsonb_build_object('goals', p_goals)
   where o.id = p_org_id
  returning settings -> 'goals' into v_goals;
  return v_goals;
end; $$;
revoke execute on function public.org_set_goals(uuid, jsonb) from public, anon;
grant  execute on function public.org_set_goals(uuid, jsonb) to authenticated;

-- =====================================================================
-- 8) Registro do que foi CRIADO (o rollback só remove o que está aqui)
-- =====================================================================
insert into public.seguranca_estado_anterior (fase, tipo, objeto, detalhe)
select 'A', 'objeto_criado', x.obj, jsonb_build_object('classe', x.classe)
from (
  select p.oid::regprocedure::text as obj, 'function' as classe
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'ext2\_%' or p.proname in ('is_org_member','assert_org_member','guard_leads_org','guard_child_org','org_set_goals'))
  union all
  select t.tgname || '|' || t.tgrelid::regclass::text, 'trigger'
    from pg_trigger t
   where not t.tgisinternal and t.tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')
) x;

-- =====================================================================
-- 9) VERIFICAÇÃO POSTERIOR — aborta tudo se algo não bater
-- =====================================================================
do $$
declare v_bad text; v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'ext2\_%' or p.proname in ('is_org_member','assert_org_member','admin_delete_org',
         'admin_delete_user','admin_orgs','admin_users','create_org','join_org','switch_org',
         'my_orgs','my_features','promote_team_member','remove_team_member','admin_org_features','admin_set_org_feature'))
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then raise exception 'Fase A: anon ainda executa %', v_bad; end if;

  if (select count(*) from pg_trigger where tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')) <> 3 then
    raise exception 'Fase A: triggers de integridade ausentes';
  end if;

  select count(*) into v_n from public.seguranca_estado_anterior where fase = 'A';
  if v_n < 25 then
    raise exception 'Fase A: estado anterior incompleto (% registros) — rollback exato ficaria impossível', v_n;
  end if;

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'orgs'
              and policyname = 'orgs_update'
              and lower(regexp_replace(coalesce(qual, ''), '[()"''[:space:]]', '', 'g')) <> 'id=my_organdis_org_owneroris_platform_admin') then
    raise exception 'Fase A: orgs_update não ficou restrita a dono/admin';
  end if;
  if has_function_privilege('anon', 'public.org_set_goals(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Fase A: org_set_goals acessível por anon';
  end if;

  -- compatibilidade com a extensão 1.10.4
  if not has_function_privilege('anon', 'public.org_by_join_code(text)', 'EXECUTE')
     or not has_function_privilege('anon', 'public.org_leads_by_join_code(text,int,int)', 'EXECUTE') then
    raise exception 'Fase A quebraria a extensão 1.10.4 (RPCs por código sem anon)';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
