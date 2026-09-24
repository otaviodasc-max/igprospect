// Testes do DIAGNOSTICO-00-somente-leitura.sql.
// Rodar:  cd tests/db && npm test  (ou node --test diagnostico.test.js)
//
// Executa TODOS os blocos num Postgres local (PGlite, PostgreSQL 17) montado
// a partir dos SQL do repositório mais o estado real da produção, e verifica:
//   • cada bloco roda sozinho (o SQL Editor mostra só o último resultado);
//   • nenhuma escrita;
//   • nenhum alias em palavra reservada (regra estática; ver o teste do bloco 10);
//   • nenhum retorno com nome, e-mail, telefone, token, join_code, UUID real
//     ou conteúdo de lead — só metadados e contagens agregadas;
//   • os bugs corrigidos na REV4 (blocos 8 e 10) não voltam.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDb, SECURITY_DIR } = require('./baseline');

const SQL = fs.readFileSync(path.join(SECURITY_DIR, 'DIAGNOSTICO-00-somente-leitura.sql'), 'utf8');

// Cada bloco começa no marcador de somente leitura e vai até o próximo.
function blocos(src) {
  const marcador = /set session characteristics as transaction read only;/gi;
  const partes = [];
  let m, ini = null;
  while ((m = marcador.exec(src))) {
    if (ini !== null) partes.push(src.slice(ini, m.index));
    ini = m.index;
  }
  if (ini !== null) partes.push(src.slice(ini));
  return partes.map((p, i) => ({ n: i + 1, sql: p.trim() })).filter(p => p.sql.length > 60);
}
const BLOCOS = blocos(SQL);
const semComentarios = s => s.replace(/--.*$/gm, '');
// consultas de um bloco, já sem o "set session characteristics"
const consultas = b => semComentarios(b.sql)
  .replace(/set session characteristics as transaction read only;/i, '')
  .split(/;\s*(?:\n|$)/).map(c => c.trim()).filter(Boolean);
const ESCRITA = /\b(insert\s+into|update\s+\w|delete\s+from|truncate|drop\s+\w|alter\s+\w|create\s+\w|grant\s|revoke\s|refresh\s+materialized)\b/i;
// colunas que jamais podem ser selecionadas (dados de pessoas/equipes)
const COLUNAS_PROIBIDAS = /\b(p\.email|l\.name|l\.username|l\.phone|l\.notes|o\.join_code|o\.agendor_token|pr\.email|raw_user_meta_data)\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
const TELEFONE = /\(\d{2}\)\s?\d{4,5}-?\d{4}/;

test('o arquivo tem os 13 blocos previstos, todos individualmente executáveis', () => {
  assert.ok(BLOCOS.length >= 13, `esperava ao menos 13 blocos, achei ${BLOCOS.length}`);
  for (const b of BLOCOS) {
    assert.match(b.sql, /^set session characteristics as transaction read only;/i,
      `bloco ${b.n} não começa pela trava de somente leitura`);
  }
});

test('nenhum bloco escreve e nenhum seleciona coluna com dado pessoal', () => {
  for (const b of BLOCOS) {
    const limpo = semComentarios(b.sql);
    assert.doesNotMatch(limpo, ESCRITA, `bloco ${b.n} tem comando de escrita`);
    assert.doesNotMatch(limpo, COLUNAS_PROIBIDAS, `bloco ${b.n} seleciona coluna sensível`);
  }
});

test('nenhum alias usa palavra reservada do PostgreSQL', () => {
  // as que quebram de verdade em "as <palavra>" (CONSTRAINT foi o caso real)
  const RESERVADAS = ['constraint', 'table', 'column', 'select', 'from', 'where', 'order', 'group',
    'default', 'check', 'using', 'and', 'or', 'not', 'null', 'all', 'any', 'case', 'when', 'end',
    'primary', 'foreign', 'references', 'unique', 'user', 'grant', 'to', 'as', 'on'];
  for (const b of BLOCOS) {
    for (const m of semComentarios(b.sql).matchAll(/\bas\s+([a-z_]+)\b/gi)) {
      assert.ok(!RESERVADAS.includes(m[1].toLowerCase()),
        `bloco ${b.n}: alias "${m[1]}" é palavra reservada`);
    }
  }
});

