-- =====================================================================
-- IGProspect SaaS — sincroniza as OBSERVAÇÕES (notes) do lead entre o
-- sistema e a extensão, nas duas direções:
--   1) org_leads_by_join_code passa a trazer também `notes`, pra extensão
--      mostrar/mesclar a observação já escrita no painel ao puxar os leads.
--   2) extension_update_lead ganha o parâmetro p_notes, pra gravar no banco
--      a observação escrita DIRETO na extensão (sem precisar abrir o painel).
-- As "observações pré-prontas" por etapa (org_pipelines.stages[].notes,
-- ver app.js notePresetsModal) já vêm de graça: org_pipeline_by_join_code
-- devolve a coluna `stages` inteira, que já inclui esse campo.
-- Execute no Supabase SQL Editor, APÓS supabase-extension-agendor-sync.sql.
-- =====================================================================

drop function if exists public.org_leads_by_join_code(text, int, int);

create or replace function public.org_leads_by_join_code(p_code text, p_limit int default 2000, p_offset int default 0)
returns table(ext_id text, name text, username text, phone text, niche text, status text, tipo text, notes text, added_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  update public.leads l set ext_id = l.id::text
  where l.org_id = v_org and (l.ext_id is null or l.ext_id = '');

  return query
  select l.ext_id, l.name, l.username, l.phone, l.niche, l.status, l.tipo, l.notes, l.added_at
  from public.leads l
  where l.org_id = v_org
  order by l.added_at desc nulls last
  limit p_limit offset p_offset;
end; $$;
grant execute on function public.org_leads_by_join_code(text,int,int) to anon, authenticated;

create or replace function public.extension_update_lead(
  p_code text, p_ext_id text, p_status text default null, p_phone text default null, p_name text default null,
  p_agendor_person_id text default null, p_agendor_deal_id text default null, p_agendor_funnel text default null,
  p_notes text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select id into v_org from public.orgs where join_code = upper(trim(p_code));
  if v_org is null then raise exception 'Código de equipe inválido'; end if;

  update public.leads set
    status            = coalesce(nullif(p_status,''), status),
    phone             = coalesce(nullif(p_phone,''), phone),
    name              = coalesce(nullif(p_name,''), name),
    notes             = coalesce(nullif(p_notes,''), notes),
    agendor_person_id = coalesce(nullif(p_agendor_person_id,''), agendor_person_id),
    agendor_deal_id   = coalesce(nullif(p_agendor_deal_id,''), agendor_deal_id),
    agendor_funnel    = coalesce(nullif(p_agendor_funnel,''), agendor_funnel),
    agendor_status    = case when p_agendor_person_id is not null and p_agendor_person_id <> '' then 'ok' else agendor_status end,
    updated_at        = now()
  where org_id = v_org and ext_id = p_ext_id;
end; $$;
grant execute on function public.extension_update_lead(text,text,text,text,text,text,text,text,text) to anon, authenticated;
