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

test('painel: metas e destinatário do pagamento usam a RPC org_set_goals, com retorno ao caminho antigo', () => {
  // A Fase A fecha o UPDATE amplo em public.orgs (hoje qualquer membro ativo
  // pode alterar nome, token do CRM e código de convite). O que membro comum
  // realmente faz — salvar metas e escolher quem recebe — passa pela RPC.
  const fn = APP.slice(APP.indexOf('async function saveOrgGoals'), APP.indexOf('async function saveOrgGoals') + 1200);
  assert.match(fn, /sb\.rpc\('org_set_goals'/, 'a RPC é o caminho principal');
  assert.match(fn, /PGRST202|42883/, 'fallback só quando a RPC ainda não existe no banco');
  assert.match(fn, /sb\.from\('orgs'\)\.update/, 'fallback mantém o painel funcionando antes da Fase A');

  // nenhum outro ponto do painel grava metas direto na tabela
  const forasteiros = [];
  const re = /sb\.from\('orgs'\)\.update\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(APP))) {
    const linha = APP.slice(0, m.index).split('\n').length;
    const dentroDoFallback = Math.abs(linha - APP.slice(0, APP.indexOf('async function saveOrgGoals')).split('\n').length) < 15;
    if (/goals/.test(m[1]) && !dentroDoFallback) forasteiros.push(linha);
  }
  assert.deepEqual(forasteiros, [], 'sobrou gravação de metas fora da RPC');
});

test('painel: as escritas diretas em public.orgs são só as quatro conhecidas', () => {
  // Inventário fechado: qualquer ponto NOVO de UPDATE em orgs reprova aqui e
  // precisa ser avaliado contra a policy da Fase A (dono/admin).
  //   1. doCreateOrg  — quem acabou de criar a equipe já é dono dela;
  //   2. fallback de saveOrgGoals — só enquanto a RPC não existir no banco;
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
