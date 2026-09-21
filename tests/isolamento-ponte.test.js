// Testes de isolamento entre equipes no fluxo extensão ⇄ painel.
// Rodar:  node --test tests/isolamento-ponte.test.js
// (IGP_ROOT=<pasta> roda os mesmos testes contra outra cópia do código.)
//
// Sem dependências: o projeto não tem bundler nem framework de teste, então
// cada teste extrai as funções REAIS de app.js / extension/content.js /
// extension/bridge.js pelo nome e executa num sandbox (node:vm) com stubs de
// chrome.*, window e do cliente Supabase. Assim o que é testado é o código
// que vai pro ar, não uma cópia.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.IGP_ROOT || path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'extension/bridge.js'), 'utf8');

// Extrai "function nome(...){...}" (ou async) contando chaves.
function fnSource(src, name) {
  const re = new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`função ${name} não encontrada`);
  const open = src.indexOf('{', src.indexOf(')', m.index));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(m.index, i + 1);
  }
  throw new Error(`fim de ${name} não encontrado`);
}
function lineMatching(src, re) {
  const m = re.exec(src);
  if (!m) throw new Error(`linha ${re} não encontrada`);
  return m[0];
}
const tick = () => new Promise(r => setImmediate(r));
// Objetos criados dentro do sandbox têm outro protótipo — compara por valor.
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

// Gera N leads como a extensão antiga guardava depois de um pull (sem orgId).
function legacyLeads(n, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: String(1700000000000 + i), name: `Lead ${i}`, username: `user${i}`,
    phone: '', niche: '', status: 'novo', synced: true, ...extra,
  }));
}

/* ------------------------------------------------------------------ */
/* PAINEL (app.js)                                                     */
/* ------------------------------------------------------------------ */
function loadPanel({ orgId, leads = [] }) {
  const calls = { update: [], upsert: [], insert: [], posted: [], warns: [] };
  const listeners = {};
  const win = {
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    postMessage: (m) => calls.posted.push(m),
  };
  const ctx = {
    console: { warn: (...a) => calls.warns.push(a.join(' ')), log() {}, error() {} },
    S: { org: { id: orgId, name: 'Equipe' }, leads },
    window: win,
    sb: {
      from: (t) => ({
        update: (patch) => ({ eq: async (c, v) => { calls.update.push({ t, patch, c, v }); return { error: null }; } }),
        upsert: async (rows, opts) => { calls.upsert.push({ t, rows, opts }); return { error: null }; },
        insert: async (rows) => { calls.insert.push({ t, rows }); return { error: null }; },
      }),
    },
    STS: () => ['novo', 'chamado', 'respondeu', 'contato'],
    defaultPipeline: () => ({ id: 'pipeline-' + orgId }),
    isLastStage: () => false, leadPipeline: () => null,
    loadLeads: async () => {}, loadDeals: async () => {}, ensureDealForLead: async () => {},
    renderShell() {}, notifyLeadContato() {}, toast() {},
    setImmediate,
  };
  vm.createContext(ctx);
  const code = [
    lineMatching(APP, /let bridgeBound=.*;/),
    lineMatching(APP, /const GENERIC_NAMES = new Set\(\[.*?\]\);/),
    fnSource(APP, 'bindBridge'),
    fnSource(APP, 'importExtensionLeads'),
    'this.bindBridge=bindBridge; this.importExtensionLeads=importExtensionLeads;',
  ].join('\n');
  vm.runInContext(code, ctx);
  const dispatch = (data) => (listeners.message || []).forEach(fn => fn({ source: win, data, origin: 'https://otaviodasc-max.github.io' }));
  const writes = () => calls.update.length + calls.upsert.length + calls.insert.length;
  return { ctx, calls, dispatch, writes };
}

