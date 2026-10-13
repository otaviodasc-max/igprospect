-- =====================================================================
-- IGProspect / Conalvo — P-03 · Registro de ações (chamados e follow-ups)
-- com data e responsável (ADITIVA)
-- =====================================================================
-- NÃO APLICADO. Rodar só com autorização, à mão, seguindo PLANO.md.
--
-- Por quê: hoje cada lead guarda só a PRIMEIRA data de cada etapa
-- (stage_dates). Um segundo follow-up no mesmo lead não fica registrado, e
-- não se sabe QUEM fez a mudança. Isso basta para acompanhar, não para pagar.
--
-- O que faz (nada apaga, move ou recalcula dados):
--   R1. Tabela lead_activity_events: um evento por ação, gravado PELO
--       BANCO (trigger), nunca pelo navegador:
--         • chamado   — a primeira vez que o lead sai da 1ª etapa
--                        (o mesmo momento em que called_at é gravado);
--         • follow_up — cada entrada numa etapa cujo nome contém "follow".
--       Responsável = auth.uid() de quem fez a mudança. Mudança feita pela
--       extensão sem login (RPC anônima por código de equipe) fica SEM
--       responsável: não conta para pagamento de ninguém.
--   R2. Sem contar duas vezes: no máximo UM chamado por lead (para sempre)
--       e UM follow-up por lead por dia (horário de Brasília). Reenviar a
--       mesma etapa, ou o painel e a extensão gravarem a mesma mudança, não
--       gera evento novo (status igual não dispara nada).
--   R3. Eventos não mudam nem somem (só a cascata de apagar a equipe ou o
--       usuário, como no resto do banco). Apagar o lead mantém o evento.
--   R4. Marca a data/hora em que o registro começou: período anterior a ela
--       não tem registro completo e não pode ser pago pelo modelo fixo.
--
-- Sem backfill: o histórico antigo (stage_dates) não tem responsável nem os
-- follow-ups repetidos, então NÃO vira evento.
-- Não mexe em leads, deals, orgs, RLS/policies ou RPCs existentes.
-- Rollback: P-03-rollback.sql.
-- =====================================================================
begin;

do $$
declare v_msg text;
begin
  select string_agg(t, ', ') into v_msg
    from unnest(array['orgs','leads','org_pipelines','org_members','profiles']) t
   where to_regclass('public.' || t) is null;
  if v_msg is not null then raise exception 'P-03 abortada: falta tabela %', v_msg; end if;
  select string_agg(c, ', ') into v_msg
    from unnest(array['status','called_at','pipeline_id','org_id']) c
   where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = c);
  if v_msg is not null then raise exception 'P-03 abortada: falta leads.%', v_msg; end if;
  select string_agg(o, ', ') into v_msg from (
    select 'tabela ' || t o from unnest(array['lead_activity_events','lead_activity_log']) t where to_regclass('public.' || t) is not null
    union all
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('leads_registrar_acao','lead_activity_imutavel','lead_stage_is_followup')
    union all
    select tgname from pg_trigger where not tgisinternal and tgname in ('leads_registrar_acao','lead_activity_imutavel')
  ) x;
  if v_msg is not null then raise exception 'P-03 abortada: já existe objeto com nome novo: %', v_msg; end if;
end $$;

-- ------------------------------------------------------------------ R4
create table public.lead_activity_log (
  id          boolean primary key default true check (id),
  started_at  timestamptz not null default now()
);
insert into public.lead_activity_log default values;
alter table public.lead_activity_log enable row level security;
create policy lead_activity_log_select on public.lead_activity_log for select to authenticated using (true);
revoke all on public.lead_activity_log from public, anon, authenticated;
grant select on public.lead_activity_log to authenticated;

-- ------------------------------------------------------------------ R1
create table public.lead_activity_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete set null,
  kind         text not null check (kind in ('chamado','follow_up')),
  stage_key    text,
  occurred_at  timestamptz not null default now(),
  day_br       date not null,
  actor_id     uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
