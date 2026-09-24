-- =====================================================================
-- ROLLBACK da FASE A — revisão 2 (2026-09-22) · revisão 5 (2026-09-24)
-- =====================================================================
-- REV5: a verificação final deixou de ser "confio que removi o que estava
-- registrado". Agora ela confere, contra o estado gravado ANTES da remoção:
-- cada policy (comando, tipo, papéis, USING, WITH CHECK), cada grant e a
-- definição de org_members_by_join_code; e, por nome, que nenhuma função
-- ou trigger da Fase A sobrou (inclusive org_set_goals e
-- org_set_pay_recipient) e que orgs_update voltou a ser a da produção
-- (membro ativo, sem WITH CHECK).
-- Restaura EXATAMENTE o estado registrado em public.seguranca_estado_anterior
-- pela própria Fase A: as policies como estavam (mesmo comando, papéis,
-- USING e WITH CHECK), a definição anterior de org_members_by_join_code e
-- os grants que existiam antes — nada é concedido "por garantia".
--
-- Se a tabela de estado não existir (ou não tiver registros da Fase A), este
-- arquivo se RECUSA a rodar: sem ela não há como restaurar sem inventar
-- privilégios.
--
-- Rode com a Fase D e a Fase C já desfeitas (ordem D → C → A).
-- Não mexe em dados.
-- =====================================================================

begin;

do $$
declare
  r          record;
  v_n        int;
  v_roles    text[];
  v_sql      text;
  v_using    text;
  v_check    text;
begin
  ------------------------------------------------------------------ 0
  if to_regclass('public.seguranca_estado_anterior') is null then
    raise exception 'Rollback A abortado: public.seguranca_estado_anterior não existe — a Fase A não foi aplicada por este arquivo';
  end if;
  select count(*) into v_n from public.seguranca_estado_anterior where fase = 'A';
  if v_n = 0 then
    raise exception 'Rollback A abortado: nenhum registro da Fase A no estado anterior';
  end if;
  if exists (select 1 from public.seguranca_estado_anterior where fase in ('C','D')) then
    raise exception 'Rollback A abortado: existem registros das Fases C/D. Desfaça primeiro D-01-rollback.sql e C-01-rollback.sql';
  end if;

  ------------------------------------------------------------------ 1
  -- remove só o que a Fase A criou
  for r in select objeto, detalhe->>'classe' as classe
             from public.seguranca_estado_anterior
            where fase = 'A' and tipo = 'objeto_criado' and detalhe->>'classe' = 'trigger'
  loop
    execute format('drop trigger if exists %I on %s', split_part(r.objeto, '|', 1), split_part(r.objeto, '|', 2));
  end loop;

  for r in select objeto from public.seguranca_estado_anterior
            where fase = 'A' and tipo = 'objeto_criado' and detalhe->>'classe' = 'function'
  loop
    execute format('drop function if exists %s', r.objeto);
  end loop;

  ------------------------------------------------------------------ 2
  -- policies: volta cada uma exatamente como estava
  for r in select detalhe from public.seguranca_estado_anterior where fase = 'A' and tipo = 'policy'
  loop
    v_roles := array(select jsonb_array_elements_text(r.detalhe->'roles'));
    v_using := r.detalhe->>'qual';
    v_check := r.detalhe->>'with_check';
    execute format('drop policy if exists %I on public.%I', r.detalhe->>'policy', r.detalhe->>'tabela');
    v_sql := format('create policy %I on public.%I as %s for %s to %s',
                    r.detalhe->>'policy', r.detalhe->>'tabela',
                    case when r.detalhe->>'permissive' = 'RESTRICTIVE' then 'restrictive' else 'permissive' end,
                    case upper(r.detalhe->>'cmd') when 'ALL' then 'all' when 'SELECT' then 'select'
                         when 'INSERT' then 'insert' when 'UPDATE' then 'update' when 'DELETE' then 'delete'
                         else 'all' end,
                    (select string_agg(case when x = 'public' then 'public' else quote_ident(x) end, ', ')
                       from unnest(v_roles) x));
    if v_using is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
    if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
    execute v_sql;
  end loop;

  ------------------------------------------------------------------ 3
  -- função substituída: reexecuta a definição anterior, como estava
  for r in select detalhe from public.seguranca_estado_anterior where fase = 'A' and tipo = 'function_def'
  loop
    execute r.detalhe->>'definicao';
  end loop;

  ------------------------------------------------------------------ 4
  -- grants: concede exatamente os papéis registrados e tira os demais
  -- (não amplia privilégio nenhum)
  for r in select objeto, detalhe from public.seguranca_estado_anterior where fase = 'A' and tipo = 'grant_execute'
  loop
    v_roles := array(select jsonb_array_elements_text(r.detalhe->'roles'));
    foreach v_sql in array array['public','anon','authenticated'] loop
      if v_sql = any(v_roles) then
        execute format('grant execute on function %s to %s', r.objeto,
                       case when v_sql = 'public' then 'public' else quote_ident(v_sql) end);
      else
        execute format('revoke execute on function %s from %s', r.objeto,
                       case when v_sql = 'public' then 'public' else quote_ident(v_sql) end);
      end if;
    end loop;
  end loop;

  ------------------------------------------------------------------ 5
  -- CONFERÊNCIA contra o estado registrado, antes de apagar o registro
  select string_agg(e.objeto, ', ') into v_sql
  from public.seguranca_estado_anterior e
  where e.fase = 'A' and e.tipo = 'policy'
    and not exists (
      select 1 from pg_policies p
       where p.schemaname = 'public'
         and p.tablename = e.detalhe->>'tabela' and p.policyname = e.detalhe->>'policy'
         and p.cmd = e.detalhe->>'cmd' and p.permissive = e.detalhe->>'permissive'
         and to_jsonb(array(select rl::text from unnest(p.roles) rl)) = e.detalhe->'roles'
         and p.qual is not distinct from e.detalhe->>'qual'
         and p.with_check is not distinct from e.detalhe->>'with_check');
  if v_sql is not null then
    raise exception 'Rollback A incompleto: policy diferente da registrada antes da Fase A: %', v_sql;
  end if;

  select string_agg(e.objeto, ', ') into v_sql
  from public.seguranca_estado_anterior e
  where e.fase = 'A' and e.tipo = 'grant_execute'
    and (select coalesce(jsonb_agg(distinct g.role order by g.role), '[]'::jsonb)
           from (select coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as role
                   from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where p.oid = to_regprocedure(e.objeto) and a.privilege_type = 'EXECUTE') g
          where g.role in ('public','anon','authenticated'))
        is distinct from e.detalhe->'roles';
  if v_sql is not null then
    raise exception 'Rollback A incompleto: ACL diferente da registrada antes da Fase A: %', v_sql;
  end if;

  select string_agg(e.objeto, ', ') into v_sql
  from public.seguranca_estado_anterior e
  where e.fase = 'A' and e.tipo = 'function_def'
    and (select md5(regexp_replace(btrim(p.prosrc), '\s+', ' ', 'g')) from pg_proc p
          where p.oid = to_regprocedure(e.objeto)) is distinct from e.detalhe->>'hash';
  if v_sql is not null then
    raise exception 'Rollback A incompleto: definição diferente da registrada: %', v_sql;
  end if;

  delete from public.seguranca_estado_anterior where fase = 'A';
  if not exists (select 1 from public.seguranca_estado_anterior) then
    drop table public.seguranca_estado_anterior;
  end if;
