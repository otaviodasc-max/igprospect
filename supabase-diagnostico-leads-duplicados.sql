-- =====================================================================
-- DIAGNÓSTICO — só leitura, não apaga nem altera nada.
-- Rode no SQL Editor do Supabase pra entender de onde vieram os leads
-- novos numa equipe específica. Troque 'NOME DA EQUIPE' pelo nome real
-- (aparece em Configurações → Seu espaço, ou no seletor de equipes).
-- =====================================================================

-- 0) Acha o id da equipe (confirme que é só 1 linha antes de continuar)
select id as org_id, name from public.orgs where name ilike '%NOME DA EQUIPE%';

-- 1) Quantos leads entraram POR DIA (created_at = quando a linha foi
--    criada de verdade no banco, diferente de "added_at" que pode vir de
--    uma planilha/import com data antiga). Um pico de centenas/milhares
--    num único dia é o sinal mais claro de import duplicado.
select date(created_at) as dia, source, count(*) as leads
from public.leads
where org_id = (select id from public.orgs where name ilike '%NOME DA EQUIPE%')
group by 1,2
order by 1 desc, 2;

-- 2) Quantos leads cada PESSOA cadastrou nessa equipe (created_by) — mostra
--    de quem é cada lead. "null" = veio sem usuário logado (ex.: extensão
--    sem "quem é você" definido, ou import antigo).
select coalesce(p.name, p.email, 'sem dono (null)') as quem_cadastrou,
       l.source, count(*) as leads
from public.leads l
left join public.profiles p on p.id = l.created_by
where l.org_id = (select id from public.orgs where name ilike '%NOME DA EQUIPE%')
group by 1,2
order by 3 desc;

-- 3) Duplicatas de verdade: mesmo @usuário (quando existe) aparecendo mais
--    de uma vez na equipe. Isso é o que eu esperaria ver se um import
--    rodou duas vezes.
select username, count(*) as vezes, array_agg(id) as ids, array_agg(created_at order by created_at) as quando
from public.leads
where org_id = (select id from public.orgs where name ilike '%NOME DA EQUIPE%')
  and username is not null and username <> ''
group by username
having count(*) > 1
order by vezes desc
limit 50;

-- 4) Se MUITOS leads não têm @usuário (import de planilha sem essa coluna),
--    a duplicata também pode estar por NOME + TELEFONE iguais:
select name, phone, count(*) as vezes, array_agg(id) as ids
from public.leads
where org_id = (select id from public.orgs where name ilike '%NOME DA EQUIPE%')
  and name is not null and name <> ''
group by name, phone
having count(*) > 1
order by vezes desc
limit 50;
