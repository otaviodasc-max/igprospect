-- =====================================================================
-- Conalvo — E-01 · Equipes novas só pela administração (pedido → aprovação)
-- =====================================================================
-- NÃO APLICADO NA PRODUÇÃO. Roda só no staging local (dev/staging/montar.js)
-- e nos testes (tests/db/pedidos-equipe.test.js). Aplicar na produção só com
-- autorização explícita, pelo SQL Editor e à mão, JUNTO com o onboarding
-- operacional (index.html, app.js, conalvo-acesso.js/.css, conalvo-alvo.png):
-- sequência em db/PUBLICACAO.md (roteiro único). Fica fora de supabase/migrations/.
--
-- Regra de negócio:
--   1. Uma pessoa pede uma equipe nova (request_org). Um pedido pendente por pessoa.
--   2. Só o superadministrador lista e analisa os pedidos.
--   3. Aprovar = o superadministrador cria o espaço (admin_approve_org_request),
--      com nome e tipo definidos por ele. Ele NÃO vira membro da equipe e o
--      perfil dele não muda. Recusar exige motivo (admin_reject_org_request).
--   4. Na aprovação fica gravado QUEM será o dono (org_requests.owner_id):
--      por padrão o próprio solicitante (o ID autenticado de quem pediu) ou,
--      por escolha explícita do superadministrador, outra conta ativa.
--      O superadministrador vê o código em admin_orgs() e o envia por fora.
--      A pessoa entra com join_org (Minha conta → Entrar em outra equipe).
--      Só a conta gravada em owner_id vira dona, uma vez, ao entrar de fato
--      na equipe (gatilho AFTER INSERT em org_members) e só se a equipe ainda
--      não tiver dono. O código, sozinho, nunca dá papel de dono: qualquer
--      outra pessoa entra como membro, antes ou depois do dono.
--   5. Ninguém além do superadministrador cria equipe: create_org passa a
--      recusar usuário comum (o caminho "Criar espaço" do onboarding). Não
--      existe "criar a equipe aprovada": a aprovação não autoriza nada além
--      de ser dona daquela equipe específica, uma vez.
--
-- Tipo "prospeccao": equipe nova desse tipo nasce com Negociações, Ligações
-- e CRM desligados (org_features). Nenhuma equipe existente é reclassificada
-- nem muda de módulo, aba ou valor.
--
-- Não mexe em: equipes, membros, perfis, códigos de entrada, join_org,
-- switch_org, RLS existente, pagamentos. create_org mantém exatamente as
-- mesmas permissões de execução (compatível com as Fases A, C e D).
-- Uma transação só. Rollback: E-01-rollback.sql.
-- =====================================================================

begin;

do $$
begin
  if to_regclass('public.org_requests') is not null then raise exception 'E-01 abortada: org_requests já existe'; end if;
  if to_regprocedure('public.create_org(text,text)') is null then raise exception 'E-01 abortada: falta create_org(text,text)'; end if;
  if to_regprocedure('public._create_org_base(text,text)') is not null then raise exception 'E-01 abortada: _create_org_base já existe'; end if;
  if to_regprocedure('public.is_platform_admin()') is null or to_regprocedure('public.is_active()') is null then
    raise exception 'E-01 abortada: faltam is_platform_admin()/is_active()';
  end if;
  if to_regclass('public.org_features') is null then raise exception 'E-01 abortada: falta org_features'; end if;
end $$;

-- ------------------------------------------------------------------ 1
-- create_org: só o superadministrador. A função de hoje vira privada
-- (_create_org_base, sem EXECUTE para ninguém) e a nova create_org recebe
-- exatamente o mesmo ACL que a antiga tinha.
create temporary table _e01_acl on commit drop as
  select coalesce(nullif(a.grantee::regrole::text, '-'), 'public') as papel
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.oid = 'public.create_org(text,text)'::regprocedure and a.privilege_type = 'EXECUTE';

alter function public.create_org(text, text) rename to _create_org_base;
revoke all on function public._create_org_base(text, text) from public, anon, authenticated;

