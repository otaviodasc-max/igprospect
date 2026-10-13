# Conalvo: roteiro único de publicação, transição e reversão

> **PUBLICADO em 13/10/2026** (autorização do dono): site no commit `68c38a6`; migrações aplicadas na produção nesta ordem: E-01 → A-01a → P-03 → P-01 → A-01b → X-01 → **`supabase-agendor-error-column.sql`** → X-02. A X-02 falhou na 1ª tentativa (faltava `leads.agendor_error` na produção, sem nada aplicado) e foi aplicada depois dessa coluna, com autorização. Registro de ações começou em 13/10/2026 18h13 (Brasília). Diagnóstico da faixa de 90: 0 dias afetados. Retrato antes × depois: igual. **C-01a não aplicada** (1.10.4 segue ativa).
> O pacote está no branch local **`publicacao-conalvo`**, montado a partir do `origin/main` só com os arquivos abaixo.

## Pacote

### Site (GitHub Pages)

| Arquivo | O que é |
|---|---|
| `index.html`, `app.js`, `app.css`, `conalvo-telas.js`, `modules.js`, `manifest.json`, `conalvo-alvo.png` | Painel Conalvo (versão `?v=20261013b` em todos os scripts) |
| `conalvo-extensao-1.11.zip` | **Extensão Conalvo 1.11 (produção)**: login com a conta do painel, ações com data e responsável |
| `igprospect-extension.zip` | Extensão 1.10.4, **sem mudança** (continua disponível até a migração) |
| `_config.yml` | Também deixa `previa/` fora do site |

A 1.11 é montada por `node dev/extensao/montar-1.11.js` a partir de `extension-dev/`, o mesmo código validado no staging:
- usa a URL e a chave **pública anônima** do `config.js` do painel (as mesmas que o site já publica);
- recusa qualquer chave privilegiada e qualquer endereço local;
- tem acesso de rede só ao Supabase do projeto e ao CRM de sempre (`hubcorretorconsorcio.com.br`), como a 1.10.4.

### Banco (SQL Editor, à mão, nesta ordem; cada arquivo é uma transação que aborta sozinha se faltar pré-requisito ou se já tiver sido aplicado)

| # | Migração | Para quê |
|---|---|---|
| 1 | `db/equipes/E-01-pedidos-de-equipe.sql` | Pedido → aprovação pelo superadmin → código → dono gravado. Tipo Prospecção |
| 2 | `db/seguranca/A-01a-dono-da-equipe.sql` | Nome, código, token, módulo e configurações da equipe: só o **dono** (ou superadmin). O membro salva **metas**, não o pagamento por lead. **Confirmar pagamento e marcar comissão paga: só dono/superadmin**, também pela API |
| 3 | `db/pagamentos/P-03-registro-de-acoes.sql` | Registro de ações com dia de Brasília e responsável: chamado, follow-up e **resposta registrada** (entrar na etapa "Respondeu", no máximo 1 por lead por dia; pular a etapa não conta) |
| 4 | `db/pagamentos/P-01-modelo-pagamento-e-trava.sql` | Pagamento confirmado imutável; troca de modelo agendada por data |
| 5 | `db/seguranca/A-01b-extensao-login.sql` | Base da 1.11: `assert_org_member` e as RPCs `ext2_*` com login (recorte da Fase A) |
| 6 | `db/extensao/X-01-extensao-1-11.sql` | 1.11: lead do perfil aberto, "seguido", ação idempotente (clique repetido, sem duplicar) |
| 7 | `supabase-agendor-error-column.sql` e depois `db/extensao/X-02-paridade-e-crm.sql` (a X-02 precisa da coluna `leads.agendor_error`, que faltava na produção) | 1.11: Hoje, Leads, Contatos, mudar etapa, notas, "Enviou contato" e CRM com reserva (sem envio duplicado) |

**Não entra agora:**
- `db/seguranca/C-01a-desligar-extensao-1-10-4.sql`: o desligamento da 1.10.4 é o **último** passo da transição, abaixo;
- a Fase A completa (`A-01`), que aborta depois da A-01a e só seria usada depois de revisada;
- as Fases C e D originais, a P-02, a `extension-dev/` e a `previa/`.

Nada disso depende da Fase A completa. A 1.10.4 continua funcionando com as 7 migrações.

## Sequência

1. **Ensaio no staging** (feito; refazer se algo mudar):
   ```bash
   cd dev/staging && PERFIL=publicacao node montar.js && node semear.js && node admin-previa.js && node pedidos-equipe.js
   cd ../e2e && node painel-staging.js && node onboarding-staging.js && node instagram-v2.js
   cd ../.. && node dev/extensao/montar-1.11.js && node --test tests/*.test.js && (cd tests/db && npm test)
   ```
