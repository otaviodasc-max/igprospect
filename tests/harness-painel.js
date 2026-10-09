// Carrega o app.js DE VERDADE num contexto isolado do Node (vm), com um DOM
// mínimo e um cliente Supabase simulado. Serve para testar o comportamento
// real do painel (goalsForm, saveOrgGoals, handler do destinatário…) sem
// navegador e sem rede — nada aqui fala com o Supabase.
//
//   const p = carregarPainel({ rpc, orgsUpdate });
//   p.S                       estado global do painel (o mesmo objeto do app)
//   p.el('gf-save')           elemento falso (criado sob demanda)
//   p.chamadas                toda chamada feita ao Supabase simulado
//   p.espioes                 toast / closeModal / renderGoals
//   await p.salvarMetasPeloFormulario(valores)
//   await p.trocarDestinatario(id)

const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.IGP_ROOT || path.join(__dirname, '..');

function elementoFalso(id) {
  const listeners = {};
  return {
    id, value: '', checked: false, disabled: false, innerHTML: '', textContent: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, appendChild() {}, remove() {},
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    querySelector() { return null; }, querySelectorAll() { return []; }, focus() {}, select() {},
  };
}

// Construtor de consulta no formato do supabase-js: from(t).update(v).eq(c,x).select(...)
// é "thenable" e resolve pelo handler informado.
function consulta(tabela, chamadas, handler) {
  const q = { tabela, op: null, valores: null, filtros: [], select: null };
  const api = {
    update(v) { q.op = 'update'; q.valores = v; return api; },
    eq(c, x) { q.filtros.push([c, x]); return api; },
    select(cols) { q.select = cols || '*'; return api; },
    then(ok, erro) {
      chamadas.push({ tipo: 'from', ...q });
      return Promise.resolve().then(() => handler(q)).then(ok, erro);
    },
  };
  return api;
}

