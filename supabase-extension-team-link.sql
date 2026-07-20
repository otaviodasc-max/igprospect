-- =====================================================================
-- IGProspect SaaS — Vínculo direto extensão↔equipe por código
-- Execute no Supabase SQL Editor.
--
-- Causa raiz do bug de leads "duplicando"/indo pra equipe errada: a
-- extensão do Instagram guardava os leads capturados numa fila local
-- SEM saber a qual equipe pertenciam de verdade, e dependia da aba do
-- painel estar aberta (e na equipe certa) no momento da sincronização
-- pra "adivinhar" o destino. Trocar de equipe no painel, ou nem ter o
-- painel aberto, fazia os leads irem pra equipe errada.
--
-- Correção: a extensão agora pede o CÓDIGO da equipe (o mesmo "join_code"
-- usado pra convidar colega — visível em Configurações → Equipe, ou na
-- aba Equipe do painel) direto na tela de Configurações dela, e grava
-- esse vínculo de forma permanente ali. Pra resolver o código sem exigir
-- login (a extensão não usa o Supabase Auth), esta função devolve
-- id/nome/token do Agendor daquela equipe — só pra quem já tem o código
-- em mãos, o mesmo nível de acesso que "join_org" já dá pra entrar na
-- equipe como membro.
-- =====================================================================

create or replace function public.org_by_join_code(p_code text)
returns table(id uuid, name text, agendor_token text)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.agendor_token
  from public.orgs o
  where o.join_code = upper(trim(p_code));
$$;
grant execute on function public.org_by_join_code(text) to anon, authenticated;
