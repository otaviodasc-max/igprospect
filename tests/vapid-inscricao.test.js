// Cenários de inscrição push do painel, incluindo a troca da chave VAPID.
// Rodar:  node --test tests/vapid-inscricao.test.js
//   (IGP_ROOT=<pasta> roda os mesmos testes contra outra cópia do código.)
//
// Executa as funções REAIS do app.js (extraídas por nome) num sandbox com
// navigator/PushManager/Supabase simulados. NENHUMA chave real aparece aqui:
// as chaves são bytes inventados, gerados no próprio teste.
//
// O simulador segue a regra do navegador de verdade: enquanto existir uma
// inscrição ATIVA, pushManager.subscribe() com outra chave FALHA
// (InvalidStateError). É isso que torna obrigatório cancelar antes de apagar
// a linha do banco.

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
const ORG = 'org-B';

// inscricao: null | { chave, endpoint, unsubscribe: true|false|'erro' }
function montarPainel({ chaveConfig = CHAVE_ATUAL, inscricao = null, permissao = 'granted', falhas = {} } = {}) {
  const log = { subscribe: [], unsubscribe: 0, delete: [], upsert: [], warns: [] };
  const estado = { ativa: null };
  if (inscricao) {
    estado.ativa = {
      endpoint: inscricao.endpoint || 'https://push.example.test/antiga',
      options: { applicationServerKey: bytesDe(inscricao.chave).buffer },
      toJSON: () => ({ keys: { p256dh: 'p256dh-antigo', auth: 'auth-antigo' } }),
      unsubscribe: async () => {
        log.unsubscribe++;
        if (inscricao.unsubscribe === 'erro') throw new Error('unsubscribe falhou');
        if (inscricao.unsubscribe === false) return false;     // navegador recusou
        estado.ativa = null;                                    // só aqui some de verdade
        return true;
      },
    };
  }
  const pushManager = {
    getSubscription: async () => estado.ativa,
    subscribe: async (opts) => {
      log.subscribe.push(opts);
      // regra do navegador: já existe inscrição ativa com outra chave
      if (estado.ativa) { const e = new Error('Registration failed - existing subscription'); e.name = 'InvalidStateError'; throw e; }
      if (falhas.subscribe) throw new Error('subscribe falhou');
      estado.ativa = {
        endpoint: 'https://push.example.test/nova',
        options: { applicationServerKey: bytesDe(chaveConfig).buffer },
        toJSON: () => ({ keys: { p256dh: 'p256dh-novo', auth: 'auth-novo' } }),
        unsubscribe: async () => { estado.ativa = null; return true; },
      };
      return estado.ativa;
    },
  };
  const consulta = () => {
    const filtros = {};
    const q = {
      eq: (col, val) => { filtros[col] = val; return q; },
      then: (ok, err) => {
        log.delete.push({ ...filtros });
        const p = falhas.delete === 'throw'
          ? Promise.reject(new Error('rede caiu'))
          : Promise.resolve({ error: falhas.delete === 'error' ? { message: 'RLS' } : null });
        return p.then(ok, err);
      },
    };
    return q;
  };
  const ctx = {
    console: { warn: (...a) => log.warns.push(a.map(String).join(' ')), log() {} },
    S: { org: { id: ORG }, route: 'dashboard' },
    IGP_CONFIG: { VAPID_PUBLIC_KEY: chaveConfig },   // no navegador, window.X é global
    navigator: { serviceWorker: { register: async () => {}, ready: Promise.resolve({ active: true, pushManager }) },
                 userAgent: 'teste' },
    Notification: { permission: permissao },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    Uint8Array, ArrayBuffer, Buffer,
    sb: {
      from: () => ({
        delete: consulta,
        upsert: async (row, opts) => { log.upsert.push({ row, opts });
          return { error: falhas.upsert ? { message: 'RLS no upsert' } : null }; },
      }),
    },
  };
  ctx.window = ctx;
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
  return { ctx, log, estado };
}

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

test('sem inscrição: cria uma e grava, sem cancelar nem apagar nada', async () => {
  const p = montarPainel();
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.subscribe.length, 1);
  assert.deepEqual([...new Uint8Array(p.log.subscribe[0].applicationServerKey)], [...bytesDe(CHAVE_ATUAL)]);
  assert.equal(p.log.delete.length, 0);
  assert.equal(p.log.unsubscribe, 0);
  assert.equal(p.log.upsert.length, 1);
  assert.equal(p.log.upsert[0].row.endpoint, 'https://push.example.test/nova');
  assert.equal(p.log.upsert[0].row.org_id, ORG);
});

