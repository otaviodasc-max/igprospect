-- =====================================================================
-- IGProspect SaaS — Migração: Mural/Chat da Equipe (messages)
-- Execute no Supabase SQL Editor APÓS o supabase-schema.sql original.
-- Mensagens são compartilhadas dentro da organização (espaço).
-- =====================================================================

create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null default public.my_org() references public.orgs(id) on delete cascade,
  user_id     uuid default auth.uid() references auth.users(id) on delete set null,
  author_name text,                                  -- nome de quem enviou (mostrado para todos)
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists messages_org_idx on public.messages(org_id, created_at);

-- ---------------------------------------------------------------------
-- RLS — só a própria organização vê/escreve; cada um apaga as suas
-- ---------------------------------------------------------------------
alter table public.messages enable row level security;

-- Sem bypass de admin aqui — ver supabase-schema.sql seção 7 (funções
-- admin_orgs/admin_users), único lugar que pode ver mais de uma org.
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select using (org_id = public.my_org());

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert with check (org_id = public.my_org() and public.is_active());

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete using (user_id = auth.uid() or public.is_platform_admin());

-- ---------------------------------------------------------------------
-- Realtime — entrega instantânea das novas mensagens (idempotente)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
