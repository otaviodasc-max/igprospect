// Fluxo diário de prospecção: contagens do Dashboard, filtros de período e
// funil, chegada de lead pelo Realtime e cálculo diário de chamados +
// follow-ups. Tudo roda o app.js DE VERDADE (tests/harness-painel.js) com
// dados fictícios — nada aqui fala com o Supabase.
//
// Os testes registram o comportamento ATUAL. O que ainda não atende ao
// requisito fica como `todo`: o teste reproduz o problema e a suíte continua
// verde, sem trocar a expectativa para "passar".
//
//   node --test tests/fluxo-prospeccao.test.js
//
// Fuso fixo: as regras de "dia" dependem da data local do aparelho.
process.env.TZ = 'America/Sao_Paulo';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { carregarPainel } = require('./harness-painel');

const ORG = 'org-teste';
const EU = 'membro-1', OUTRO = 'membro-2';

const FUNIL = { id: 'pl-insta', org_id: ORG, name: 'Instagram', icon: '📸', is_default: true, order_idx: 0, stages: [
  { key: 'novo', label: 'Novo Lead', color: '#64748B', order: 0 },
  { key: 'chamado', label: 'Chamado', color: '#6366F1', order: 1 },
  { key: 'respondeu', label: 'Respondeu', color: '#F59E0B', order: 2 },
  { key: 'follow_up', label: 'Follow-up', color: '#0EA5E9', order: 3 },
  { key: 'contato', label: 'Enviou Contato', color: '#10B981', order: 4 },
] };
const FUNIL_EMP = { id: 'pl-emp', org_id: ORG, name: 'Empresários', icon: '🏢', is_default: false, order_idx: 1, stages: [
  { key: 'a_contatar', label: 'A Contatar', color: '#64748B', order: 0 },
  { key: 'em_conversa', label: 'Em Conversa', color: '#6366F1', order: 1 },
] };

// Data/hora LOCAL (mês 1–12) → ISO em UTC, igual ao que o Supabase devolve.
const local = (a, m, d, h = 12, min = 0) => new Date(a, m - 1, d, h, min).toISOString();
const hojeLocal = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; };
const reais = v => Math.round(v * 100) / 100;

let seq = 0;
// Linha no formato da tabela `leads` (snake_case), convertida pelo leadFromRow real.
function linha(over = {}) {
  seq++;
  return { id: 'lead-' + seq, org_id: ORG, name: 'Lead Fictício ' + seq, username: 'ficticio_' + seq,
    status: 'novo', tipo: 'comum', pipeline_id: FUNIL.id, source: 'extensao', ext_id: 'ext-' + seq,
    created_by: EU, stage_dates: {}, ...over };
}
// Lead adicionado em `adicionado` e, opcionalmente, chamado em `chamado`.
function leadChamado(adicionado, chamado, extra = {}) {
  const sd = { novo: adicionado };
  if (chamado) sd.chamado = chamado;
  return linha({ added_at: adicionado, status: chamado ? 'chamado' : 'novo', called_at: chamado || null,
    status_changed_at: chamado || adicionado, stage_dates: sd, ...extra });
}

function painel({ leads = [], goals = {}, members = [] } = {}) {
  const p = carregarPainel();
  const S = p.S;
  S.org = { id: ORG, name: 'Equipe Teste', module_id: 'consorcio', settings: { goals } };
  S.profile = { id: EU, name: 'Pessoa Teste', org_role: 'member', platform_role: 'user', status: 'active' };
  S.session = { user: { id: EU } };
  S.pipelines = [FUNIL, FUNIL_EMP];
  S.members = members; S.deals = []; S.weeklyPayments = []; S.calls = [];
  const fromRow = p.run('leadFromRow');
  S.leads = leads.map(r => fromRow(r));
  return p;
}

