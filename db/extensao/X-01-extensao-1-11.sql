-- =====================================================================
-- Conalvo — X-01 · RPCs da extensão 1.11 (login) com eventos reais
-- (ADITIVA)
-- =====================================================================
-- NÃO APLICADO EM PRODUÇÃO. Testado só no staging local (dev/staging) e no
-- Postgres em memória dos testes. Exige: Fase A (db/seguranca/A-01, que cria
-- assert_org_member e as ext2_*) e P-03 (db/pagamentos, registro de ações).
--
-- O que faz:
--   X1. Índice (org_id, username) para achar o lead do perfil aberto sem
--       baixar a equipe inteira (a 1.10.4 baixa TODOS os leads ao conectar).
--   X2. Registro de ações ganha "seguido" (1 por lead), independente de
--       adicionar o lead. "respondeu" (1 por lead por dia) já vem da P-03.
--   X3. ext_action_requests: cada ação da extensão leva um id gerado no
--       cliente (client_id). Repetir o MESMO id (clique duplo, timeout,
--       nova tentativa) devolve o resultado guardado, sem gravar de novo.
--   X4. ext2_lead_status: o lead do @ na equipe + etapa (cor/rótulo do funil
--       DELE) + o que já foi registrado (seguido, chamado, follow-up hoje,
--       respondeu hoje), com datas de Brasília.
--   X5. ext2_adicionar_lead: adiciona (ou devolve o existente com o mesmo @)
--       e, se pedido, registra "seguido" no mesmo passo.
--   X6. ext2_registrar_acao: seguido | chamado | follow_up | respondeu, com
--       a linha do lead travada (for update) — painel e extensão agindo ao
--       mesmo tempo não duplicam evento. Data = relógio do SERVIDOR (Brasília),
--       responsável = auth.uid(). Chamado já registrado não é refeito.
--       Follow-up/respondeu exigem o chamado antes (senão a mudança de etapa
--       geraria um chamado que ninguém clicou).
--   Toda RPC exige login e associação ATIVA à equipe (assert_org_member) e
--   confere que o lead é da equipe informada.
-- Rollback: X-01-rollback.sql.
-- =====================================================================
begin;

do $$
declare v_msg text;
begin
  if to_regprocedure('public.assert_org_member(uuid)') is null then raise exception 'X-01 abortada: aplique a Fase A antes'; end if;
  if to_regclass('public.lead_activity_events') is null then raise exception 'X-01 abortada: aplique a P-03 antes'; end if;
  if to_regclass('public.lead_activity_um_respondeu_dia') is null then raise exception 'X-01 abortada: a P-03 aplicada é anterior ao registro de respostas'; end if;
  select string_agg(o, ', ') into v_msg from (
    select 'tabela ext_action_requests' o where to_regclass('public.ext_action_requests') is not null
    union all
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('ext2_lead_status','ext2_adicionar_lead','ext2_registrar_acao','ext2_status_json')
    union all
    select 'índice ' || c.relname from pg_class c where c.relname in ('lead_activity_um_seguido')
  ) x;
  if v_msg is not null then raise exception 'X-01 abortada: já existe objeto com nome novo: %', v_msg; end if;
end $$;

-- ------------------------------------------------------------------ X1
create index if not exists leads_org_username_idx on public.leads(org_id, username);

-- ------------------------------------------------------------------ X2
alter table public.lead_activity_events drop constraint lead_activity_events_kind_check;
alter table public.lead_activity_events add constraint lead_activity_events_kind_check
  check (kind in ('chamado','follow_up','seguido','respondeu'));
create unique index lead_activity_um_seguido on public.lead_activity_events(lead_id) where kind = 'seguido' and lead_id is not null;
-- "respondeu" (1 por lead por dia, índice lead_activity_um_respondeu_dia) já vem da P-03: a
-- resposta registrada pela extensão e a entrada na etapa pelo painel caem no mesmo evento.

