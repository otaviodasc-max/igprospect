// Comportamento REAL do painel ao salvar metas e o destinatário do pagamento.
// O app.js roda inteiro num contexto isolado (tests/harness-painel.js), com
// Supabase simulado — nada de regex sobre o código, nada de rede.
//
//   node --test tests/metas-painel.test.js
//
// Cobre os itens 14–18 da revisão da REV4: o fluxo termina sem
// ReferenceError, o modal fecha, o toast aparece, a tela é redesenhada,
// S.org fica atualizado; falha da RPC não mexe no estado local; o caminho
// antigo (antes da Fase A) continua funcionando; e depois da Fase A um erro
// de verdade da RPC NÃO cai no UPDATE amplo.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { carregarPainel, FORMULARIO_COMPLETO } = require('./harness-painel');

const ORG = '00000000-0000-4000-8000-00000000000a';
const DONO = '00000000-0000-4000-8000-0000000000d1';
const MEMBRO = '00000000-0000-4000-8000-0000000000e2';
// objetos criados dentro do contexto do app têm outro protótipo: compara por valor
const clone = o => JSON.parse(JSON.stringify(o));

function painel(opts = {}) {
  const p = carregarPainel(opts);
  p.S.org = { id: ORG, name: 'Equipe de teste', settings: { agendorAuto: true, goals: { contacts: 1, payRecipientId: DONO } } };
  p.S.members = [{ id: DONO, name: 'Dono' }, { id: MEMBRO, name: 'Membro' }];
  p.S.profile = { org_role: 'owner' };
  return p;
}
// Resposta da RPC como o banco devolveria: merge das metas, sem tocar no destinatário
const rpcComoBanco = p => (fn, args) => {
  const atuais = (p.S.org.settings && p.S.org.settings.goals) || {};
  if (fn === 'org_set_goals') return { data: { ...atuais, ...args.p_goals }, error: null };
  if (fn === 'org_set_pay_recipient') {
    const g = { ...atuais };
    if (args.p_recipient_id) g.payRecipientId = args.p_recipient_id; else delete g.payRecipientId;
    return { data: g, error: null };
  }
  throw new Error(`RPC inesperada: ${fn}`);
};
const rpcsChamadas = p => p.chamadas.filter(c => c.tipo === 'rpc').map(c => c.fn);
const updatesEmOrgs = p => p.chamadas.filter(c => c.tipo === 'from' && c.tabela === 'orgs');

describe('aba Metas → "Salvar metas"', () => {
  test('14/15. sucesso: sem ReferenceError, modal fecha, toast aparece, renderGoals roda e S.org é atualizado', async () => {
    let p;
    p = painel({ rpc: (fn, a) => rpcComoBanco(p)(fn, a) });
    await p.salvarMetasPeloFormulario(FORMULARIO_COMPLETO);          // rejeitaria com ReferenceError na REV4
    assert.deepEqual(rpcsChamadas(p), ['org_set_goals']);
    assert.equal(updatesEmOrgs(p).length, 0, 'sem UPDATE direto quando a RPC existe');
    assert.equal(p.espioes.closeModal, 1, 'modal fechou');
    assert.deepEqual(p.espioes.toast, [{ msg: 'Metas atualizadas!', tipo: 'success' }]);
    assert.equal(p.espioes.renderGoals, 1, 'renderGoals() executado');
    const g = p.S.org.settings.goals;
    assert.equal(g.contacts, 40); assert.equal(g.payFollowUp, true); assert.equal(g.payBasis, 'chamados');
    assert.equal(g.payRecipientId, DONO, 'destinatário preservado');
    assert.equal(p.S.org.settings.agendorAuto, true, 'resto de settings preservado');
  });

  test('o objeto enviado é o completo do formulário, sem payRecipientId', async () => {
    let p;
    p = painel({ rpc: (fn, a) => rpcComoBanco(p)(fn, a) });
    await p.salvarMetasPeloFormulario(FORMULARIO_COMPLETO);
    const enviado = p.chamadas[0].args;
    assert.equal(enviado.p_org_id, ORG, 'equipe explícita (p_org_id)');
    assert.deepEqual(Object.keys(enviado.p_goals).sort(), ['callsWeekly', 'commission', 'commissionPct', 'contacts', 'leadDailyMax',
      'leadDailyMin', 'payBasis', 'payBonusMinPerDay', 'payBonusRate', 'payDayRate', 'payFollowUp', 'payTargetPerDay', 'revenue', 'sales']);
    assert.equal(typeof enviado.p_goals.payFollowUp, 'boolean');
  });

  test('saveOrgGoals nunca manda payRecipientId, mesmo recebendo getGoals() inteiro', async () => {
    let p;
    p = painel({ rpc: (fn, a) => rpcComoBanco(p)(fn, a) });
    await p.run('saveOrgGoals({ ...getGoals(), payRecipientId: "' + MEMBRO + '" })');
    assert.ok(!('payRecipientId' in p.chamadas[0].args.p_goals));
    assert.equal(p.S.org.settings.goals.payRecipientId, DONO);
  });

  for (const [nome, erro] of [
    ['valor recusado pela validação (22023)', { code: '22023', message: 'Metas recusadas: contacts (valor inválido)' }],
    ['sem permissão (42501)', { code: '42501', message: 'Sem acesso a esta equipe' }],
    ['função interna ausente (42883 citando OUTRA função)', { code: '42883', message: 'function public.is_org_member(uuid) does not exist' }],
    ['erro genérico (P0001)', { code: 'P0001', message: 'falhou' }],
  ]) {
    test(`16/18. falha da RPC — ${nome}: estado local intacto e SEM cair no UPDATE amplo`, async () => {
      const p = painel({ rpc: () => ({ data: null, error: erro }) });
      const antes = clone(p.S.org), refAntes = p.S.org;
      await p.salvarMetasPeloFormulario(FORMULARIO_COMPLETO);
      assert.equal(updatesEmOrgs(p).length, 0, 'não tentou o UPDATE direto');
      assert.equal(p.S.org, refAntes, 'S.org é o mesmo objeto');
      assert.deepEqual(p.S.org, antes, 'S.org não mudou');
      assert.deepEqual(p.espioes.toast, [{ msg: erro.message, tipo: 'error' }]);
      assert.equal(p.espioes.closeModal, 0, 'modal continua aberto');
      assert.equal(p.espioes.renderGoals, 0);
      assert.equal(p.el('gf-save').disabled, false, 'botão liberado de novo');
    });
  }

  for (const [nome, erro] of [
    ['PGRST202 (PostgREST não acha a função)', { code: 'PGRST202', message: 'Could not find the function public.org_set_goals(p_goals, p_org_id) in the schema cache' }],
    ['42883 citando a própria RPC', { code: '42883', message: 'function public.org_set_goals(uuid, jsonb) does not exist' }],
  ]) {
    test(`17. antes da Fase A — ${nome}: cai no UPDATE antigo, preservando destinatário e settings`, async () => {
      const p = painel({ rpc: () => ({ data: null, error: erro }), orgsUpdate: () => ({ data: [{ id: ORG }], error: null }) });
      await p.salvarMetasPeloFormulario(FORMULARIO_COMPLETO);
      const [u] = updatesEmOrgs(p);
      assert.ok(u, 'fez o UPDATE');
      assert.deepEqual(u.filtros, [['id', ORG]]);
      assert.equal(u.valores.settings.goals.payRecipientId, DONO, 'metas não apagam o destinatário (bug da versão publicada)');
      assert.equal(u.valores.settings.goals.contacts, 40);
      assert.equal(u.valores.settings.agendorAuto, true);
      assert.equal(p.S.org.settings.goals.contacts, 40);
      assert.equal(p.espioes.closeModal, 1); assert.equal(p.espioes.renderGoals, 1);
    });
  }

  test('17. antes da Fase A, UPDATE que não grava nada (0 linhas) é erro — não finge que salvou', async () => {
    const p = painel({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }), orgsUpdate: () => ({ data: [], error: null }) });
    const antes = clone(p.S.org);
    await p.salvarMetasPeloFormulario(FORMULARIO_COMPLETO);
    assert.deepEqual(p.S.org, antes);
    assert.equal(p.espioes.toast[0].tipo, 'error');
    assert.equal(p.espioes.closeModal, 0);
  });
});