// Lê os cartões do Dashboard: "Total no período" + 1 cartão por etapa do funil escolhido.
function lerCartoes(p, alvo = 'content') {
  const html = p.el(alvo).innerHTML;
  const nums = [...html.matchAll(/rd-stat-val" data-cnt="(\d+)"/g)].map(m => Number(m[1]));
  if (!nums.length) return null;                      // tela de boas-vindas (sem leads)
  const funil = [FUNIL, FUNIL_EMP].find(f => f.id === p.S.relDashPipelineId) || FUNIL;
  const out = { total: nums[0] };
  funil.stages.forEach((s, i) => { out[s.key] = nums[i + 1]; });
  return out;
}
function dashboard(p, de, ate, funil = FUNIL.id) {
  p.S.relDashFrom = de; p.S.relDashTo = ate; p.S.relDashPipelineId = funil; p.S.relDashPreset = '';
  p.run("renderRelDash('content')");
  return lerCartoes(p);
}

/* ------------------------------------------------------------------ */
describe('Dashboard: cada etapa conta no dia em que aconteceu', () => {
  test('lead adicionado conta no dia do cadastro (total e 1ª etapa), e não no dia seguinte', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 5, 10))] });
    assert.deepEqual(dashboard(p, '2026-10-05', '2026-10-05'), { total: 1, novo: 1, chamado: 0, respondeu: 0, follow_up: 0, contato: 0 });
    assert.equal(dashboard(p, '2026-10-06', '2026-10-06').total, 0);
  });

  test('lead chamado conta em "Chamado" no dia do chamado; o cadastro fica no dia dele', () => {
    const p = painel({ leads: [leadChamado(local(2026, 9, 30), local(2026, 10, 1, 9))] });
    assert.deepEqual(dashboard(p, '2026-10-01', '2026-10-01'), { total: 1, novo: 0, chamado: 1, respondeu: 0, follow_up: 0, contato: 0 });
    assert.deepEqual(dashboard(p, '2026-09-30', '2026-09-30'), { total: 1, novo: 1, chamado: 0, respondeu: 0, follow_up: 0, contato: 0 });
  });

  test('chamado em 01/10 e follow-up em 20/10: cada um no seu dia, sem mover o chamado para 20/10', () => {
    const sd = { novo: local(2026, 9, 28), chamado: local(2026, 10, 1, 9), respondeu: local(2026, 10, 3, 9), follow_up: local(2026, 10, 20, 15) };
    const p = painel({ leads: [linha({ added_at: sd.novo, status: 'follow_up', called_at: sd.chamado, status_changed_at: sd.follow_up, stage_dates: sd })] });
    assert.deepEqual(dashboard(p, '2026-10-01', '2026-10-01'), { total: 1, novo: 0, chamado: 1, respondeu: 0, follow_up: 0, contato: 0 });
    assert.deepEqual(dashboard(p, '2026-10-20', '2026-10-20'), { total: 1, novo: 0, chamado: 0, respondeu: 0, follow_up: 1, contato: 0 });
    assert.deepEqual(dashboard(p, '2026-10-01', '2026-10-31'), { total: 1, novo: 0, chamado: 1, respondeu: 1, follow_up: 1, contato: 0 });
    // A data do chamado que o pagamento usa também continua 01/10.
    assert.equal(p.run('leadCalledDate(S.leads[0])'), sd.chamado);
  });

  test('ação às 22h30 conta no dia LOCAL (o Dashboard compara datas no fuso do aparelho)', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 5, 22, 30))] });   // em UTC já é 06/10
    assert.equal(dashboard(p, '2026-10-05', '2026-10-05').total, 1);
    assert.equal(dashboard(p, '2026-10-06', '2026-10-06').total, 0);
  });

  test('comportamento atual: etapa pulada no Kanban conta na data do chamado', () => {
    // Novo → Enviou Contato direto em 05/10. O banco só grava as etapas por
    // onde o status passou; o painel preenche as puladas (chamado, respondeu,
    // follow-up) com called_at, que o trigger grava na 1ª mudança de status.
    const p = painel({ leads: [linha({ added_at: local(2026, 10, 1), status: 'contato', called_at: local(2026, 10, 5),
      status_changed_at: local(2026, 10, 5), stage_dates: { novo: local(2026, 10, 1), contato: local(2026, 10, 5) } })] });
    assert.deepEqual(dashboard(p, '2026-10-05', '2026-10-05'), { total: 1, novo: 0, chamado: 1, respondeu: 1, follow_up: 1, contato: 1 });
  });

  test('pendente: "Respondeu" só deveria contar quando houve resposta registrada', { todo: 'etapa pulada vira resposta no dia do chamado; precisa de registro de eventos' }, () => {
    const p = painel({ leads: [linha({ added_at: local(2026, 10, 1), status: 'contato', called_at: local(2026, 10, 5),
      status_changed_at: local(2026, 10, 5), stage_dates: { novo: local(2026, 10, 1), contato: local(2026, 10, 5) } })] });
    assert.equal(dashboard(p, '2026-10-05', '2026-10-05').respondeu, 0);
  });
});