test('painel: bindBridge não pede a fila local (request-leads) e não importa mensagens "leads"', async () => {
  const p = loadPanel({ orgId: 'B' });
  p.ctx.bindBridge();
  p.ctx.bindBridge(); // idempotente
  assert.equal(p.calls.posted.length, 0, 'painel não pode mandar postMessage pra extensão');
  // Extensão antiga respondendo com 6.000 leads da equipe A
  p.dispatch({ source: 'igp-extension', type: 'leads', leads: legacyLeads(6000, { orgId: 'A' }) });
  p.dispatch({ source: 'igp-extension', type: 'leads', leads: legacyLeads(6000) });
  await tick(); await tick();
  assert.equal(p.writes(), 0, 'nenhuma escrita no banco');
  // Presença continua funcionando
  p.dispatch({ source: 'igp-extension', type: 'hello' });
  assert.equal(p.ctx.S.extensionPresent, true);
  assert.ok(p.calls.warns.every(w => !/Lead \d|user\d/.test(w)), 'console sem dados de lead');
});

test('painel: equipe C recém-criada começa vazia e abrir o painel não pede nem importa igp_l', async () => {
  const p = loadPanel({ orgId: 'C', leads: [] });
  p.ctx.bindBridge();                       // boot() logo depois de create_org
  assert.equal(p.calls.posted.length, 0);
  p.dispatch({ source: 'igp-extension', type: 'leads', leads: legacyLeads(6516) });
  await tick(); await tick();
  assert.equal(p.writes(), 0);
  assert.equal(p.ctx.S.leads.length, 0);
});

test('painel: 6.000 leads sem orgId → nenhum importado, nenhum atualizado por username', async () => {
  const existing = [{ id: 'db-1', extId: 'outro', username: 'user5', name: 'Existente', status: 'novo', phone: '' }];
  const p = loadPanel({ orgId: 'B', leads: existing });
  await p.ctx.importExtensionLeads(legacyLeads(6000, { status: 'contato', phone: '11999999999' }));
  assert.equal(p.writes(), 0);
  assert.equal(existing[0].status, 'novo');
  assert.match(p.calls.warns.join('\n'), /6000 lead\(s\) da extensão rejeitados/);
});

test('painel da equipe B rejeita todos os leads com orgId=A', async () => {
  const p = loadPanel({ orgId: 'B' });
  await p.ctx.importExtensionLeads(legacyLeads(500, { orgId: 'A' }));
  assert.equal(p.writes(), 0);
});

test('painel: lead da própria equipe com mesmo @usuário mas outro id NÃO atualiza nem duplica', async () => {
  const existing = [{ id: 'db-1', extId: 'x-1', username: 'user0', name: 'Existente', status: 'novo', phone: '' }];
  const p = loadPanel({ orgId: 'B', leads: existing });
  await p.ctx.importExtensionLeads([{ id: '999', orgId: 'B', username: 'user0', name: 'Outro', status: 'contato', phone: '1' }]);
  assert.equal(p.writes(), 0);
  assert.equal(existing[0].status, 'novo');
});

test('painel (defesa em profundidade): lead legítimo da equipe B grava org_id explícito', async () => {
  const p = loadPanel({ orgId: 'B' });
  await p.ctx.importExtensionLeads([{ id: '1', orgId: 'B', username: 'nova', name: 'Nova', status: 'novo' }]);
  assert.equal(p.calls.upsert.length, 1);
  assert.equal(p.calls.upsert[0].rows.length, 1);
  assert.equal(p.calls.upsert[0].rows[0].org_id, 'B');
});

