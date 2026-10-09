// Duas equipes fictícias no painel: boot() real, troca de equipe pelo mesmo
// caminho do painel (switch_org + boot) e eventos Realtime de leads.
//
// O banco falso NÃO aplica RLS: devolve linhas de todas as equipes quando o
// app não filtra por org_id — é o pior caso, para provar o filtro do próprio
// painel. O "servidor" Realtime falso entrega cada evento só aos canais
// ativos cujo filtro `org_id=eq.X` casa com a linha (como o Supabase faz).
// Os últimos testes ignoram esse filtro de propósito e entregam eventos da
// equipe B direto no callback da equipe A.
//
// Limite: não há servidor Realtime de verdade. O que roda é o callback REAL
// que subscribeLeads() registra, chamado com payloads no formato do Supabase.
//
//   node --test tests/isolamento-realtime.test.js
process.env.TZ = 'America/Sao_Paulo';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { carregarPainel } = require('./harness-painel');

const A = 'org-A', B = 'org-B', EU = 'membro-1';
const agora = () => new Date().toISOString();
const funil = (id, org) => ({ id, org_id: org, name: 'Instagram ' + org, is_default: true, order_idx: 0, stages: [
  { key: 'novo', label: 'Novo Lead', color: '#64748B', order: 0 },
  { key: 'chamado', label: 'Chamado', color: '#6366F1', order: 1 },
  { key: 'contato', label: 'Enviou Contato', color: '#10B981', order: 2 },
] });
let seq = 0;
function lead(org, over = {}) {
  seq++; const t = agora();
  return { id: 'lead-' + seq, org_id: org, name: 'Lead Fictício ' + seq, username: 'ficticio_' + seq, status: 'novo', tipo: 'comum',
    pipeline_id: org === A ? 'pl-A' : 'pl-B', source: 'extensao', ext_id: 'ext-' + seq, added_at: t, stage_dates: { novo: t }, created_by: EU, ...over };
}