/* ------------------------------------------------------------------ */
describe('Dashboard: filtros de data e de funil que já existem', () => {
  test('De/Até digitados recalculam a contagem', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 1)), leadChamado(local(2026, 10, 20))] });
    assert.equal(dashboard(p, '2026-10-01', '2026-10-31').total, 2);
    p.el('rd-from').onchange({ target: { value: '2026-10-15' } });
    assert.equal(p.S.relDashFrom, '2026-10-15');
    assert.equal(lerCartoes(p).total, 1);
    p.el('rd-to').onchange({ target: { value: '2026-10-19' } });
    assert.equal(lerCartoes(p).total, 0);
  });

  test('seletor de funil: cada funil conta só os próprios leads', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 2)),
      linha({ pipeline_id: FUNIL_EMP.id, status: 'a_contatar', tipo: 'empresario', added_at: local(2026, 10, 2), stage_dates: { a_contatar: local(2026, 10, 2) } })] });
    assert.equal(dashboard(p, '2026-10-01', '2026-10-31').total, 1);
    p.el('rd-pipeline').onchange({ target: { value: FUNIL_EMP.id } });
    assert.deepEqual(lerCartoes(p), { total: 1, a_contatar: 1, em_conversa: 0 });
  });

  test('comportamento atual: lead sem pipeline_id não aparece no Dashboard de nenhum funil', () => {
    // leadPipeline() trata pipeline_id vazio como o funil principal, mas o
    // Dashboard filtra por l.pipeline_id === funil.id. Leads da extensão
    // nascem com o funil principal (extension_add_lead), então isso só
    // afeta leads antigos sem funil.
    const p = painel({ leads: [leadChamado(local(2026, 10, 2), null, { pipeline_id: null })] });
    assert.equal(dashboard(p, '2026-10-01', '2026-10-31').total, 0);
  });

  test('atalhos "Este mês" e "Mês passado" usam o mês local', () => {
    const p = painel();
    const n = new Date();
    const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    p.run("applyRelDashPreset('month')");
    assert.deepEqual([p.S.relDashFrom, p.S.relDashTo], [ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0))]);
    p.run("applyRelDashPreset('lastmonth')");
    assert.deepEqual([p.S.relDashFrom, p.S.relDashTo], [ymd(new Date(n.getFullYear(), n.getMonth() - 1, 1)), ymd(new Date(n.getFullYear(), n.getMonth(), 0))]);
    assert.equal(p.S.relDashPreset, '');
  });

  test('atalho "Tudo" vai do lead mais antigo até hoje', () => {
    const p = painel({ leads: [leadChamado(local(2026, 3, 10)), leadChamado(local(2026, 10, 2))] });
    p.run("applyRelDashPreset('all')");
    assert.equal(p.S.relDashFrom, '2026-03-10');
    // "Até" de "Tudo" continua em UTC (isoDate), como antes desta etapa:
    // depois das 21h ele já mostra amanhã, o que só alarga o intervalo.
    assert.equal(p.S.relDashTo, new Date().toISOString().slice(0, 10));
  });

  test('os botões Tudo/30d/7d/Hoje do topo valem só para Leads, Ligações e Negociações, não para o Dashboard', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 2))] });
    p.S.route = 'dashboard'; p.run('renderShell()');
    assert.equal(p.el('period-tabs').style.display, 'none');
    p.S.route = 'leads'; p.run('renderShell()');
    assert.equal(p.el('period-tabs').style.display, 'flex');
  });

  test('"Hoje" da aba Leads (filtro do topo) pega leads cadastrados desde a meia-noite local', () => {
    const agora = new Date();
    const ontem = new Date(agora); ontem.setDate(ontem.getDate() - 1); ontem.setHours(12, 0, 0, 0);
    const hoje0 = new Date(agora); hoje0.setHours(0, 0, 1, 0);
    const p = painel({ leads: [leadChamado(hoje0.toISOString()), leadChamado(ontem.toISOString())] });
    p.S.period = '1'; assert.equal(p.run('filteredLeads().length'), 1);
    p.S.period = '7'; assert.equal(p.run('filteredLeads().length'), 2);
    p.S.period = 'all'; assert.equal(p.run('filteredLeads().length'), 2);
  });
});

