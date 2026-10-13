# Painel Conalvo: roteiro único de publicação e reversão

> **Nada disto foi publicado nem aplicado.** Tudo está em commits locais e no staging. Publicar só com autorização explícita, seguindo esta ordem.

## O que entra (e o que fica de fora)

### Site (GitHub Pages)

| Arquivo | Por quê |
|---|---|
| `index.html` | Casca Conalvo (título, logo, sidebar). Carrega `config.js`, `modules.js`, `conalvo-telas.js` e `app.js`, todos com `?v=20261013b` |
| `app.js`, `app.css` | Painel Conalvo (era `previa/app-conalvo.*`), com as funções reais |
| `conalvo-telas.js` | Relatórios, Equipe, Configurações por assunto, Administração e telas de acesso. Carregado **antes** do `app.js` |
| `modules.js` | Tipo **Prospecção** (só para equipes criadas assim pela administração) |
| `conalvo-alvo.png` | Logo usado na sidebar e nas telas de acesso (ainda não está no site) |
| `manifest.json` | Nome "Conalvo" no app instalado |
| `_config.yml` | Passa a excluir também `previa/` do site |

**Fica de fora:**
- extensão DEV (`extension-dev/`);
- Fase A, C e D (`db/seguranca`);
- X-01 e X-02 (`db/extensao`);
- P-02 (padrão das novas equipes);
- `conalvo-acesso.js`/`.css` (camada provisória substituída por `conalvo-telas.js`);
- a Prévia (`previa/`), que o `_config.yml` já não serve.

A extensão instalada (1.10.4) e `igprospect-extension.zip` **não mudam**.

### Banco (SQL Editor, à mão, cada arquivo numa transação)

| Ordem | Migração | Para quê | Sem ela, o painel… |
|---|---|---|---|
| 1 | `db/equipes/E-01-pedidos-de-equipe.sql` | Pedido → aprovação pelo superadmin → código → dono gravado; tipo Prospecção; `create_org` só para o superadmin | mostra "Pedidos… ainda não disponíveis"; entrar por código funciona |
| 2 | `db/pagamentos/P-03-registro-de-acoes.sql` | Registro de ações (chamado e follow-up com dia de Brasília e responsável). Base do Relatório mensal | mostra "Atividade ainda não disponível" no Relatório mensal; Metas segue como hoje |
| 3 | `db/pagamentos/P-01-modelo-pagamento-e-trava.sql` | Trava de pagamento confirmado (imutável) e troca de modelo agendada por data | todas as equipes ficam no pagamento por lead; a opção "Fixo + comissão" aparece desativada |

Nenhuma delas depende da Fase A nem da X-01/X-02. Todas abortam sozinhas se faltar pré-requisito ou se já tiverem sido aplicadas. O staging `PERFIL=publicacao` aplica exatamente estas três, nesta ordem.

## Sequência

1. **Ensaio no staging** (feito; refazer se algo mudar):
   ```bash
   cd dev/staging && PERFIL=publicacao node montar.js && node semear.js && node admin-previa.js
   cd ../e2e && node painel-staging.js && node onboarding-staging.js
   cd ../.. && node --test tests/*.test.js && (cd tests/db && npm test)
   ```
2. **Retrato antes** (SQL Editor, só leitura). Guarde o resultado:
   ```sql
   select id, name, module_id, join_code, settings->'goals' as metas, agendor_token is not null and agendor_token <> '' as tem_crm from orgs order by id;
   select org_id, user_id, role from org_members order by 1, 2;
   select org_id, count(*), max(week_end) from weekly_payments group by 1 order by 1;
   select count(*) from leads;
   ```
3. **Publicar o site** (os arquivos da tabela).
   - O branch local `publicacao-conalvo` foi montado a partir do `origin/main` com **só** esses arquivos, as três migrações, os rollbacks e este roteiro. Ele não leva a Prévia, a extensão DEV nem outro SQL.
   - Depois do GitHub Pages terminar, confira que o `index.html` servido pede `app.js?v=20261013b` e `conalvo-telas.js?v=20261013b`.
   - Nesse intervalo, sem as migrações:
     - entrar, ver leads, CRM, Negociações, Metas e pagamento por lead funcionam;
     - Relatório mensal e Pedidos mostram "ainda não disponível";
     - ninguém consegue criar equipe pela tela.