describe('Configurações → "Quem deve receber o valor"', () => {
  test('14/15. dono escolhe uma pessoa: RPC própria, sem ReferenceError, toast e S.org atualizado', async () => {
    let p;
    p = painel({ rpc: (fn, a) => rpcComoBanco(p)(fn, a) });
    await p.trocarDestinatario(MEMBRO);                              // rejeitaria com ReferenceError na REV4
    assert.deepEqual(p.chamadas.map(c => [c.fn, c.args]), [['org_set_pay_recipient', { p_org_id: ORG, p_recipient_id: MEMBRO }]]);
    assert.deepEqual(p.espioes.toast, [{ msg: 'Destinatário do pagamento definido', tipo: 'success' }]);
    assert.equal(p.S.org.settings.goals.payRecipientId, MEMBRO);
    assert.equal(p.S.org.settings.goals.contacts, 1, 'metas intactas');
    assert.equal(p.run('getGoals().payRecipientId'), MEMBRO);
  });

  test('"Todo mundo" (vazio) manda nulo e remove o destinatário', async () => {
    let p;
    p = painel({ rpc: (fn, a) => rpcComoBanco(p)(fn, a) });
    await p.trocarDestinatario('');
    assert.equal(p.chamadas[0].args.p_recipient_id, null);
    assert.ok(!('payRecipientId' in p.S.org.settings.goals));
    assert.deepEqual(p.espioes.toast, [{ msg: 'Voltou a somar a equipe inteira', tipo: 'success' }]);
  });

  test('16/18. recusa do banco (membro comum): estado local intacto, seletor volta e nada de UPDATE amplo', async () => {
    const p = painel({ rpc: () => ({ data: null, error: { code: '42501', message: 'Só o dono da equipe altera o destinatário do pagamento' } }) });
    const antes = clone(p.S.org);
    await p.trocarDestinatario(MEMBRO);
    assert.deepEqual(p.S.org, antes);
    assert.equal(updatesEmOrgs(p).length, 0);
    assert.equal(p.el('st-pay-recipient').value, DONO, 'seletor volta ao valor gravado');
    assert.equal(p.espioes.toast[0].tipo, 'error');
  });

  test('17. antes da Fase A: cai no UPDATE antigo só com o destinatário mudado', async () => {
    const p = painel({ rpc: () => ({ data: null, error: { code: 'PGRST202', message: 'x' } }), orgsUpdate: () => ({ data: [{ id: ORG }], error: null }) });
    await p.trocarDestinatario(MEMBRO);
    const [u] = updatesEmOrgs(p);
    assert.deepEqual(clone(u.valores.settings.goals), { contacts: 1, payRecipientId: MEMBRO });
    assert.equal(p.S.org.settings.goals.payRecipientId, MEMBRO);
    await p.trocarDestinatario('');
    assert.deepEqual(clone(updatesEmOrgs(p)[1].valores.settings.goals), { contacts: 1 });
  });
});
