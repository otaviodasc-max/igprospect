-- =====================================================================
-- ROLLBACK da FASE C — revisão 2 (2026-09-22)
-- =====================================================================
-- Devolve às RPCs por código de equipe EXATAMENTE os papéis registrados
-- por C-01 em public.seguranca_estado_anterior. Não concede nada além
-- disso (se um papel não tinha EXECUTE antes, continua sem).
-- Sem o registro, este arquivo se recusa a rodar.
-- Não mexe em dados.
-- =====================================================================

begin;

do $$
declare r record; v_roles text[]; v_role text;
begin
  if to_regclass('public.seguranca_estado_anterior') is null
     or not exists (select 1 from public.seguranca_estado_anterior where fase = 'C') then
    raise exception 'Rollback C abortado: não há estado registrado da Fase C';
  end if;
  if exists (select 1 from public.seguranca_estado_anterior where fase = 'D') then
    raise exception 'Rollback C abortado: desfaça antes a Fase D (D-01-rollback.sql)';
  end if;

  for r in select objeto, detalhe from public.seguranca_estado_anterior where fase = 'C' and tipo = 'grant_execute'
  loop
    v_roles := array(select jsonb_array_elements_text(r.detalhe->'roles'));
    foreach v_role in array array['public','anon','authenticated'] loop
      if v_role = any(v_roles) then
        execute format('grant execute on function %s to %s', r.objeto,
                       case when v_role = 'public' then 'public' else quote_ident(v_role) end);
      else
        execute format('revoke execute on function %s from %s', r.objeto,
                       case when v_role = 'public' then 'public' else quote_ident(v_role) end);
      end if;
    end loop;
  end loop;

  delete from public.seguranca_estado_anterior where fase = 'C';
end $$;

commit;
notify pgrst, 'reload schema';
