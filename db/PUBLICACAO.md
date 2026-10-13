# Painel Conalvo: roteiro único de publicação e reversão

> **Nada disto foi publicado nem aplicado.** Tudo está em commits locais e no staging. Publicar só com autorização explícita, seguindo esta ordem.
> O pacote está pronto no branch local **`publicacao-conalvo`**, montado a partir do `origin/main` só com os arquivos abaixo.

## Pacote final

### Site (GitHub Pages)

| Arquivo | Por quê |
|---|---|
| `index.html` | Casca Conalvo. Carrega `config.js`, `modules.js`, `conalvo-telas.js` e `app.js`, todos com `?v=20261013b` |
| `app.js`, `app.css` | Painel Conalvo, com as funções reais. "Definir metas" envia **só** as metas (o pagamento é do dono, em Configurações → Pagamento) |
| `conalvo-telas.js` | Relatórios, Equipe, Configurações por assunto, Administração e telas de acesso. Carregado **antes** do `app.js` |
| `modules.js` | Tipo **Prospecção** (só para equipes criadas assim pela administração) |
| `conalvo-alvo.png` | Logo (ainda não está no site) |
| `manifest.json` | Nome "Conalvo" no app instalado |
| `_config.yml` | Também exclui `previa/` do site |

### Banco (SQL Editor, à mão; cada arquivo é uma transação que aborta sozinha se faltar pré-requisito ou se já tiver sido aplicado)

| Ordem | Migração | Para quê |
|---|---|---|
| 1 | `db/equipes/E-01-pedidos-de-equipe.sql` | Pedido → aprovação pelo superadmin → código → dono gravado. Tipo Prospecção. `create_org` só para o superadmin |
| 2 | `db/seguranca/A-01a-dono-da-equipe.sql` | **Correção da brecha.** Nome, código, token, módulo e `settings` da equipe só pelo **dono** (ou superadmin). O membro salva as **metas** pela RPC `org_set_goals`, mas não o pagamento por lead. Destinatário do pagamento só do dono |
| 3 | `db/pagamentos/P-03-registro-de-acoes.sql` | Registro de ações (chamado e follow-up, com dia de Brasília e responsável). Base do Relatório mensal |
| 4 | `db/pagamentos/P-01-modelo-pagamento-e-trava.sql` | Pagamento confirmado imutável. Troca de modelo agendada por data (só o dono) |

**Fica de fora:**
- a Fase A **completa** (`A-01`): a A-01a é o recorte necessário (veja abaixo);
- `A-01b`, X-01 e X-02: base da extensão 1.11, uma versão separada;
- Fases C e D;
- P-02;
- a extensão DEV (`extension-dev/`);
- `conalvo-acesso.*`;
- `previa/`.

A extensão instalada (1.10.4) e `igprospect-extension.zip` **não mudam**.

### Por que a A-01a e não a Fase A completa

Revisão da `A-01-aditiva-compativel.sql` (revisão 5), parte a parte:

| Parte | O que faz | No pacote? |
|---|---|---|
| A1 `is_org_member` | "sou membro ativo desta equipe?" | **Sim** (usada pela RPC de metas) |
| A1 `assert_org_member` | Login + associação, ou erro | Não: só a 1.11 usa (vai na `A-01b`) |
| A2 travas `org_id` / funil / lead da mesma equipe | Integridade entre equipes | Não. Proteção útil, mas não é a brecha. Aborta se houver inconsistência histórica: aplicar à parte, com o diagnóstico |
| A3 RLS só para usuário ativo | Bloqueado/pendente para de gravar | Não. É outra brecha (usuário bloqueado), a avaliar à parte |
| A4 sem e-mail na RPC anônima de membros | Para de expor e-mail pelo código | Não: muda o que a 1.10.4 recebe; avaliar com a Fase C |
| A5 RPCs do painel sem `anon` | Endurecimento | Não |
| A6 `ext2_*` | RPCs da extensão com login | Não: vai na `A-01b` (versão 1.11) |
| A7 `orgs_update` só dono/admin | **A brecha** | **Sim** |
| A8 `org_set_goals` | Metas pelo membro | **Sim, corrigida.** A A8 original deixava o membro gravar `payDayRate`, `payBasis`, `payFollowUp`, `payBonus*` e `commissionPct`. Na A-01a, essas chaves só o dono muda; reenviar o valor já gravado passa |
| A9 `org_set_pay_recipient` | Destinatário só do dono | **Sim** |

