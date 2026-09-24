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

## O que o diagnóstico da produção mudou (revisão 4)

O diagnóstico foi rodado na produção (PostgreSQL 17.6) e mostrou que o banco **não** é o que o repositório sugere. O resumo anonimizado está em `RESUMO-DIAGNOSTICO-PRODUCAO.md`. Três consequências diretas:

1. **`orgs_update` era a policy do `supabase-schema.sql`, não a do `supabase-lock-orgs-owner.sql`** (esse arquivo nunca foi executado lá). Ou seja, **qualquer membro ativo** pode alterar a linha da organização: nome, `settings`, `module_id`, `agendor_token` e até o `join_code`. A Fase A da revisão 3 esperava a versão restrita e **abortaria na primeira tentativa**, sem mudar nada — a precondição funcionou como devia, mas contra o banco errado.
   - A revisão 4 passa a **esperar a policy real**, registra-a para o rollback e a **substitui de propósito** por dono da equipe ativa ou admin da plataforma, com `USING` e `WITH CHECK` explícitos.
   - No painel, as telas que gravam em `orgs` são do dono, **menos a aba Metas**. Para ela entra a RPC `org_set_goals`; o destinatário do pagamento tem RPC própria, só do dono (`org_set_pay_recipient`). **A versão da revisão 4 desta RPC estava errada — ver "Revisão 5" logo abaixo.**
2. **Os blocos 8 e 10 do diagnóstico tinham defeito** (comparação por texto de `regclass` e alias reservado). Corrigidos e cobertos por teste.
3. **A inconsistência histórica foi limpa pelo proprietário** (50 negociações de uma equipe apontando lead de outra, criadas em lote em 16/09/2026, antes do hotfix). Nenhuma migration daqui mexe nessas linhas. O que entra é a **prevenção**: as travas da Fase A tornam esse padrão impossível, e as precondições agregadas abortam a fase se algum cruzamento reaparecer.

## O que a revisão independente da REV4 encontrou (revisão 5)

A RPC `org_set_goals` da revisão 4 **não conversava com o painel de verdade**. Os testes passavam porque usavam um objeto simplificado, escrito à mão, e não o que o painel manda. Depois da Fase A, "Salvar metas" teria parado de funcionar para todo mundo:

1. **Chaves erradas.** O painel (`goalsForm()` e `getGoals()` em `app.js`) usa 14 chaves: `contacts`, `sales`, `revenue`, `commission`, `leadDailyMin`, `leadDailyMax`, `callsWeekly`, `payDayRate`, `payTargetPerDay`, `commissionPct`, `payBasis`, `payFollowUp`, `payBonusMinPerDay` e `payBonusRate`. A RPC aceitava outra lista (`payRate`, `dailyTarget`, `weeklyTarget`…), que **nunca existiu no painel**, e recusava 7 das chaves reais.
2. **Booleano recusado.** `payFollowUp` é booleano, e a RPC só aceitava número, nulo ou texto.
3. **Dois `ReferenceError` no painel.** Depois de salvar metas e depois de trocar o destinatário, o código fazia `S.org.settings=settings` com uma variável que não existia ali. O banco gravava, mas o modal não fechava, o aviso não aparecia e a tela não era redesenhada.
4. **Destinatário do pagamento aberto.** A interface trata "quem recebe" como coisa do dono, mas a RPC aceitava `payRecipientId` de qualquer membro ativo. Por chamada direta, um membro trocava, apagava ou injetava o destinatário.
5. **Rollback conferido pela metade.** A verificação final não citava `org_set_goals` e só procurava o que estava no registro. A verificação da Fase A olhava só o `USING` de `orgs_update`.

**Como a revisão 5 resolve:**

- **Duas RPCs, responsabilidades separadas.**
  - `org_set_goals(p_org_id, p_goals)` é para **membro ativo** daquela equipe (ou admin da plataforma). O contrato é exatamente o objeto do painel, com regra própria por chave:
    - contagens: inteiro ≥ 0;
    - dinheiro e percentual: número ≥ 0, com teto;
    - `payBasis`: só `seguidos` ou `chamados`;
    - `payFollowUp`: só booleano.

    Texto no lugar de número, lista, objeto, nulo e chave desconhecida são recusados. Se o objeto trouxer `payRecipientId`, **a chamada inteira é recusada**. A gravação faz *merge* sobre as metas atuais num único `UPDATE`, então o destinatário gravado fica onde está.
  - `org_set_pay_recipient(p_org_id, p_recipient_id)` é **só para o dono daquela equipe** (`org_members.role = 'owner'` em `p_org_id`, com perfil ativo) ou para o admin da plataforma. Aceita só duas coisas: vazio ou nulo ("todo mundo", que remove a chave), ou o UUID de um **membro ativo da própria equipe**.
