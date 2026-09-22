// Cenários de inscrição push do painel, incluindo a troca da chave VAPID.
// Rodar:  node --test tests/vapid-inscricao.test.js
//
// Executa as funções REAIS do app.js (extraídas por nome) num sandbox, com
// navigator/PushManager/Supabase simulados. NENHUMA chave real aparece aqui:
// as chaves são bytes inventados, gerados no próprio teste.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = process.env.IGP_ROOT || path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

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
// chave base64url fictícia de 65 bytes (mesmo tamanho de uma chave VAPID real)
function chaveFalsa(semente) {
  const b = Buffer.alloc(65);
  b[0] = 4;
  for (let i = 1; i < 65; i++) b[i] = (semente * 7 + i * 13) % 251;
  return b.toString('base64url');
}
const CHAVE_ATUAL = chaveFalsa(1);
const CHAVE_ANTIGA = chaveFalsa(2);
const bytesDe = b64 => new Uint8Array(Buffer.from(b64, 'base64url'));

function montarPainel({ chaveConfig = CHAVE_ATUAL, inscricaoExistente = null, permissao = 'granted',
                        falhas = {} } = {}) {
  const log = { subscribe: [], unsubscribe: 0, delete: [], upsert: [], warns: [] };
  const novaInscricao = {
    endpoint: 'https://push.example.test/nova',
    options: { applicationServerKey: bytesDe(chaveConfig).buffer },
    toJSON: () => ({ keys: { p256dh: 'p256dh-novo', auth: 'auth-novo' } }),
    unsubscribe: async () => true,
  };
  const pushManager = {
    getSubscription: async () => inscricaoExistente,
    subscribe: async (opts) => {
      log.subscribe.push(opts);
      if (falhas.subscribe) throw new Error('subscribe falhou');
      return novaInscricao;
    },
  };
  const ctx = {
    console: { warn: (...a) => log.warns.push(a.map(String).join(' ')), log() {} },
    S: { org: { id: 'org-B' }, route: 'dashboard' },
    IGP_CONFIG: { VAPID_PUBLIC_KEY: chaveConfig },   // no navegador, window.X é global
    navigator: { serviceWorker: { register: async () => {}, ready: Promise.resolve({ active: true, pushManager }) },
                 userAgent: 'teste' },
    Notification: { permission: permissao },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Uint8Array, ArrayBuffer, Buffer,
    sb: {
      from: () => ({
        delete: () => ({ eq: async (col, val) => { log.delete.push({ col, val });
          if (falhas.delete === 'throw') throw new Error('rede caiu');
          return { error: falhas.delete === 'error' ? { message: 'RLS' } : null }; } }),
        upsert: async (row, opts) => { log.upsert.push({ row, opts }); return { error: null }; },
      }),
    },
  };
  ctx.window = ctx;                 // 'PushManager' in window, window.IGP_CONFIG, etc.
  ctx.PushManager = function () {};
  ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  const code = [
    APP.match(/const VAPID_PUB = .*;/)[0],
    'let swReg = null;',
    fnSource(APP, 'pushSupported'), fnSource(APP, 'pushPerm'), fnSource(APP, 'urlB64ToUint8'),
    fnSource(APP, 'registerSW'), fnSource(APP, 'pushKeyBytes'), fnSource(APP, 'samePushKey'),
    fnSource(APP, 'ensurePushSubscription'),
    'this.ensurePushSubscription=ensurePushSubscription; this.samePushKey=samePushKey; this.pushKeyBytes=pushKeyBytes;',
  ].join('\n');
  vm.runInContext(code, ctx);
  return { ctx, log, novaInscricao };
}
const inscricaoCom = (chave, endpoint = 'https://push.example.test/antiga', extra = {}) => ({
  endpoint,
  options: { applicationServerKey: bytesDe(chave).buffer },
  toJSON: () => ({ keys: { p256dh: 'p256dh-antigo', auth: 'auth-antigo' } }),
  unsubscribe: async () => { if (extra.falhaUnsubscribe) throw new Error('unsubscribe falhou'); return true; },
});

test('normalização: compara base64url, ArrayBuffer e Uint8Array como iguais', () => {
  const { ctx } = montarPainel();
  const b = bytesDe(CHAVE_ATUAL);
  assert.equal(ctx.samePushKey(CHAVE_ATUAL, CHAVE_ATUAL), true);
  assert.equal(ctx.samePushKey(b.buffer, CHAVE_ATUAL), true, 'ArrayBuffer x base64url');
  assert.equal(ctx.samePushKey(b, CHAVE_ATUAL), true, 'Uint8Array x base64url');
  assert.equal(ctx.samePushKey(bytesDe(CHAVE_ANTIGA), CHAVE_ATUAL), false, 'chaves diferentes');
  assert.equal(ctx.samePushKey(null, CHAVE_ATUAL), false, 'sem chave na inscrição');
  assert.equal(ctx.samePushKey(b.slice(0, 30), CHAVE_ATUAL), false, 'tamanho diferente');
  assert.equal(ctx.samePushKey('não é base64 $$$', CHAVE_ATUAL), false, 'string inválida não quebra');
});