2. **Retrato antes** (SQL Editor, só leitura). Guarde o resultado:
   ```sql
   select id, name, module_id, join_code, settings->'goals' as metas, coalesce(agendor_token,'') <> '' as tem_crm from orgs order by id;
   select org_id, user_id, role from org_members order by 1, 2;
   select org_id, count(*), max(week_end) from weekly_payments group by 1 order by 1;
   select count(*) from leads; select count(*) from deals where commission_paid;
   ```
3. **Impacto da correção da faixa de 90**: rodar `db/pagamentos/DIAGNOSTICO-faixa-90.sql` (só leitura). A consulta lista, nas equipes com a faixa ligada, os dias ainda não confirmados em que o dia de Brasília muda o resultado ("passa a ter" ou "deixa de ter" a faixa). Pagamentos confirmados não mudam. No staging não há caso real (0 linhas); um caso simulado (19 ações às 15h + 1 às 22h30) aparece corretamente.
4. **Publicar o site**: push do branch `publicacao-conalvo` para o `main`. Conferir que o `index.html` servido pede `app.js?v=20261013b`.
5. **Aplicar 1 → 7**, logo em seguida.
6. **Conferir:**
   - o retrato do passo 2 continua igual (só mudam as policies de `orgs` e `weekly_payments`);
   - em Configurações → Extensão, o painel passa a oferecer a 1.11 (ele só mostra o link quando o banco já tem a base dela).
7. **Teste de fumaça** com contas reais combinadas:
   1. o superadmin aprova um pedido de Consórcio e um de Prospecção; quem pediu entra com o código e vira dono;
   2. pela tela, o dono move um lead para "Chamado" e depois para "Respondeu": as duas ações aparecem no Relatório mensal (Chamados e Respostas registradas);
   3. um **membro** salva uma meta, não vê os valores do pagamento e não tem o botão de confirmar pagamento;
   4. pela API, com o token do membro, `PATCH /rest/v1/orgs?id=eq.<equipe>` devolve 0 linhas e `POST /rest/v1/weekly_payments` é recusado;
   5. a 1.10.4 adiciona um lead e marca chamado (fica registrado **sem responsável**);
   6. uma pessoa instala a 1.11, entra com o e-mail e a senha do painel, adiciona um lead e marca chamado (fica **com** responsável).

## Extensão 1.11: instalar e atualizar

No painel: **Configurações → Extensão → Baixar a 1.11**. As mesmas instruções aparecem lá:

1. Baixe e descompacte o `.zip` numa pasta que não vai apagar.
2. No Chrome, abra `chrome://extensions` e ligue o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta.
4. Abra o Instagram, clique no painel Conalvo e entre com o e-mail e a senha do painel.
5. Funcionou? **Remova a IGProspect 1.10.4** em `chrome://extensions`: as duas juntas mostram dois painéis.
6. **Atualizar:** substitua os arquivos da pasta pelos da versão nova e clique em **Recarregar** na extensão.

O que o staging **não** consegue validar e só dá para ver depois de publicar:
- o login na produção;
- o envio ao CRM real (no staging é um CRM falso com as mesmas rotas);
- a extensão empacotada apontando para a produção. O código é o mesmo testado no staging; muda só o `config.js`, que é conferido pelo teste do pacote.

## Transição dos usuários (1.10.4 → 1.11)

1. **Publicação (passos 4–5):** as duas versões funcionam juntas.
   - A 1.10.4 continua sincronizando pelo código da equipe, e as ações dela ficam **sem responsável**.
   - A 1.11 grava com responsável.
2. **Migração:** cada pessoa instala a 1.11 e remove a 1.10.4. Acompanhe pela consulta abaixo (só leitura); uma equipe só terminou quando `sem_responsavel` ficar em 0 por alguns dias:
   ```sql
   select o.name, count(*) filter (where e.actor_id is null) as sem_responsavel, count(*) as total
     from public.lead_activity_events e join public.orgs o on o.id = e.org_id
    where e.occurred_at > now() - interval '7 days' group by 1 order by 2 desc;
   ```
3. **Desligamento da 1.10.4** (só depois de todos migrarem, com nova autorização): aplicar `db/seguranca/C-01a-desligar-extensao-1-10-4.sql`. Ele corta só as RPCs por código de equipe; a 1.11 e o painel seguem. O rollback (`C-01a-rollback.sql`) devolve exatamente os acessos anteriores.

### Modelo fixo durante a transição

