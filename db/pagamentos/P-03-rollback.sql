-- =====================================================================
-- Rollback da P-03. NÃO APLICADO. Recusa rodar se já houver evento
-- registrado: apagar o registro apagaria a base de pagamentos do modelo
-- fixo. Nesse caso, exporte a tabela e decida antes, à mão.
-- =====================================================================
begin;
do $$
begin
  if to_regclass('public.lead_activity_events') is null then raise exception 'Rollback P-03: P-03 não aplicada?'; end if;
  if exists (select 1 from public.lead_activity_events) then
    raise exception 'Rollback P-03 recusado: há ações registradas. Exporte e decida antes.';
  end if;
end $$;
drop trigger leads_registrar_acao on public.leads;
drop function public.leads_registrar_acao();
drop table public.lead_activity_events;
drop function public.lead_activity_imutavel();
drop function public.lead_stage_is_followup(uuid,uuid,text);
drop function public.lead_stage_is_resposta(uuid,uuid,text);
drop table public.lead_activity_log;
commit;