test('painel: código não pede nem importa a fila local em lugar nenhum', () => {
  assert.doesNotMatch(APP, /request-leads/);
  assert.doesNotMatch(APP, /synced-ids/);
  assert.doesNotMatch(fnSource(APP, 'bindBridge'), /importExtensionLeads/);
  assert.doesNotMatch(fnSource(APP, 'importExtensionLeads'), /!raw\.orgId\s*\|\|/);
  // única chamada restante é a recursiva, dentro da própria função
  const outside = APP.replace(fnSource(APP, 'importExtensionLeads'), '');
  assert.doesNotMatch(outside, /importExtensionLeads\(/);
});

/* ------------------------------------------------------------------ */
/* BRIDGE (extension/bridge.js)                                        */
/* ------------------------------------------------------------------ */
function runBridge(origin) {
  const calls = { posted: [], listeners: 0, storage: 0 };
  const chrome = { storage: {
    local: { get: () => { calls.storage++; }, set: () => { calls.storage++; } },
    onChanged: { addListener: () => { calls.storage++; } },
  } };
  const ctx = {
    window: { location: { origin }, addEventListener: () => { calls.listeners++; }, postMessage: (m, o) => calls.posted.push({ m, o }) },
    chrome,
  };
  vm.createContext(ctx);
  vm.runInContext(BRIDGE, ctx);
  return calls;
}

test('bridge.js: só envia "hello", não lê storage, não escuta mensagens', () => {
  const c = runBridge('https://otaviodasc-max.github.io');
  assert.deepEqual(c.posted.map(x => x.m.type), ['hello']);
  assert.equal(c.posted[0].o, 'https://otaviodasc-max.github.io');
  assert.equal(c.listeners, 0);
  assert.equal(c.storage, 0);
  assert.equal(runBridge('https://site-qualquer.com').posted.length, 0);
});

test('bridge.js: código não referencia igp_l, igp_org, request-leads nem synced-ids', () => {
  const code = BRIDGE.replace(/\/\/.*$/gm, '');
  for (const s of ['igp_l', 'igp_org', 'request-leads', 'synced-ids', 'chrome.storage']) {
    assert.ok(!code.includes(s), `bridge.js ainda usa ${s}`);
  }
});

/* ------------------------------------------------------------------ */
/* EXTENSÃO (extension/content.js)                                     */
/* ------------------------------------------------------------------ */
function loadExtension({ org = null, leads = [], store = {}, handlers = {} } = {}) {
  const sent = [];
  const deferred = [];
  const warns = [];
  const ctx = {
    console: { warn: (...a) => warns.push(a.join(' ')), log() {} },
    S: { leads, org, orgMembers: [], agendorStatus: {}, filter: 'all', open: false, pipelineStages: null, agendorMap: null, agendorOrigin: null, agendorToken: '' },
    store,
    chrome: {
      runtime: {
        sendMessage: (msg, cb) => {
          sent.push(msg);
          const h = handlers[msg.type];
          if (!h) return;
          const res = h(msg);
          if (res && res.__defer) deferred.push(() => cb && cb(res.value)); else cb && cb(res);
        },
      },
      storage: { local: {
        get: (keys, cb) => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; ks.forEach(k => { if (k in store) o[k] = store[k]; }); cb(o); },
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
      } },
    },
    shadow: { getElementById: () => ({ value: ctx.__typedCode || '' }) },
    toast() {}, render() {}, renderBody() {}, extractProfile() {},
    newLeadStatusKey: () => 'novo', mapPipelineStages: (s) => s || [], registerSyncAndCheck: () => true,
    recentSyncTimes: [], syncPaused: false,
  };
  ctx.db = { save: (d) => { Object.assign(store, d); return Promise.resolve(); } };
  vm.createContext(ctx);
  const names = ['splitLeadsByOrg', 'isolateLocalLeads', 'mergePulledLeads', 'pullLeads', 'pullPipeline',
    'doLinkOrg', 'applyOrgChange', 'leadIsFromConnectedOrg', 'syncLeadAddDirect', 'syncLeadUpdateDirect',
    'syncLeadDeleteDirect', 'doDeleteLead'];
  vm.runInContext([lineMatching(CONTENT, /const QUARANTINE_KEY = .*;/), ...names.map(n => fnSource(CONTENT, n))].join('\n'), ctx);
  return { ctx, sent, deferred, warns, store };
}
const serverLeads = (prefix, n) => Array.from({ length: n }, (_, i) => ({ ext_id: `${prefix}-${i}`, name: `${prefix}${i}`, username: `${prefix}${i}`, status: 'novo', added_at: '2026-07-01T00:00:00Z' }));