- Ações sem responsável (1.10.4) **não são atribuídas a ninguém**. Ficam guardadas e aparecem sinalizadas no mês em Relatórios → Fechamento mensal.
- Cada mês é fechado sozinho. Um mês só fica **pendente** se o cálculo depender dessas ações, isto é, se houver ação sem responsável num dia em que o destinatário não bateu a meta. Nos outros dias, a fração já está no máximo e o valor não muda.
- **Decisão necessária só para os meses pendentes:** a quem pertencem as ações sem responsável daqueles dias. Sem ela, esses meses ficam pendentes; os demais (inclusive os seguintes) podem ser confirmados.
- A comissão de cada mês é só das vendas daquele mês: um mês pendente não empurra as vendas dele para o mês seguinte.

## Voltar atrás

As reversões são **independentes**: o painel novo funciona com e sem as migrações, e o antigo também.

### Site (sem tocar no banco)
- Fazer `git revert` do commit da publicação. Nada no banco muda e nenhum dado se perde.
- Com as migrações aplicadas, o painel antigo:
  - não cria equipe;
  - não sobrescreve pagamento confirmado;
  - não confirma pagamento por membro.
- A 1.11 já instalada continua funcionando, porque fala direto com o banco. O link de download some junto com o site novo.

### Banco (ordem inversa; cada passo é independente e nenhum apaga dado criado depois da publicação)

| Passo | Arquivo | Com dados criados depois da publicação |
|---|---|---|
| 1 | `X-02-rollback.sql` | **Recusa** se houver contato ou envio ao CRM registrado pela 1.11. Para preservar, não rode |
| 2 | `X-01-rollback.sql` | **Recusa** se houver "seguido" registrado |
| 3 | `A-01b-rollback.sql` | Recusa enquanto a X-01 existir; sem dados próprios |
| 4 | `P-01-rollback.sql` | **Recusa** se houver plano agendado |
| 5 | `P-03-rollback.sql` | **Recusa** se houver ação registrada (haverá logo após a publicação) |
| 6 | `A-01a-rollback.sql` | Sempre roda e **não apaga nada**: devolve as policies exatas da produção (`orgs_update` e `weekly_payments_org`). **Reabre a brecha**: usar só se a correção travar algo legítimo |
| 7 | `E-01-rollback.sql` | **Recusa** se houver pedidos gravados; as equipes criadas por pedidos continuam |

Regra prática: se algo der errado, reverta **o site** primeiro. As migrações são aditivas e, onde há dados, o rollback se recusa em vez de apagar.

## O que segue pendente (com o motivo)

| Item | Situação |
|---|---|
| Meses do fixo com ações sem responsável em dias que alteram o valor | Pendentes até a decisão de a quem pertencem essas ações (veja acima). Os outros meses fecham |
| Pagamento por lead: 2º follow-up no mesmo lead em outro dia; base "leads cadastrados" | Regras de pagamento atuais, mantidas. O cálculo usa a 1ª entrada na etapa e o cadastro (rotulado "Leads cadastrados", não "seguidos"). Mudar isso alteraria valores: não foi feito |
| Desligar a 1.10.4 (C-01a) | Preparado e testado, para depois da migração de todos |
| Tempo da 1ª abordagem à venda | Indisponível: a data da venda é digitada e pode ser editada |

## Onde está testado

| O quê | Onde | Resultado |
|---|---|---|
| Painel (telas, regras, isolamento, faixa em Brasília, fechamento por mês, respostas, cache do registro) | `node --test tests/*.test.js` | 212, mais 2 pendências documentadas (regras do pagamento por lead) |
| Banco (PGlite): E-01, A-01a (inclusive pagamento e comissão), P-03 com respostas, P-01, A-01b, X-01, X-02, C-01a, rollbacks | `cd tests/db && npm test` | 217 + 22, 3 pulados (cenários com a Fase C original ou sem a Fase A, fora do pacote) |
| Pacote da extensão (config de produção, chave anônima, recusa de chave privilegiada ou local, mesmo código do staging) | `tests/extensao-dev.test.js` | 5 |
| API do staging com o pacote completo | `dev/staging/pedidos-equipe.js` | 77 |
| Painel × staging com o pacote completo | `dev/e2e/painel-staging.js` | 61 |
| Onboarding, regra do dono, membros antigos, painel publicado hoje × banco novo | `dev/e2e/onboarding-staging.js` | 31 |
| Extensão 1.11 carregada no navegador, Instagram real + staging com o pacote + CRM falso | `dev/e2e/instagram-v2.js` | 9 cenários (login, clique duplo, rede derrubada, CRM, troca de equipe…) |