-- ------------------------------------------------------------------ X3
create table public.ext_action_requests (
  client_id   uuid primary key,
  org_id      uuid not null references public.orgs(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  kind        text not null,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);
alter table public.ext_action_requests enable row level security;   -- sem policy: só as RPCs
revoke all on public.ext_action_requests from public, anon, authenticated;

-- ------------------------------------------------------------------ X4
create function public.ext2_status_json(p_lead uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', l.id, 'ext_id', l.ext_id, 'name', l.name, 'username', l.username, 'status', l.status,
    'pipeline_id', l.pipeline_id, 'added_at', l.added_at,
    'etapa', (select jsonb_build_object('key', st->>'key', 'label', st->>'label', 'color', st->>'color')
                from public.org_pipelines pl, jsonb_array_elements(pl.stages) st
               where pl.id = coalesce(l.pipeline_id, (select id from public.org_pipelines where org_id = l.org_id and is_default limit 1))
                 and st->>'key' = l.status limit 1),
    'chamado_legado', (l.called_at is not null and not exists (select 1 from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'chamado')),
    'eventos', jsonb_build_object(
      'seguido',      (select min(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'seguido'),
      'chamado',      (select min(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'chamado'),
      'ultimo_follow_up', (select max(e.occurred_at) from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'follow_up'),
      'follow_up_hoje',   exists (select 1 from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'follow_up' and e.day_br = (now() at time zone 'America/Sao_Paulo')::date),
      'respondeu_hoje',   exists (select 1 from public.lead_activity_events e where e.lead_id = l.id and e.kind = 'respondeu' and e.day_br = (now() at time zone 'America/Sao_Paulo')::date)
    ))
  from public.leads l where l.id = p_lead
$$;
revoke all on function public.ext2_status_json(uuid) from public, anon, authenticated;

create function public.ext2_lead_status(p_org_id uuid, p_username text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.assert_org_member(p_org_id);
  select id into v_id from public.leads
   where org_id = p_org_id and username = lower(trim(both '@' from coalesce(p_username, '')))
   order by added_at nulls last limit 1;
  if v_id is null then return null; end if;
  return public.ext2_status_json(v_id);
end $$;

-- ------------------------------------------------------------------ X5
create function public.ext2_adicionar_lead(p_org_id uuid, p_client_id uuid, p_username text, p_name text default null,
                                           p_seguido boolean default true, p_niche text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user text := lower(trim(both '@' from coalesce(p_username, ''))); v_id uuid; v_pl uuid; v_first text; v_res jsonb; v_novo boolean := false; v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.assert_org_member(p_org_id);
  if p_client_id is null then raise exception 'client_id obrigatório' using errcode = '22023'; end if;
  if v_user !~ '^[a-z0-9._]{1,30}$' then raise exception 'Usuário do Instagram inválido' using errcode = '22023'; end if;
  select result into v_res from public.ext_action_requests where client_id = p_client_id;
  if v_res is not null then return v_res || jsonb_build_object('repetido', true); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_org_id::text || '|' || v_user, 0));    -- mesmo @ ao mesmo tempo: um só cria
  select id into v_id from public.leads where org_id = p_org_id and username = v_user order by added_at nulls last limit 1;
  if v_id is null then
    select pl.id, pl.stages -> 0 ->> 'key' into v_pl, v_first from public.org_pipelines pl where pl.org_id = p_org_id and pl.is_default limit 1;
    insert into public.leads(org_id, name, username, niche, notes, status, tipo, pipeline_id, source, ext_id, added_at, created_by)
    values (p_org_id, nullif(trim(coalesce(p_name, '')), ''), v_user, nullif(p_niche, ''), nullif(p_notes, ''),
            coalesce(v_first, 'novo'), 'comum', v_pl, 'extensao', 'x11-' || p_client_id, now(), auth.uid())
    returning id into v_id;
    v_novo := true;
  end if;
  if coalesce(p_seguido, false) then
    insert into public.lead_activity_events(org_id, lead_id, kind, stage_key, occurred_at, day_br, actor_id)
    values (p_org_id, v_id, 'seguido', null, now(), v_dia, auth.uid()) on conflict do nothing;
  end if;
  v_res := jsonb_build_object('novo', v_novo, 'lead', public.ext2_status_json(v_id));
  insert into public.ext_action_requests(client_id, org_id, user_id, kind, result) values (p_client_id, p_org_id, auth.uid(), 'adicionar', v_res);
  return v_res;
end $$;

-- ------------------------------------------------------------------ X6
create function public.ext2_registrar_acao(p_org_id uuid, p_client_id uuid, p_lead_id uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res jsonb; l record; v_stages jsonb; v_key text; v_idx int; v_cur int; v_n int := 0;
        v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform public.assert_org_member(p_org_id);
  if p_client_id is null then raise exception 'client_id obrigatório' using errcode = '22023'; end if;
  if p_kind not in ('seguido','chamado','follow_up','respondeu') then raise exception 'Ação inválida' using errcode = '22023'; end if;
  select result into v_res from public.ext_action_requests where client_id = p_client_id;
  if v_res is not null then return v_res || jsonb_build_object('repetido', true); end if;

  select * into l from public.leads where id = p_lead_id and org_id = p_org_id for update;   -- trava o lead
  if not found then raise exception 'Lead não encontrado nesta equipe' using errcode = '42501'; end if;
  select pl.stages into v_stages from public.org_pipelines pl
   where pl.id = coalesce(l.pipeline_id, (select id from public.org_pipelines where org_id = p_org_id and is_default limit 1));
  select (o - 1)::int into v_cur from jsonb_array_elements(coalesce(v_stages, '[]'::jsonb)) with ordinality s(st, o) where st->>'key' = l.status;

  if p_kind = 'seguido' then
    insert into public.lead_activity_events(org_id, lead_id, kind, occurred_at, day_br, actor_id)
    values (p_org_id, l.id, 'seguido', now(), v_dia, auth.uid()) on conflict do nothing;
    get diagnostics v_n = row_count;

  elsif p_kind = 'chamado' then
    if l.called_at is null and coalesce(v_cur, 0) = 0 then
      v_key := v_stages -> 1 ->> 'key';                     -- 2ª etapa do funil do lead
      if v_key is not null then
        update public.leads set status = v_key, updated_at = now() where id = l.id;   -- P-03 grava o evento
        select count(*) into v_n from public.lead_activity_events where lead_id = l.id and kind = 'chamado';
      end if;
    elsif not exists (select 1 from public.lead_activity_events where lead_id = l.id and kind = 'chamado') and l.called_at is null then
      insert into public.lead_activity_events(org_id, lead_id, kind, stage_key, occurred_at, day_br, actor_id)
      values (p_org_id, l.id, 'chamado', l.status, now(), v_dia, auth.uid()) on conflict do nothing;
      get diagnostics v_n = row_count;
    end if;                                                   -- já chamado (inclusive legado): nada novo

  else  -- follow_up | respondeu: 1 por lead por dia; move a etapa só para a frente
    -- Lead ainda na 1ª etapa e nunca chamado: mudar a etapa faria o banco
    -- registrar um CHAMADO que ninguém pediu (P-03). Exige o chamado antes.
    if l.called_at is null and coalesce(v_cur, 0) = 0 then
      raise exception 'Registre o chamado antes do %', case when p_kind = 'follow_up' then 'follow-up' else 'respondeu' end using errcode = '22023';
    end if;
    insert into public.lead_activity_events(org_id, lead_id, kind, stage_key, occurred_at, day_br, actor_id)
    values (p_org_id, l.id, p_kind, l.status, now(), v_dia, auth.uid()) on conflict do nothing;
    get diagnostics v_n = row_count;
    select st->>'key', (o - 1)::int into v_key, v_idx
      from jsonb_array_elements(coalesce(v_stages, '[]'::jsonb)) with ordinality s(st, o)
     where case when p_kind = 'follow_up' then lower(coalesce(st->>'label', '')) like '%follow%'
                else public.lead_stage_is_resposta(p_org_id, l.pipeline_id, st->>'key') end   -- mesmo critério da P-03 (sem "não respondeu")
     order by o limit 1;
    if v_key is not null and l.status is distinct from v_key and (p_kind = 'follow_up' or coalesce(v_cur, 0) < v_idx) then
      update public.leads set status = v_key, updated_at = now() where id = l.id;    -- o evento de hoje já existe: o trigger não duplica
    end if;
  end if;

  v_res := jsonb_build_object('registrado', v_n > 0, 'lead', public.ext2_status_json(l.id));
  insert into public.ext_action_requests(client_id, org_id, user_id, kind, result) values (p_client_id, p_org_id, auth.uid(), p_kind, v_res);
  return v_res;
end $$;

revoke all on function public.ext2_lead_status(uuid,text) from public, anon;
revoke all on function public.ext2_adicionar_lead(uuid,uuid,text,text,boolean,text,text) from public, anon;
revoke all on function public.ext2_registrar_acao(uuid,uuid,uuid,text) from public, anon;
grant execute on function public.ext2_lead_status(uuid,text) to authenticated;
grant execute on function public.ext2_adicionar_lead(uuid,uuid,text,text,boolean,text,text) to authenticated;
grant execute on function public.ext2_registrar_acao(uuid,uuid,uuid,text) to authenticated;

commit;
