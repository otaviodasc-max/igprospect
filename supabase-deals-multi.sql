-- =====================================================================
-- IGProspect SaaS — Migração: vários negócios por lead
-- Execute NO Supabase SQL Editor APÓS ter rodado o supabase-deals.sql.
--
-- Antes, um lead só podia ter 1 negócio (constraint "unique" em
-- deals.lead_id) — impedia, por exemplo, registrar uma carta de imóvel e,
-- meses depois, uma de veículo pra mesma pessoa. Esta migração libera
-- múltiplos negócios por lead e ajusta o trigger automático pra continuar
-- criando só o PRIMEIRO sozinho (negócios extras são criados manualmente
-- pela ficha do lead, no sistema, botão "+ Novo negócio").
-- =====================================================================

-- 1) Remove a constraint única — o índice deals_lead_idx (não único)
--    continua servindo pras buscas por lead_id.
alter table public.deals drop constraint if exists deals_lead_id_key;

-- 2) Trigger: antes usava "on conflict (lead_id) do nothing", que dependia
--    da constraint única removida acima. Agora checa explicitamente se já
--    existe algum negócio pra esse lead antes de criar o automático.
create or replace function public.ensure_deal_for_lead()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.status = 'contato' and not exists (select 1 from public.deals where lead_id = new.id) then
    select coalesce(p.name, p.email) into v_name
      from public.profiles p where p.id = new.created_by;
    insert into public.deals(org_id, lead_id, created_by, prospector_name)
      values (new.org_id, new.id, new.created_by, v_name);
  end if;
  return new;
end; $$;