test('extensão: pullLeads marca todo lead baixado com orgId da equipe conectada', () => {
  const org = { id: 'B', code: 'CODEB', locked: true };
  const local = [
    { id: 'b-local', orgId: 'B', synced: false, name: 'pendente B' },
    { id: 'a-local', orgId: 'A', synced: false, name: 'pendente A' },
    { id: 'sem-org', synced: false, name: 'legado' },
  ];
  const e = loadExtension({ org, leads: local, handlers: { pull_org_leads: () => ({ ok: true, leads: serverLeads('b', 50) }) } });
  e.ctx.pullLeads('CODEB', false);
  const ids = e.ctx.S.leads.map(l => l.id);
  assert.equal(e.ctx.S.leads.length, 51);
  assert.ok(e.ctx.S.leads.every(l => l.orgId === 'B'));
  assert.ok(ids.includes('b-local'));
  assert.ok(!ids.includes('a-local') && !ids.includes('sem-org'));
  assert.ok(e.store.igp_l.every(l => l.orgId === 'B'));
});

test('extensão: resposta atrasada do pull da equipe A é descartada depois de trocar para B', () => {
  const e = loadExtension({
    org: { id: 'A', code: 'CODEA', locked: true },
    handlers: {
      pull_org_leads: (m) => m.code === 'CODEA' ? { __defer: true, value: { ok: true, leads: serverLeads('a', 6000) } } : { ok: true, leads: serverLeads('b', 3) },
      resolve_org_code: () => ({ ok: true, org: { id: 'B', name: 'Equipe B', agendor_token: '' } }),
      resolve_org_members: () => ({ ok: true, members: [] }),
      pull_org_pipeline: () => ({ ok: true, pipeline: { stages: [] } }),
    },
  });
  e.ctx.pullLeads('CODEA', false);         // pull de A em andamento
  e.ctx.__typedCode = 'CODEB';
  e.ctx.doLinkOrg();                         // troca pra B
  e.deferred.forEach(fn => fn());            // resposta de A chega agora
  assert.equal(e.ctx.S.org.id, 'B');
  assert.equal(e.ctx.S.leads.length, 3);
  assert.ok(e.ctx.S.leads.every(l => l.orgId === 'B'));
  assert.ok(e.store.igp_l.every(l => l.orgId === 'B'));
});

test('extensão: trocar de A para B não deixa nenhum lead ou cache de A', () => {
  const aLeads = serverLeads('a', 100).map(l => ({ id: l.ext_id, orgId: 'A', synced: true }))
    .concat([{ id: 'a-pend', orgId: 'A', synced: false }]);
  const e = loadExtension({
    org: { id: 'A', code: 'CODEA', locked: true }, leads: aLeads,
    store: { igp_l: aLeads, igp_stages: [{ key: 'a' }], igp_agendor_map: { x: 1 } },
    handlers: {
      resolve_org_code: () => ({ ok: true, org: { id: 'B', name: 'Equipe B', agendor_token: '' } }),
      resolve_org_members: () => ({ ok: true, members: [] }),
      pull_org_pipeline: () => ({ ok: true, pipeline: { stages: [{ key: 'b' }] } }),
      pull_org_leads: () => ({ ok: true, leads: serverLeads('b', 5) }),
    },
  });
  e.ctx.S.agendorStatus = { 'a-0': 'ok' };
  e.ctx.__typedCode = 'CODEB';
  e.ctx.doLinkOrg();
  assert.equal(e.ctx.S.org.id, 'B');
  assert.ok(e.ctx.S.leads.every(l => l.orgId === 'B'));
  assert.ok(!e.store.igp_l.some(l => String(l.id).startsWith('a')));
  same(e.ctx.S.agendorStatus, {});
  same(e.store.igp_stages, [{ key: 'b' }]);
});