/* ------------------------------------------------------------------ */
describe('Dashboard: atalho "Hoje"', () => {
  test('o botão "Hoje" existe ao lado de Tudo / Este mês / Mês passado', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 2))] });
    dashboard(p, '2026-10-01', '2026-10-31');
    const botoes = [...p.el('tb-controls').innerHTML.matchAll(/data-rdpre="([a-z]+)"/g)].map(m => m[1]);
    assert.deepEqual(botoes, ['all', 'today', 'month', 'lastmonth']);
  });

  test('"Hoje" usa a data local, não a UTC', () => {
    const p = painel();
    // 09/10 às 22h30 em São Paulo já é 10/10 em UTC.
    assert.equal(p.run("localIsoDate(new Date(2026,9,9,22,30))"), '2026-10-09');
    assert.equal(p.run("isoDate(new Date(2026,9,9,22,30))"), '2026-10-10');
    p.run("applyRelDashPreset('today')");
    assert.deepEqual([p.S.relDashFrom, p.S.relDashTo, p.S.relDashPreset], [hojeLocal(), hojeLocal(), 'today']);
  });

  test('"Hoje" é recalculado a cada desenho (não fica preso a um dia antigo)', () => {
    const p = painel({ leads: [leadChamado(new Date().toISOString())] });
    p.S.relDashPreset = 'today'; p.S.relDashFrom = '2020-01-01'; p.S.relDashTo = '2020-01-01';
    p.run("renderRelDash('content')");
    assert.deepEqual([p.S.relDashFrom, p.S.relDashTo], [hojeLocal(), hojeLocal()]);
    assert.equal(lerCartoes(p).total, 1);
  });

  test('mudar De/Até à mão sai do modo "Hoje"', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 2))] });
    p.run("applyRelDashPreset('today')"); p.run("renderRelDash('content')");
    p.el('rd-from').onchange({ target: { value: '2026-10-01' } });
    assert.equal(p.S.relDashPreset, '');
    assert.equal(p.S.relDashFrom, '2026-10-01');
  });
});