function montar() {
  const db = {
    orgs: [{ id: A, name: 'Equipe A (teste)', module_id: 'consorcio', settings: {} }, { id: B, name: 'Equipe B (teste)', module_id: 'consorcio', settings: {} }],
    profiles: [{ id: EU, name: 'Pessoa Teste', email: 'pessoa@example.test', org_id: A, org_role: 'member', platform_role: 'user', status: 'active' }],
    org_pipelines: [funil('pl-A', A), funil('pl-B', B)],
    leads: [lead(A), lead(A, { status: 'chamado', stage_dates: { novo: agora(), chamado: agora() } }), lead(B), lead(B), lead(B)],
    calls: [], deals: [], messages: [], org_niches: [], org_deal_stages: [], org_call_outcomes: [], weekly_payments: [],
  };
  const p = carregarPainel();
  p.ctx.addEventListener = () => {};                    // ponte da extensão (bindBridge)
  const sb = p.run('sb');
  const leituras = [];
  sb.auth.getSession = async () => ({ data: { session: { user: { id: EU } } } });
  sb.from = tabela => {
    const filtros = []; let unico = false;
    const q = {
      select() { return q; }, order() { return q; }, range() { return q; }, limit() { return q; },
      eq(c, v) { filtros.push([c, v]); return q; }, in(c, vs) { filtros.push([c, vs, 'in']); return q; },
      single() { unico = true; return q; }, maybeSingle() { unico = true; return q; },
      insert() { return Promise.resolve({ data: null, error: null }); }, update() { return q; }, upsert() { return q; },
      then(ok, erro) {
        leituras.push({ tabela, filtros: filtros.map(f => f.slice(0, 2)) });
        const rows = (db[tabela] || []).filter(r => filtros.every(([c, v, op]) => op === 'in' ? v.includes(r[c]) : r[c] === v));
        return Promise.resolve({ data: unico ? (rows[0] || null) : rows, error: null }).then(ok, erro);
      },
    };
    return q;
  };
  sb.rpc = async (fn, args) => {
    if (fn === 'switch_org') { db.profiles[0].org_id = args.p_org_id; return { data: null, error: null }; }
    return { data: null, error: { code: 'PGRST202', message: 'not found' } };
  };
  const removidos = new Set();
  sb.removeChannel = c => { removidos.add(c); };
  // "Servidor": entrega só a canais ativos cujo filtro casa com a linha.
  // DELETE sai como o Supabase manda sem REPLICA IDENTITY FULL: só o id.
  const emitir = (tipo, row) => {
    for (const c of p.canais) {
      if (removidos.has(c)) continue;
      for (const o of c.ouvintes) {
        if (o.filtro.table !== 'leads') continue;
        const [col, val] = o.filtro.filter.split('=eq.');
        if (row[col] !== val) continue;
        o.cb(tipo === 'DELETE' ? { eventType: 'DELETE', new: {}, old: { id: row.id } } : { eventType: tipo, new: row, old: {} });
      }
    }
  };
  const callbackDe = org => p.canais.find(c => c.nome === 'leads-' + org).ouvintes[0].cb;
  const trocarPara = async org => { await p.run(`sb.rpc('switch_org',{ p_org_id:'${org}' })`); await p.run('boot()'); };
  return { p, db, emitir, leituras, removidos, callbackDe, trocarPara };
}
const cartoes = p => {
  const nums = [...p.el('content').innerHTML.matchAll(/rd-stat-val" data-cnt="(\d+)"/g)].map(m => +m[1]);
  return nums.length ? { total: nums[0], novo: nums[1], chamado: nums[2], contato: nums[3] } : null;
};
const retrato = p => ({ cartoes: cartoes(p), leads: p.S.leads.map(l => `${l.id}:${l.status}:${l.name}`).sort() });
async function abrirNoHoje(ctx) { await ctx.p.run('boot()'); ctx.p.run("applyRelDashPreset('today')"); ctx.p.run('renderShell()'); }

/* ------------------------------------------------------------------ */
describe('Duas equipes: leitura, Realtime filtrado e troca de equipe', () => {
  test('com "Hoje", eventos da B não chegam à A, os da A atualizam, e a troca isola as duas', async () => {
    const t = montar(); const { p, db, emitir, leituras, removidos } = t;
    await abrirNoHoje(t);
    assert.equal(p.S.org.id, A);
    assert.deepEqual([...p.S.leads.map(l => db.leads.find(r => r.id === l.id).org_id)], [A, A]);
    for (const tab of ['leads', 'calls', 'deals', 'messages', 'org_pipelines', 'weekly_payments'])
      assert.ok(leituras.some(l => l.tabela === tab && l.filtros.some(([c, v]) => c === 'org_id' && v === A)), 'sem filtro org_id em ' + tab);
    assert.deepEqual(cartoes(p), { total: 2, novo: 2, chamado: 1, contato: 0 });

    const lb = lead(B); db.leads.push(lb); emitir('INSERT', lb);
    emitir('UPDATE', { ...lb, status: 'contato' }); emitir('DELETE', lb); db.leads.splice(db.leads.indexOf(lb), 1);
    assert.deepEqual(cartoes(p), { total: 2, novo: 2, chamado: 1, contato: 0 });
    assert.equal(p.S.leads.length, 2);

    const la = lead(A); db.leads.push(la); emitir('INSERT', la);
    assert.deepEqual(cartoes(p), { total: 3, novo: 3, chamado: 1, contato: 0 });
    emitir('DELETE', la); db.leads.pop();
    assert.deepEqual(cartoes(p), { total: 2, novo: 2, chamado: 1, contato: 0 });

    const canalA = p.canais.find(c => c.nome === 'leads-' + A);
    await t.trocarPara(B);
    assert.equal(p.S.org.id, B);
    assert.ok(removidos.has(canalA), 'canal da equipe A não foi removido');
    assert.deepEqual([...new Set(p.S.leads.map(l => l.pipeline_id))], ['pl-B']);
    assert.equal(p.S.relDashPipelineId, 'pl-B');
    assert.equal(p.S.relDashPreset, 'today');
    assert.deepEqual(cartoes(p), { total: 3, novo: 3, chamado: 0, contato: 0 });

    emitir('INSERT', lead(A));
    assert.deepEqual(cartoes(p), { total: 3, novo: 3, chamado: 0, contato: 0 });
    emitir('INSERT', lead(B));
    assert.deepEqual(cartoes(p), { total: 4, novo: 4, chamado: 0, contato: 0 });
  });
});

/* ------------------------------------------------------------------ */
describe('Evento da equipe B entregue DE PROPÓSITO no callback da equipe A', () => {
  test('INSERT da B: ignorado', async () => {
    const t = montar(); await abrirNoHoje(t);
    const antes = retrato(t.p);
    t.callbackDe(A)({ eventType: 'INSERT', new: lead(B), old: {} });
    assert.deepEqual(retrato(t.p), antes);
  });

  test('UPDATE da B com o id de um lead da A: não sobrescreve o lead da A', async () => {
    const t = montar(); await abrirNoHoje(t);
    const antes = retrato(t.p);
    const alvo = t.p.S.leads[0];
    t.callbackDe(A)({ eventType: 'UPDATE', new: lead(B, { id: alvo.id, status: 'contato', name: 'Nome de outra equipe' }), old: { id: alvo.id } });
    assert.deepEqual(retrato(t.p), antes);
  });

  test('UPDATE sem org_id: ignorado', async () => {
    const t = montar(); await abrirNoHoje(t);
    const antes = retrato(t.p);
    const { org_id, ...semOrg } = lead(A, { id: t.p.S.leads[0].id, status: 'contato' });
    t.callbackDe(A)({ eventType: 'UPDATE', new: semOrg, old: {} });
    assert.deepEqual(retrato(t.p), antes);
  });

  test('DELETE com org_id da B apontando um lead da A: não remove', async () => {
    const t = montar(); await abrirNoHoje(t);
    const antes = retrato(t.p);
    t.callbackDe(A)({ eventType: 'DELETE', new: {}, old: { id: t.p.S.leads[0].id, org_id: B } });
    assert.deepEqual(retrato(t.p), antes);
  });

  test('DELETE só com id (formato real) de lead que não está carregado na A: nada muda', async () => {
    const t = montar(); await abrirNoHoje(t);
    const antes = retrato(t.p);
    const idDeB = t.db.leads.find(r => r.org_id === B).id;
    t.callbackDe(A)({ eventType: 'DELETE', new: {}, old: { id: idDeB } });
    assert.deepEqual(retrato(t.p), antes);
  });

  test('DELETE só com id de um lead da A continua removendo (caso normal)', async () => {
    const t = montar(); await abrirNoHoje(t);
    const alvo = t.p.S.leads.find(l => l.status === 'novo');
    t.callbackDe(A)({ eventType: 'DELETE', new: {}, old: { id: alvo.id } });
    assert.deepEqual(cartoes(t.p), { total: 1, novo: 1, chamado: 1, contato: 0 });
  });
});

/* ------------------------------------------------------------------ */
describe('Callback atrasado do canal antigo depois da troca de equipe', () => {
  test('INSERT, UPDATE e DELETE pelo callback da A, já com a B aberta: nada muda na B', async () => {
    const t = montar(); await abrirNoHoje(t);
    const cbA = t.callbackDe(A);
    await t.trocarPara(B);
    const antes = retrato(t.p);
    const leadDaB = t.p.S.leads[0];
    cbA({ eventType: 'INSERT', new: lead(A), old: {} });
    cbA({ eventType: 'UPDATE', new: lead(A, { id: leadDaB.id, status: 'contato' }), old: {} });
    cbA({ eventType: 'UPDATE', new: { ...t.db.leads.find(r => r.id === leadDaB.id), status: 'contato' }, old: {} });
    cbA({ eventType: 'DELETE', new: {}, old: { id: leadDaB.id } });
    assert.deepEqual(retrato(t.p), antes);
    // o canal da B segue funcionando normalmente
    t.callbackDe(B)({ eventType: 'INSERT', new: lead(B), old: {} });
    assert.equal(cartoes(t.p).total, antes.cartoes.total + 1);
  });
});