4. **Aplicar a E-01**, logo em seguida.
5. **Aplicar a P-03.** O registro começa a contar a partir daqui. Não há backfill: dias anteriores aparecem como "registro começou em…".
6. **Aplicar a P-01.**
7. **Conferir**:
   - o retrato do passo 2 continua igual (equipes, códigos, papéis, metas, pagamentos e leads);
   - um usuário comum recebe "Equipes novas são criadas pela administração Conalvo…" se chamar `create_org`;
   - o superadmin vê Administração → Pedidos de aprovação.
8. **Teste de fumaça** com contas reais combinadas:
   - pedir → aprovar (Consórcio e Prospecção) → entrar com o código → dono;
   - um chamado pela tela aparece no Relatório mensal;
   - o pagamento por lead mostra os valores de cada equipe;
   - um membro não vê valores.

### Interface antiga × banco novo

- O service worker não guarda páginas. A versão antiga só persiste em **abas já abertas** e no cache do GitHub Pages (~10 min). Por isso o site vai **antes** das migrações.
- Aba antiga com as migrações aplicadas:
  - "Criar espaço" é recusado pelo banco com mensagem clara;
  - entrar por código continua;
  - confirmar de novo um período já pago é recusado pela trava da P-01 (antes, o upsert sobrescrevia).
  - Testado em `onboarding-staging.js`, seção "Interface publicada hoje".
- O `index.html` sobe a versão de todos os scripts e do CSS juntos (`tests/acesso-operacional.test.js` reprova se divergirem).

## Voltar atrás

Na ordem inversa, cada passo independente:

1. **P-01** → `db/pagamentos/P-01-rollback.sql`. Recusa se alguma equipe já tiver plano agendado (exporte `org_pay_plans` e decida antes).
2. **P-03** → `db/pagamentos/P-03-rollback.sql`. Recusa se já houver ação registrada: depois da publicação haverá. Exporte `lead_activity_events` e decida antes. O painel sem a P-03 volta a mostrar "Atividade ainda não disponível", sem quebrar.
3. **E-01** → `db/equipes/E-01-rollback.sql`. Recusa se houver pedidos gravados. As equipes criadas por pedidos continuam existindo, com seus membros.
4. **Site** → reverter o commit da publicação (`git revert`). O painel antigo funciona com qualquer combinação das três migrações. A única diferença é que, com a P-01, ele não sobrescreve pagamento confirmado.

Não é preciso desfazer o banco para desfazer o site, nem o contrário.

## O que continua bloqueado (decisão ou etapa futura)

| Item | Bloqueio | Como fica na tela |
|---|---|---|
| **Respostas reais** no Relatório mensal | O evento "respondeu" só existe com a X-01 + extensão 1.11 com login (depende da Fase A) | "— ainda não registrado". Nenhum número estimado |
| **Fechamento mensal do modelo fixo** | Ações feitas pela extensão 1.10.4 ficam sem responsável (decisão nº 1 de `db/pagamentos/PLANO.md`) | Prévia do mês com o motivo do bloqueio; não confirma |
| **Tempo da 1ª abordagem à venda** | A data da venda é digitada no formulário e pode ser editada | "indisponível" |
| **P-02** (Fixo + comissão como padrão das equipes novas) | Só quando o modelo fixo estiver plenamente funcional | Equipes novas começam no pagamento por lead |
| **Fase A/C/D** (segunda camada de isolamento) | Revisão própria (`db/seguranca/PLANO.md`) | O painel funciona antes e depois da Fase A |

## Onde está testado

| O quê | Onde | Resultado |
|---|---|---|
| Painel (telas, regras, isolamento com dados fictícios, sem rede) | `node --test tests/*.test.js` | 201 + 4 pendências documentadas |
| Banco (PGlite, sem rede) | `cd tests/db && npm test` | ver relatório da rodada |
| Painel × staging com o conjunto de publicação (Consórcio, membro, extensão 1.10.4, Prospecção, isolamento, Administração, celular) | `dev/e2e/painel-staging.js` | ver relatório da rodada |
| Onboarding, dono gravado, membros antigos e interface publicada hoje × banco novo | `dev/e2e/onboarding-staging.js` | 31 verificações |
| Regra do dono pela API (concorrência, código compartilhado, tentativas diretas) | `dev/staging/pedidos-equipe.js` | 74 verificações |
