# Segunda camada de isolamento entre equipes: plano

> Nada deste diretório foi aplicado. Cada fase só roda com autorização explícita do proprietário, **pelo SQL Editor e à mão**, na ordem abaixo.
> Os arquivos ficam fora de `supabase/migrations/` de propósito, para que um `supabase db push` nunca os aplique sozinho.

## Estado de partida (commit `777faf3`)

- **Painel:** Supabase Auth com e-mail e senha. As leituras filtram `org_id`; as escritas dependiam do default `my_org()` e do RLS.
- **Extensão 1.10.4:** não tem login. Usa a *anon key* mais o **código da equipe** (`join_code`) em 7 RPCs `SECURITY DEFINER` concedidas a `anon`. O "quem é você" é escolhido pelo próprio usuário, então o `created_by` é informado pelo cliente.
- **Banco:** RLS por "equipe ativa" (`org_id = my_org()`, com `my_org()` vindo de `profiles.org_id`). Não havia trava de integridade entre `org_id` e as referências (funil, lead da negociação ou da ligação).

## Fases

| Fase | Onde | O que | Quebra algo? |
|---|---|---|---|
| **A** | Banco: `A-01-aditiva-compativel.sql` | `is_org_member`; travas de integridade (org_id imutável, funil e lead da mesma equipe); RLS exige usuário ativo também para gravar; chat só para ativo; RPC anônima de membros sem e-mail; RPCs do painel sem `anon`; RPCs novas `ext2_*` com login | Não. A extensão 1.10.4 e o painel atual continuam funcionando (teste 12 e teste 13) |
| **B** | Painel (este commit) | `org_id` explícito em todo insert e `.eq('org_id')` em todo update e delete; `_config.yml` tira SQL, docs e testes do site | Não. É compatível com o banco antes e depois da Fase A |
| **B2** | Extensão 1.11 (**ainda não implementada**) | Login Supabase na extensão e uso exclusivo das `ext2_*` (ver abaixo) | Não, enquanto a Fase C não roda |
| **C** | Banco: `C-01-revogar-rpcs-anonimas.sql` | Revoga todas as RPCs por código de equipe | **Sim**, para quem ainda estiver na 1.10.4: ela para de sincronizar |
| **D** | Banco: `D-01-restricoes-finais.sql` | Remove o default `my_org()`; RLS exige associação ativa (`is_org_member`); autor do lead precisa ser membro | **Sim**, para aba com o `app.js` antigo aberta: gravações sem `org_id` passam a falhar |

## Autenticação da extensão: hoje e depois

**Hoje:** não há autenticação de usuário. Quem tem o código da equipe lê todos os leads, os nomes dos membros e o token do CRM, e grava ou apaga leads da equipe. O código é visível a todos os membros, continua válido para ex-membros e não expira.

**Como deveria ser (extensão 1.11):**
1. A tela de Configurações ganha login com e-mail e senha da mesma conta do painel. A chamada é `POST {SUPABASE_URL}/auth/v1/token?grant_type=password`, com o header `apikey`, o que já é permitido pelo `host_permissions` atual.
2. O `access_token` e o `refresh_token` ficam em `chrome.storage.local`. O `background.js` manda `Authorization: Bearer <access_token>`, renova com `grant_type=refresh_token` antes de expirar e apaga tudo ao sair.
3. A equipe é escolhida numa lista (`ext2_my_orgs`), não por código. Etapas, mapa e token do CRM vêm de `ext2_org_context`. Leads usam `ext2_list_leads`, `ext2_add_lead`, `ext2_update_lead` e `ext2_delete_lead`, sempre com `org_id` explícito, validado no banco por associação ativa.
4. O "quem é você" deixa de existir, porque o `created_by` é o usuário logado.
5. Não pode haver *fallback* para as RPCs por código: sem login, a extensão não sincroniza.
6. Leads locais pendentes (`synced:false`) da equipe escolhida são reenviados via `ext2_add_lead`. Os leads sem `orgId` continuam na quarentena, sem sincronizar.

**Sem interromper ninguém:** a 1.11 fala só com as `ext2_*`, que existem desde a Fase A, e a 1.10.4 continua funcionando pelas RPCs antigas até a Fase C. As duas convivem durante a transição.

