-- =====================================================================
-- DIAGNÓSTICO — só leitura, não apaga nem altera nada.
-- Objetivo: confirmar que os leads da equipe da sua irmã foram DUPLICADOS
-- (não movidos) para a equipe do Arthur (SOCIAL SELLING ARTHUR) através do
-- botão Exportar → Importar do painel (app.js: exportLeads/importLeads).
-- Essa é a única forma no sistema de um lote inteiro de leads de uma
-- equipe aparecer de uma vez em outra — cada linha importada nasce com
-- source='import' no mesmo instante, e created_by é quem clicou "Importar"
-- estando logado na equipe do Arthur na hora.
-- Rode cada bloco no SQL Editor do Supabase, na ordem.
-- =====================================================================

-- 0) Confirma os dois ids de equipe (cada select deve dar 1 linha só)
select id as org_id_arthur, name from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%';
select id as org_id_irma,   name from public.orgs where name ilike '%EQUIPE DA BRENDA%';

-- 1) Leads importados na equipe do Arthur, agrupados por instante e por
--    quem importou. Um bloco enorme, tudo no mesmo minuto/hora, com um
--    único "importado_por", é o "disparo gigante" que você descreveu.
select date_trunc('minute', l.created_at) as quando,
       coalesce(p.name, p.email, '⚠ sem usuário (import antigo ou direto por SQL)') as importado_por,
       count(*) as leads
from public.leads l
left join public.profiles p on p.id = l.created_by
where l.org_id = (select id from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%')
  and l.source = 'import'
group by 1,2
order by 3 desc, 1 desc
limit 50;

-- 2) Confirma que são MESMO cópia dos leads dela: bate @usuário entre as
--    duas equipes. Se a contagem daqui for igual (ou muito perto) do total
--    de leads da equipe dela, é o lote inteiro mesmo.
select count(*) as leads_duplicados_confirmados
from public.leads a
join public.leads b
  on lower(a.username) = lower(b.username) and a.username is not null and a.username <> ''
where a.org_id = (select id from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%')
  and b.org_id = (select id from public.orgs where name ilike '%EQUIPE DA BRENDA%')
  and a.source = 'import';

-- 3) IMPORTANTE antes de decidir apagar: algum desses leads duplicados já
--    tem negociação (deals) com progresso real na equipe do Arthur (ligação
--    registrada, status avançado, etc.)? Se aparecer alguma linha aqui,
--    o time dele já trabalhou em cima da cópia — apagar direto perderia
--    esse trabalho (deals têm "on delete cascade" no lead). Confira 1 a 1
--    antes de incluir esses ids no script de remoção.
select l.id, l.name, l.username, l.status, d.status as deal_status, d.created_at as deal_criado_em
from public.leads l
join public.deals d on d.lead_id = l.id
where l.org_id = (select id from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%')
  and l.source = 'import';

-- 4) Lista final do lote pra levar pro script de remoção — ajuste o filtro
--    de "quando" com o valor exato visto no bloco 1 antes de confiar nela.
select id, name, username, phone, created_at, created_by
from public.leads
where org_id = (select id from public.orgs where name ilike '%SOCIAL SELLING ARTHUR%')
  and source = 'import'
  -- and date_trunc('minute', created_at) = 'AAAA-MM-DD HH:MM'  -- cole o valor do bloco 1
order by created_at;
