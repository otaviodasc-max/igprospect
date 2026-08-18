-- =====================================================================
-- IGProspect SaaS — Liga o bônus de meta diária SÓ na equipe da Brenda
-- Execute no SQL Editor do Supabase.
--
-- Regra: quem bater 90 unidades de trabalho num único dia (leads chamados
-- e follow-ups somados) recebe R$ 0,65 por unidade naquele dia, em vez da
-- tarifa normal de R$ 0,50. É por PESSOA e por DIA — dois prospectores com
-- 45 cada no mesmo dia não disparam o bônus.
--
-- Isolamento: a configuração mora em orgs.settings->'goals' da equipe da
-- Brenda e em NENHUMA outra linha. Toda outra equipe segue com
-- payBonusMinPerDay = 0 (desligado) e a tarifa normal — o bônus não tem
-- como vazar, porque o app lê as settings da org em que o usuário está.
-- =====================================================================

-- PASSO 1 — Confira ANTES de atualizar: rode só este select e veja se ele
-- traz exatamente UMA linha, a equipe certa. Se trouxer mais de uma (ou
-- nenhuma), troque o filtro pelo id exato da org na linha do update.
select id, name, settings->'goals' as goals_hoje
from public.orgs
where name ilike '%brenda%';

-- PASSO 2 — Liga o bônus. Preserva todas as outras metas já configuradas
-- (o `||` faz merge no jsonb: só as duas chaves do bônus são escritas).
update public.orgs
set settings =
      coalesce(settings, '{}'::jsonb)
      || jsonb_build_object('goals',
           coalesce(settings->'goals', '{}'::jsonb)
           || jsonb_build_object('payBonusMinPerDay', 90, 'payBonusRate', 0.65))
where name ilike '%brenda%';

-- PASSO 3 — Confirme o resultado.
select id, name, settings->'goals'->'payBonusMinPerDay' as min_dia,
       settings->'goals'->'payBonusRate' as valor_bonus
from public.orgs
where name ilike '%brenda%';