## Ordem exata de publicação

0. **Imediato, fora das fases:** gerar um par novo de chaves VAPID, trocar a pública no `config.js` e a privada nos secrets da Edge Function `notify`, e pedir a todos que reativem as notificações. A chave privada antiga está pública (repositório público, GitHub Pages e histórico do git). Decidir se o repositório continua público.
1. **Preparar a Fase A:**
   - rodar os blocos 13 a 15 de `diagnostico-vazamento-somente-leitura.sql` e conferir se as funções em produção batem com o repositório (sobrecargas extras de `extension_*` estão previstas: as Fases A e C tratam todas pelo nome);
   - rodar os diagnósticos do cabeçalho do A-01 e guardar os resultados.
2. **Aplicar a Fase A** (SQL Editor, arquivo inteiro). Ela confere a si mesma e aborta tudo se algo não bater. Não precisa pausar o sistema. Logo depois, fazer um teste rápido: um lead pela extensão 1.10.4 e um pelo painel.
3. **Publicar a Fase B** (push do painel). Conferir:
   - `app.js?v=` novo no `index.html`;
   - `…/supabase-schema.sql` e `…/NOTIFICACOES-SETUP.txt` respondendo **404**;
   - todos recarregando o painel.
4. **Implementar e testar a extensão 1.11** (tarefa separada, depende de autorização). Distribuir o ZIP e acompanhar a adoção: todo usuário ativo logado na extensão, e nos logs de API do Supabase nenhuma chamada a `/rpc/extension_*` ou `/rpc/org_*_by_join_code` por alguns dias.
5. **Fase C**, somente depois do item 4 confirmado. Aplicar fora do horário de uso (~5 min). Quem ainda estiver na 1.10.4 para de sincronizar; os leads ficam guardados na extensão e voltam ao atualizar para a 1.11.
6. **Fase D**, com a Fase B publicada há pelo menos 48 h e todos tendo recarregado. Aplicar fora do horário de uso (~5 min). A fase aborta sozinha se houver perfil com equipe ativa sem associação.

**Pausa do sistema:** nenhuma fase exige parar o uso. As Fases C e D devem ser aplicadas fora do expediente, porque é nesses dois momentos que clientes desatualizados passam a ser recusados.

## Testes com duas equipes fictícias, sem tocar em dados reais

- **Local (já existe):** `cd tests/db && npm install && npm test`. Monta o banco dos SQL do repositório num Postgres em memória (PGlite), cria as equipes "A (teste)" e "B (teste)" com usuários `@example.test` e roda os cenários em baseline, A, A+C e A+C+D.
- **Antes da produção (recomendado):** um projeto Supabase **separado**, de staging (plano gratuito). Rodar os SQL do repositório, depois as fases, e testar painel e extensão apontando para ele. Não usar o projeto de produção para experimentos.
- **Na produção**, depois de cada fase: só com duas contas de teste dedicadas e duas equipes de teste, criadas com autorização. Nunca usar equipes reais.

## Rollback

Sempre na ordem inversa: **D → C → A**. Nenhum rollback mexe em dados.

| Fase | Como desfazer | Efeito |
|---|---|---|
| D | `D-01-rollback.sql` | Volta os defaults `my_org()` e as policies da Fase A |
| C | `C-01-rollback.sql` | Devolve o `anon` às RPCs por código (a 1.10.4 volta a funcionar) |
| B | `git revert` do commit do painel + push | O painel volta a gravar sem `org_id` explícito (funciona com a Fase A; **não** com a D) |
| A | `A-01-rollback.sql` (com a C já desfeita) | Remove travas, policies novas e `ext2_*`, e devolve o `anon` às RPCs do painel e o e-mail na RPC de membros |

## Fora do escopo desta tarefa (tarefas separadas)

- Restaurar o push "lead enviou contato".
- Criar negociação automaticamente em funil com última etapa personalizada.
- Limpar dados históricos.
- Restringir o token do CRM só ao dono.
- Endurecer a Edge Function `notify`.
- `alter default privileges` para novas funções não nascerem executáveis por `anon`.