O que já era só do dono no banco e continua: funis, nichos, etapas de negociação e desfechos (policies `*_write`), e o próprio papel no perfil (trigger `guard_profile_update`).

**Depois da A-01a, a A-01 completa aborta sem mudar nada:** as precondições dela esperam o estado anterior. Se um dia ela for usada, precisa de uma revisão que parta deste estado. O restante dela que a 1.11 precisa já está na `A-01b`.

## Sequência

1. **Ensaio no staging** (feito; refazer se algo mudar):
   ```bash
   cd dev/staging && PERFIL=publicacao node montar.js && node semear.js && node admin-previa.js && node pedidos-equipe.js
   cd ../e2e && node painel-staging.js && node onboarding-staging.js
   cd ../.. && node --test tests/*.test.js && (cd tests/db && npm test)
   ```
2. **Retrato antes** (SQL Editor, só leitura). Guarde o resultado:
   ```sql
   select id, name, module_id, join_code, settings->'goals' as metas, coalesce(agendor_token,'') <> '' as tem_crm from orgs order by id;
   select org_id, user_id, role from org_members order by 1, 2;
   select org_id, count(*), max(week_end) from weekly_payments group by 1 order by 1;
   select count(*) from leads;
   select policyname, qual, with_check from pg_policies where tablename = 'orgs';
   ```
3. **Publicar o site**: fazer o push do branch `publicacao-conalvo` para o `main`.
   - Esperar o GitHub Pages terminar.
   - Conferir que o `index.html` servido pede `app.js?v=20261013b` e `conalvo-telas.js?v=20261013b`.
4. **Aplicar, nesta ordem e logo em seguida:** E-01 → A-01a → P-03 → P-01.
5. **Conferir**:
   - o retrato do passo 2 continua igual: equipes, códigos, papéis, metas, pagamentos e leads. Só a policy `orgs_update` muda para dono/admin;
   - um usuário comum que chama `create_org` recebe "Equipes novas são criadas pela administração Conalvo…".
6. **Teste de fumaça**, com contas reais combinadas:
   1. superadmin aprova um pedido de Consórcio e um de Prospecção;
   2. quem pediu entra com o código e vira dono;
   3. um chamado feito pela tela aparece no Relatório mensal;
   4. o dono salva um valor do pagamento por lead;
   5. um **membro** salva uma meta pela tela (funciona), mas não vê os valores do pagamento;
   6. pela API, com o token do membro, `PATCH /rest/v1/orgs?id=eq.<equipe>` com `{"name":"x"}` devolve **0 linhas**;
   7. a extensão 1.10.4 adiciona um lead e marca chamado.

### Interface antiga × banco novo

- O service worker não guarda páginas: a versão antiga só fica em **abas abertas** e no cache do Pages (~10 min). Por isso o site vai antes das migrações.
- Aba antiga com as migrações aplicadas:
  - "Criar espaço" é recusado pelo banco com mensagem clara;
  - entrar por código continua;
  - confirmar de novo um período já pago é recusado pela P-01;
  - **"Definir metas" feito por um membro** só falha se a equipe nunca gravou os valores do pagamento por lead: o painel antigo reenvia os valores padrão, que diferem do gravado. Basta recarregar a página.

## Voltar atrás

As duas reversões são **independentes**: o painel novo funciona com e sem as migrações, e o antigo também.

### Site (sem tocar no banco)

- `git revert` do commit da publicação.
- Nada no banco muda e nenhum dado se perde. Pedidos, planos agendados, ações registradas e metas gravadas continuam no banco, prontos para quando o site voltar.
- Com as migrações aplicadas, o painel antigo:
  - não cria equipe;
  - não sobrescreve pagamento confirmado;
  - deixa o membro salvar metas, sujeito ao caso descrito em "Interface antiga × banco novo".