test('sem inscrição: cria uma e grava, sem cancelar nada', async () => {
  const p = montarPainel();
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.subscribe.length, 1);
  assert.deepEqual([...new Uint8Array(p.log.subscribe[0].applicationServerKey)], [...bytesDe(CHAVE_ATUAL)]);
  assert.equal(p.log.delete.length, 0);
  assert.equal(p.log.upsert.length, 1);
  assert.equal(p.log.upsert[0].row.endpoint, 'https://push.example.test/nova');
  assert.equal(p.log.upsert[0].row.org_id, 'org-B');
});

test('mesma chave: reaproveita a inscrição (não cancela, não reinscreve)', async () => {
  const p = montarPainel({ inscricaoExistente: inscricaoCom(CHAVE_ATUAL) });
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.subscribe.length, 0);
  assert.equal(p.log.delete.length, 0);
  assert.equal(p.log.upsert.length, 1);
  assert.equal(p.log.upsert[0].row.endpoint, 'https://push.example.test/antiga');
});

test('chave trocada: apaga a linha antiga, cancela e assina de novo', async () => {
  const p = montarPainel({ inscricaoExistente: inscricaoCom(CHAVE_ANTIGA) });
  await p.ctx.ensurePushSubscription();
  assert.deepEqual(p.log.delete, [{ col: 'endpoint', val: 'https://push.example.test/antiga' }]);
  assert.equal(p.log.subscribe.length, 1);
  assert.equal(p.log.upsert.length, 1);
  assert.equal(p.log.upsert[0].row.endpoint, 'https://push.example.test/nova');
  assert.equal(p.log.upsert[0].opts.onConflict, 'endpoint');
});

test('falha ao cancelar a antiga não impede a inscrição nova', async () => {
  const p = montarPainel({ inscricaoExistente: inscricaoCom(CHAVE_ANTIGA, 'https://push.example.test/antiga', { falhaUnsubscribe: true }) });
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.subscribe.length, 1);
  assert.equal(p.log.upsert.length, 1);
  assert.match(p.log.warns.join('\n'), /unsubscribe/);
});

test('falha ao apagar a linha antiga (erro do banco ou rede) não impede a inscrição nova', async () => {
  for (const modo of ['error', 'throw']) {
    const p = montarPainel({ inscricaoExistente: inscricaoCom(CHAVE_ANTIGA), falhas: { delete: modo } });
    await p.ctx.ensurePushSubscription();
    assert.equal(p.log.subscribe.length, 1, modo);
    assert.equal(p.log.upsert.length, 1, modo);
    assert.match(p.log.warns.join('\n'), /não saiu do banco/, modo);
  }
});

test('falha ao assinar: não estoura pra fora e não grava inscrição', async () => {
  const p = montarPainel({ inscricaoExistente: inscricaoCom(CHAVE_ANTIGA), falhas: { subscribe: true } });
  await p.ctx.ensurePushSubscription();   // não pode lançar
  assert.equal(p.log.upsert.length, 0);
  assert.match(p.log.warns.join('\n'), /push sub/);
});

test('sem permissão concedida: não mexe em nada', async () => {
  const p = montarPainel({ permissao: 'default', inscricaoExistente: inscricaoCom(CHAVE_ANTIGA) });
  await p.ctx.ensurePushSubscription();
  assert.deepEqual([p.log.subscribe.length, p.log.delete.length, p.log.upsert.length], [0, 0, 0]);
});

test('index.html: cache-busting de config.js e app.js na mesma versão', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const cfg = html.match(/config\.js\?v=([0-9a-z]+)/);
  const app = html.match(/app\.js\?v=([0-9a-z]+)/);
  assert.ok(cfg && app, 'config.js e app.js precisam de ?v=');
  assert.equal(cfg[1], app[1], 'trocar a chave pública exige subir o ?v= do config.js junto com o do app.js');
});

test('NOTIFICACOES-SETUP.txt não contém valor de chave', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'NOTIFICACOES-SETUP.txt'), 'utf8');
  const suspeitos = (txt.match(/(?<![-A-Za-z0-9_])[A-Za-z0-9_-]{40,}(?![-A-Za-z0-9_])/g) || [])
    .filter(t => /[A-Za-z]/.test(t) && /[0-9]/.test(t));   // linhas de traços do guia não contam
  assert.deepEqual(suspeitos, [], 'sobrou algo parecido com chave');
  assert.match(txt, /VAPID_PRIVATE_KEY\s*=\s*<COLE_AQUI/, 'guia continua utilizável, com marcador');
  assert.doesNotMatch(txt, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, 'e-mail pessoal removido');
});
