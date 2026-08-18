-- =====================================================================
-- IGProspect SaaS — Migração: data em que o lead FOI CHAMADO (leads.called_at)
-- Execute no SQL Editor do Supabase.
--
-- Problema: os relatórios contavam o lead pela data da ÚLTIMA mudança de
-- etapa (status_changed_at). Como essa coluna é reescrita a cada mudança,
-- um lead chamado ontem e marcado "Enviou Contato" hoje SUMIA da contagem
-- de ontem e aparecia na de hoje — ou seja, o prospector perdia o lead
-- chamado que ele mesmo chamou, só porque o lead andou no funil depois.
--
-- Solução: uma coluna `called_at` gravada UMA ÚNICA VEZ, na primeira vez
-- que o lead sai da etapa inicial, e nunca mais atualizada. Não importa
-- pra qual etapa ele vá depois: a data em que ele foi chamado é fixa.
-- O trigger fica no nível da tabela, então vale pra qualquer origem
-- (app.js, extensão, RPCs, sync do Hub, SQL direto).
--
-- Isolamento: a coluna é por LINHA de lead, e todo lead já carrega o seu
-- org_id. Nenhum dado cruza de uma equipe pra outra por causa disso — as
-- leituras no app continuam filtrando por .eq('org_id', ...).
-- =====================================================================

alter table public.leads add column if not exists called_at timestamptz;

-- Backfill: pra quem já mudou de etapa alguma vez (status_changed_at
-- diferente de added_at), a melhor data disponível é a última mudança
-- registrada — é o único histórico que existe hoje. Quem nunca mudou de
-- etapa fica null e o app usa a data de cadastro normalmente.
update public.leads
set called_at = status_changed_at
where called_at is null
  and status_changed_at is not null
  and added_at is not null
  and status_changed_at <> added_at;

create or replace function public.leads_set_called_at()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'UPDATE') then
    -- Grava só na PRIMEIRA mudança de etapa. Depois disso, called_at é
    -- imutável — nem uma nova mudança de etapa, nem um update que tente
    -- sobrescrever a coluna, mexem nela.
    if old.called_at is not null then
      new.called_at := old.called_at;
    elsif new.status is distinct from old.status then
      new.called_at := now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_called_at on public.leads;
create trigger leads_called_at
before update on public.leads
for each row execute function public.leads_set_called_at();

create index if not exists leads_org_calledat_idx on public.leads(org_id, called_at);