-- R2: identidade de uma ação
create unique index lead_activity_um_chamado on public.lead_activity_events(lead_id) where kind = 'chamado' and lead_id is not null;
create unique index lead_activity_um_followup_dia on public.lead_activity_events(lead_id, day_br) where kind = 'follow_up' and lead_id is not null;
create index lead_activity_org_dia on public.lead_activity_events(org_id, day_br);

alter table public.lead_activity_events enable row level security;
create policy lead_activity_events_select on public.lead_activity_events for select to authenticated
  using (
    exists (select 1 from public.org_members m join public.profiles p on p.id = m.user_id
             where m.org_id = lead_activity_events.org_id and m.user_id = auth.uid() and p.status = 'active')
    or public.is_platform_admin()
  );
revoke all on public.lead_activity_events from public, anon, authenticated;
grant select on public.lead_activity_events to authenticated;

-- A etapa é de follow-up? Mesmo critério do painel: o NOME contém "follow".
create function public.lead_stage_is_followup(p_org uuid, p_pipeline uuid, p_status text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.org_pipelines pl, jsonb_array_elements(coalesce(pl.stages, '[]'::jsonb)) st
     where pl.org_id = p_org
       and pl.id = coalesce(p_pipeline, (select id from public.org_pipelines where org_id = p_org and is_default limit 1))
       and st->>'key' = p_status
       and lower(coalesce(st->>'label', '')) like '%follow%'
  )
$$;
revoke all on function public.lead_stage_is_followup(uuid,uuid,text) from public, anon, authenticated;

create function public.leads_registrar_acao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if old.called_at is null and new.called_at is not null then
    insert into public.lead_activity_events(org_id, lead_id, kind, stage_key, occurred_at, day_br, actor_id)
    values (new.org_id, new.id, 'chamado', new.status, now(), v_dia, auth.uid())
    on conflict do nothing;
  end if;
  if new.status is distinct from old.status and public.lead_stage_is_followup(new.org_id, new.pipeline_id, new.status) then
    insert into public.lead_activity_events(org_id, lead_id, kind, stage_key, occurred_at, day_br, actor_id)
    values (new.org_id, new.id, 'follow_up', new.status, now(), v_dia, auth.uid())
    on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public.leads_registrar_acao() from public, anon, authenticated;
create trigger leads_registrar_acao
after update of status, called_at on public.leads
for each row execute function public.leads_registrar_acao();

-- ------------------------------------------------------------------ R3
create function public.lead_activity_imutavel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.orgs where id = old.org_id) then return old; end if;
    raise exception 'Registro de ação é imutável.' using errcode = 'P0001';
  end if;
  -- só as cascatas "set null" (lead ou usuário apagado)
  if (to_jsonb(new) - 'lead_id' - 'actor_id') = (to_jsonb(old) - 'lead_id' - 'actor_id')
     and (new.lead_id is not distinct from old.lead_id or (new.lead_id is null and not exists (select 1 from public.leads where id = old.lead_id)))
     and (new.actor_id is not distinct from old.actor_id or (new.actor_id is null and not exists (select 1 from auth.users where id = old.actor_id))) then
    return new;
  end if;
  raise exception 'Registro de ação é imutável.' using errcode = 'P0001';
end $$;
revoke all on function public.lead_activity_imutavel() from public, anon, authenticated;
create trigger lead_activity_imutavel before update or delete on public.lead_activity_events
for each row execute function public.lead_activity_imutavel();

-- ------------------------------------------------------------------ verificação
do $$
begin
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('leads_registrar_acao','lead_activity_imutavel')) <> 2 then
    raise exception 'P-03: triggers ausentes';
  end if;
  if exists (select 1 from public.lead_activity_events) then raise exception 'P-03: registro deveria nascer vazio (sem backfill)'; end if;
  if has_table_privilege('anon', 'public.lead_activity_events', 'select')
     or has_table_privilege('authenticated', 'public.lead_activity_events', 'insert')
     or has_table_privilege('authenticated', 'public.lead_activity_events', 'update') then
    raise exception 'P-03: privilégios mais amplos que o esperado';
  end if;
end $$;

commit;
