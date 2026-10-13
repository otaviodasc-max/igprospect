-- =====================================================================
-- Conalvo — X-02 · Paridade da extensão 1.11 com o painel lateral 1.10.4
-- (ADITIVA)
-- =====================================================================
-- NÃO APLICADO EM PRODUÇÃO. Exige a X-01 (e, por ela, Fase A e P-03).
--
--   Y1. Evento "contato" (1 por lead): quando o lead passa a "Enviou contato".
--   Y2. ext2_contexto: equipe, módulo, funis (etapas e cores configuradas) e
--       se o CRM externo está ATIVO (Consórcio + token configurado). O token
--       só vai para quem pode enviar (mesmo acesso que o membro já tem hoje).
--   Y3. Consultas paginadas por equipe, nunca a equipe inteira:
--       ext2_resumo (Hoje / período, calculado no banco), ext2_listar_leads
--       (busca, etapa, funil, observação, "só meus", só contatos; cursor).
--   Y4. Edição: ext2_mudar_etapa (sem "Enviou contato" — esse tem fluxo
--       próprio; da 1ª etapa só para a 2ª, que é o chamado), ext2_salvar_nota.
--   Y5. ext2_enviar_contato: telefone + etapa de contato + evento, idempotente
--       por client_id, lead travado. Exige o chamado antes.
--   Y6. Envio ao CRM com RESERVA no banco (crm_envios): um envio por lead de
--       cada vez; sucesso só depois de o servidor gravar os ids do CRM; falha
--       clara libera nova tentativa; resultado INCERTO (sem resposta) bloqueia
--       reenvio automático até alguém confirmar — o CRM não tem chave de
--       idempotência e reenviar poderia duplicar a pessoa lá.
--   Toda RPC: login + associação ativa (assert_org_member) + lead da equipe.
-- Rollback: X-02-rollback.sql.
-- =====================================================================
begin;

do $$
declare v_msg text;
begin
  if to_regprocedure('public.ext2_registrar_acao(uuid,uuid,uuid,text)') is null then raise exception 'X-02 abortada: aplique a X-01 antes'; end if;
  select string_agg(o, ', ') into v_msg from (
    select 'tabela crm_envios' o where to_regclass('public.crm_envios') is not null
    union all
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('ext2_contexto','ext2_resumo','ext2_listar_leads','ext2_mudar_etapa','ext2_salvar_nota',
       'ext2_enviar_contato','ext2_crm_reservar','ext2_crm_concluir','ext2_crm_falhou','ext2_crm_manual','ext2_contato_key','ext2_item_json','ext2_crm_ativo')
  ) x;
  if v_msg is not null then raise exception 'X-02 abortada: já existe objeto com nome novo: %', v_msg; end if;
end $$;

-- ------------------------------------------------------------------ Y1
alter table public.lead_activity_events drop constraint lead_activity_events_kind_check;
alter table public.lead_activity_events add constraint lead_activity_events_kind_check
  check (kind in ('chamado','follow_up','seguido','respondeu','contato'));
create unique index lead_activity_um_contato on public.lead_activity_events(lead_id) where kind = 'contato' and lead_id is not null;
create index if not exists leads_org_added_idx on public.leads(org_id, added_at desc, id desc);

-- Etapa de "Enviou contato" de um funil: mesma regra da extensão 1.10.4
-- (chave 'contato'/'enviou_contato' ou rótulo "Enviou contato"/"Contato
-- enviado"/"Contato"; senão, a última etapa).
create function public.ext2_contato_key(p_stages jsonb) returns text
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(
    (select st->>'key' from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) with ordinality s(st, o)
      where st->>'key' in ('contato','enviou_contato') or lower(trim(st->>'label')) in ('enviou contato','contato enviado','contato')
      order by o limit 1),
    (select st->>'key' from jsonb_array_elements(coalesce(p_stages, '[]'::jsonb)) with ordinality s(st, o) order by o desc limit 1))
$$;

