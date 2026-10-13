-- Rollback da X-01. NÃO APLICADO. Recusa se já houver evento "seguido"
-- (voltar a restrição de tipos apagaria esse histórico). "respondeu" é da P-03.
begin;
do $$
begin
  if exists (select 1 from public.lead_activity_events where kind = 'seguido') then
    raise exception 'Rollback X-01 recusado: há eventos "seguido" registrados. Exporte e decida antes.';
  end if;
end $$;
drop function public.ext2_registrar_acao(uuid,uuid,uuid,text);
drop function public.ext2_adicionar_lead(uuid,uuid,text,text,boolean,text,text);
drop function public.ext2_lead_status(uuid,text);
drop function public.ext2_status_json(uuid);
drop table public.ext_action_requests;
drop index public.lead_activity_um_seguido;
alter table public.lead_activity_events drop constraint lead_activity_events_kind_check;
alter table public.lead_activity_events add constraint lead_activity_events_kind_check check (kind in ('chamado','follow_up','respondeu'));
drop index if exists public.leads_org_username_idx;
commit;
