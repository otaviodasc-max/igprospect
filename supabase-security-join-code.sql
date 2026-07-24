-- =====================================================================
-- IGProspect SaaS — Fortalece a entropia do código de convite (join_code)
-- Execute no Supabase SQL Editor, por último (depois de
-- supabase-INSTALAR-TUDO.sql).
--
-- ACHADO DA AUDITORIA: join_code nascia com só 6 caracteres hexadecimais
-- (upper(substring(md5(random()::text) from 1 for 6))) — 16^6 ≈ 16,7
-- milhões de combinações. Esse código é o ÚNICO "segredo" que protege as
-- funções da extensão (org_by_join_code, org_leads_by_join_code,
-- org_members_by_join_code, extension_add_lead/update/delete), TODAS
-- concedidas ao papel `anon` (sem exigir login) — é assim que a extensão
-- funciona sem autenticação de verdade. Com só 6 caracteres, um script
-- simples consegue varrer o espaço inteiro de códigos em tempo viável e,
-- pra cada acerto, ler nome da equipe + TOKEN DO AGENDOR, listar todos os
-- leads (nome/telefone/e-mail/notas), listar e-mail dos membros, e
-- cadastrar/editar/apagar leads à vontade — de qualquer organização,
-- sem nunca fazer login.
--
-- CORREÇÃO: novos espaços passam a nascer com um código de 12 caracteres
-- tirados de um uuid aleatório (gen_random_uuid(), já usado em outras
-- tabelas do sistema) — 16^12 ≈ 2,8×10^14 combinações, inviável de
-- varrer por força bruta. Isso NÃO muda o código dos espaços que já
-- existem (ver bloco opcional de rotação no fim deste arquivo — não é
-- rodado automaticamente porque quebraria a extensão de quem já está
-- conectado, até reconectar com o código novo).
--
-- Mitigação adicional recomendada (fora do banco, não depende deste
-- arquivo): habilitar/checar o rate limiting de API do projeto no painel
-- do Supabase (Project Settings → API), pra dificultar ainda mais um
-- script de força bruta mesmo contra o espaço maior de códigos.
-- =====================================================================