describe('execução real de cada bloco (PGlite = PostgreSQL 17)', () => {
  let db;
  before(async () => { db = await createDb(); });

  for (const b of blocos(SQL)) {
    test(`bloco ${b.n} roda sozinho, sem erro, e não devolve dado pessoal`, async () => {
      // cada comando do bloco, na ordem, como no SQL Editor
      const comandos = b.sql.split(/;\s*\n/).map(c => c.trim()).filter(c => c && !/^--/.test(semComentarios(c)));
      let ultimo = null;
      for (const c of comandos) {
        try { ultimo = await db.query(c.replace(/;$/, '')); }
        catch (e) { assert.fail(`bloco ${b.n} falhou: ${e.message}`); }
      }
      const texto = JSON.stringify(ultimo && ultimo.rows || []);
      assert.doesNotMatch(texto, EMAIL, `bloco ${b.n} devolveu e-mail`);
      assert.doesNotMatch(texto, TELEFONE, `bloco ${b.n} devolveu telefone`);
      // UUID só pode aparecer em definição de objeto (nenhum bloco devolve id de linha)
      if (UUID.test(texto)) assert.fail(`bloco ${b.n} devolveu UUID`);
    });
  }

  test('bloco 8 (CORRIGIDO): encontra os triggers reais, inclusive o de auth.users', async () => {
    const tabelas = blocos(SQL).find(b => /pg_get_triggerdef/.test(b.sql) && /tgrelid = any/.test(b.sql));
    const auth = blocos(SQL).find(b => /auth\.users'::regclass/.test(b.sql));
    const daTabela = (await db.query(consultas(tabelas)[0])).rows.map(r => `${r.tabela}.${r.trigger}`);
    for (const esperado of ['leads.leads_called_at', 'leads.leads_create_deal', 'leads.leads_stage_dates',
                            'leads.leads_status_changed_at', 'profiles.profiles_guard']) {
      assert.ok(daTabela.some(t => t.endsWith(esperado)), `faltou ${esperado} — achei: ${daTabela.join(', ')}`);
    }
    const doAuth = (await db.query(consultas(auth)[0])).rows.map(r => r.trigger);
    assert.ok(doAuth.includes('on_auth_user_created'), 'trigger de criação de perfil não encontrado');
  });

  test('bloco 8: a consulta ANTIGA (comparação textual) voltava vazia — o bug', async () => {
    const antiga = `select t.tgname from pg_trigger t where not t.tgisinternal
      and t.tgrelid::regclass::text in ('public.leads','public.calls','public.deals','public.messages',
        'public.profiles','public.orgs','public.org_members','public.weekly_payments','public.push_subscriptions')`;
    const nova = `select t.tgname from pg_trigger t where not t.tgisinternal
      and t.tgrelid = any (array['public.leads'::regclass,'public.calls'::regclass,'public.deals'::regclass,
        'public.messages'::regclass,'public.profiles'::regclass,'public.orgs'::regclass,
        'public.org_members'::regclass,'public.weekly_payments'::regclass,'public.push_subscriptions'::regclass])`;
    assert.equal((await db.query(antiga)).rows.length, 0, 'a consulta antiga deveria vir vazia (era o bug)');
    assert.ok((await db.query(nova)).rows.length >= 5, 'a consulta nova precisa achar os triggers');
    assert.doesNotMatch(SQL, /tgrelid::regclass::text in \(/, 'o arquivo não pode voltar à comparação textual');
  });

  test('bloco 10: o alias reservado saiu do arquivo (regra estática) e o novo roda', async () => {
    // Nota técnica: o PostgreSQL puro ACEITA palavra reservada depois de AS
    // (ColLabel), e o PGlite confirma isso — mas o editor de SQL do Supabase
    // recusou "conname as constraint" com erro de sintaxe na produção
    // (PostgreSQL 17.6). Por isso a regra aqui é ESTÁTICA: o arquivo não pode
    // usar esse alias, e o alias novo precisa funcionar de verdade.
    assert.doesNotMatch(SQL, /\bas constraint\b/i, 'o arquivo não pode voltar ao alias reservado');
    assert.match(SQL, /as nome_constraint/);
    const r = await db.query('select conname as nome_constraint from pg_constraint limit 1');
    assert.ok(Array.isArray(r.rows));
  });

  test('bloco 10: constraints e índices são achados por regclass', async () => {
    const b10 = blocos(SQL).find(b => /pg_get_constraintdef/.test(b.sql));
    const cons = (await db.query(consultas(b10)[0])).rows;
    assert.ok(cons.length > 0, 'nenhuma constraint encontrada');
    assert.ok(cons.some(c => c.nome_constraint === 'leads_pkey'));
  });

  test('bloco 11 confirma a unicidade compatível com on conflict (org_id, ext_id)', async () => {
    const b11 = blocos(SQL).find(b => /veredito/.test(b.sql));
    const r = await db.query(consultas(b11)[0]);
    assert.ok(r.rows.some(x => /COMPATÍVEL/.test(x.veredito)), 'índice único (org_id, ext_id) não confirmado');
  });

  test('bloco 12 devolve só contagens agregadas', async () => {
    const b12 = blocos(SQL).find(b => /metrica/.test(b.sql));
    const r = await db.query(consultas(b12)[0]);
    assert.ok(r.rows.length >= 10);
    for (const linha of r.rows) {
      assert.equal(typeof linha.metrica, 'string');
      assert.ok(typeof linha.valor === 'number' || typeof linha.valor === 'bigint' || /^\d+$/.test(String(linha.valor)),
        `métrica "${linha.metrica}" não é contagem`);
    }
  });
});

test('bloco 5 procura TODOS os nomes que a Fase A se recusa a sobrescrever (inclusive as RPCs de metas)', () => {
  // A precondição 0.4 da Fase A lista os nomes novos; o bloco 5 é quem deixa
  // o proprietário conferir isso ANTES de rodar a fase. As listas têm de bater.
  const A = fs.readFileSync(path.join(SECURITY_DIR, 'A-01-aditiva-compativel.sql'), 'utf8');
  const secao04 = A.slice(A.indexOf('------------------------------------------------------------------ 0.4'),
                          A.indexOf('------------------------------------------------------------------ 0.5'));
  const nomesDaFase = [...secao04.matchAll(/'([a-z_0-9]+)'/g)].map(m => m[1]);
  assert.ok(nomesDaFase.includes('org_set_goals') && nomesDaFase.includes('org_set_pay_recipient'));
  const b5 = blocos(SQL).find(b => /seguranca_estado_anterior/.test(b.sql) && /ext2/.test(b.sql));
  const faltam = nomesDaFase.filter(n => !b5.sql.includes(`'${n}'`));
  assert.deepEqual(faltam, [], 'nomes que a Fase A recusa mas o diagnóstico não procura');
});

test('bloco 5 acha org_set_goals e org_set_pay_recipient quando eles já existem', async () => {
  const db = await createDb({ phases: ['A-01-aditiva-compativel.sql'] });
  const b5 = blocos(SQL).find(b => /seguranca_estado_anterior/.test(b.sql) && /ext2/.test(b.sql));
  const r = await db.query(consultas(b5)[0]);
  const objs = r.rows.map(x => x.objeto);
  assert.ok(objs.some(o => o.startsWith('org_set_goals(')), 'org_set_goals');
  assert.ok(objs.some(o => o.startsWith('org_set_pay_recipient(')), 'org_set_pay_recipient');
});
