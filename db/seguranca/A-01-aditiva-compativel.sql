-- =====================================================================
-- IGProspect — Segunda camada de isolamento · FASE A (aditiva, compatível)
-- =====================================================================
-- NÃO RODAR sem autorização. Não é aplicado automaticamente (fica fora de
-- supabase/migrations/ de propósito). Ver db/seguranca/PLANO.md.
--
-- O que esta fase faz (nada aqui apaga, move ou corrige dados existentes):
--   A1. is_org_member(org): "o usuário logado é membro ATIVO desta equipe?"
--   A2. Travas de integridade no banco (só valem para escritas NOVAS):
--       • org_id de lead/negociação/ligação não pode mudar num UPDATE;
--       • lead só pode usar funil (pipeline_id) da própria equipe;
--       • negociação/ligação só pode apontar para lead da própria equipe.
--   A3. RLS: usuário bloqueado/pendente não grava mais (antes o is_active()
--       só valia pra leitura) e não lê o chat da equipe.
--   A4. RPC anônima org_members_by_join_code para de devolver e-mail
--       (a extensão 1.10.4 só usa user_id e name).
--   A5. RPCs do painel (admin_*, create_org, join_org, switch_org, …) deixam
--       de ser executáveis por anon — só usuário logado.
--   A6. RPCs NOVAS e autenticadas para a extensão (ext2_*): exigem login
--       (auth.uid()), validam que o usuário é membro ativo da equipe pedida,
--       gravam created_by = auth.uid() (não confiam no cliente) e localizam
--       lead sempre por org_id + ext_id. Nenhum cliente usa ainda: são o
--       caminho da extensão futura (ver PLANO.md, Fase B).
--
-- O que NÃO muda nesta fase (compatibilidade com a extensão 1.10.4):
--   • org_by_join_code, org_pipeline_by_join_code, org_leads_by_join_code,
--     extension_add_lead/update/delete continuam funcionando pra anon.
--   • defaults org_id = my_org() continuam (removidos só na Fase D).
--
-- ANTES DE RODAR — diagnóstico (somente leitura), rode e guarde o resultado:
--   -- a) leads com funil de outra equipe (só informativo; não bloqueia)
--   select count(*) from public.leads l join public.org_pipelines p on p.id = l.pipeline_id where p.org_id <> l.org_id;
--   -- b) negociações/ligações apontando para lead de outra equipe
--   select count(*) from public.deals d join public.leads l on l.id = d.lead_id where l.org_id <> d.org_id;
--   select count(*) from public.calls c join public.leads l on l.id = c.lead_id where l.org_id <> c.org_id;
--   -- c) usuários bloqueados/pendentes que ainda têm equipe ativa
--   select status, count(*) from public.profiles where org_id is not null and status <> 'active' group by 1;
--   Linhas antigas inconsistentes NÃO impedem esta fase (as travas só olham
--   escritas novas / campos alterados), mas devem ir pro relatório.
--
-- ROLLBACK: db/seguranca/A-01-rollback.sql
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- A1. Associação ativa à equipe
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(p_org_id uuid)
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

-- Usado pelas ext2_*: erro padrão (42501 = insufficient_privilege).
create or replace function public.assert_org_member(p_org_id uuid)
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

-- ---------------------------------------------------------------------
-- A2. Travas de integridade (valem para qualquer origem: painel, RPC,
--     trigger ou SQL direto). SECURITY DEFINER só pra enxergar o dono real
--     do funil/lead referenciado, sem depender do RLS de quem grava.
-- ---------------------------------------------------------------------
create or replace function public.guard_leads_org()
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

create or replace function public.guard_child_org()
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

revoke execute on function public.guard_leads_org()  from public, anon, authenticated;
revoke execute on function public.guard_child_org()  from public, anon, authenticated;

drop trigger if exists leads_guard_org on public.leads;
create trigger leads_guard_org before insert or update on public.leads
  for each row execute function public.guard_leads_org();

drop trigger if exists deals_guard_org on public.deals;
create trigger deals_guard_org before insert or update on public.deals
  for each row execute function public.guard_child_org();

drop trigger if exists calls_guard_org on public.calls;
create trigger calls_guard_org before insert or update on public.calls
  for each row execute function public.guard_child_org();

-- ---------------------------------------------------------------------
-- A3. RLS: gravação também exige usuário ativo; chat só pra ativo.
--     Mesma regra de equipe de antes (org_id = my_org()).
-- ---------------------------------------------------------------------
drop policy if exists leads_org on public.leads;
create policy leads_org on public.leads for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy if exists calls_org on public.calls;
create policy calls_org on public.calls for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy if exists deals_org on public.deals;
create policy deals_org on public.deals for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy if exists weekly_payments_org on public.weekly_payments;
create policy weekly_payments_org on public.weekly_payments for all
  using      (org_id = public.my_org() and public.is_active())
  with check (org_id = public.my_org() and public.is_active());

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select
  using (org_id = public.my_org() and public.is_active());

-- ---------------------------------------------------------------------
-- A4. RPC anônima da extensão para de expor e-mail dos membros.
--     Mesma assinatura e mesmas colunas (email vem sempre nulo).
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- A5. RPCs usadas só pelo painel (sempre logado): tira de anon/PUBLIC.
--     Todas as sobrecargas existentes, seja qual for a assinatura.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- A6. RPCs autenticadas para a extensão (substitutas das *_by_join_code).
-- ---------------------------------------------------------------------
create or replace function public.ext2_my_orgs()
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

create or replace function public.ext2_org_context(p_org_id uuid)
returns table(org_id uuid, org_name text, pipeline_id uuid, stages jsonb,
              agendor_map jsonb, agendor_origin jsonb, agendor_token text)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_org_member(p_org_id);
  -- agendor_token: mesmo nível de acesso que o membro já tem hoje (orgs_select);
  -- a extensão precisa dele pra enviar ao CRM. Restringir ao dono é outra tarefa.
  return query
  select o.id, o.name, pl.id, pl.stages, pl.agendor_map, pl.agendor_origin, o.agendor_token
  from public.orgs o
  left join public.org_pipelines pl on pl.org_id = o.id and pl.is_default
  where o.id = p_org_id
  limit 1;
end; $$;

create or replace function public.ext2_org_members(p_org_id uuid)
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

-- Somente leitura (diferente de org_leads_by_join_code, que grava ext_id):
-- lead sem ext_id sai com o próprio id como identificador.
create or replace function public.ext2_list_leads(p_org_id uuid, p_limit int default 500, p_offset int default 0)
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

create or replace function public.ext2_add_lead(
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

create or replace function public.ext2_update_lead(
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

create or replace function public.ext2_delete_lead(p_org_id uuid, p_ext_id text)
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

-- ---------------------------------------------------------------------
-- VERIFICAÇÃO POSTERIOR (aborta a transação inteira se algo não bater)
-- ---------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'ext2\_%' or p.proname in ('is_org_member','assert_org_member','admin_delete_org',
         'admin_delete_user','admin_orgs','admin_users','create_org','join_org','switch_org'))
    and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_bad is not null then raise exception 'Fase A: anon ainda executa %', v_bad; end if;

  if (select count(*) from pg_trigger where tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')) <> 3 then
    raise exception 'Fase A: triggers de integridade ausentes';
  end if;
  -- compatibilidade 1.10.4: as RPCs antigas continuam com anon
  if not has_function_privilege('anon', 'public.org_by_join_code(text)', 'EXECUTE') then
    raise exception 'Fase A quebraria a extensão 1.10.4 (org_by_join_code sem anon)';
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