/* ------------------------------------------------------------------ */
// Limite: o harness não tem servidor Realtime. O que roda aqui é o callback
// REAL que subscribeLeads() registra, chamado com um payload no formato do
// Supabase. Publicação da tabela, RLS do Realtime e entrega não são testados.
describe('Dashboard: lead chegando pelo Realtime (callback real do subscribeLeads)', () => {
  function inscrever(p) {
    p.run('subscribeLeads()');
    const canal = p.canais.at(-1);
    assert.equal(canal.ouvintes.length, 1);
    const { evento, filtro, cb } = canal.ouvintes[0];
    assert.equal(evento, 'postgres_changes');
    assert.deepEqual({ ...filtro }, { event: '*', schema: 'public', table: 'leads', filter: `org_id=eq.${ORG}` });
    return cb;
  }

  test('com "Hoje" selecionado, INSERT soma, UPDATE de etapa conta o chamado e DELETE tira', () => {
    const p = painel();                       // equipe ainda sem leads → tela de boas-vindas
    p.S.route = 'dashboard'; p.run("applyRelDashPreset('today')"); p.run('renderShell()');
    assert.equal(lerCartoes(p), null);
    const cb = inscrever(p);

    const agora = new Date().toISOString();
    const row = linha({ added_at: agora, status: 'novo', stage_dates: { novo: agora } });
    cb({ eventType: 'INSERT', new: row, old: {} });
    assert.deepEqual(lerCartoes(p), { total: 1, novo: 1, chamado: 0, respondeu: 0, follow_up: 0, contato: 0 });

    const depois = new Date().toISOString();
    cb({ eventType: 'UPDATE', new: { ...row, status: 'chamado', called_at: depois, status_changed_at: depois, stage_dates: { novo: agora, chamado: depois } }, old: { id: row.id } });
    assert.deepEqual(lerCartoes(p), { total: 1, novo: 1, chamado: 1, respondeu: 0, follow_up: 0, contato: 0 });
    assert.equal(p.S.leads.length, 1);

    cb({ eventType: 'DELETE', new: {}, old: { id: row.id } });
    assert.equal(p.S.leads.length, 0);
  });

  test('em outra aba o lead entra no estado e aparece ao voltar ao Dashboard', () => {
    const p = painel({ leads: [leadChamado(local(2026, 10, 2))] });
    p.S.route = 'goals';
    const cb = inscrever(p);
    const agora = new Date().toISOString();
    cb({ eventType: 'INSERT', new: linha({ added_at: agora, stage_dates: { novo: agora } }), old: {} });
    assert.equal(p.S.leads.length, 2);
    p.run("applyRelDashPreset('today')");
    p.S.route = 'dashboard'; p.run('renderShell()');
    assert.equal(lerCartoes(p).total, 1);
  });
});

