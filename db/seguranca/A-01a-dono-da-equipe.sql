-- =====================================================================
-- Conalvo — A-01a · Configurações da equipe só do DONO (recorte da Fase A)
-- =====================================================================
-- NÃO APLICADO EM PRODUÇÃO. Rodar só com autorização, à mão, seguindo
-- db/PUBLICACAO.md (depois do site novo).
--
-- Problema (diagnóstico da produção, RESUMO-DIAGNOSTICO-PRODUCAO.md):
-- a policy orgs_update deixa QUALQUER MEMBRO ATIVO alterar a linha da equipe
-- pela API direta — nome, código de convite, token do CRM, módulo e
-- settings (metas e valores do pagamento por lead). O painel só esconde.
--
-- O que esta migração faz (recorte das seções A1, A7, A8 e A9 da Fase A,
-- db/seguranca/A-01-aditiva-compativel.sql, revisão 5), nada mais:
--   S1. is_org_member(org): "sou membro ATIVO desta equipe?" (usada em S3).
--   S2. orgs_update: só o DONO da equipe ativa ou o superadministrador,
--       com USING e WITH CHECK.
--   S3. org_set_goals(org, metas): o que o membro faz hoje no painel — metas
--       da equipe. DIFERENÇA para a A8 da Fase A: as chaves do PAGAMENTO POR
--       LEAD (payDayRate, payTargetPerDay, payBasis, payFollowUp,
--       payBonusMinPerDay, payBonusRate, commissionPct) só o DONO daquela
--       equipe (ou o superadmin) muda. Membro que reenviar o valor JÁ
--       gravado passa (aba antiga aberta); valor diferente é recusado.
--   S4. org_set_pay_recipient(org, id): destinatário do pagamento, só dono.
--   S5. Confirmar pagamento (INSERT em weekly_payments): só o DONO da equipe
--       ativa ou o superadmin. Membro continua VENDO os pagamentos; alterar
--       ou apagar um confirmado já é recusado pela P-01.
--   S6. Marcar comissão como paga (deals.commission_paid / paid_at): só o
--       dono daquela equipe ou o superadmin. Editar a negociação sem mexer
--       nesses dois campos continua liberado para o membro.
--
-- Fica de fora (avaliado em db/PUBLICACAO.md): travas de integridade (A2),
-- RLS de usuário ativo (A3), e-mail na RPC anônima (A4), revogar anon das
-- RPCs do painel (A5) e as ext2_* da extensão 1.11 (A6).
--
-- Compatível com: extensão 1.10.4 (RPCs por código, SECURITY DEFINER, não
-- passam por orgs_update), E-01, P-01, P-03 (em qualquer ordem). Funis,
-- nichos, etapas e observações já eram só do dono (policies *_write).
--
-- Depois desta, a Fase A completa (A-01) ABORTA sem mudar nada (as
-- precondições dela esperam o estado anterior): ela precisa de uma revisão
-- que parta deste estado antes de ser usada.
--
-- Rollback: A-01a-rollback.sql (devolve a policy exata da produção; não
-- apaga nem altera dado nenhum — metas e valores gravados ficam como estão).
-- =====================================================================
begin;

