-- =====================================================================
-- Rollback da E-01. NÃO APLICADO. Desfaz só o que a E-01 criou e devolve
-- o create_org de antes (com o mesmo ACL que a create_org da E-01 tem).
-- Recusa rodar se houver pedidos gravados: apagá-los perderia o histórico
-- de quem pediu e de quem aprovou. Exporte e decida antes, à mão.
-- Equipes já criadas por pedidos continuam existindo, com seus membros.
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.org_requests') is null then raise exception 'Rollback E-01: org_requests não existe (E-01 não aplicada?)'; end if;
  if exists (select 1 from public.org_requests) then raise exception 'Rollback E-01 recusado: há pedidos gravados. Exporte e decida antes.'; end if;
end $$;
create temporary table _e01_acl on commit drop as
  select coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as papel
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = 'public.create_org(text,text)'::regprocedure and a.privilege_type = 'EXECUTE';
drop trigger org_requests_dono_ao_entrar on public.org_members;
drop function public.org_requests_dono_ao_entrar();
drop function public.admin_reject_org_request(uuid,text);
drop function public.admin_approve_org_request(uuid,text,text,uuid);
drop function public.admin_org_requests();
drop function public.my_org_requests();
drop function public.request_org(text,text,text);
drop view public.org_requests_v;
drop table public.org_requests;
drop function public.create_org(text, text);
alter function public._create_org_base(text, text) rename to create_org;
revoke all on function public.create_org(text, text) from public, anon, authenticated;
do $$
declare r record;
begin
  for r in select distinct papel from _e01_acl loop
    execute format('grant execute on function public.create_org(text, text) to %s', case when r.papel = 'public' then 'public' else quote_ident(r.papel) end);
  end loop;
end $$;
commit;
