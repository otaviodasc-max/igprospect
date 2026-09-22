-- =====================================================================
-- ROLLBACK da FASE A — revisão 2 (2026-09-22)
-- =====================================================================
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
  delete from public.seguranca_estado_anterior where fase = 'A';
  if not exists (select 1 from public.seguranca_estado_anterior) then
    drop table public.seguranca_estado_anterior;
  end if;
end $$;

-- VERIFICAÇÃO POSTERIOR: nada da Fase A pode ter sobrado
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'ext2\_%' or p.proname in ('is_org_member','assert_org_member','guard_leads_org','guard_child_org'));
  if v_bad is not null then raise exception 'Rollback A incompleto: função remanescente %', v_bad; end if;

  if exists (select 1 from pg_trigger where not tgisinternal
              and tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')) then
    raise exception 'Rollback A incompleto: trigger remanescente';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