-- ------------------------------------------------------------------ Y6 (tabela)
create table public.crm_envios (
  lead_id       uuid primary key references public.leads(id) on delete cascade,
  org_id        uuid not null references public.orgs(id) on delete cascade,
  estado        text not null check (estado in ('enviando','ok','falhou','incerto','manual')),
  reserva       uuid,
  tentativas    integer not null default 0,
  iniciado_em   timestamptz,
  concluido_em  timestamptz,
  person_id     text,
  deal_id       text,
  erro          text,
  por           uuid references auth.users(id) on delete set null
);
alter table public.crm_envios enable row level security;            -- sem policy: só as RPCs
revoke all on public.crm_envios from public, anon, authenticated;

create function public.ext2_crm_ativo(p_org_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(o.module_id, 'consorcio') = 'consorcio' and coalesce(trim(o.agendor_token), '') <> '' from public.orgs o where o.id = p_org_id
$$;
revoke all on function public.ext2_crm_ativo(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ status/itens
create or replace function public.ext2_status_json(p_lead uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', l.id, 'ext_id', l.ext_id, 'name', l.name, 'username', l.username, 'status', l.status, 'phone', l.phone,
    'notes', l.notes, 'niche', l.niche, 'pipeline_id', l.pipeline_id, 'added_at', l.added_at, 'meu', l.created_by = auth.uid(),
    'etapa', (select jsonb_build_object('key', st->>'key', 'label', st->>'label', 'color', st->>'color', 'contato', st->>'key' = public.ext2_contato_key(pl.stages))
                from public.org_pipelines pl, jsonb_array_elements(pl.stages) st
               where pl.id = coalesce(l.pipeline_id, (select id from public.org_pipelines where org_id = l.org_id and is_default limit 1))
                 and st->>'key' = l.status limit 1),
    'chamado_legado', (l.called_at is not null and not exists (select 1 from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'chamado')),
    'crm', jsonb_build_object('estado', coalesce(c.estado, case when coalesce(l.agendor_person_id, '') <> '' then 'ok' end),
                              'erro', coalesce(c.erro, l.agendor_error), 'funil', l.agendor_funnel),
    'eventos', jsonb_build_object(
      'seguido',      (select min(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'seguido'),
      'chamado',      (select min(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'chamado'),
      'contato',      (select min(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'contato'),
      'ultimo_follow_up', (select max(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'follow_up'),
      'follow_up_hoje',   exists (select 1 from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'follow_up' and e.day_br = (now() at time zone 'America/Sao_Paulo')::date),
      'respondeu_hoje',   exists (select 1 from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'respondeu' and e.day_br = (now() at time zone 'America/Sao_Paulo')::date)
    ))
  from public.leads l left join public.crm_envios c on c.lead_id = l.id where l.id = p_lead
$$;
revoke all on function public.ext2_status_json(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ Y2
create function public.ext2_contexto(p_org_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_ativo boolean;
begin
  perform public.assert_org_member(p_org_id);
  v_ativo := public.ext2_crm_ativo(p_org_id);
  select jsonb_build_object(
    'org', jsonb_build_object('id', o.id, 'name', o.name, 'module_id', coalesce(o.module_id, 'consorcio')),
    'papel', (select m.role from public.org_members m where m.org_id = o.id and m.user_id = auth.uid()),
    'pipelines', coalesce((select jsonb_agg(jsonb_build_object('id', pl.id, 'name', pl.name, 'icon', pl.icon, 'is_default', pl.is_default,
                   'stages', pl.stages, 'contato_key', public.ext2_contato_key(pl.stages),
                   'crm_destinos', case when v_ativo then (select count(*) from jsonb_object_keys(coalesce(pl.agendor_map, '{}'::jsonb))) else 0 end)
                   order by pl.order_idx, pl.name) from public.org_pipelines pl where pl.org_id = o.id), '[]'::jsonb),
    'crm', jsonb_build_object('ativo', v_ativo,
             'motivo', case when coalesce(o.module_id, 'consorcio') <> 'consorcio' then 'Equipe sem integração com CRM (modo Prospecção).'
                            when coalesce(trim(o.agendor_token), '') = '' then 'Integração com o CRM não configurada pelo dono da equipe.' end))
  into v from public.orgs o where o.id = p_org_id;
  return v;
end $$;

-- ------------------------------------------------------------------ Y3
create function public.ext2_resumo(p_org_id uuid, p_de date, p_ate date, p_so_meus boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_uid uuid := auth.uid(); v_inicio date;
begin
  perform public.assert_org_member(p_org_id);
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 400 then raise exception 'Período inválido' using errcode = '22023'; end if;
  select (started_at at time zone 'America/Sao_Paulo')::date into v_inicio from public.lead_activity_log limit 1;
  select jsonb_build_object(
    'adicionados', (select count(*) from public.leads l where l.org_id = p_org_id and (l.added_at at time zone 'America/Sao_Paulo')::date between p_de and p_ate and (not p_so_meus or l.created_by = v_uid)),
    'eventos', coalesce((select jsonb_object_agg(kind, n) from (select e.kind, count(*) n from public.lead_activity_events e
                 where e.org_id = p_org_id and e.day_br between p_de and p_ate and (not p_so_meus or e.actor_id = v_uid) group by e.kind) x), '{}'::jsonb),
    'registro_desde', v_inicio,
    'incompleto', v_inicio is null or v_inicio > p_de,
    'funil', coalesce((select jsonb_agg(jsonb_build_object('key', st->>'key', 'label', st->>'label', 'color', st->>'color',
                 'n', (select count(*) from public.leads l where l.org_id = p_org_id and l.status = st->>'key' and (l.pipeline_id = pl.id or l.pipeline_id is null) and (not p_so_meus or l.created_by = v_uid)))
                 order by o)
               from public.org_pipelines pl, jsonb_array_elements(pl.stages) with ordinality s(st, o) where pl.org_id = p_org_id and pl.is_default), '[]'::jsonb),
    'recentes', coalesce((select jsonb_agg(public.ext2_status_json(r.id) order by r.added_at desc) from (
                   select l.id, l.added_at from public.leads l where l.org_id = p_org_id and (not p_so_meus or l.created_by = v_uid)
                    order by l.added_at desc nulls last limit 5) r), '[]'::jsonb))
  into v;
  return v;
end $$;

create function public.ext2_listar_leads(p_org_id uuid, p_busca text default null, p_etapa text default null, p_pipeline uuid default null,
  p_nota text default null, p_so_meus boolean default false, p_so_contatos boolean default false, p_limite integer default 25,
  p_cursor_data timestamptz default null, p_cursor_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_lim int := least(greatest(coalesce(p_limite, 25), 1), 50); v_q text := nullif(lower(trim(both '@' from trim(coalesce(p_busca, '')))), '');
        v_dig text := nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), ''); v_nota text := nullif(lower(trim(coalesce(p_nota, ''))), '');
        v_itens jsonb; v_ult record; v_n int;
begin
  perform public.assert_org_member(p_org_id);
  with pls as (       -- etapa de contato calculada UMA vez por funil (não por lead)
    select pl.id, pl.is_default, public.ext2_contato_key(pl.stages) as ck from public.org_pipelines pl where pl.org_id = p_org_id
  ), base as (
    select l.id, coalesce(l.added_at, 'epoch'::timestamptz) as k
      from public.leads l
      left join pls pl on pl.id = coalesce(l.pipeline_id, (select id from pls where is_default limit 1))
     where l.org_id = p_org_id
       and (v_q is null or l.username like '%' || v_q || '%' or lower(coalesce(l.name, '')) like '%' || v_q || '%' or (v_dig is not null and length(v_dig) >= 4 and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') like '%' || v_dig || '%'))
       and (p_etapa is null or l.status = p_etapa)
       and (p_pipeline is null or coalesce(l.pipeline_id, pl.id) = p_pipeline)
       and (v_nota is null or lower(coalesce(l.notes, '')) like '%' || v_nota || '%')
       and (not coalesce(p_so_meus, false) or l.created_by = auth.uid())
       and (not coalesce(p_so_contatos, false) or (l.status = pl.ck and coalesce(l.phone, '') <> ''))
       and (p_cursor_data is null or (coalesce(l.added_at, 'epoch'::timestamptz), l.id) < (p_cursor_data, p_cursor_id))
     order by coalesce(l.added_at, 'epoch'::timestamptz) desc, l.id desc
     limit v_lim + 1)
  select jsonb_agg(public.ext2_status_json(b.id) order by b.k desc, b.id desc) filter (where rn <= v_lim), count(*)
    into v_itens, v_n
    from (select base.*, row_number() over (order by k desc, id desc) rn from base) b;
  select k, id into v_ult from (select coalesce(l.added_at, 'epoch'::timestamptz) k, l.id from public.leads l
    where l.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(v_itens, '[]'::jsonb)) x)) z order by k asc, id asc limit 1;
  return jsonb_build_object('itens', coalesce(v_itens, '[]'::jsonb),
    'proximo', case when v_n > v_lim then jsonb_build_object('data', v_ult.k, 'id', v_ult.id) end);
end $$;

-- ------------------------------------------------------------------ Y4
create function public.ext2_mudar_etapa(p_org_id uuid, p_client_id uuid, p_lead_id uuid, p_etapa text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res jsonb; l record; v_stages jsonb; v_cur int; v_alvo int;
begin
  perform public.assert_org_member(p_org_id);
  if p_client_id is null then raise exception 'client_id obrigatório' using errcode = '22023'; end if;
  select result into v_res from public.ext_action_requests where client_id = p_client_id;
  if v_res is not null then return v_res || jsonb_build_object('repetido', true); end if;
  select * into l from public.leads where id = p_lead_id and org_id = p_org_id for update;
  if not found then raise exception 'Lead não encontrado nesta equipe' using errcode = '42501'; end if;
  select pl.stages into v_stages from public.org_pipelines pl where pl.id = coalesce(l.pipeline_id, (select id from public.org_pipelines where org_id = p_org_id and is_default limit 1));
  select (o - 1)::int into v_alvo from jsonb_array_elements(coalesce(v_stages, '[]'::jsonb)) with ordinality s(st, o) where st->>'key' = p_etapa;
  if v_alvo is null then raise exception 'Etapa não existe no funil deste lead' using errcode = '22023'; end if;
  if p_etapa = public.ext2_contato_key(v_stages) then raise exception 'Use "Enviou contato" (pede o telefone)' using errcode = '22023'; end if;
  select (o - 1)::int into v_cur from jsonb_array_elements(coalesce(v_stages, '[]'::jsonb)) with ordinality s(st, o) where st->>'key' = l.status;
  if l.called_at is null and coalesce(v_cur, 0) = 0 and v_alvo > 1 then
    raise exception 'Registre o chamado antes de avançar o lead' using errcode = '22023';
  end if;
  if l.status is distinct from p_etapa then update public.leads set status = p_etapa, updated_at = now() where id = l.id; end if;
  v_res := jsonb_build_object('registrado', l.status is distinct from p_etapa, 'lead', public.ext2_status_json(l.id));
  insert into public.ext_action_requests(client_id, org_id, user_id, kind, result) values (p_client_id, p_org_id, auth.uid(), 'etapa', v_res);
  return v_res;
end $$;

create function public.ext2_salvar_nota(p_org_id uuid, p_lead_id uuid, p_notas text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_org_member(p_org_id);
  if length(coalesce(p_notas, '')) > 4000 then raise exception 'Observação longa demais' using errcode = '22023'; end if;
  update public.leads set notes = nullif(p_notas, ''), updated_at = now() where id = p_lead_id and org_id = p_org_id;
  if not found then raise exception 'Lead não encontrado nesta equipe' using errcode = '42501'; end if;
  return public.ext2_status_json(p_lead_id);
end $$;

-- ------------------------------------------------------------------ Y5
create function public.ext2_enviar_contato(p_org_id uuid, p_client_id uuid, p_lead_id uuid, p_telefone text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res jsonb; l record; v_stages jsonb; v_key text; v_cur int; v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'); v_n int := 0;
begin
  perform public.assert_org_member(p_org_id);
  if p_client_id is null then raise exception 'client_id obrigatório' using errcode = '22023'; end if;
  select result into v_res from public.ext_action_requests where client_id = p_client_id;
  if v_res is not null then return v_res || jsonb_build_object('repetido', true); end if;
  if length(v_tel) < 10 or length(v_tel) > 13 then raise exception 'Telefone inválido (use DDD + número)' using errcode = '22023'; end if;
  select * into l from public.leads where id = p_lead_id and org_id = p_org_id for update;
  if not found then raise exception 'Lead não encontrado nesta equipe' using errcode = '42501'; end if;
  select pl.stages into v_stages from public.org_pipelines pl where pl.id = coalesce(l.pipeline_id, (select id from public.org_pipelines where org_id = p_org_id and is_default limit 1));
  v_key := public.ext2_contato_key(v_stages);
  if v_key is null then raise exception 'O funil deste lead não tem etapa de contato' using errcode = '22023'; end if;
  select (o - 1)::int into v_cur from jsonb_array_elements(coalesce(v_stages, '[]'::jsonb)) with ordinality s(st, o) where st->>'key' = l.status;
  if l.called_at is null and coalesce(v_cur, 0) = 0 then raise exception 'Registre o chamado antes do contato' using errcode = '22023'; end if;
  update public.leads set phone = v_tel, status = v_key, updated_at = now() where id = l.id;
  insert into public.lead_activity_events(org_id, lead_id, kind, stage_key, occurred_at, day_br, actor_id)
  values (p_org_id, l.id, 'contato', v_key, now(), (now() at time zone 'America/Sao_Paulo')::date, auth.uid()) on conflict do nothing;
  get diagnostics v_n = row_count;
  v_res := jsonb_build_object('registrado', v_n > 0, 'crm_ativo', public.ext2_crm_ativo(p_org_id), 'lead', public.ext2_status_json(l.id));
  insert into public.ext_action_requests(client_id, org_id, user_id, kind, result) values (p_client_id, p_org_id, auth.uid(), 'contato', v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------------ Y6 (fluxo)
-- Reserva o envio. acao: enviar | ja_enviado | em_andamento | incerto | sem_mapeamento | sem_telefone | inativo
create function public.ext2_crm_reservar(p_org_id uuid, p_lead_id uuid, p_forcar boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l record; o record; pl record; c record; v_map jsonb; v_res uuid := gen_random_uuid();
begin
  perform public.assert_org_member(p_org_id);
  if not public.ext2_crm_ativo(p_org_id) then return jsonb_build_object('acao', 'inativo'); end if;
  select * into l from public.leads where id = p_lead_id and org_id = p_org_id for update;
  if not found then raise exception 'Lead não encontrado nesta equipe' using errcode = '42501'; end if;
  if coalesce(l.agendor_person_id, '') <> '' then return jsonb_build_object('acao', 'ja_enviado'); end if;
  if coalesce(l.phone, '') = '' then return jsonb_build_object('acao', 'sem_telefone'); end if;
  select * into pl from public.org_pipelines where id = coalesce(l.pipeline_id, (select id from public.org_pipelines where org_id = p_org_id and is_default limit 1));
  v_map := coalesce(pl.agendor_map -> l.status, case when pl.agendor_map ? 'stageId' then pl.agendor_map end);
  if v_map is null or coalesce(v_map->>'stageId', '') = '' then return jsonb_build_object('acao', 'sem_mapeamento'); end if;
  select * into c from public.crm_envios where lead_id = l.id;
  if found then
    if c.estado in ('ok','manual') then return jsonb_build_object('acao', 'ja_enviado'); end if;
    if c.estado = 'enviando' and c.iniciado_em > now() - interval '2 minutes' then return jsonb_build_object('acao', 'em_andamento'); end if;
    if c.estado in ('incerto','enviando') and not coalesce(p_forcar, false) then return jsonb_build_object('acao', 'incerto', 'erro', c.erro); end if;
  end if;
  insert into public.crm_envios(lead_id, org_id, estado, reserva, tentativas, iniciado_em, erro, por)
  values (l.id, p_org_id, 'enviando', v_res, 1, now(), null, auth.uid())
  on conflict (lead_id) do update set estado = 'enviando', reserva = v_res, tentativas = crm_envios.tentativas + 1, iniciado_em = now(), erro = null, por = auth.uid();
  select * into o from public.orgs where id = p_org_id;
  return jsonb_build_object('acao', 'enviar', 'reserva', v_res, 'token', o.agendor_token, 'mapa', v_map, 'origem', pl.agendor_origin,
    'lead', jsonb_build_object('name', l.name, 'username', l.username, 'phone', l.phone, 'niche', l.niche, 'notes', l.notes));
end $$;

create function public.ext2_crm_concluir(p_org_id uuid, p_lead_id uuid, p_reserva uuid, p_person_id text, p_deal_id text, p_funil text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_org_member(p_org_id);
  if coalesce(p_person_id, '') = '' then raise exception 'Sem o id da pessoa no CRM' using errcode = '22023'; end if;
  update public.crm_envios set estado = 'ok', concluido_em = now(), person_id = p_person_id, deal_id = nullif(p_deal_id, ''), erro = null
   where lead_id = p_lead_id and org_id = p_org_id and reserva = p_reserva and estado = 'enviando';
  if not found then
    -- repetição do MESMO concluir (a resposta anterior se perdeu na rede): sucesso
    if exists (select 1 from public.crm_envios where lead_id = p_lead_id and org_id = p_org_id and reserva = p_reserva and estado = 'ok' and person_id = p_person_id) then
      return public.ext2_status_json(p_lead_id);
    end if;
    raise exception 'Reserva de envio inválida ou expirada' using errcode = '55000';
  end if;
  update public.leads set agendor_person_id = p_person_id, agendor_deal_id = nullif(p_deal_id, ''), agendor_funnel = nullif(p_funil, ''),
         agendor_status = 'ok', agendor_error = null, updated_at = now() where id = p_lead_id;
  return public.ext2_status_json(p_lead_id);
end $$;

-- p_incerto = sem resposta (o CRM pode ter criado a pessoa): bloqueia reenvio automático.
create function public.ext2_crm_falhou(p_org_id uuid, p_lead_id uuid, p_reserva uuid, p_erro text, p_incerto boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_org_member(p_org_id);
  update public.crm_envios set estado = case when p_incerto then 'incerto' else 'falhou' end, erro = left(coalesce(p_erro, 'erro'), 300)
   where lead_id = p_lead_id and org_id = p_org_id and reserva = p_reserva and estado = 'enviando';
  if not found then raise exception 'Reserva de envio inválida ou expirada' using errcode = '55000'; end if;
  update public.leads set agendor_error = left(coalesce(p_erro, 'erro'), 300) where id = p_lead_id;
  return public.ext2_status_json(p_lead_id);
end $$;

-- "Já está no CRM" (marcar à mão) e desfazer — só fora de um envio em andamento.
create function public.ext2_crm_manual(p_org_id uuid, p_lead_id uuid, p_manual boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.assert_org_member(p_org_id);
  if not exists (select 1 from public.leads where id = p_lead_id and org_id = p_org_id) then raise exception 'Lead não encontrado nesta equipe' using errcode = '42501'; end if;
  if exists (select 1 from public.crm_envios where lead_id = p_lead_id and estado = 'enviando' and iniciado_em > now() - interval '2 minutes') then
    raise exception 'Há um envio em andamento' using errcode = '55000';
  end if;
  if p_manual then
    insert into public.crm_envios(lead_id, org_id, estado, por) values (p_lead_id, p_org_id, 'manual', auth.uid())
    on conflict (lead_id) do update set estado = 'manual', erro = null, por = auth.uid();
  else
    delete from public.crm_envios where lead_id = p_lead_id and estado = 'manual';
  end if;
  return public.ext2_status_json(p_lead_id);
end $$;

do $$
declare f text;
begin
  foreach f in array array['ext2_contexto(uuid)','ext2_resumo(uuid,date,date,boolean)',
    'ext2_listar_leads(uuid,text,text,uuid,text,boolean,boolean,integer,timestamptz,uuid)','ext2_mudar_etapa(uuid,uuid,uuid,text)',
    'ext2_salvar_nota(uuid,uuid,text)','ext2_enviar_contato(uuid,uuid,uuid,text)','ext2_crm_reservar(uuid,uuid,boolean)',
    'ext2_crm_concluir(uuid,uuid,uuid,text,text,text)','ext2_crm_falhou(uuid,uuid,uuid,text,boolean)','ext2_crm_manual(uuid,uuid,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.ext2_contato_key(jsonb) from public, anon, authenticated';
end $$;

commit;