- **Várias equipes.** As duas RPCs decidem pelo `p_org_id` e por `org_members`, nunca pela equipe aberta. Quem é dono de A e está com B aberta continua definindo o destinatário de A, e em B é tratado como membro.
- **Painel.**
  - `saveOrgGoals` nunca manda o destinatário, e `savePayRecipient` usa a RPC própria. As duas atualizam `S.org` só quando dá certo, e o `settings` solto saiu dos dois pontos.
  - O caminho antigo (UPDATE direto) só é usado quando a RPC **não existe** (`PGRST202`, ou `42883` citando a própria RPC). Qualquer outro erro é mostrado como está, sem cair no UPDATE amplo.
  - Se o UPDATE antigo não afetar nenhuma linha, isso agora é erro, e não um "salvo" falso.
- **Verificações.**
  - A Fase A confere `orgs_update` inteira (comando, tipo, papel, `USING` e `WITH CHECK`) e as duas RPCs: assinatura, `SECURITY DEFINER`, `search_path` fixo e ACL exatamente `authenticated`.
  - O rollback compara policies, grants e a definição restaurada com o registro **antes** de apagá-lo. Depois procura, **pelo nome**, qualquer função ou trigger da Fase A que tenha sobrado, e confere que `orgs_update` voltou a ser a de membro ativo, sem `WITH CHECK`.
- **Bug antigo corrigido de quebra:** na versão publicada (`777faf3`), salvar metas **apagava o destinatário do pagamento**, porque o formulário regravava `goals` inteiro sem essa chave. Com o *merge*, isso acabou, tanto na RPC quanto no caminho antigo.

Os testes agora usam o **objeto real**: o `app.js` roda inteiro num contexto isolado do Node, com Supabase simulado (`tests/harness-painel.js`). O payload dos testes de banco sai desse mesmo painel, não de um objeto escrito à mão.

## Precondições e rollback exato (revisão 2)

Cada fase roda numa transação só e **aborta antes de alterar qualquer coisa** se o banco não estiver no estado esperado. A Fase A confere: tabelas, colunas e tipos; índice único **não parcial** em `leads(org_id, ext_id)` (sem ele o `on conflict` não funciona); ausência de qualquer objeto com os nomes novos; assinatura, retorno e **hash da definição** de `org_members_by_join_code`; os grants atuais das RPCs do painel, olhando a **ACL explícita** (e não `has_function_privilege`, que daria "true" só por causa do `PUBLIC`); e a **lista completa de policies** das tabelas sensíveis, abortando tanto se faltar uma quanto se existir uma a mais, permissiva ou restritiva. Nenhuma policy desconhecida é removida automaticamente.

Objetos novos são criados com `create function` (nunca `create or replace`), então um homônimo com definição desconhecida interrompe a fase.

Antes de mudar qualquer coisa, a Fase A cria `public.seguranca_estado_anterior` (com RLS ligado e sem policy: nenhum papel da API a enxerga) e registra ali os grants, as policies e a definição de função que serão substituídos. **Os rollbacks restauram exatamente esse registro** e, na dúvida, se recusam a rodar. Eles nunca concedem privilégio "por garantia": um papel que não tinha `EXECUTE` continua sem.

Se um hash ou uma policy divergir, isso não é um erro do plano: é o sinal de que a produção difere do repositório. Rode o diagnóstico, compare e só então ajuste a constante correspondente na migration.

## Ordem exata de publicação

0. **Incidente VAPID** (fora destas fases, com ordem própria — ver abaixo).
1. **Preparar:**
   - rodar `DIAGNOSTICO-00-somente-leitura.sql` bloco a bloco e guardar os resultados, porque é ele que confirma (ou desmente) cada precondição;
   - conferir no BLOCO 4 o hash de `org_members_by_join_code`, no BLOCO 5 que nenhum nome novo existe (inclusive `org_set_goals` e `org_set_pay_recipient`), no BLOCO 6 as policies e no BLOCO 11 o índice único.

**Da publicação do painel até a Fase A** (ordem da revisão independente da REV4; nada disso foi executado):

1. **Publicar o painel compatível** (push do `main`, com `app.js?v=20260924a`). Ele chama as RPCs novas e, enquanto elas não existem, usa o caminho antigo.
2. **Verificar que o painel continua funcionando pelo fallback, antes da Fase A.** Salvar metas e trocar o destinatário com uma conta de teste. Os dois precisam gravar, e a aba de rede mostra `org_set_goals`/`org_set_pay_recipient` respondendo 404 (`PGRST202`), seguidos do `PATCH` em `orgs`. Conferir também `…/supabase-schema.sql` e `…/NOTIFICACOES-SETUP.txt` respondendo **404** e todos recarregando o painel.
3. **Aplicar a Fase A** (SQL Editor, arquivo inteiro). Ela confere a si mesma e aborta tudo se algo não bater. Não precisa pausar o sistema.
4. **Verificar que o painel passou a usar as RPCs:** a aba de rede mostra `org_set_goals` respondendo 200, e não há mais `PATCH` em `orgs` ao salvar metas.
5. **Testar metas com o payload completo:** abrir "Definir metas", preencher **todos** os campos (inclusive "Pagar também pelos follow-ups" ligado e desligado e as duas bases de pagamento), salvar e reabrir. Tudo tem que voltar igual, e o destinatário tem que continuar o mesmo.
6. **Testar o destinatário como dono:** escolher uma pessoa, recarregar, voltar para "Todo mundo" e recarregar de novo.
7. **Testar a recusa como membro comum:** com uma conta de membro de teste, salvar metas tem que funcionar. Chamar `org_set_pay_recipient` direto (console) tem que devolver "Só o dono da equipe…", e o destinatário tem que continuar o mesmo.
8. **Testar criação de lead, negociação e ligação em duas equipes de teste:** um lead pela extensão 1.10.4 e um pelo painel em cada equipe; mover um lead para "contato" e conferir que a negociação nasceu na equipe do lead; registrar uma ligação. Com uma conta que participa das duas equipes, repetir na outra.
9. **Só depois disso considerar as fases seguintes:**
   - extensão 1.11 com login (tarefa separada), com distribuição e confirmação de adoção. Em todo usuário ativo logado na extensão, nos logs de API do Supabase não pode aparecer nenhuma chamada a `/rpc/extension_*` ou `/rpc/org_*_by_join_code` por alguns dias;
   - **Fase C**, somente depois disso, fora do horário de uso (~5 min);
   - **Fase D**, com o painel publicado há pelo menos 48 h e todos tendo recarregado, fora do horário de uso (~5 min).

