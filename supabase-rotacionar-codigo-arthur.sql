-- =====================================================================
-- ROTAÇÃO DO JOIN_CODE — equipe SOCIAL SELLING ARTHUR.
-- O código atual (4BDB7E) tem só 6 caracteres — formato antigo, vulnerável
-- a força bruta (~16,7 milhões de combinações), documentado em
-- supabase-security-join-code.sql. Provavelmente é assim que os dois
-- lotes de leads apareceram do nada: a função extension_add_lead é
-- pública (grant to anon, sem exigir login) e não tem limite de taxa no
-- servidor — só com o código, qualquer script externo grava leads à
-- vontade nessa equipe.
--
-- Isso troca só a equipe do Arthur, pelo padrão novo de 12 caracteres
-- (mesma geração usada em create_org() hoje). As outras equipes do
-- sistema continuam com o código antigo até serem rotacionadas à parte.
--
-- IMPORTANTE: depois de rodar, a extensão de quem já estava conectado
-- nessa equipe para de sincronizar até digitar o código novo de novo
-- (Configurações → Equipe, dentro da extensão).
-- =====================================================================

update public.orgs
set join_code = upper(substring(replace(gen_random_uuid()::text,'-',''), 1, 12))
where id = '113a1850-19d8-401a-b08d-bd50f3a14e66'
returning id, name, join_code as novo_codigo;