create function public.create_org(p_name text, p_module_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Equipes novas são criadas pela administração Conalvo. Peça uma equipe em Minha conta ou entre com o código que você recebeu.' using errcode = '42501';
  end if;
  return public._create_org_base(p_name, p_module_id);
end $$;
revoke all on function public.create_org(text, text) from public, anon, authenticated;
do $$
declare r record;
begin
  for r in select distinct papel from _e01_acl loop
    execute format('grant execute on function public.create_org(text, text) to %s', case when r.papel = 'public' then 'public' else quote_ident(r.papel) end);
  end loop;
end $$;

-- ------------------------------------------------------------------ 2
create table public.org_requests (
  id              uuid primary key default gen_random_uuid(),
  requester_id    uuid not null references public.profiles(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 3 and 60),
  module_id       text not null check (module_id in ('prospeccao','consorcio')),
  message         text check (message is null or char_length(message) <= 500),
  status          text not null default 'pendente' check (status in ('pendente','aprovado','recusado')),
  review_note     text check (review_note is null or char_length(review_note) <= 300),
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  org_id          uuid references public.orgs(id) on delete set null,
  owner_id        uuid references public.profiles(id) on delete set null,   -- futuro dono, gravado na aprovação
  owner_claimed_at timestamptz,
  created_at      timestamptz not null default now(),
  check (status <> 'recusado' or nullif(btrim(review_note), '') is not null),
  check (org_id is null or status = 'aprovado'),                 -- equipe apagada depois: org_id volta a null
  check (owner_id is null or status = 'aprovado')
);
create unique index org_requests_um_pendente on public.org_requests(requester_id) where status = 'pendente';
create unique index org_requests_uma_equipe on public.org_requests(org_id) where org_id is not null;
alter table public.org_requests enable row level security;
revoke all on public.org_requests from public, anon, authenticated;

-- o que o SOLICITANTE vê (sem código de entrada: ele chega por fora)
create view public.org_requests_v with (security_invoker = true) as
  select r.id, r.requester_id, p.name as requester_name, p.email as requester_email, r.name, r.module_id, r.message,
         r.status, r.review_note, r.reviewed_at, r.org_id, (r.owner_claimed_at is not null) as joined, r.created_at,
         (r.owner_id is not null and r.owner_id = r.requester_id) as owner_is_requester
    from public.org_requests r left join public.profiles p on p.id = r.requester_id;
revoke all on public.org_requests_v from public, anon, authenticated;

-- ------------------------------------------------------------------ 3
create function public.request_org(p_name text, p_module_id text, p_message text default null)
returns setof public.org_requests_v
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_nome text := btrim(coalesce(p_name, '')); v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if auth.uid() is null then raise exception 'Faça login.' using errcode = '42501'; end if;
  if not public.is_active() then raise exception 'Cadastro em análise: aguarde a aprovação do administrador' using errcode = '42501'; end if;
  if char_length(v_nome) not between 3 and 60 then raise exception 'O nome da equipe precisa ter de 3 a 60 caracteres.' using errcode = '22023'; end if;
  if p_module_id is null or p_module_id not in ('prospeccao','consorcio') then raise exception 'Escolha o tipo da equipe.' using errcode = '22023'; end if;
  if char_length(coalesce(v_msg, '')) > 500 then raise exception 'A mensagem pode ter até 500 caracteres.' using errcode = '22023'; end if;
  if exists (select 1 from public.org_requests where requester_id = auth.uid() and status = 'pendente') then
    raise exception 'Você já tem um pedido aguardando análise.' using errcode = '23505';
  end if;
  insert into public.org_requests(requester_id, name, module_id, message) values (auth.uid(), v_nome, p_module_id, v_msg) returning id into v_id;
  return query select * from public.org_requests_v where id = v_id;
end $$;

create function public.my_org_requests()
returns setof public.org_requests_v
language sql stable security definer set search_path = public as $$
  select * from public.org_requests_v where requester_id = auth.uid() order by created_at desc;
$$;

-- o superadministrador vê também o nome atual da equipe criada. O código de
-- entrada vem de admin_orgs() (já restrita ao superadmin): nenhuma função
-- nova toca no código, como a verificação da Fase C exige.
create function public.admin_org_requests()
returns table(id uuid, requester_id uuid, requester_name text, requester_email text, name text, module_id text, message text,
              status text, review_note text, reviewed_at timestamptz, org_id uuid, joined boolean, created_at timestamptz,
              owner_is_requester boolean, org_name text, owner_id uuid, owner_name text, owner_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Só o superadministrador.' using errcode = '42501'; end if;
  return query select v.*, o.name, r.owner_id, d.name, d.email
    from public.org_requests_v v join public.org_requests r on r.id = v.id
    left join public.orgs o on o.id = v.org_id left join public.profiles d on d.id = r.owner_id
   order by v.created_at desc;
end $$;

-- Aprovar = criar o espaço. O superadministrador define nome, tipo e quem
-- será o dono (padrão: o solicitante; outra pessoa só por p_owner_id
-- explícito, conta ativa). Ele não vira membro e o perfil dele (equipe
-- ativa) fica como estava.
create function public.admin_approve_org_request(p_request_id uuid, p_name text default null, p_module_id text default null, p_owner_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare r public.org_requests; v_org uuid; v_nome text; v_mod text; v_perfil_org uuid; v_perfil_papel text; v_dono uuid;
begin
  if not public.is_platform_admin() then raise exception 'Só o superadministrador.' using errcode = '42501'; end if;
  select * into r from public.org_requests where id = p_request_id for update;
  if r.id is null or r.status <> 'pendente' then raise exception 'Esse pedido já foi analisado.' using errcode = '22023'; end if;
  v_nome := btrim(coalesce(nullif(btrim(p_name), ''), r.name));
  v_mod := coalesce(p_module_id, r.module_id);
  if char_length(v_nome) not between 3 and 60 then raise exception 'O nome da equipe precisa ter de 3 a 60 caracteres.' using errcode = '22023'; end if;
  if v_mod not in ('prospeccao','consorcio') then raise exception 'Escolha o tipo da equipe.' using errcode = '22023'; end if;
  v_dono := coalesce(p_owner_id, r.requester_id);
  if not exists (select 1 from public.profiles where id = v_dono and status = 'active') then
    raise exception 'O dono escolhido precisa ser uma conta ativa.' using errcode = '22023';
  end if;
  select p.org_id, p.org_role into v_perfil_org, v_perfil_papel from public.profiles p where p.id = auth.uid();
  v_org := public._create_org_base(v_nome, v_mod);                 -- funis, etapas e desfechos padrão do tipo
  delete from public.org_members m where m.org_id = v_org and m.user_id = auth.uid();   -- o superadmin não fica na equipe
  perform set_config('app.allow_org_change', '1', true);
  update public.profiles set org_id = v_perfil_org, org_role = v_perfil_papel where id = auth.uid();
  if v_mod = 'prospeccao' then                                      -- Prospecção: sem Negociações, Ligações e CRM
    insert into public.org_features(org_id, feature_key, enabled)
      select v_org, f.key, false from public.features f where f.key in ('deals','calls','crm');
  end if;
  update public.org_requests set status = 'aprovado', org_id = v_org, owner_id = v_dono, name = v_nome, module_id = v_mod, reviewed_by = auth.uid(), reviewed_at = now()
   where id = r.id;
  return v_org;
end $$;

create function public.admin_reject_org_request(p_request_id uuid, p_note text)
returns setof public.org_requests_v
language plpgsql security definer set search_path = public as $$
declare v_status text; v_nota text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_platform_admin() then raise exception 'Só o superadministrador.' using errcode = '42501'; end if;
  select status into v_status from public.org_requests where id = p_request_id for update;
  if v_status is null or v_status <> 'pendente' then raise exception 'Esse pedido já foi analisado.' using errcode = '22023'; end if;
  if v_nota is null then raise exception 'Explique o motivo da recusa.' using errcode = '22023'; end if;
  update public.org_requests set status = 'recusado', review_note = v_nota, reviewed_by = auth.uid(), reviewed_at = now() where id = p_request_id;
  return query select * from public.org_requests_v where id = p_request_id;
end $$;

-- ------------------------------------------------------------------ 4
-- A conta gravada em owner_id vira dona ao ENTRAR de fato na equipe (linha
-- realmente inserida em org_members: AFTER INSERT não roda quando o
-- join_org cai no "on conflict do nothing"). Uma vez só, e só se a equipe
-- ainda não tiver dono. Qualquer outra pessoa segue as regras normais
-- (membro). O pedido é travado (for update): entradas simultâneas da mesma
-- conta não reclamam duas vezes.
create function public.org_requests_dono_ao_entrar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_req uuid;
begin
  select r.id into v_req from public.org_requests r
   where r.org_id = new.org_id and r.owner_id = new.user_id and r.status = 'aprovado' and r.owner_claimed_at is null
   for update;
  if v_req is null then return null; end if;
  update public.org_requests set owner_claimed_at = now() where id = v_req;
  if new.role <> 'owner' and not exists (select 1 from public.org_members m where m.org_id = new.org_id and m.role = 'owner') then
    update public.org_members set role = 'owner' where org_id = new.org_id and user_id = new.user_id;
  end if;
  return null;
end $$;
revoke all on function public.org_requests_dono_ao_entrar() from public, anon, authenticated;
create trigger org_requests_dono_ao_entrar after insert on public.org_members
  for each row execute function public.org_requests_dono_ao_entrar();

revoke all on function public.request_org(text,text,text) from public, anon;
revoke all on function public.my_org_requests() from public, anon;
revoke all on function public.admin_org_requests() from public, anon;
revoke all on function public.admin_approve_org_request(uuid,text,text,uuid) from public, anon;
revoke all on function public.admin_reject_org_request(uuid,text) from public, anon;
grant execute on function public.request_org(text,text,text), public.my_org_requests(), public.admin_org_requests(),
  public.admin_approve_org_request(uuid,text,text,uuid), public.admin_reject_org_request(uuid,text) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.org_requests', 'select') or has_table_privilege('anon', 'public.org_requests', 'select')
     or has_table_privilege('authenticated', 'public.org_requests_v', 'select') then
    raise exception 'E-01: a tabela de pedidos não pode ser lida direto';
  end if;
  if has_function_privilege('authenticated', 'public._create_org_base(text,text)', 'execute')
     or has_function_privilege('anon', 'public._create_org_base(text,text)', 'execute') then
    raise exception 'E-01: _create_org_base não pode ser executada por usuários';
  end if;
  if has_function_privilege('anon', 'public.request_org(text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.admin_approve_org_request(uuid,text,text,uuid)', 'execute') then
    raise exception 'E-01: anon não pode pedir nem aprovar';
  end if;
end $$;

commit;
