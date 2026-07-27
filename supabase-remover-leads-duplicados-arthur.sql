-- =====================================================================
-- REMOÇÃO — só rode isso DEPOIS de confirmar o lote com
-- supabase-diagnostico-vazamento-arthur.sql (blocos 1, 2 e principalmente
-- o 3 — leads com negociação já em andamento na equipe do Arthur exigem
-- decisão manual, não entram nesse apagão automático).
--
-- Os leads originais da equipe da sua irmã NÃO são tocados por este
-- script — o filtro é só org_id = equipe do Arthur.
-- =====================================================================

begin;

-- 1) Confira ANTES de confirmar: quantas linhas seriam apagadas e quais são.
select id, name, username, phone, created_at
from public.leads
where org_id = (select id from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%')
  and source = 'import'
  and date_trunc('minute', created_at) = 'AAAA-MM-DD HH:MM'  -- cole aqui o valor exato do bloco 1 do diagnóstico
order by created_at;

-- 2) Se a lista acima bater exatamente com o lote esperado (mesma
--    quantidade de leads da equipe da irmã, nenhum com negociação em
--    andamento que você queira preservar), descomente o DELETE abaixo e
--    rode o bloco inteiro de novo.

-- delete from public.leads
-- where org_id = (select id from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%')
--   and source = 'import'
--   and date_trunc('minute', created_at) = 'AAAA-MM-DD HH:MM';

-- 3) Só depois de ver "DELETE <número esperado>" no resultado:
commit;
-- Se algo parecer errado no passo 1, rode "rollback;" em vez de "commit;"
-- pra desfazer tudo e não apagar nada.