test('extensão: troca de equipe feita em OUTRA aba limpa a memória desta aba', () => {
  const aLeads = [{ id: 'a-1', orgId: 'A', synced: true }];
  const e = loadExtension({
    org: { id: 'A', code: 'CODEA', locked: true }, leads: aLeads,
    store: { igp_l: [{ id: 'b-1', orgId: 'B', synced: true }, { id: 'velho', synced: true }], igp_stages: null, igp_tok: '' },
  });
  e.ctx.applyOrgChange({ id: 'B', code: 'CODEB', locked: true });
  same(e.ctx.S.leads.map(l => l.id), ['b-1']);
  // atualização atrasada de um lead de A (ex.: callback do CRM) não vai pro banco com o código de B
  e.ctx.syncLeadUpdateDirect('a-1', { status: 'contato' });
  assert.equal(e.sent.filter(m => m.type === 'update_lead_direct').length, 0);
});

test('extensão: 6.000 leads legados sem orgId → descartados/quarentena, nunca sincronizam', () => {
  const legacy = legacyLeads(3000).concat(legacyLeads(3000).map((l, i) => ({ ...l, id: 'p' + i, synced: false })));
  const e = loadExtension({ org: { id: 'B', code: 'CODEB', locked: true } });
  const kept = e.ctx.isolateLocalLeads(legacy);
  assert.equal(kept.length, 0);
  assert.equal(e.store.igp_l_quarentena.length, 3000, 'só os nunca sincronizados vão pra quarentena');
  legacy.forEach(l => e.ctx.syncLeadAddDirect(l));
  legacy.forEach(l => e.ctx.syncLeadUpdateDirect(l.id, { status: 'contato' }));
  legacy.forEach(l => e.ctx.syncLeadDeleteDirect(l.id, l));
  assert.equal(e.sent.length, 0, 'nada vai pro banco');
  assert.match(e.warns.join('\n'), /6000 lead\(s\) locais/);
  assert.ok(e.warns.every(w => !/Lead \d|user\d/.test(w)), 'console sem dados de lead');
  // quarentena é gravada só por isolateLocalLeads e nunca lida por mais ninguém
  const uses = CONTENT.split('QUARANTINE_KEY').length - 1;
  assert.equal(uses, 4, 'QUARANTINE_KEY: declaração + get + leitura + set, todos dentro de isolateLocalLeads');
  assert.ok(!/igp_l_quarentena/.test(CONTENT.replace(lineMatching(CONTENT, /const QUARANTINE_KEY = .*;/), '')));
});

test('extensão: lead legítimo da equipe B continua sincronizando direto (RPC), sem a ponte', () => {
  const e = loadExtension({ org: { id: 'B', code: 'CODEB', locked: true, userId: 'u1' } });
  const lead = { id: '1', orgId: 'B', name: 'Nova', synced: false };
  e.ctx.S.leads = [lead];
  e.ctx.syncLeadAddDirect(lead);
  e.ctx.syncLeadUpdateDirect('1', { status: 'chamado' });
  e.ctx.doDeleteLead('1');
  assert.deepEqual(e.sent.map(m => m.type), ['add_lead_direct', 'update_lead_direct', 'delete_lead_direct']);
  assert.ok(e.sent.every(m => m.code === 'CODEB'));
});

test('extensão: carga inicial isola igp_l pela equipe antes de usar', () => {
  const load = CONTENT.slice(CONTENT.indexOf('db.load().then(d=>{'));
  const orgAt = load.indexOf('S.org=d.igp_org');
  const leadsAt = load.indexOf('S.leads=isolateLocalLeads(d.igp_l)');
  assert.ok(orgAt > 0 && leadsAt > orgAt, 'equipe carregada antes, leads filtrados por ela');
  assert.doesNotMatch(CONTENT, /S\.leads=d\.igp_l/);
});