function carregarPainel({ rpc, orgsUpdate, root = ROOT } = {}) {
  const chamadas = [];
  const canais = [];
  const elementos = new Map();
  const el = id => { if (!elementos.has(id)) elementos.set(id, elementoFalso(id)); return elementos.get(id); };
  const sb = {
    auth: { getSession: () => new Promise(() => {}), onAuthStateChange() {}, signOut: async () => {} },
    rpc(fn, args) {
      chamadas.push({ tipo: 'rpc', fn, args: JSON.parse(JSON.stringify(args)) });
      return Promise.resolve().then(() => (rpc ? rpc(fn, args) : { data: null, error: { code: 'PGRST202', message: 'not found' } }));
    },
    from(t) {
      return consulta(t, chamadas, q => (orgsUpdate ? orgsUpdate(q) : { data: [{ id: 'x' }], error: null }));
    },
    // Guarda cada canal e cada .on(evento, filtro, callback) registrado pelo
    // app, para o teste chamar o callback REAL com um payload fictício. Não
    // há servidor Realtime aqui: publicação, RLS e entrega ficam de fora.
    channel(nome) {
      const c = { nome, ouvintes: [], on(evento, filtro, cb) { c.ouvintes.push({ evento, filtro, cb }); return c; }, subscribe() { return c; } };
      canais.push(c);
      return c;
    },
    removeChannel() {},
  };
  const ctx = {
    console, performance, setTimeout, clearTimeout, setInterval, clearInterval, URL, URLSearchParams, Intl,
    requestAnimationFrame: () => 0,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'node' },
    location: { href: 'http://localhost/', search: '', hash: '', reload() {} },
    document: {
      readyState: 'loading',                     // não dispara o boot() do app
      documentElement: elementoFalso('html'), body: elementoFalso('body'),
      getElementById: el, createElement: () => elementoFalso(),
      querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
    },
    // URL/chave de mentira: o app só cria o cliente se "parecer" configurado
    IGP_CONFIG: { SUPABASE_URL: 'http://supabase.invalid', SUPABASE_ANON_KEY: 'chave-de-teste-'.padEnd(40, 'x') },
    supabase: { createClient: () => sb },
  };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  // mesma ordem do index.html (config.js fica de fora: a configuração é a de teste acima)
  vm.runInContext(fs.readFileSync(path.join(root, 'modules.js'), 'utf8'), ctx, { filename: 'modules.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), ctx, { filename: 'app.js' });

  const espioes = { toast: [], closeModal: 0, renderGoals: 0 };
  ctx.toast = (msg, tipo) => { espioes.toast.push({ msg, tipo }); };
  ctx.closeModal = () => { espioes.closeModal++; };
  ctx.renderGoals = () => { espioes.renderGoals++; };

  const run = code => vm.runInContext(code, ctx);
  const S = run('S');

  // Preenche o formulário de metas como o usuário faria e clica em "Salvar".
  async function salvarMetasPeloFormulario(valores = {}) {
    run('goalsForm()');
    for (const [id, v] of Object.entries(valores)) {
      if (typeof v === 'boolean') el(id).checked = v; else el(id).value = String(v);
    }
    await el('gf-save').onclick();
  }

  // Executa o handler REAL do seletor "Quem deve receber o valor", extraído
  // do app.js (fica dentro de renderSettings, que depende da tela inteira).
  async function trocarDestinatario(id) {
    const fn = run(`(${extrairHandler(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), "$('st-pay-recipient').onchange=")})`);
    const alvo = el('st-pay-recipient');
    alvo.value = id;
    await fn({ target: alvo });
  }

  return { S, el, run, chamadas, canais, espioes, salvarMetasPeloFormulario, trocarDestinatario, ctx };
}

// Recorta a função atribuída logo depois de `marcador`, casando chaves e
// respeitando strings e template literals.
function extrairHandler(src, marcador) {
  const i0 = src.indexOf(marcador);
  if (i0 < 0) throw new Error(`handler não encontrado: ${marcador}`);
  const ini = i0 + marcador.length;
  let i = src.indexOf('{', ini), prof = 0;
  const pilha = [];
  for (; i < src.length; i++) {
    const c = src[i];
    const topo = pilha[pilha.length - 1];
    if (topo === "'" || topo === '"') {
      if (c === '\\') { i++; continue; }
      if (c === topo) pilha.pop();
      continue;
    }
    if (topo === '`') {
      if (c === '\\') { i++; continue; }
      if (c === '`') { pilha.pop(); continue; }
      if (c === '$' && src[i + 1] === '{') { pilha.push('${'); prof++; i++; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { pilha.push(c); continue; }
    if (c === '{') { prof++; pilha.push('{'); continue; }
    if (c === '}') {
      prof--; pilha.pop();
      if (prof === 0) return src.slice(ini, i + 1);
    }
  }
  throw new Error('handler sem fechamento');
}

// Valores do formulário de metas preenchidos como um dono faria de verdade.
const FORMULARIO_COMPLETO = {
  'gf-contacts': '40', 'gf-sales': '5', 'gf-revenue': '500.000,00', 'gf-commission': '10.000,00',
  'gf-leadmin': '50', 'gf-leadmax': '120', 'gf-callsweek': '30', 'gf-pay-rate': '0,50',
  'gf-pay-target': '60', 'gf-commpct': '0.1', 'gf-pay-basis': 'chamados', 'gf-pay-followup': true,
  'gf-pay-bonusmin': '90', 'gf-pay-bonusrate': '0,65',
};

// O objeto exato que goalsForm() envia quando o formulário acima é salvo.
// Obtido rodando o painel real (e não escrito à mão).
async function payloadRealDoPainel(valores = FORMULARIO_COMPLETO, root = ROOT) {
  const p = carregarPainel({ root, rpc: () => ({ data: {}, error: null }) });
  p.S.org = { id: '00000000-0000-4000-8000-000000000001', settings: {} };
  await p.salvarMetasPeloFormulario(valores).catch(() => {});
  const c = p.chamadas.find(x => x.tipo === 'rpc');
  if (!c) throw new Error('o painel não chamou nenhuma RPC ao salvar metas');
  return c.args.p_goals;
}

module.exports = { carregarPainel, extrairHandler, payloadRealDoPainel, FORMULARIO_COMPLETO, ROOT };
