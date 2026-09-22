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
| **0** | Banco: `DIAGNOSTICO-00-somente-leitura.sql` | Extrai metadados (definições, grants, policies, triggers, colunas, índices, contagens anônimas). Só leitura | Não |
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

## Precondições e rollback exato (revisão 2)

Cada fase roda numa transação só e **aborta antes de alterar qualquer coisa** se o banco não estiver no estado esperado. A Fase A confere: tabelas, colunas e tipos; índice único **não parcial** em `leads(org_id, ext_id)` (sem ele o `on conflict` não funciona); ausência de qualquer objeto com os nomes novos; assinatura, retorno e **hash da definição** de `org_members_by_join_code`; os grants atuais das RPCs do painel, olhando a **ACL explícita** (e não `has_function_privilege`, que daria "true" só por causa do `PUBLIC`); e a **lista completa de policies** das tabelas sensíveis, abortando tanto se faltar uma quanto se existir uma a mais, permissiva ou restritiva. Nenhuma policy desconhecida é removida automaticamente.

Objetos novos são criados com `create function` (nunca `create or replace`), então um homônimo com definição desconhecida interrompe a fase.

Antes de mudar qualquer coisa, a Fase A cria `public.seguranca_estado_anterior` (com RLS ligado e sem policy: nenhum papel da API a enxerga) e registra ali os grants, as policies e a definição de função que serão substituídos. **Os rollbacks restauram exatamente esse registro** e, na dúvida, se recusam a rodar. Eles nunca concedem privilégio "por garantia": um papel que não tinha `EXECUTE` continua sem.

Se um hash ou uma policy divergir, isso não é um erro do plano: é o sinal de que a produção difere do repositório. Rode o diagnóstico, compare e só então ajuste a constante correspondente na migration.

## Ordem exata de publicação

0. **Incidente VAPID (fora destas fases, ordem própria — ver abaixo).**
1. **Preparar a Fase A:**
   - rodar `DIAGNOSTICO-00-somente-leitura.sql` inteiro e guardar os resultados. Ele é a fonte que confirma (ou desmente) cada precondição;
   - conferir no BLOCO 4 o hash de `org_members_by_join_code` contra o valor esperado na Fase A; no BLOCO 5, que nenhum nome novo existe; no BLOCO 6, as policies; no BLOCO 11, o índice único;
   - rodar também os diagnósticos do cabeçalho do A-01.
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


## Rotação da chave VAPID (ordem corrigida)

A chave privada está exposta (repositório público, GitHub Pages e histórico do git). A rotação tem ordem própria, porque trocar só a chave deixaria todos os aparelhos presos à inscrição antiga:

1. **Publicar primeiro o código compatível com rotação, ainda com a chave ANTIGA.** O painel passa a comparar a chave da inscrição existente com a configurada e, se forem diferentes, apaga a linha, cancela a inscrição e cria outra. Com a chave igual, nada muda para ninguém.
2. **Verificar o funcionamento** com a chave antiga: notificações continuam chegando e nenhuma inscrição é recriada à toa.
3. **Só então gerar o par novo**, fora do repositório, e guardar no gerenciador de senhas.
4. **Janela coordenada:** trocar os *secrets* da Edge Function e, em seguida, publicar o `config.js` com a chave pública nova e o `?v=` novo.
5. **Pedir que todos abram o painel** (no iPhone, pelo ícone da Tela de Início). A reinscrição acontece sozinha, sem pedir permissão de novo.
6. **Confirmar reinscrições e entregas** antes de qualquer outra coisa.
7. **Só depois disso** considerar a limpeza das inscrições antigas.

**Por que a `notify` NÃO apaga inscrição em 401/403 (ainda):** a ideia era limpar sozinha as inscrições presas à chave antiga. O risco é o inverso: 401/403 também aparece quando a configuração está temporariamente inconsistente — *secret* novo com `config.js` antigo, uma função publicada pela metade, relógio fora de hora ou erro de digitação na chave. Nesse cenário, a função apagaria **inscrições válidas** de toda a equipe, e cada pessoa teria de reativar na mão. Por isso a `notify` continua apagando só em **404/410** (inscrição que o próprio serviço de push declara inexistente), e a limpeza por 401/403 fica para uma revisão específica, depois da rotação, com os números da janela em mãos.
