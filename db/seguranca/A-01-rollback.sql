-- =====================================================================
-- ROLLBACK da FASE A — volta ao comportamento anterior. Não mexe em dados.
-- Só rode se a Fase A causar problema E a Fase C ainda não tiver sido aplicada
-- (com a C aplicada, desfaça a C primeiro: C-01-rollback.sql).
-- =====================================================================
begin;

-- A2: travas de integridade
drop trigger if exists leads_guard_org on public.leads;
drop trigger if exists deals_guard_org on public.deals;
drop trigger if exists calls_guard_org on public.calls;
drop function if exists public.guard_leads_org();
drop function if exists public.guard_child_org();

-- A3: policies como estavam (is_active só no USING; chat sem is_active)
drop policy if exists leads_org on public.leads;
create policy leads_org on public.leads for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org());
drop policy if exists calls_org on public.calls;
create policy calls_org on public.calls for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org());
drop policy if exists deals_org on public.deals;
create policy deals_org on public.deals for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org());
drop policy if exists weekly_payments_org on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using (org_id = public.my_org() and public.is_active()) with check (org_id = public.my_org());
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select using (org_id = public.my_org());

-- A4: org_members_by_join_code volta a devolver e-mail
create or replace function public.org_members_by_join_code(p_code text)
returns table(user_id uuid, name text, email text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(p.name, p.email), p.email
  from public.orgs o
  join public.profiles p on p.org_id = o.id and p.status = 'active'
  where o.join_code = upper(trim(p_code))
  order by coalesce(p.name, p.email);
$$;
grant execute on function public.org_members_by_join_code(text) to anon, authenticated;

-- A5: devolve EXECUTE a anon nas RPCs do painel (estado anterior)
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
    execute format('grant execute on function %s to public, anon, authenticated', r.fn);
  end loop;
end $$;

-- A6 / A1: funções novas (nenhum cliente publicado depende delas)
drop function if exists public.ext2_my_orgs();
drop function if exists public.ext2_org_context(uuid);
drop function if exists public.ext2_org_members(uuid);
drop function if exists public.ext2_list_leads(uuid, int, int);
drop function if exists public.ext2_add_lead(uuid, text, text, text, text, text, text, text, timestamptz);
drop function if exists public.ext2_update_lead(uuid, text, text, text, text, text, text, text, text);
drop function if exists public.ext2_delete_lead(uuid, text);
drop function if exists public.assert_org_member(uuid);
drop function if exists public.is_org_member(uuid);

commit;
notify pgrst, 'reload schema';