-- --------------------------------------------------------------- precondições
do $$
declare v_msg text; v_q text; v_w text; v_n int;
begin
  select string_agg(f, ', ') into v_msg
    from unnest(array['public.my_org()','public.is_active()','public.is_org_owner()','public.is_platform_admin()']) f
   where to_regprocedure(f) is null;
  if v_msg is not null then raise exception 'A-01a abortada: falta função %', v_msg; end if;
  if to_regclass('public.orgs') is null or to_regclass('public.org_members') is null or to_regclass('public.profiles') is null then
    raise exception 'A-01a abortada: falta tabela orgs, org_members ou profiles';
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_msg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('is_org_member','org_set_goals','org_set_pay_recipient');
  if v_msg is not null then raise exception 'A-01a abortada: já existe %  (Fase A ou A-01a já aplicada?)', v_msg; end if;

  -- orgs_update tem de ser EXATAMENTE a da produção (membro ativo, sem WITH CHECK)
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'orgs' and cmd in ('UPDATE','ALL');
  select lower(regexp_replace(coalesce(qual, ''), '[()"''[:space:]]', '', 'g')),
         lower(regexp_replace(coalesce(with_check, ''), '[()"''[:space:]]', '', 'g'))
    into v_q, v_w
    from pg_policies where schemaname = 'public' and tablename = 'orgs' and policyname = 'orgs_update'
     and cmd = 'UPDATE' and permissive = 'PERMISSIVE' and array(select r::text from unnest(roles) r) = array['public']::text[];
  if v_n <> 1 or v_q is distinct from 'id=my_organdis_activeoris_platform_admin' or v_w <> '' then
    raise exception 'A-01a abortada: orgs_update diferente da produção (USING %, WITH CHECK %, % policies de UPDATE em orgs). Nada foi alterado.', v_q, v_w, v_n;
  end if;

  -- weekly_payments: uma policy só, a da produção (ALL para membro ativo da equipe aberta)
  select count(*) into v_n from pg_policies where schemaname = 'public' and tablename = 'weekly_payments';
  select lower(regexp_replace(coalesce(qual, ''), '[()"''[:space:]]', '', 'g')),
         lower(regexp_replace(coalesce(with_check, ''), '[()"''[:space:]]', '', 'g'))
    into v_q, v_w
    from pg_policies where schemaname = 'public' and tablename = 'weekly_payments' and policyname = 'weekly_payments_org' and cmd = 'ALL';
  if v_n <> 1 or v_q is distinct from 'org_id=my_organdis_active' or v_w is distinct from 'org_id=my_org' then
    raise exception 'A-01a abortada: policies de weekly_payments diferentes da produção (USING %, WITH CHECK %, % policies). Nada foi alterado.', v_q, v_w, v_n;
  end if;
  if exists (select 1 from pg_trigger where not tgisinternal and tgname = 'deals_comissao_so_dono') or to_regprocedure('public.deals_comissao_so_dono()') is not null then
    raise exception 'A-01a abortada: trava de comissão já existe';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deals' and column_name = 'commission_paid')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deals' and column_name = 'paid_at') then
    raise exception 'A-01a abortada: falta deals.commission_paid ou deals.paid_at';
  end if;
end $$;

-- --------------------------------------------------------------- S1
create function public.is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_org_id is not null and exists (
    select 1 from public.org_members m join public.profiles p on p.id = m.user_id
     where m.org_id = p_org_id and m.user_id = auth.uid() and p.status = 'active');
$$;
revoke execute on function public.is_org_member(uuid) from public, anon;
grant  execute on function public.is_org_member(uuid) to authenticated;

