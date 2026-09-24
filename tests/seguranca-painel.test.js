// Verificação estática do isolamento por equipe no CLIENTE (painel e extensão).
// Rodar:  node --test tests/seguranca-painel.test.js
//
// Garante que toda escrita do painel em tabela de equipe leva a equipe
// explícita e que a extensão só fala com o banco por RPC (nunca tabela direta).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.IGP_ROOT || path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'extension/background.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'extension/content.js'), 'utf8');
const TEAM_TABLES = 'leads|deals|calls|messages|weekly_payments|push_subscriptions';

test('painel: todo update/delete em leads/deals/calls/messages filtra por org_id antes do id', () => {
  const re = /sb\.from\('(leads|deals|calls|messages)'\)\.(update|delete)\(/g;
  const sem = [];
  let m, total = 0;
  while ((m = re.exec(APP))) {
    total++;
    const tail = APP.slice(m.index, m.index + 400);
    const idx = tail.search(/\.(eq|in)\('id',/);
    if (idx < 0 || !tail.slice(0, idx).includes(".eq('org_id',S.org.id)")) {
      sem.push(`${m[1]}.${m[2]} @ linha ${APP.slice(0, m.index).split('\n').length}`);
    }
  }
  assert.ok(total >= 20, `esperava ~22 escritas, achou ${total}`);
  assert.deepEqual(sem, [], 'escritas sem filtro de equipe');
});

test('painel: todo insert/upsert em tabela de equipe leva org_id explícito', () => {
  const re = new RegExp(`sb\\.from\\('(${TEAM_TABLES})'\\)\\.(insert|upsert)\\(`, 'g');
  const sem = [];
  let m;
  while ((m = re.exec(APP))) {
    // o objeto gravado é montado na própria chamada ou nas linhas logo acima
    const around = APP.slice(Math.max(0, m.index - 1200), m.index + 300);
    const call = APP.slice(m.index, m.index + 300);
    const ok = /withOrg\(/.test(call) || /org_id:S\.org\.id/.test(call) ||
               (/\((rows|row)[.,)]/.test(call) && /org_id:(S\.org\.id|orgId)\b/.test(around));
    if (!ok) sem.push(`${m[1]}.${m[2]} @ linha ${APP.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(sem, [], 'gravações sem equipe explícita');
});

test('painel: leituras de tabela de equipe filtram por org_id', () => {
  const re = new RegExp(`sb\\.from\\('(${TEAM_TABLES})'\\)\\.select\\(`, 'g');
  const sem = [];
  let m;
  while ((m = re.exec(APP))) {
    const tail = APP.slice(m.index, m.index + 300);
    if (!/\.eq\('org_id',/.test(tail)) sem.push(`${m[1]} @ linha ${APP.slice(0, m.index).split('\n').length}`);
  }
  assert.deepEqual(sem, []);
});

test('extensão: só usa RPC (nunca acessa tabela direto) e não chama o painel', () => {
  const rest = BG.match(/\/rest\/v1\/[a-z_]+/g) || [];
  assert.ok(rest.length > 0 && rest.every(p => p === '/rest/v1/rpc'), `acessos: ${rest}`);
  assert.doesNotMatch(CONTENT, /\/rest\/v1\//);
  assert.doesNotMatch(CONTENT, /postMessage\(/);
});

test('Pages: _config.yml exclui SQL, docs, testes e fontes de servidor do site', () => {
  const cfg = fs.readFileSync(path.join(ROOT, '_config.yml'), 'utf8');
  for (const e of ['"*.sql"', '"*.txt"', '"*.md"', 'db', 'tests', 'worker', 'supabase']) {
    assert.match(cfg, new RegExp(`^\\s*-\\s*${e.replace(/[.*"]/g, c => '\\' + c)}\\s*$`, 'm'), e);
  }
});

test('painel: metas e destinatário usam cada um a sua RPC; o UPDATE direto só existe no fallback', () => {
  // Inventário estático complementar. O COMPORTAMENTO (payload real, erros,
  // fallback, estado local) é testado de verdade em tests/metas-painel.test.js.
  const corpo = nome => { const i = APP.indexOf(`async function ${nome}(`); assert.ok(i >= 0, nome); return APP.slice(i, APP.indexOf('\n}\n', i)); };
  assert.match(corpo('saveOrgGoals'), /sb\.rpc\('org_set_goals'/);
  assert.match(corpo('savePayRecipient'), /sb\.rpc\('org_set_pay_recipient'/);
  assert.doesNotMatch(corpo('saveOrgGoals'), /org_set_pay_recipient/);
  // nenhum outro ponto grava metas direto na tabela: só o helper do fallback
  const fora = [...APP.matchAll(/sb\.from\('orgs'\)\.update\(([^)]*)\)/g)]
    .filter(m => /settings/.test(m[1]))
    .map(m => APP.slice(0, m.index).split('\n').length)
    .filter(l => l !== APP.slice(0, APP.indexOf("sb.from('orgs').update({ settings }).eq('id',S.org.id).select('id')")).split('\n').length);
  // o outro UPDATE de settings é o card do CRM (dono) — ver inventário abaixo
  assert.equal(fora.length, 1, `gravações de settings fora do fallback: ${fora}`);
  // e nenhum ReferenceError latente: "settings" solto depois de salvar
  assert.doesNotMatch(APP, /S\.org\.settings=settings;/);
});

test('painel: as escritas diretas em public.orgs são só as quatro conhecidas', () => {
  // Inventário fechado: qualquer ponto NOVO de UPDATE em orgs reprova aqui e
  // precisa ser avaliado contra a policy da Fase A (dono/admin).
  //   1. doCreateOrg  — quem acabou de criar a equipe já é dono dela;
  //   2. saveOrgSettingsGoalsDirect — fallback de saveOrgGoals e de
  //      savePayRecipient, só enquanto as RPCs não existirem no banco;
  //   3. st-save (token do CRM) — card exclusivo do dono;
  //   4. st-auto/agendorAuto (ajuste do envio ao CRM) — mesmo card do dono;
  //   5. st-module (módulo de profissão) — seletor exclusivo do dono.
  // Quem prova o fechamento de verdade é o teste de banco "orgs_update":
  // depois da Fase A, membro comum, bloqueado e forasteiro recebem 0 linhas.
  const pontos = [...APP.matchAll(/sb\.from\('orgs'\)\.update\(([^)]*)\)/g)]
    .map(m => ({ linha: APP.slice(0, m.index).split('\n').length, campos: m[1].replace(/\s+/g, ' ').slice(0, 40) }));
  assert.equal(pontos.length, 5, `esperava 5 escritas diretas em orgs, achei ${pontos.length}: ${JSON.stringify(pontos)}`);
  const campos = pontos.map(p => p.campos).join(' | ');
  assert.match(campos, /module_answers/);   // doCreateOrg
  assert.match(campos, /settings/);          // fallback e st-save
  assert.match(campos, /module_id/);         // st-module
});