test('chave igual: reaproveita a inscrição (não cancela, não apaga, não reinscreve)', async () => {
  const p = montarPainel({ inscricao: { chave: CHAVE_ATUAL, unsubscribe: true } });
  await p.ctx.ensurePushSubscription();
  assert.deepEqual([p.log.subscribe.length, p.log.delete.length, p.log.unsubscribe], [0, 0, 0]);
  assert.equal(p.log.upsert.length, 1);
  assert.equal(p.log.upsert[0].row.endpoint, 'https://push.example.test/antiga');
});

test('unsubscribe() devolve false: não apaga no banco e não tenta assinar', async () => {
  const p = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: false } });
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.unsubscribe, 1);
  assert.equal(p.log.delete.length, 0, 'a linha antiga continua no banco');
  assert.equal(p.log.subscribe.length, 0, 'não tenta assinar com a inscrição antiga ativa');
  assert.equal(p.log.upsert.length, 0);
  assert.ok(p.estado.ativa, 'inscrição antiga segue ativa no navegador');
  assert.match(p.log.warns.join('\n'), /não foi cancelada/);
});

test('unsubscribe() lança erro: não apaga no banco e não tenta assinar', async () => {
  const p = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: 'erro' } });
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.delete.length, 0);
  assert.equal(p.log.subscribe.length, 0);
  assert.equal(p.log.upsert.length, 0);
  assert.match(p.log.warns.join('\n'), /unsubscribe da inscrição antiga falhou/);
  assert.match(p.log.warns.join('\n'), /não foi cancelada/);
});

test('próximo boot tenta de novo e regulariza depois de uma falha de cancelamento', async () => {
  // 1º boot: unsubscribe falha → nada é apagado
  const p1 = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: false } });
  await p1.ctx.ensurePushSubscription();
  assert.deepEqual([p1.log.delete.length, p1.log.upsert.length], [0, 0]);
  // 2º boot: o navegador agora cancela → fluxo completa
  const p2 = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: true } });
  await p2.ctx.ensurePushSubscription();
  assert.equal(p2.log.delete.length, 1);
  assert.equal(p2.log.subscribe.length, 1);
  assert.equal(p2.log.upsert.length, 1);
});

test('cancelamento e remoção ok: cria e grava a inscrição nova', async () => {
  const p = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: true } });
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.unsubscribe, 1);
  assert.equal(p.log.subscribe.length, 1);
  assert.equal(p.log.upsert.length, 1);
  assert.equal(p.log.upsert[0].row.endpoint, 'https://push.example.test/nova');
  assert.equal(p.log.upsert[0].row.org_id, ORG);
  assert.equal(p.log.upsert[0].opts.onConflict, 'endpoint');
});

test('a remoção da linha antiga filtra por endpoint E org_id', async () => {
  const p = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: true } });
  await p.ctx.ensurePushSubscription();
  assert.deepEqual(p.log.delete, [{ org_id: ORG, endpoint: 'https://push.example.test/antiga' }]);
});

test('cancelou mas a remoção no banco falha: segue e grava a inscrição nova', async () => {
  for (const modo of ['error', 'throw']) {
    const p = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: true }, falhas: { delete: modo } });
    await p.ctx.ensurePushSubscription();
    assert.equal(p.log.subscribe.length, 1, modo);
    assert.equal(p.log.upsert.length, 1, modo);
    assert.match(p.log.warns.join('\n'), /não saiu do banco/, modo);
  }
});

test('nova inscrição falha depois do cancelamento: não grava e tenta no próximo boot', async () => {
  const p = montarPainel({ inscricao: { chave: CHAVE_ANTIGA, unsubscribe: true }, falhas: { subscribe: true } });
  await p.ctx.ensurePushSubscription();   // não pode lançar
  assert.equal(p.log.subscribe.length, 1);
  assert.equal(p.log.upsert.length, 0, 'nada é gravado sem inscrição');
  assert.match(p.log.warns.join('\n'), /push sub.*próximo carregamento/s);
  // próximo boot, já sem inscrição ativa: regulariza
  const p2 = montarPainel();
  await p2.ctx.ensurePushSubscription();
  assert.equal(p2.log.upsert.length, 1);
});

test('upsert falha: erro é registrado e a próxima inicialização regulariza', async () => {
  const p = montarPainel({ falhas: { upsert: true } });
  await p.ctx.ensurePushSubscription();
  assert.equal(p.log.upsert.length, 1);
  assert.match(p.log.warns.join('\n'), /não foi gravada.*próximo carregamento/s);
  const p2 = montarPainel();
  await p2.ctx.ensurePushSubscription();
  assert.equal(p2.log.upsert.length, 1);
});

test('sem permissão concedida: não mexe em nada', async () => {
  const p = montarPainel({ permissao: 'default', inscricao: { chave: CHAVE_ANTIGA, unsubscribe: true } });
  await p.ctx.ensurePushSubscription();
  assert.deepEqual([p.log.subscribe.length, p.log.delete.length, p.log.upsert.length, p.log.unsubscribe], [0, 0, 0, 0]);
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
