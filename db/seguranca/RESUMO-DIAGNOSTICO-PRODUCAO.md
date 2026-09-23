# Resumo anonimizado do diagnóstico da produção

> Fonte: `DIAGNOSTICO-00-somente-leitura.sql` rodado pelo proprietário no Supabase em 23/09/2026.
> Aqui só entram **números agregados e metadados**. Nenhum id, nome, e-mail, telefone, token, código de equipe ou conteúdo de lead.
> Nada foi executado por este repositório: as migrations continuam sem aplicação.

## Ambiente

| Item | Valor |
|---|---|
| Servidor | PostgreSQL 17.6 |
| Equipes | 13 |
| Perfis | 11 — 10 ativos, 1 pendente, 0 bloqueados |
| Pessoas em mais de uma equipe | 5 (comportamento legítimo) |
| Equipes com código de convite curto | 3 |
| Leads | 18.579 |
| Leads sem `ext_id` | 171 |
| Negociações | 590 |
| Inscrições de push | 11 |
| Realtime | publica `public.leads` e `public.messages` |

## Integridade (depois da limpeza feita pelo proprietário)

| Verificação | Resultado |
|---|---|
| Negociações com lead de outra equipe | **0** |
| Negociações sem lead | 0 |
| Ligações com lead de outra equipe | 0 |
| Leads com funil de outra equipe | 0 |
| Leads cujo autor não é membro da equipe | 0 |
| Perfis com equipe ativa sem associação em `org_members` | 0 |

Tudo isso é pré-requisito das Fases A e D, e agora está zerado.

## Incidente histórico já tratado (contexto, sem ação nova)

50 negociações estavam numa equipe apontando leads de outra. Todas com `source='extensao'`, criadas em lote em **16/09/2026**, antes do hotfix publicado em 21/09. Nenhuma vendida, nenhuma comissão paga, nenhuma alterada depois. Cada uma tinha correspondência unívoca por `ext_id` na equipe certa, e os leads correspondentes já tinham a própria negociação correta. O proprietário salvou backup CSV e removeu as 50 redundantes.

**Este repositório não cria migration de limpeza para essas linhas e não tenta removê-las de novo.** O que entra é prevenção, com teste que reproduz exatamente esse padrão e comprova que ele é impossível depois da Fase A.

## Estrutura confirmada

- `org_id` é **NOT NULL** nas seis tabelas da Fase D.
- Defaults `my_org()` presentes em `calls`, `deals`, `leads`, `messages`, `push_subscriptions` e `weekly_payments` — é o que a Fase D remove.
- `leads_org_extid_uniq`: índice **único, não parcial, sem expressão**, exatamente em `(org_id, ext_id)` — compatível com `on conflict (org_id, ext_id)`.
- Triggers em produção: quatro em `leads` (`leads_called_at`, `leads_create_deal`, `leads_stage_dates`, `leads_status_changed_at`), um em `profiles` (`profiles_guard`) e um em `auth.users` (`on_auth_user_created`).

## Divergências entre produção e repositório

| Onde | Produção | Repositório | Tratamento |
|---|---|---|---|
| `orgs_update` | Qualquer **membro ativo** atualiza a organização; sem `WITH CHECK` | `supabase-lock-orgs-owner.sql` restringiria ao dono — **nunca foi executado** | A Fase A espera a policy real, registra-a e a substitui por dono/admin, com `USING` e `WITH CHECK` |
| Bloco 8 do diagnóstico | Vinha vazio | Comparava `regclass::text` com nome qualificado | Corrigido para comparar por OID |
| Bloco 10 do diagnóstico | Erro de sintaxe no editor | Alias `constraint` | Corrigido para `nome_constraint` |

## Achado sem ação nesta rodada

`anon` e `authenticated` têm **DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE e UPDATE** nas tabelas do schema `public`. Risco classificado como médio (o RLS filtra linha a linha, mas `TRUNCATE`, `TRIGGER` e `REFERENCES` não são cobertos por policy). Proposta de **Fase E** separada, com testes e rollback próprios, descrita em `PLANO.md`. Nada foi alterado agora.
