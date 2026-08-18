-- =====================================================================
-- IGProspect SaaS — Migração: data de entrada em CADA etapa (leads.stage_dates)
-- Execute no SQL Editor do Supabase (depois de supabase-lead-called-at.sql).
--
-- Problema: o lead tinha UMA data só pro relatório. Arrastar um lead de
-- "Chamado" pra "Respondeu 2ª Abordagem" fazia ele contar todo no dia da
-- 2ª abordagem — e sumir do dia em que foi chamado. Quem prospecta recebe
-- por lead chamado, então no fim do mês faltava lead na conta e a pessoa
-- recebia a menos.
--
-- Solução: `stage_dates`, um mapa {etapa: data da PRIMEIRA vez que o lead
-- entrou nela}. Cada etapa passa a ter a sua própria data, gravada uma
-- única vez e nunca reescrita. O mesmo lead conta em "Chamado" no dia em
-- que foi chamado E em "Respondeu 2ª Abordagem" no dia em que respondeu —
-- uma etapa não desconta da outra, nunca.
--
-- Funciona com QUALQUER funil: as chaves são as etapas que a própria
-- equipe criou (nada é fixo em 'chamado'/'contato'), e o trigger é no
-- nível da tabela, então vale pra app.js, extensão, RPCs e sync do Hub.
--
-- Isolamento: a coluna é por LINHA de lead, e todo lead carrega o seu
-- org_id. Nada cruza de uma equipe pra outra — as leituras no app
-- continuam filtrando por .eq('org_id', ...).
-- =====================================================================

alter table public.leads add column if not exists stage_dates jsonb not null default '{}'::jsonb;

-- Backfill: o único histórico que existe hoje é a etapa atual + a data da
-- última mudança (status_changed_at) e a data do chamado (called_at).
-- Registramos a etapa atual com a data dela; as etapas anteriores ficam de
-- fora e o app cai no fallback (ver leadStageDate em app.js).
update public.leads
set stage_dates = jsonb_build_object(status, to_jsonb(coalesce(status_changed_at, added_at, now())))
where stage_dates = '{}'::jsonb and status is not null;

create or replace function public.leads_set_stage_dates()
returns trigger language plpgsql as $$
declare cur jsonb;
begin
  if (TG_OP = 'INSERT') then
    cur := coalesce(new.stage_dates, '{}'::jsonb);
    if new.status is not null and not (cur ? new.status) then
      cur := cur || jsonb_build_object(new.status, to_jsonb(coalesce(new.added_at, now())));
    end if;
    new.stage_dates := cur;
  elsif (TG_OP = 'UPDATE') then
    -- Parte de stage_dates ANTIGO, nunca do que veio no update: assim
    -- nenhuma data já gravada pode ser apagada ou reescrita por um client.
    cur := coalesce(old.stage_dates, '{}'::jsonb);
    if new.status is distinct from old.status and new.status is not null and not (cur ? new.status) then
      cur := cur || jsonb_build_object(new.status, to_jsonb(now()));
    end if;
    new.stage_dates := cur;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_stage_dates on public.leads;
create trigger leads_stage_dates
before insert or update on public.leads
for each row execute function public.leads_set_stage_dates();
