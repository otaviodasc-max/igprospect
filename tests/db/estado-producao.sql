-- Ajustes que aproximam o banco de teste do ESTADO REAL DA PRODUÇÃO,
-- medido pelo DIAGNOSTICO-00-somente-leitura.sql (PostgreSQL 17.6).
--
-- Por que existe: a baseline monta o banco replayando os SQL do repositório
-- na ordem dos cabeçalhos, e isso NÃO é igual à produção — alguns arquivos
-- nunca foram executados lá. Testar contra o repositório dava uma falsa
-- sensação de acerto: a Fase A da REV3 passava aqui e abortaria na produção.
--
-- Divergência confirmada no diagnóstico (bloco 6):
--   orgs_update — USING normalizado: id=my_organdis_activeoris_platform_admin
--   (ou seja, QUALQUER MEMBRO ATIVO atualiza a organização), WITH CHECK ausente.
--   O repositório tem supabase-lock-orgs-owner.sql, que restringiria ao dono,
--   mas ele nunca foi rodado na produção.
--
-- Rodar este arquivo depois da baseline reproduz esse estado.

drop policy if exists orgs_update on public.orgs;
create policy orgs_update on public.orgs
  for update using ((id = public.my_org() and public.is_active()) or public.is_platform_admin());
