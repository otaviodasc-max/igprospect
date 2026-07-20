-- =====================================================================
-- IGProspect SaaS — Extensão grava direto no banco (sem depender do painel)
-- Execute no Supabase SQL Editor, APÓS supabase-extension-team-link.sql
-- e supabase-leads-dedupe.sql (usa o índice único criado lá).
--
-- Causa raiz: mesmo com o código da equipe travado na extensão, o LEAD
-- só era gravado quando alguém abria o painel (aba do navegador) — e o
-- painel grava sempre na equipe que ELE está aberto (via my_org(), lido
-- da sessão logada), não na equipe que a extensão tem configurada. Sem
-- o painel aberto na equipe certa, o lead simplesmente não ia pra
-- lugar nenhum.
--
-- Correção: duas funções que a extensão chama diretamente (com a chave
-- pública, sem precisar de login) — sempre reconferindo o código da
-- equipe por dentro, nunca confiando num org_id vindo do navegador.
-- =====================================================================

create or replace function public.extension_add_lead(
  p_code text, p_ext_id text, p_name text, p_username text default '',
  p_phone text default '', p_niche text default '', p_notes text default '',
  p_status text default 'novo', p_added_at timestamptz default now()
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_pipeline uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  select id into v_pipeline from public.org_pipelines
    where org_id = v_org and is_default limit 1;

  insert into public.leads(org_id, name, username, phone, niche, notes, status, tipo, pipeline_id, source, ext_id, added_at)
  values (v_org, nullif(p_name,''), nullif(lower(p_username),''), nullif(p_phone,''), nullif(p_niche,''), nullif(p_notes,''),
          coalesce(nullif(p_status,''),'novo'), 'comum', v_pipeline, 'extensao', p_ext_id, coalesce(p_added_at, now()))
  on conflict (org_id, ext_id) where ext_id is not null and ext_id <> '' do nothing;
end; $$;
grant execute on function public.extension_add_lead(text,text,text,text,text,text,text,text,timestamptz) to anon, authenticated;

-- Usada quando a extensão detecta que um lead JÁ capturado respondeu no
-- Direct (avança o status e/ou grava o telefone).
create or replace function public.extension_update_lead(
  p_code text, p_ext_id text, p_status text default null, p_phone text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  update public.leads set
    status     = coalesce(nullif(p_status,''), status),
    phone      = coalesce(nullif(p_phone,''), phone),
    updated_at = now()
  where org_id = v_org and ext_id = p_ext_id;
end; $$;
grant execute on function public.extension_update_lead(text,text,text,text) to anon, authenticated;
