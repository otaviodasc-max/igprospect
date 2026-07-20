-- =====================================================================
-- IGProspect SaaS — extension_update_lead também corrige o nome
-- Execute no Supabase SQL Editor, APÓS supabase-extension-prospector.sql.
--
-- A extensão detecta um nome errado (ex.: "Mensagens", pego por engano
-- do cabeçalho do Direct) e corrige sozinha assim que reconhece o nome
-- de verdade — mas antes ela só corrigia a cópia local, nunca o banco.
-- Agora extension_update_lead também aceita corrigir o nome.
-- =====================================================================

create or replace function public.extension_update_lead(
  p_code text, p_ext_id text, p_status text default null, p_phone text default null, p_name text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  update public.leads set
    status     = coalesce(nullif(p_status,''), status),
    phone      = coalesce(nullif(p_phone,''), phone),
    name       = coalesce(nullif(p_name,''), name),
    updated_at = now()
  where org_id = v_org and ext_id = p_ext_id;
end; $$;
grant execute on function public.extension_update_lead(text,text,text,text,text) to anon, authenticated;
