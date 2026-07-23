-- =====================================================================
-- IGProspect SaaS — Migração: data de mudança de etapa (leads.status_changed_at)
-- Execute no SQL Editor do Supabase.
--
-- Problema: os relatórios/dashboards contavam cada lead pela data de
-- CADASTRO (added_at), mesmo quando a etapa (status) só mudou bem depois
-- (ex.: lead cadastrado 22/06, marcado como "Enviou Contato" só em 23/07 —
-- o sistema contava "Enviou Contato" em 22/06, e não em 23/07). Isso vale
-- pra QUALQUER etapa de QUALQUER funil, não só "Enviou Contato".
--
-- Solução: uma coluna `status_changed_at`, atualizada automaticamente por
-- TRIGGER sempre que `status` muda — funciona não importa de onde vem a
-- alteração (app.js, a extensão, RPCs da extensão, sync do Agendor, SQL
-- direto), porque o trigger fica no nível da tabela, não do client.
-- No cadastro (INSERT), começa igual a `added_at` (1ª etapa = data do
-- cadastro, que já é automática).
-- =====================================================================

alter table public.leads add column if not exists status_changed_at timestamptz;

-- Backfill: quem já tem lead cadastrado, considera que a etapa atual
-- "começou" na data de cadastro (não temos histórico anterior a isso).
update public.leads
set status_changed_at = coalesce(status_changed_at, added_at, created_at, now())
where status_changed_at is null;

alter table public.leads alter column status_changed_at set default now();
alter table public.leads alter column status_changed_at set not null;

create or replace function public.leads_set_status_changed_at()
returns trigger language plpgsql as $$
begin
  if (TG_OP = 'INSERT') then
    new.status_changed_at := coalesce(new.status_changed_at, new.added_at, now());
  elsif (TG_OP = 'UPDATE') then
    if new.status is distinct from old.status then
      new.status_changed_at := now();
    else
      new.status_changed_at := old.status_changed_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists leads_status_changed_at on public.leads;
create trigger leads_status_changed_at
before insert or update on public.leads
for each row execute function public.leads_set_status_changed_at();

create index if not exists leads_org_statuschanged_idx on public.leads(org_id, status_changed_at);
