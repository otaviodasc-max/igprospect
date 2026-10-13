-- =====================================================================
-- Conalvo — A-01b · Base da extensão 1.11 com login (recorte da Fase A)
-- =====================================================================
-- NÃO FAZ PARTE DO PACOTE DE PUBLICAÇÃO do painel (db/PUBLICACAO.md).
-- Versão separada, para a extensão 1.11 (extension-dev/), que depende ainda
-- da X-01 e da X-02 (db/extensao). Exige a A-01a aplicada antes.
--
-- O que faz (cópia EXATA das seções A1-assert e A6 da Fase A, revisão 5):
--   B1. assert_org_member(org): login + associação ATIVA, ou erro 42501.
--   B2. ext2_my_orgs, ext2_org_context, ext2_org_members, ext2_list_leads,
--       ext2_add_lead, ext2_update_lead, ext2_delete_lead: RPCs da extensão
--       com login (sem código de equipe, sem "quem é você"), só authenticated.
-- Não toca nas RPCs por código: a 1.10.4 continua funcionando (isso é a Fase C).
-- Fica de fora (avaliar à parte): travas de integridade (A2), RLS de usuário
-- ativo (A3), e-mail na RPC anônima (A4), revogar anon das RPCs do painel (A5).
-- Rollback: A-01b-rollback.sql (recusa se a X-01 estiver aplicada).
-- =====================================================================
begin;
do $$
declare v_msg text;
begin
  if to_regprocedure('public.org_set_goals(uuid,jsonb)') is null or to_regprocedure('public.is_org_member(uuid)') is null then
    raise exception 'A-01b abortada: aplique a A-01a antes';
  end if;
  if to_regclass('public.seguranca_estado_anterior') is not null then
    raise exception 'A-01b abortada: a Fase A completa (A-01) já está aplicada';
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_msg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname = 'assert_org_member' or p.proname like 'ext2\_%');
  if v_msg is not null then raise exception 'A-01b abortada: já existe %', v_msg; end if;
  -- a ext2_add_lead depende do índice único NÃO parcial em leads(org_id, ext_id)
  if not exists (select 1 from pg_index i where i.indrelid = 'public.leads'::regclass and i.indisunique and i.indpred is null and i.indexprs is null
      and array(select a.attname::text from unnest(i.indkey) k join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k) = array['org_id','ext_id']::text[]) then
    raise exception 'A-01b abortada: falta índice único em leads(org_id, ext_id)';
  end if;
end $$;

-- ---------------------------------------------------------------- B1
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

-- ---------------------------------------------------------------- B2
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

do $$
declare v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname = 'assert_org_member' or p.proname like 'ext2\_%')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or not p.prosecdef);
  if v_bad is not null then raise exception 'A-01b: acesso errado em %', v_bad; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'ext2\_%') <> 7 then
    raise exception 'A-01b: esperado 7 RPCs ext2_*';
  end if;
end $$;
commit;
notify pgrst, 'reload schema';