end $$;

-- VERIFICAÇÃO POSTERIOR: nada da Fase A pode ter sobrado, POR NOME — não
-- depende do registro (que pode ter sido editado ou estar incompleto)
do $$
declare v_bad text; v_n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'ext2\_%' or p.proname in ('is_org_member','assert_org_member','guard_leads_org',
         'guard_child_org','org_set_goals','org_set_pay_recipient'));
  if v_bad is not null then raise exception 'Rollback A incompleto: função remanescente %', v_bad; end if;

  select string_agg(tgname || ' em ' || tgrelid::regclass::text, ', ') into v_bad
  from pg_trigger where not tgisinternal
   and tgname in ('leads_guard_org','deals_guard_org','calls_guard_org');
  if v_bad is not null then raise exception 'Rollback A incompleto: trigger remanescente %', v_bad; end if;

  -- orgs_update de volta EXATAMENTE ao estado da produção: UPDATE,
  -- PERMISSIVE, papel public, USING de membro ativo e SEM WITH CHECK
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename = 'orgs' and policyname = 'orgs_update'
     and cmd = 'UPDATE' and permissive = 'PERMISSIVE'
     and array(select r::text from unnest(roles) r) = array['public']::text[]
     and lower(regexp_replace(coalesce(qual, ''), '[()"''[:space:]]', '', 'g')) = 'id=my_organdis_activeoris_platform_admin'
     and with_check is null;
  if v_n <> 1 then
    raise exception 'Rollback A incompleto: orgs_update não voltou a ser a policy anterior (membro ativo, sem WITH CHECK)';
  end if;

  -- a tabela pode ter sido apagada logo acima: consulta dinâmica
  if to_regclass('public.seguranca_estado_anterior') is not null then
    execute 'select count(*) from public.seguranca_estado_anterior where fase = ''A''' into v_n;
    if v_n > 0 then
      raise exception 'Rollback A incompleto: registros da Fase A ficaram na tabela de estado';
    end if;
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
