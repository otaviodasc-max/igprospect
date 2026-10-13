-- =====================================================================
-- Rollback da C-01a: devolve às RPCs por código EXATAMENTE os papéis
-- guardados (a 1.10.4 volta a sincronizar). Não mexe em dados.
-- =====================================================================
begin;
do $$
declare r record; v_roles text[]; v_role text;
begin
  if to_regclass('public.c01a_grants_anteriores') is null then raise exception 'Rollback C-01a: C-01a não aplicada?'; end if;
  for r in select objeto, roles from public.c01a_grants_anteriores loop
    v_roles := array(select jsonb_array_elements_text(r.roles));
    foreach v_role in array array['public','anon','authenticated'] loop
      if v_role = any(v_roles) then execute format('grant execute on function %s to %s', r.objeto, v_role);
      else execute format('revoke execute on function %s from %s', r.objeto, v_role); end if;
    end loop;
  end loop;
end $$;
drop table public.c01a_grants_anteriores;
commit;
notify pgrst, 'reload schema';
