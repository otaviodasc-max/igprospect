-- Stub mínimo do ambiente Supabase para testes locais (PGlite).
-- Reproduz só o que os SQL do IGProspect usam: papéis anon/authenticated/
-- service_role, schema auth com auth.users e auth.uid() (lendo o "sub" do JWT
-- como o PostgREST faz), privilégios padrão do schema public e a publicação
-- do Realtime. NÃO é o Supabase: serve só pra exercitar RLS/grants/RPCs.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at         timestamptz default now()
);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth   to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Igual ao Supabase: tudo que o dono cria no public já nasce liberado pros
-- papéis da API (quem protege é o RLS e os grants explícitos/revogações).
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create publication supabase_realtime;