-- --------------------------------------------------------------- S2
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update
  using      ((id = public.my_org() and public.is_org_owner()) or public.is_platform_admin())
  with check ((id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());

-- --------------------------------------------------------------- S3
-- Contrato = objeto do painel (goalsForm/getGoals). Regras por chave como na
-- Fase A (revisão 5); payRecipientId nunca entra (S4).
create function public.org_set_goals(p_org_id uuid, p_goals jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_goals jsonb; v_ruim text; v_atual jsonb; v_dono boolean;
begin
  if auth.uid() is null then raise exception 'Login obrigatório' using errcode = '42501'; end if;
  if not (public.is_org_member(p_org_id) or public.is_platform_admin()) then
    raise exception 'Sem acesso a esta equipe' using errcode = '42501';
  end if;
  if p_goals is null or jsonb_typeof(p_goals) <> 'object' then
    raise exception 'Metas inválidas: esperado um objeto' using errcode = '22023';
  end if;
  if p_goals ? 'payRecipientId' then
    raise exception 'O destinatário do pagamento não é alterado por aqui (só o dono, em Configurações)' using errcode = '42501';
  end if;

  with regra(k, tipo, maximo) as (values
    ('contacts','int',1000000::numeric), ('sales','int',1000000), ('leadDailyMin','int',100000),
    ('leadDailyMax','int',100000), ('callsWeekly','int',100000), ('payTargetPerDay','int',100000),
    ('payBonusMinPerDay','int',100000),
    ('revenue','num',1000000000000), ('commission','num',1000000000000),
    ('payDayRate','num',1000000), ('payBonusRate','num',1000000), ('commissionPct','num',100),
    ('payBasis','basis',null), ('payFollowUp','bool',null)
  )
  select string_agg(e.k || case when r.k is null then ' (chave desconhecida)' else ' (valor inválido)' end, ', ' order by e.k)
    into v_ruim
    from jsonb_each(p_goals) e(k, v) left join regra r on r.k = e.k
   where r.k is null
      or not case r.tipo
           when 'bool'  then jsonb_typeof(e.v) = 'boolean'
           when 'basis' then jsonb_typeof(e.v) = 'string' and (e.v #>> '{}') in ('seguidos','chamados')
           else case when jsonb_typeof(e.v) <> 'number' then false
                     else (e.v #>> '{}')::numeric between 0 and r.maximo
                          and (r.tipo = 'num' or (e.v #>> '{}')::numeric = trunc((e.v #>> '{}')::numeric)) end
         end;
  if v_ruim is not null then raise exception 'Metas recusadas: %', v_ruim using errcode = '22023'; end if;

  -- pagamento por lead: só o dono DESTA equipe (org_members, perfil ativo) ou o superadmin
  v_dono := public.is_platform_admin() or exists (
    select 1 from public.org_members m join public.profiles p on p.id = m.user_id and p.status = 'active'
     where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'owner');
  if not v_dono then
    select coalesce(o.settings -> 'goals', '{}'::jsonb) into v_atual from public.orgs o where o.id = p_org_id for update;
    select string_agg(e.k, ', ' order by e.k) into v_ruim
      from jsonb_each(p_goals) e(k, v)
     where e.k in ('payDayRate','payTargetPerDay','payBasis','payFollowUp','payBonusMinPerDay','payBonusRate','commissionPct')
       and (v_atual -> e.k) is distinct from e.v;
    if v_ruim is not null then
      raise exception 'Só o dono da equipe altera os valores do pagamento (%)', v_ruim using errcode = '42501';
    end if;
  end if;

  update public.orgs o
     set settings = coalesce(o.settings, '{}'::jsonb)
                    || jsonb_build_object('goals', coalesce(o.settings -> 'goals', '{}'::jsonb) || p_goals)
   where o.id = p_org_id
  returning o.settings -> 'goals' into v_goals;
  if not found then raise exception 'Equipe não encontrada' using errcode = '22023'; end if;
  return v_goals;
end; $$;
revoke execute on function public.org_set_goals(uuid, jsonb) from public, anon;
grant  execute on function public.org_set_goals(uuid, jsonb) to authenticated;

-- --------------------------------------------------------------- S4
create function public.org_set_pay_recipient(p_org_id uuid, p_recipient_id text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare v_txt text; v_goals jsonb;
begin
  if auth.uid() is null then raise exception 'Login obrigatório' using errcode = '42501'; end if;
  if not (public.is_platform_admin() or exists (
            select 1 from public.org_members m join public.profiles p on p.id = m.user_id and p.status = 'active'
             where m.org_id = p_org_id and m.user_id = auth.uid() and m.role = 'owner')) then
    raise exception 'Só o dono da equipe altera o destinatário do pagamento' using errcode = '42501';
  end if;
  v_txt := nullif(btrim(coalesce(p_recipient_id, '')), '');
  if v_txt is not null then
    if v_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Destinatário inválido' using errcode = '22023';
    end if;
    v_txt := lower(v_txt);
    if not exists (select 1 from public.org_members m join public.profiles p on p.id = m.user_id and p.status = 'active'
                    where m.org_id = p_org_id and m.user_id = v_txt::uuid) then
      raise exception 'Destinatário não é membro ativo desta equipe' using errcode = '22023';
    end if;
  end if;
  update public.orgs o
     set settings = coalesce(o.settings, '{}'::jsonb)
                    || jsonb_build_object('goals', case when v_txt is null
                         then coalesce(o.settings -> 'goals', '{}'::jsonb) - 'payRecipientId'
                         else coalesce(o.settings -> 'goals', '{}'::jsonb) || jsonb_build_object('payRecipientId', v_txt) end)
   where o.id = p_org_id
  returning o.settings -> 'goals' into v_goals;
  if not found then raise exception 'Equipe não encontrada' using errcode = '22023'; end if;
  return v_goals;
end; $$;
revoke execute on function public.org_set_pay_recipient(uuid, text) from public, anon;
grant  execute on function public.org_set_pay_recipient(uuid, text) to authenticated;

-- --------------------------------------------------------------- S5
drop policy weekly_payments_org on public.weekly_payments;
create policy weekly_payments_select on public.weekly_payments for select
  using (org_id = public.my_org() and public.is_active());
create policy weekly_payments_insert on public.weekly_payments for insert
  with check ((org_id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());
create policy weekly_payments_dono on public.weekly_payments for update
  using ((org_id = public.my_org() and public.is_org_owner()) or public.is_platform_admin())
  with check ((org_id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());
create policy weekly_payments_dono_delete on public.weekly_payments for delete
  using ((org_id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());

-- --------------------------------------------------------------- S6
create function public.deals_comissao_so_dono() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.commission_paid is not distinct from old.commission_paid and new.paid_at is not distinct from old.paid_at then return new; end if;
  if tg_op = 'INSERT' and coalesce(new.commission_paid, false) = false and new.paid_at is null then return new; end if;
  -- chamada do próprio servidor (sem usuário da API): migrações, scripts do dono do banco
  if auth.uid() is null and current_user not in ('anon', 'authenticated') then return new; end if;
  if public.is_platform_admin() or exists (
       select 1 from public.org_members m join public.profiles p on p.id = m.user_id and p.status = 'active'
        where m.org_id = new.org_id and m.user_id = auth.uid() and m.role = 'owner') then
    return new;
  end if;
  raise exception 'Só o dono da equipe marca comissão como paga' using errcode = '42501';
end $$;
revoke all on function public.deals_comissao_so_dono() from public, anon, authenticated;
create trigger deals_comissao_so_dono before insert or update on public.deals
  for each row execute function public.deals_comissao_so_dono();

-- --------------------------------------------------------------- verificação
do $$
declare v_bad text;
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'orgs' and policyname = 'orgs_update'
        and lower(regexp_replace(coalesce(qual, ''), '[()"''[:space:]]', '', 'g')) = 'id=my_organdis_org_owneroris_platform_admin'
        and lower(regexp_replace(coalesce(with_check, ''), '[()"''[:space:]]', '', 'g')) = 'id=my_organdis_org_owneroris_platform_admin') <> 1 then
    raise exception 'A-01a: orgs_update não ficou como dono/admin';
  end if;
  select string_agg(f.sig, ', ') into v_bad
    from unnest(array['public.is_org_member(uuid)','public.org_set_goals(uuid,jsonb)','public.org_set_pay_recipient(uuid,text)']) f(sig)
    left join pg_proc p on p.oid = to_regprocedure(f.sig)
   where p.oid is null or not p.prosecdef
      or has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_bad is not null then raise exception 'A-01a: função ausente ou com acesso errado: %', v_bad; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'weekly_payments') <> 4
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'weekly_payments' and cmd = 'ALL') then
    raise exception 'A-01a: policies de weekly_payments não ficaram como esperado';
  end if;
  if not exists (select 1 from pg_trigger where not tgisinternal and tgname = 'deals_comissao_so_dono') then
    raise exception 'A-01a: trava de comissão ausente';
  end if;
end $$;

commit;
notify pgrst, 'reload schema';
