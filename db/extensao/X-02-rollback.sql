-- =====================================================================
-- Rollback da X-02. NÃO APLICADO. Recusa se já houver evento "contato" ou
-- registro de envio ao CRM (apagar mudaria o histórico). Volta a função de
-- status para a versão da X-01.
-- =====================================================================
begin;
do $$
begin
  if exists (select 1 from public.lead_activity_events where kind = 'contato') or exists (select 1 from public.crm_envios) then
    raise exception 'Rollback X-02 recusado: há contatos/envios ao CRM registrados. Exporte e decida antes.';
  end if;
end $$;
drop function public.ext2_crm_manual(uuid,uuid,boolean);
drop function public.ext2_crm_falhou(uuid,uuid,uuid,text,boolean);
drop function public.ext2_crm_concluir(uuid,uuid,uuid,text,text,text);
drop function public.ext2_crm_reservar(uuid,uuid,boolean);
drop function public.ext2_enviar_contato(uuid,uuid,uuid,text);
drop function public.ext2_salvar_nota(uuid,uuid,text);
drop function public.ext2_mudar_etapa(uuid,uuid,uuid,text);
drop function public.ext2_listar_leads(uuid,text,text,uuid,text,boolean,boolean,integer,timestamptz,uuid);
drop function public.ext2_resumo(uuid,date,date,boolean);
drop function public.ext2_contexto(uuid);
create or replace function public.ext2_status_json(p_lead uuid) returns jsonb
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
drop table public.crm_envios;
drop function public.ext2_crm_ativo(uuid);
drop function public.ext2_contato_key(jsonb);
drop index public.lead_activity_um_contato;
drop index if exists public.leads_org_added_idx;
alter table public.lead_activity_events drop constraint lead_activity_events_kind_check;
alter table public.lead_activity_events add constraint lead_activity_events_kind_check check (kind in ('chamado','follow_up','seguido','respondeu'));
commit;
