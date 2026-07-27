-- =====================================================================
-- REMOÇÃO — lote confirmado em 2026-07-27 via
-- supabase-diagnostico-vazamento-arthur.sql: 3280 leads da EQUIPE DA
-- BRENDA foram inseridos de uma vez só (mesma transação, mesmo
-- created_at até o microssegundo) dentro da equipe SOCIAL SELLING
-- ARTHUR — não foi vazamento pela extensão nem pelo Importar do painel,
-- foi um INSERT em massa gravado com created_by = Otávio.
--
-- Os leads originais da EQUIPE DA BRENDA não são tocados — o filtro é só
-- org_id = equipe do Arthur + created_by = Otávio + o timestamp exato do
-- lote. O lead legítimo da Larissa Henn (16:02:22, outro created_by) fica
-- de fora automaticamente.
-- =====================================================================

begin;

-- 1) Confira ANTES de confirmar: tem que dar exatamente 3280 linhas.
select count(*) as total_a_apagar
from public.leads
where org_id = '113a1850-19d8-401a-b08d-bd50f3a14e66'          -- SOCIAL SELLING ARTHUR
  and created_by = '694eb03a-5049-4517-a5ad-e604faee1eac'      -- Otávio
  and created_at = '2026-07-24 21:09:16.76915+00';

-- 2) IMPORTANTE — confira se algum desses 3280 já tem negociação (deals)
--    com progresso real na equipe do Arthur. Se aparecer alguma linha,
--    o delete abaixo apagaria esse trabalho junto (deals têm "on delete
--    cascade" no lead) — pare e decida esses casos à parte antes de continuar.
select l.id, l.name, l.username, l.status, d.status as deal_status, d.created_at as deal_criado_em
from public.leads l
join public.deals d on d.lead_id = l.id
where l.org_id = '113a1850-19d8-401a-b08d-bd50f3a14e66'
  and l.created_by = '694eb03a-5049-4517-a5ad-e604faee1eac'
  and l.created_at = '2026-07-24 21:09:16.76915+00';

-- 3) Se o passo 1 deu exatamente 3280 e o passo 2 veio vazio, descomente
--    o DELETE abaixo e rode o arquivo inteiro de novo.

-- delete from public.leads
-- where org_id = '113a1850-19d8-401a-b08d-bd50f3a14e66'
--   and created_by = '694eb03a-5049-4517-a5ad-e604faee1eac'
--   and created_at = '2026-07-24 21:09:16.76915+00';

-- 4) Só depois de ver "DELETE 3280" no resultado do passo 3:
commit;
-- Se algo parecer errado nos passos 1 ou 2, rode "rollback;" em vez de
-- "commit;" pra desfazer tudo e não apagar nada.
