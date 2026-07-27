-- =====================================================================
-- ROTAÇÃO DO JOIN_CODE — TODAS as equipes ainda no formato antigo (curto).
-- Continuação de supabase-security-join-code.sql: aquele arquivo só
-- protegeu equipes NOVAS (create_org() já gera 12 caracteres); as que já
-- existiam ficaram com o código de 6 caracteres até serem rotacionadas
-- manualmente — foi por aí que a equipe do Arthur levou dois lotes de
-- leads aparecendo do nada (extension_add_lead é pública, sem login, sem
-- limite de taxa no servidor; só o código já basta pra qualquer script
-- externo gravar/ler/apagar leads da equipe).
--
-- Isso troca o código só de quem ainda está com menos de 12 caracteres —
-- equipes já rotacionadas (ou criadas depois do fix de 24/07) não são
-- tocadas de novo.
--
-- IMPORTANTE: toda extensão já conectada numa equipe que mudar de código
-- para de sincronizar até alguém digitar o código novo nela de novo
-- (Configurações → Equipe, dentro da extensão). Avise cada equipe afetada
-- — a lista abaixo (bloco 1) mostra o código novo de cada uma.
-- =====================================================================

-- 1) Confira ANTES: quais equipes serão afetadas e quantas são.
select id, name, join_code as codigo_atual, length(join_code) as tamanho
from public.orgs
where length(join_code) < 12
order by name;

-- 2) Rotação de verdade — só roda depois de conferir a lista acima.
--    Mostra equipe + código novo de cada uma pra você avisar quem usa.
update public.orgs
set join_code = upper(substring(replace(gen_random_uuid()::text,'-',''), 1, 12))
where length(join_code) < 12
returning id, name, join_code as novo_codigo;