### Banco (na ordem inversa; cada passo independente)

| Passo | Arquivo | O que acontece com os dados criados depois da publicação |
|---|---|---|
| 1 | `db/pagamentos/P-01-rollback.sql` | **Recusa** se houver plano agendado. Para preservar, não rode: a P-01 é aditiva e pode ficar. Se for preciso mesmo, exporte `org_pay_plans` antes |
| 2 | `db/pagamentos/P-03-rollback.sql` | **Recusa** se houver ação registrada (haverá logo depois da publicação). Para preservar, deixe a P-03 aplicada: o painel antigo a ignora |
| 3 | `db/seguranca/A-01a-rollback.sql` | Sempre roda e **não apaga nada**: devolve a `orgs_update` exata da produção e remove as três funções. Metas, valores e destinatário gravados ficam. **Reabre a brecha:** usar só se a correção travar algo legítimo |
| 4 | `db/equipes/E-01-rollback.sql` | **Recusa** se houver pedidos gravados. As equipes criadas por pedidos continuam existindo, com os membros |

**Regra prática:** se algo der errado, reverta **o site** primeiro. As migrações são aditivas e protegem dados. A única que muda comportamento de quem já usa é a A-01a, que bloqueia o membro de alterar a equipe, e o rollback dela não perde nada.

## O que continua fora do pacote

| Item | O que falta | Como fica na tela |
|---|---|---|
| **Respostas reais** no Relatório mensal | O banco só registra "respondeu" quando a extensão 1.11 (com login) envia a ação, pela X-01. Mover o lead para "Respondeu" no painel não gera o evento. **Decisão pendente:** registrar também a entrada na etapa "Respondeu" (painel e extensão), como já é feito com o follow-up | "— ainda não registrado". Nenhum número estimado |
| **Fechamento mensal do modelo fixo** | Ações feitas pela extensão 1.10.4 ficam sem responsável. Exige todos na 1.11 com login (e a 1.10.4 desligada, Fase C) ou uma decisão de atribuição | Prévia do mês com o motivo do bloqueio; não confirma |
| **Extensão 1.11** | Base no banco pronta e testada sobre o pacote (`A-01b` → X-01 → X-02, `PERFIL=extensao`). Faltam o build de produção (hoje só fala com 127.0.0.1), a forma de distribuir e a troca dos usuários | Continua a 1.10.4 |
| **Tempo da 1ª abordagem à venda** | A data da venda é digitada e pode ser editada | "indisponível" |
| **P-02** | Só quando o modelo fixo estiver plenamente funcional | Equipes novas começam no pagamento por lead |
| **A2/A3/A4/A5** | Endurecimentos independentes da brecha (veja a tabela da Fase A) | — |

## Onde está testado

| O quê | Onde | Resultado |
|---|---|---|
| Painel (telas, regras, isolamento, respostas atrasadas, sem rede) | `node --test tests/*.test.js` | 203 + 4 pendências documentadas |
| Banco (PGlite): E-01, P-01, P-03, A-01a, A-01b, Fase A completa, 1.11 nas duas bases | `cd tests/db && npm test` | 230 OK (208 + 22 da 1.11 sobre A-01a/A-01b), 3 pulados (casos com Fase C ou sem Fase A, fora do pacote) |
| API do staging com o pacote (regra do dono, concorrência, A-01a, pagamento) | `dev/staging/pedidos-equipe.js` | 77 verificações |
| Painel × staging com o pacote (Consórcio, membro + A-01a, extensão 1.10.4, Prospecção, isolamento, Admin, celular) | `dev/e2e/painel-staging.js` | 57 verificações |
| Onboarding, dono gravado, membros antigos, painel publicado hoje × banco novo | `dev/e2e/onboarding-staging.js` | 31 verificações |
| Extensão 1.11 pela API sobre o pacote + A-01b + X-01 + X-02 | `dev/staging/medir.js` (`PERFIL=extensao`) | isolamento, concorrência e repetição ok |