create or replace function public.create_org(p_name text, p_module_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_code text; v_module text;
begin
  if not public.is_active() then raise exception 'Cadastro em análise: aguarde a aprovação do administrador'; end if;
  -- 12 caracteres hex de um uuid aleatório — bem mais forte que os 6 de antes.
  v_code := upper(substring(replace(gen_random_uuid()::text,'-',''), 1, 12));
  v_module := coalesce(p_module_id,'consorcio');
  insert into public.orgs(name, join_code, module_id)
    values (coalesce(nullif(trim(p_name),''),'Meu espaço'), v_code, v_module)
    returning id into v_org;
  insert into public.org_members(org_id, user_id, role) values (v_org, auth.uid(), 'owner');
  perform set_config('app.allow_org_change','1', true);
  update public.profiles set org_id = v_org, org_role = 'owner' where id = auth.uid();

  -- Funil "Instagram" (prospecção) — igual ao prospectFunnel de todo módulo hoje.
  insert into public.org_pipelines (org_id, name, icon, order_idx, is_default, counts_as_empresario, stages)
  values (v_org, 'Instagram', '📸', 0, true, false,
    '[
      {"key":"novo","label":"Novo Lead","short":"Novos","color":"#64748B","order":0},
      {"key":"chamado","label":"Chamado","short":"Chamados","color":"#6366F1","order":1},
      {"key":"respondeu","label":"Respondeu","short":"Responderam","color":"#F59E0B","order":2},
      {"key":"contato","label":"Enviou Contato","short":"Convertidos","color":"#10B981","order":3}
    ]'::jsonb);

  -- Funil "Empresários" — só para equipes no módulo consórcio.
  if v_module = 'consorcio' then
    insert into public.org_pipelines (org_id, name, icon, order_idx, is_default, counts_as_empresario, stages)
    values (v_org, 'Empresários', '🏢', 1, false, true,
      '[
        {"key":"a_contatar","label":"A Contatar","short":"A Contatar","color":"#64748B","order":0},
        {"key":"em_conversa","label":"Em Conversa","short":"Conversa","color":"#6366F1","order":1},
        {"key":"reuniao","label":"Reunião","short":"Reunião","color":"#8B5CF6","order":2},
        {"key":"negociando","label":"Negociando","short":"Negociando","color":"#F59E0B","order":3}
      ]'::jsonb);
  end if;

  -- Estágios de negociação por módulo.
  insert into public.org_deal_stages (org_id, stages, won_stage, lost_stage, card_types)
  values (v_org,
    case v_module
      when 'imoveis' then '[
        {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
        {"key":"visita","label":"Visita Agendada","short":"Visita","color":"#6366F1","order":1},
        {"key":"proposta","label":"Proposta","short":"Proposta","color":"#8B5CF6","order":2},
        {"key":"documentacao","label":"Documentação","short":"Docs","color":"#F59E0B","order":3},
        {"key":"vendido","label":"Fechado","short":"Fechados","color":"#10B981","order":4},
        {"key":"perdido","label":"Perdido","short":"Perdidos","color":"#EF4444","order":5}
      ]'::jsonb
      when 'seguros' then '[
        {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
        {"key":"cotacao","label":"Cotação","short":"Cotação","color":"#6366F1","order":1},
        {"key":"proposta","label":"Proposta","short":"Proposta","color":"#F59E0B","order":2},
        {"key":"apolice_emitida","label":"Apólice Emitida","short":"Emitidas","color":"#10B981","order":3},
        {"key":"renovacao_perdida","label":"Perdida","short":"Perdidas","color":"#EF4444","order":4}
      ]'::jsonb
      when 'saas' then '[
        {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
        {"key":"demo_agendada","label":"Demo Agendada","short":"Agendada","color":"#6366F1","order":1},
        {"key":"demo_realizada","label":"Demo Realizada","short":"Realizada","color":"#8B5CF6","order":2},
        {"key":"proposta","label":"Proposta","short":"Proposta","color":"#F59E0B","order":3},
        {"key":"trial","label":"Em Trial","short":"Trial","color":"#0EA5E9","order":4},
        {"key":"fechado","label":"Fechado","short":"Fechados","color":"#10B981","order":5},
        {"key":"perdido","label":"Perdido","short":"Perdidos","color":"#EF4444","order":6}
      ]'::jsonb
      else '[
        {"key":"contato","label":"Contato Recebido","short":"Contato","color":"#64748B","order":0},
        {"key":"reuniao","label":"Reunião","short":"Reunião","color":"#6366F1","order":1},
        {"key":"reuniao_agendada","label":"Reunião Agendada","short":"Agendada","color":"#8B5CF6","order":2},
        {"key":"negociando","label":"Negociando","short":"Negociando","color":"#F59E0B","order":3},
        {"key":"vendido","label":"Vendido","short":"Vendidos","color":"#10B981","order":4},
        {"key":"perdido","label":"Perdido","short":"Perdidos","color":"#EF4444","order":5}
      ]'::jsonb
    end,
    case v_module when 'imoveis' then 'vendido' when 'seguros' then 'apolice_emitida' when 'saas' then 'fechado' else 'vendido' end,
    case v_module when 'seguros' then 'renovacao_perdida' else 'perdido' end,
    case v_module
      when 'imoveis' then '["Apartamento","Casa","Terreno","Comercial"]'::jsonb
      when 'seguros' then '["Auto","Vida","Residencial","Saúde","Empresarial"]'::jsonb
      when 'saas'    then '["Plano Starter","Plano Pro","Plano Enterprise","Infoproduto"]'::jsonb
      else '["Imóvel","Veículo","Investimentos"]'::jsonb
    end);

  -- Desfechos de ligação — iguais para todo módulo hoje.
  insert into public.org_call_outcomes (org_id, outcomes)
  values (v_org, '[
    {"key":"interessado","label":"Interessado","color":"#10B981","order":0},
    {"key":"retornar","label":"Retornar depois","color":"#F59E0B","order":1},
    {"key":"sem_interesse","label":"Sem interesse","color":"#EF4444","order":2},
    {"key":"nao_atendeu","label":"Não atendeu","color":"#64748B","order":3},
    {"key":"fechado","label":"Fechou negócio","color":"#6366F1","order":4}
  ]'::jsonb);

  return v_org;
end; $$;

grant execute on function public.create_org(text, text) to authenticated;

notify pgrst, 'reload schema';

-- =====================================================================
-- OPCIONAL — rotacionar o código das equipes que JÁ EXISTEM.
-- NÃO faz parte da execução automática acima (por isso está comentado).
-- Só rode linha por linha, e SÓ SE você quiser, ciente de que:
--   • toda extensão já conectada com o código antigo para de sincronizar
--     até alguém digitar o código novo nela de novo (Configurações →
--     Equipe → trocar código);
--   • o "código de convite" mostrado em Configurações → Equipe também muda.
--
-- update public.orgs
--   set join_code = upper(substring(replace(gen_random_uuid()::text,'-',''), 1, 12));
-- =====================================================================