**Por que o painel vem antes da Fase A:** a Fase A fecha o `UPDATE` amplo em `orgs`. O painel publicado hoje (`777faf3`) salva metas com esse UPDATE, e o RLS passaria a devolver 0 linhas **sem erro**: quem clica veria "Metas atualizadas!" sem nada ter sido gravado.

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
| B | `git revert` dos commits do painel + push | O painel volta a gravar sem `org_id` explícito (**não** funciona com a D). Com a Fase A aplicada, o painel antigo **não** salva metas (UPDATE vira 0 linhas): desfazer o painel só depois de desfazer a A |
| A | `A-01-rollback.sql` (com a C já desfeita) | Remove travas, policies novas, `ext2_*`, `org_set_goals` e `org_set_pay_recipient`. Devolve `orgs_update` a "membro ativo, sem `WITH CHECK`", o `anon` às RPCs do painel e o e-mail na RPC de membros. Aborta se algo não bater com o registro |

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


## Achado que fica para uma fase própria: privilégios de tabela

O diagnóstico mostrou `anon` e `authenticated` com **DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE e UPDATE** nas tabelas do schema `public` — inclusive em tabelas de backup histórico. É o padrão do Supabase (quem protege é o RLS), mas a superfície é maior do que o necessário.

**Risco:** médio hoje, porque o RLS limita linha a linha. O que incomoda é o que o RLS **não** cobre: `TRUNCATE` não é filtrado por policy (apaga a tabela inteira de todas as equipes), `REFERENCES` permite criar FK apontando para as tabelas e `TRIGGER` permite anexar trigger a elas. Basta um papel da API conseguir executar SQL arbitrário — por exemplo via uma função `SECURITY DEFINER` mal escrita — para que isso pese.

**Nesta rodada, nada foi alterado.** Proposta de **Fase E**, independente e com testes e rollback próprios:
1. medir o que painel e extensão realmente usam por tabela (o painel lê e escreve `leads`, `calls`, `deals`, `messages`, `weekly_payments`, `push_subscriptions` e as tabelas de configuração; a extensão não toca em tabela nenhuma, só em RPC);
2. revogar primeiro os candidatos óbvios: **TRUNCATE, TRIGGER e REFERENCES** de `anon` e `authenticated`;
3. depois avaliar `DELETE`/`INSERT`/`UPDATE` de `anon` (que não deveria precisar de nenhum, já que a extensão só usa RPC);
4. cada passo com rollback que devolve exatamente os privilégios registrados, como nas Fases A, C e D.

## Leads sem ext_id (171 na produção)

Nenhuma fase depende de preencher isso, e **não há backfill proposto**:
- o índice único `(org_id, ext_id)` aceita vários nulos, então nada quebra;
- `ext2_list_leads` devolve `coalesce(ext_id, id::text)`, e `ext2_update_lead`/`ext2_delete_lead` localizam por `ext_id` **ou** pelo `id` quando o `ext_id` está vazio;
- `ext2_add_lead` exige `ext_id` só para o lead novo que a extensão cria.

Preencher `ext_id` nesses 171 leads é uma decisão de produto (mudaria como a extensão os enxerga) e precisa de estratégia aprovada em separado.

## Usuários em várias equipes (5 na produção)

É comportamento legítimo e continua funcionando: `ext2_my_orgs` lista as equipes de que a pessoa é membro, `ext2_org_members` lista todos os membros ativos (e não só quem está com a equipe aberta) e o RLS continua limitando leitura e escrita à equipe ativa. Há teste específico para isso.

## Códigos de equipe curtos (3 na produção)

Continuam sendo o ponto mais frágil enquanto a Fase C não roda: código curto é varrível por força bruta e dá acesso às RPCs anônimas. A rotação (`supabase-rotacionar-todos-join-codes.sql`) é independente destas fases e desconecta as extensões já conectadas — decidir com o proprietário se roda antes da Fase C ou junto com ela.
