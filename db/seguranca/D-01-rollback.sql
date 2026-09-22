-- =====================================================================
-- ROLLBACK da FASE D — revisão 2 (2026-09-22)
-- =====================================================================
-- Restaura os defaults de org_id e as policies EXATAMENTE como registrados
-- por D-01 em public.seguranca_estado_anterior, e remove a trava de autor.
-- Só restaura default cuja definição anterior está registrada: sem registro,
-- o arquivo se recusa a rodar. Não mexe em dados.
-- Rode ANTES de C-01-rollback.sql e A-01-rollback.sql.
-- =====================================================================

begin;

do $$
declare r record; v_roles text[]; v_sql text; v_using text; v_check text; v_default text;
begin
  if to_regclass('public.seguranca_estado_anterior') is null
     or not exists (select 1 from public.seguranca_estado_anterior where fase = 'D') then
    raise exception 'Rollback D abortado: não há estado registrado da Fase D';
  end if;

  -- 1) trava de autor (só o que a Fase D criou)
  for r in select objeto from public.seguranca_estado_anterior
            where fase = 'D' and tipo = 'objeto_criado' and detalhe->>'classe' = 'trigger'
  loop
    execute format('drop trigger if exists %I on %s', split_part(r.objeto, '|', 1), split_part(r.objeto, '|', 2));
  end loop;
  for r in select objeto from public.seguranca_estado_anterior
            where fase = 'D' and tipo = 'objeto_criado' and detalhe->>'classe' = 'function'
  loop
    execute format('drop function if exists %s', r.objeto);
  end loop;

  -- 2) defaults: só volta o que estiver registrado
  for r in select detalhe from public.seguranca_estado_anterior where fase = 'D' and tipo = 'column_default'
  loop
    v_default := r.detalhe->>'default';
    if v_default is null then
      raise exception 'Rollback D abortado: default anterior de %.% não foi registrado', r.detalhe->>'tabela', r.detalhe->>'coluna';
    end if;
    execute format('alter table public.%I alter column %I set default %s',
                   r.detalhe->>'tabela', r.detalhe->>'coluna', v_default);
  end loop;

  -- 3) policies como estavam depois da Fase A
  for r in select detalhe from public.seguranca_estado_anterior where fase = 'D' and tipo = 'policy'
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

  delete from public.seguranca_estado_anterior where fase = 'D';
end $$;

-- VERIFICAÇÃO POSTERIOR
do $$
declare v_bad text;
begin
  select string_agg(table_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'public' and column_name = 'org_id' and column_default is null
    and table_name in ('leads','calls','deals','messages','weekly_payments','push_subscriptions');
  if v_bad is not null then raise exception 'Rollback D incompleto: default ausente em %', v_bad; end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname = 'leads_guard_author') then
    raise exception 'Rollback D incompleto: trigger de autor remanescente';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
