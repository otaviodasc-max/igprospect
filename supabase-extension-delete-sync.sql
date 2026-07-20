-- =====================================================================
-- IGProspect SaaS — Excluir lead na extensão também exclui no sistema
-- Execute no Supabase SQL Editor, APÓS supabase-extension-pull-data.sql.
--
-- Mesmo padrão de segurança das outras funções da extensão: reconfirma
-- o código da equipe por dentro, nunca confia num org_id vindo do
-- navegador, e só apaga dentro da própria equipe (org_id = v_org).
-- =====================================================================

create or replace function public.extension_delete_lead(p_code text, p_ext_id text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  delete from public.leads where org_id = v_org and ext_id = p_ext_id;
end; $$;
grant execute on function public.extension_delete_lead(text,text) to anon, authenticated;