/* ------------------------------------------------------------------ */
// Regra atual, configurável em Metas: valor por ação = payDayRate/payTargetPerDay
// (25/50 = R$ 0,50). Quando a pessoa faz payBonusMinPerDay ações num dia,
// TODAS as ações daquele dia passam a valer payBonusRate (R$ 0,65).
describe('Pagamento: chamados + follow-ups do mesmo dia (regra configurável atual)', () => {
  const METAS = { payDayRate: 25, payTargetPerDay: 50, payBonusMinPerDay: 90, payBonusRate: 0.65, payBasis: 'chamados', payFollowUp: true };
  const dentro = (de, ate) => iso => { if (!iso) return false; const d = new Date(iso); return d >= de && d < ate; };
  const OUTUBRO = dentro(new Date(2026, 9, 1), new Date(2026, 10, 1));

  // `chamados` leads chamados no dia e `follows` leads (chamados em setembro) com follow-up no dia.
  function leadsDoDia(dia, chamados, follows, { hora = 10, por = EU } = {}) {
    const out = [];
    for (let i = 0; i < chamados; i++) out.push(leadChamado(local(2026, 9, 20), local(2026, 10, dia, hora), { created_by: por }));
    for (let i = 0; i < follows; i++) {
      const sd = { novo: local(2026, 9, 1), chamado: local(2026, 9, 2), follow_up: local(2026, 10, dia, hora) };
      out.push(linha({ added_at: sd.novo, status: 'follow_up', called_at: sd.chamado, status_changed_at: sd.follow_up, stage_dates: sd, created_by: por }));
    }
    return out;
  }
  const relatorio = (p, inW = OUTUBRO, membro = EU) => p.run('prospectReport')(inW, membro);

  test('89 ações no dia (60 chamados + 29 follow-ups) = R$ 0,50 cada', () => {
    const r = relatorio(painel({ goals: METAS, leads: leadsDoDia(1, 60, 29) }));
    assert.deepEqual([r.prospectLeads, r.followUps, r.prospectUnits, r.bonusDays, reais(r.prospectPay)], [60, 29, 89, 0, 44.5]);
  });

  test('90 ações no dia (60 chamados + 30 follow-ups) = R$ 0,65 em todas', () => {
    const r = relatorio(painel({ goals: METAS, leads: leadsDoDia(1, 60, 30) }));
    assert.deepEqual([r.prospectUnits, r.bonusDays, reais(r.prospectPay)], [90, 1, 58.5]);
  });

  test('a faixa é por dia: 89 num dia e 90 no outro', () => {
    const r = relatorio(painel({ goals: METAS, leads: [...leadsDoDia(1, 89, 0), ...leadsDoDia(2, 45, 45)] }));
    assert.deepEqual([r.prospectUnits, r.bonusDays, reais(r.prospectPay)], [179, 1, reais(44.5 + 58.5)]);
  });

  test('a faixa é por pessoa: ações de outro membro não completam as 90 de ninguém', () => {
    const p = painel({ goals: METAS, leads: [...leadsDoDia(1, 60, 29), ...leadsDoDia(1, 1, 0, { por: OUTRO })] });
    assert.equal(reais(relatorio(p).prospectPay), 44.5);
    const equipe = relatorio(p, OUTUBRO, '');
    assert.deepEqual([equipe.prospectUnits, equipe.bonusDays, reais(equipe.prospectPay)], [90, 0, 45]);
  });

  test('chamado em 01/10 e follow-up em 20/10 rendem uma ação em cada dia', () => {
    const sd = { novo: local(2026, 9, 28), chamado: local(2026, 10, 1, 9), follow_up: local(2026, 10, 20, 15) };
    const p = painel({ goals: METAS, leads: [linha({ added_at: sd.novo, status: 'follow_up', called_at: sd.chamado, status_changed_at: sd.follow_up, stage_dates: sd })] });
    const mes = relatorio(p);
    assert.deepEqual([mes.prospectLeads, mes.followUps, reais(mes.prospectPay)], [1, 1, 1]);
    const dia20 = relatorio(p, dentro(new Date(2026, 9, 20), new Date(2026, 9, 21)));
    assert.deepEqual([dia20.prospectLeads, dia20.followUps], [0, 1]);
    const dia1 = relatorio(p, dentro(new Date(2026, 9, 1), new Date(2026, 9, 2)));
    assert.deepEqual([dia1.prospectLeads, dia1.followUps], [1, 0]);
  });

  test('com "pagar follow-ups" desligado, só os chamados contam', () => {
    const r = relatorio(painel({ goals: { ...METAS, payFollowUp: false }, leads: leadsDoDia(1, 60, 30) }));
    assert.deepEqual([r.prospectUnits, r.bonusDays, reais(r.prospectPay)], [60, 0, 30]);
  });

  test('pendente: ações depois das 21h entram no dia seguinte na conta da faixa', { todo: 'prospectPayOf agrupa por String(data).slice(0,10), que é o dia em UTC' }, () => {
    // 89 ações às 10h e 1 às 22h do MESMO dia local = 90 → deveria ser R$ 58,50.
    // Hoje a das 22h cai em 02/10 (UTC) e o dia 01/10 fica com 89 → R$ 45,00.
    const r = relatorio(painel({ goals: METAS, leads: [...leadsDoDia(1, 60, 29), ...leadsDoDia(1, 0, 1, { hora: 22 })] }));
    assert.equal(reais(r.prospectPay), 58.5);
  });

  test('pendente: um segundo follow-up no mesmo lead, em outro dia, também deveria contar', { todo: 'stage_dates guarda só a 1ª entrada na etapa; precisa de registro de eventos' }, () => {
    // Follow-up em 20/10, voltou para Respondeu e teve outro follow-up em 25/10
    // (status_changed_at = 25/10). Só o de 20/10 existe para o painel.
    const sd = { novo: local(2026, 9, 28), chamado: local(2026, 10, 1), respondeu: local(2026, 10, 10), follow_up: local(2026, 10, 20) };
    const p = painel({ goals: METAS, leads: [linha({ added_at: sd.novo, status: 'follow_up', called_at: sd.chamado, status_changed_at: local(2026, 10, 25), stage_dates: sd })] });
    assert.equal(relatorio(p).followUps, 2);
  });

  test('pendente: "Seguido" deveria ser independente de adicionar o lead', { todo: 'na base "seguidos", todo lead cadastrado conta como seguido (data = added_at)' }, () => {
    // Lead só adicionado, sem ter sido seguido no Instagram: não deveria contar.
    const r = relatorio(painel({ goals: { ...METAS, payBasis: 'seguidos', payFollowUp: false }, leads: [leadChamado(local(2026, 10, 3))] }));
    assert.equal(r.prospectLeads, 0);
  });
});
