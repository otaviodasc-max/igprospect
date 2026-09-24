// Testes de isolamento entre equipes NO BANCO (RLS, grants, RPCs, triggers).
// Rodam num Postgres em memória (PGlite) montado a partir dos SQL do
// repositório — nunca conectam no Supabase nem em dado real.
//
//   cd tests/db && npm install && npm test
//
// Cada cenário roda contra os estados do banco ao longo da migração:
//   baseline  = como está hoje (SQL do repositório, sem db/seguranca)
//   A         = + A-01-aditiva-compativel.sql
//   A+C       = + C-01-revogar-rpcs-anonimas.sql
//   A+C+D     = + D-01-restricoes-finais.sql
// Onde a baseline é vulnerável, o teste REGISTRA a falha atual e prova que a
// fase correspondente fecha a brecha.

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDb, SECURITY_DIR } = require('./baseline');

const PHASES = {
  baseline: [],
  A: ['A-01-aditiva-compativel.sql'],
  'A+C': ['A-01-aditiva-compativel.sql', 'C-01-revogar-rpcs-anonimas.sql'],
  'A+C+D': ['A-01-aditiva-compativel.sql', 'C-01-revogar-rpcs-anonimas.sql', 'D-01-restricoes-finais.sql'],
};
const SHARED_EXT_ID = '1700000000000';
const SHARED_USER = 'mesmo.perfil';

// ------------------------------------------------------------------ helpers
async function as(db, uid, fn) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid || '']);
  await db.exec(uid ? 'set role authenticated' : 'set role anon');
  try { return await fn(); }
  finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}
// Objetos vindos do banco: compara por valor (JSON), não por referência.
const same = (a, b, msg) => assert.equal(JSON.stringify(a), JSON.stringify(b), msg);
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const rows = async (db, sql, params) => (await db.query(sql, params)).rows;

// Duas equipes fictícias (A e B), um usuário em cada, um bloqueado em A e um
// membro de A que depois é removido. Tudo local, nomes/e-mails de mentira.
async function seed(db) {
  const u = {};
  for (const k of ['a', 'b', 'bloq', 'removido']) {
    u[k] = (await one(db, 'insert into auth.users(email) values ($1) returning id', [`${k}@example.test`])).id;
  }
  // handle_new_user cria o perfil como 'pending'; o trigger de proteção do
  // perfil não deixa mudar status fora do admin — desliga só neste setup.
  await db.exec("set session_replication_role = replica; update public.profiles set status = 'active'; set session_replication_role = origin;");
  const orgA = (await as(db, u.a, () => one(db, "select public.create_org('Equipe A (teste)', 'consorcio') as id"))).id;
  const orgB = (await as(db, u.b, () => one(db, "select public.create_org('Equipe B (teste)', 'consorcio') as id"))).id;
  const codeA = (await one(db, 'select join_code from public.orgs where id = $1', [orgA])).join_code;
  const codeB = (await one(db, 'select join_code from public.orgs where id = $1', [orgB])).join_code;
  for (const k of ['bloq', 'removido']) await as(db, u[k], () => db.query('select public.join_org($1)', [codeA]));
  await db.exec(`set session_replication_role = replica; update public.profiles set status = 'blocked' where id = '${u.bloq}'; set session_replication_role = origin;`);
  const plA = (await one(db, 'select id from public.org_pipelines where org_id = $1 and is_default', [orgA])).id;
  const plB = (await one(db, 'select id from public.org_pipelines where org_id = $1 and is_default', [orgB])).id;
  // Um lead em cada equipe com o MESMO @usuário e o MESMO ext_id.
  const leadA = (await as(db, u.a, () => one(db,
    "insert into public.leads(org_id, name, username, ext_id, status, pipeline_id) values ($1, 'Lead A', $2, $3, 'novo', $4) returning id",
    [orgA, SHARED_USER, SHARED_EXT_ID, plA]))).id;
  const leadB = (await as(db, u.b, () => one(db,
    "insert into public.leads(org_id, name, username, ext_id, status, pipeline_id) values ($1, 'Lead B', $2, $3, 'novo', $4) returning id",
    [orgB, SHARED_USER, SHARED_EXT_ID, plB]))).id;
  return { u, orgA, orgB, codeA, codeB, plA, plB, leadA, leadB };
}
const leadB = (db, f) => one(db, 'select * from public.leads where id = $1', [f.leadB]);
const hasPhase = (name, p) => name.split('+').includes(p);

// ------------------------------------------------------------------ cenários
for (const [state, phases] of Object.entries(PHASES)) {
  describe(`banco: ${state}`, () => {
    let db, f;
    before(async () => { db = await createDb({ phases }); f = await seed(db); });

    test('1. usuário de A não lê leads de B', async () => {
      const r = await as(db, f.u.a, () => rows(db, 'select org_id from public.leads'));
      assert.ok(r.length > 0 && r.every(x => x.org_id === f.orgA));
      const n = await as(db, f.u.a, () => one(db, 'select count(*)::int n from public.leads where org_id = $1', [f.orgB]));
      assert.equal(n.n, 0);
    });

    test('2. usuário de A não insere lead em B', async () => {
      await assert.rejects(as(db, f.u.a, () => db.query(
        "insert into public.leads(org_id, name) values ($1, 'invasor')", [f.orgB])), /row-level security|não é membro/);
    });

    test('3. usuário de A não atualiza lead de B', async () => {
      const r = await as(db, f.u.a, () => db.query("update public.leads set name = 'alterado' where id = $1", [f.leadB]));
      assert.equal(r.affectedRows, 0);
      assert.equal((await leadB(db, f)).name, 'Lead B');
    });

    test('4. usuário de A não exclui lead de B', async () => {
      const r = await as(db, f.u.a, () => db.query('delete from public.leads where id = $1', [f.leadB]));
      assert.equal(r.affectedRows, 0);
      assert.ok(await leadB(db, f));
    });

    test('5/6. mesmo @usuário e mesmo ext_id em A e B: atualizar em A não toca B', async () => {
      if (!hasPhase(state, 'C')) {
        // caminho da extensão 1.10.4 (anon + código de A)
        // parâmetros NOMEADOS, como o PostgREST manda (posicional é ambíguo
        // entre as sobrecargas antigas que ainda existem)
        await as(db, null, () => db.query(`select public.extension_update_lead(p_code => $1, p_ext_id => $2,
          p_status => 'contato', p_phone => '1199', p_name => 'Novo nome', p_agendor_person_id => null,
          p_agendor_deal_id => null, p_agendor_funnel => null, p_notes => null)`, [f.codeA, SHARED_EXT_ID]));
      }
      if (hasPhase(state, 'A')) {
        const n = await as(db, f.u.a, () => one(db, "select public.ext2_update_lead($1, $2, 'contato', '1188') n", [f.orgA, SHARED_EXT_ID]));
        assert.equal(n.n, 1);
      }
      const b = await leadB(db, f);
      assert.equal(b.status, 'novo'); assert.equal(b.phone, null); assert.equal(b.name, 'Lead B');
      if (state !== 'baseline') {
        const a = await one(db, 'select status from public.leads where id = $1', [f.leadA]);
        assert.equal(a.status, 'contato');
      }
    });

    test('7. lead sem org_id', async () => {
      if (hasPhase(state, 'D')) {
        await assert.rejects(as(db, f.u.a, () => db.query("insert into public.leads(name) values ('sem equipe')")), /null value in column "org_id"|row-level security/);
      } else {
        // VULNERABILIDADE ATUAL (fechada na Fase D): o default my_org() escolhe
        // a equipe ativa em silêncio.
        const r = await as(db, f.u.a, () => one(db, "insert into public.leads(name) values ('sem equipe') returning org_id"));
        assert.equal(r.org_id, f.orgA);
      }
    });

    test('8. org_id vindo do cliente é validado', async () => {
      // lead de A usando funil de B
      const p = as(db, f.u.a, () => db.query("insert into public.leads(org_id, name, pipeline_id) values ($1, 'x', $2)", [f.orgA, f.plB]));
      // negociação de A apontando para lead de B
      const d = as(db, f.u.a, () => db.query('insert into public.deals(org_id, lead_id) values ($1, $2)', [f.orgA, f.leadB]));
      // mover lead de equipe mesmo por caminho que ignora RLS (dono/SECURITY DEFINER)
      const solto = (await as(db, f.u.a, () => one(db, "insert into public.leads(org_id, name) values ($1, 'pra mover') returning id", [f.orgA]))).id;
      const m = db.query('update public.leads set org_id = $1 where id = $2', [f.orgB, solto]);
      if (hasPhase(state, 'A')) {
        await assert.rejects(p, /Funil de outra equipe/);
        await assert.rejects(d, /Lead de outra equipe/);
        await assert.rejects(m, /não pode ser alterado/);
        await assert.rejects(as(db, f.u.a, () => db.query("select public.ext2_add_lead($1, 'z1', 'x')", [f.orgB])), /Sem acesso a esta equipe/);
        await assert.rejects(as(db, null, () => db.query("select public.ext2_add_lead($1, 'z2', 'x')", [f.orgA])), /permission denied/);
      } else {
        // VULNERABILIDADES ATUAIS (fechadas na Fase A)
        await p; await d; await m;
        await db.query('update public.leads set org_id = $1 where id = $2', [f.orgA, solto]); // desfaz no banco de teste
      }
    });

    test('usuário bloqueado não grava; membro removido perde acesso', async () => {
      const ins = as(db, f.u.bloq, () => db.query("insert into public.leads(org_id, name) values ($1, 'do bloqueado')", [f.orgA]));
      // na Fase D a trava de autor recusa antes do RLS — as duas recusas valem
      if (hasPhase(state, 'A')) await assert.rejects(ins, /row-level security|não é membro/);
      else await ins; // VULNERABILIDADE ATUAL: is_active() só valia na leitura
      await as(db, f.u.a, () => db.query('select public.remove_team_member($1)', [f.u.removido]));
      const n = await as(db, f.u.removido, () => one(db, 'select count(*)::int n from public.leads'));
      assert.equal(n.n, 0);
      if (hasPhase(state, 'A')) {
        await assert.rejects(as(db, f.u.removido, () => db.query('select * from public.ext2_list_leads($1)', [f.orgA])), /Sem acesso/);
      }
    });

    test('11. RPCs anônimas por código de equipe: mapeadas e revogadas na Fase C', async () => {
      const LEGACY = ['org_by_join_code', 'org_members_by_join_code', 'org_pipeline_by_join_code', 'org_leads_by_join_code',
        'extension_add_lead', 'extension_update_lead', 'extension_delete_lead'];
      const anonExec = await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')`);
      const names = new Set(anonExec.map(r => r.proname));
      for (const l of LEGACY) assert.equal(names.has(l), !hasPhase(state, 'C'), l);
      if (hasPhase(state, 'A')) {
        for (const n of ['admin_delete_org', 'admin_delete_user', 'create_org', 'join_org', 'switch_org', 'ext2_add_lead']) assert.ok(!names.has(n), n);
      }
      if (hasPhase(state, 'C')) {
        // o que sobra pra anon: só helpers usados dentro do RLS e funções de trigger (não chamáveis direto)
        const allowed = new Set(['my_org', 'is_active', 'is_org_owner', 'is_platform_admin', 'handle_new_user',
          'guard_profile_update', 'ensure_deal_for_lead']);
        assert.deepEqual([...names].filter(n => !allowed.has(n)), []);
        await assert.rejects(as(db, null, () => db.query('select * from public.org_by_join_code($1)', [f.codeA])), /permission denied/);
      }
    });

    test('12. fluxo da extensão 1.10.4 funciona enquanto a Fase C não roda', { skip: hasPhase(state, 'C') }, async () => {
      await as(db, null, async () => {
        const org = await one(db, 'select * from public.org_by_join_code($1)', [f.codeA]);
        assert.equal(org.id, f.orgA); assert.ok('agendor_token' in org);
        const mem = await rows(db, 'select * from public.org_members_by_join_code($1)', [f.codeA]);
        assert.ok(mem.length > 0 && mem.every(m => m.user_id && m.name));
        if (hasPhase(state, 'A')) assert.ok(mem.every(m => m.email === null), 'e-mail não sai mais pra anon');
        const pl = await one(db, 'select * from public.org_pipeline_by_join_code($1)', [f.codeA]);
        assert.ok(Array.isArray(pl.stages));
        await db.query("select public.extension_add_lead($1, 'ext-112', 'Via 1.10.4', 'via.ext', '', '', '', 'novo', now(), $2)", [f.codeA, f.u.a]);
        const pulled = await rows(db, 'select * from public.org_leads_by_join_code($1, 500, 0)', [f.codeA]);
        assert.ok(pulled.some(l => l.ext_id === 'ext-112'));
        await db.query("select public.extension_update_lead($1, 'ext-112', 'chamado', null, null, null, null, null, 'obs')", [f.codeA]);
        await db.query("select public.extension_delete_lead($1, 'ext-112')", [f.codeA]);
      });
      const b = await leadB(db, f);
      assert.equal(b.status, 'novo');
    });

    test('13. operações normais do painel (leads, negociações, ligações, chat, pagamentos)', async () => {
      await as(db, f.u.a, async () => {
        const l = await one(db, "insert into public.leads(org_id, name, username, status, pipeline_id) values ($1, 'Normal', 'normal', 'novo', $2) returning id", [f.orgA, f.plA]);
        await db.query("update public.leads set status = 'contato' where id = $1 and org_id = $2", [l.id, f.orgA]);
        const deal = await one(db, 'select id, org_id from public.deals where lead_id = $1', [l.id]);
        assert.equal(deal.org_id, f.orgA, 'negociação automática ao chegar em contato');
        await db.query("update public.deals set status = 'negociando' where id = $1 and org_id = $2", [deal.id, f.orgA]);
        const c = await one(db, "insert into public.calls(org_id, lead_id, name, outcome) values ($1, $2, 'Normal', 'interessado') returning id", [f.orgA, l.id]);
        await db.query('update public.calls set notes = $1 where id = $2 and org_id = $3', ['ok', c.id, f.orgA]);
        await db.query('delete from public.calls where id = $1 and org_id = $2', [c.id, f.orgA]);
        await db.query("insert into public.messages(org_id, body, author_name) values ($1, 'oi', 'A')", [f.orgA]);
        assert.ok((await rows(db, 'select id from public.messages where org_id = $1', [f.orgA])).length > 0);
        await db.query(`insert into public.weekly_payments(org_id, member_id, week_start, week_end) values ($1, $2, current_date, current_date + 6)
          on conflict (org_id, member_id, week_start) do update set total = 1`, [f.orgA, f.u.a]);
        await db.query('delete from public.deals where id = $1 and org_id = $2', [deal.id, f.orgA]);
        await db.query('delete from public.leads where id = $1 and org_id = $2', [l.id, f.orgA]);
      });
    });

    test('RPCs autenticadas ext2_* (caminho da extensão com login)', { skip: !hasPhase(state, 'A') }, async () => {
      await as(db, f.u.a, async () => {
        const orgs = await rows(db, 'select * from public.ext2_my_orgs()');
        assert.deepEqual(orgs.map(o => o.org_id), [f.orgA]);
        const ctx = await one(db, 'select * from public.ext2_org_context($1)', [f.orgA]);
        assert.equal(ctx.pipeline_id, f.plA);
        const mem = await rows(db, 'select * from public.ext2_org_members($1)', [f.orgA]);
        assert.ok(mem.length > 0 && !('email' in mem[0]));
        const id = (await one(db, "select public.ext2_add_lead($1, 'ext2-1', 'Via ext2', 'via.ext2') id", [f.orgA])).id;
        assert.ok(id);
        const again = (await one(db, "select public.ext2_add_lead($1, 'ext2-1', 'Dup') id", [f.orgA])).id;
        assert.equal(again, null, 'mesmo org_id+ext_id não duplica');
        const list = await rows(db, 'select * from public.ext2_list_leads($1, 500, 0)', [f.orgA]);
        assert.ok(list.some(l => l.ext_id === 'ext2-1'));
        assert.equal((await one(db, "select public.ext2_delete_lead($1, 'ext2-1') n", [f.orgA])).n, 1);
        assert.equal((await one(db, 'select public.ext2_delete_lead($1, $2) n', [f.orgA, 'inexistente'])).n, 0);
      });
      const created = await one(db, "select count(*)::int n from public.leads where ext_id = 'ext2-1'");
      assert.equal(created.n, 0);
      // created_by vem do login, nunca do cliente
      await as(db, f.u.a, () => db.query("select public.ext2_add_lead($1, 'ext2-2', 'Autor')", [f.orgA]));
      assert.equal((await one(db, "select created_by from public.leads where ext_id = 'ext2-2'")).created_by, f.u.a);
    });
  });
}

// ------------------------------------------------------------------ estático
test('14. migrations não apagam, movem nem corrigem dados', () => {
  const files = fs.readdirSync(SECURITY_DIR).filter(f => f.endsWith('.sql'));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const isRollback = /rollback/i.test(f);
    const src = fs.readFileSync(path.join(SECURITY_DIR, f), 'utf8');
    // tira comentários e corpos de função ($$ ... $$): o que sobra é o que a
    // migration EXECUTA diretamente.
    const top = src.replace(/--.*$/gm, '').replace(/\$\$[\s\S]*?\$\$/g, '$$');
    // escrita na própria tabela de controle da migration é permitida:
    // ela só guarda grants/policies/definições anteriores, para o rollback exato
    const semControle = top.replace(/(insert\s+into|delete\s+from)\s+public\.seguranca_estado_anterior/gi, '')
                           .replace(/drop\s+table\s+public\.seguranca_estado_anterior/gi, '');
    const bad = semControle.match(/\b(delete\s+from|truncate|update\s+public\.|insert\s+into|drop\s+(table|schema|column|database)|alter\s+table\s+\S+\s+drop\s+column)\b/gi);
    assert.equal(bad, null, `${f}: ${bad}`);
    // funções criadas pelas migrations: SECURITY DEFINER sempre com search_path fixo
    for (const m of src.matchAll(/create\s+or\s+replace\s+function[\s\S]*?as\s+\$\$/gi)) {
      if (!isRollback && /security\s+definer/i.test(m[0])) assert.match(m[0], /set\s+search_path\s*=\s*public,\s*pg_temp/i, `${f}: search_path`);
    }
  }
});

test('rollbacks aplicam limpos na ordem D → C → A e devolvem o estado anterior', async () => {
  const db = await createDb({ phases: [...PHASES['A+C+D'], 'D-01-rollback.sql', 'C-01-rollback.sql', 'A-01-rollback.sql'] });
  const f = await seed(db);
  // default my_org() de volta
  const d = await one(db, "select column_default from information_schema.columns where table_schema='public' and table_name='leads' and column_name='org_id'");
  assert.match(d.column_default, /my_org\(\)/);
  // extensão 1.10.4 volta a funcionar (e-mail volta a sair, como antes)
  const org = await as(db, null, () => one(db, 'select * from public.org_by_join_code($1)', [f.codeA]));
  assert.equal(org.id, f.orgA);
  // nada de ext2_/travas sobrando
  const sobras = await rows(db, `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (proname like 'ext2\\_%' or proname in ('is_org_member','assert_org_member','guard_leads_org','guard_child_org','guard_leads_author'))`);
  assert.deepEqual(sobras, []);
  // e o isolamento básico continua
  const n = await as(db, f.u.a, () => one(db, 'select count(*)::int n from public.leads where org_id = $1', [f.orgB]));
  assert.equal(n.n, 0);
});

/* ------------------------------------------------------------------ */
/* PRECONDIÇÕES: a migration tem que ABORTAR sem mudar nada            */
/* ------------------------------------------------------------------ */
const A_FILE = 'A-01-aditiva-compativel.sql';
const applyFile = async (db, f) => {
  try { await db.exec(fs.readFileSync(path.join(SECURITY_DIR, f), 'utf8')); }
  finally { try { await db.exec('rollback'); } catch { /* sem transação aberta */ } }
};
// Estado observável antes/depois: nada da Fase A pode existir, e as policies
// e a função legada têm que continuar como estavam.
async function estadoIntacto(db) {
  const novos = await rows(db, `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and (p.proname like 'ext2\\_%' or p.proname in ('is_org_member','assert_org_member','guard_leads_org','guard_child_org'))`);
  const trig = await rows(db, `select tgname from pg_trigger where not tgisinternal
    and tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')`);
  const tab = await one(db, "select to_regclass('public.seguranca_estado_anterior') is null as sem_tabela");
  const pol = await one(db, `select with_check from pg_policies where schemaname='public' and tablename='leads' and policyname='leads_org'`);
  const email = await one(db, `select (prosrc like '%p.email%') as devolve_email from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname='org_members_by_join_code'`);
  const anon = await one(db, "select has_function_privilege('anon','public.create_org(text,text)','EXECUTE') as tem");
  return { novos: novos.length, trig: trig.length, semTabela: tab.sem_tabela, check: pol.with_check,
           devolveEmail: email.devolve_email, anonCreateOrg: anon.tem };
}

describe('precondições da Fase A abortam antes de qualquer alteração', () => {
  const cenarios = [
    ['objeto novo homônimo já existe',
      "create function public.is_org_member(p uuid) returns boolean language sql as $f$ select true $f$;",
      /já existe objeto com nome novo/],
    ['policy adicional permissiva numa tabela afetada',
      "create policy leads_extra on public.leads for select using (true);",
      /policies divergentes/],
    ['grant diferente do esperado numa RPC do painel',
      "revoke execute on function public.create_org(text,text) from anon;",
      /grants diferentes do esperado/],
    ['definição de org_members_by_join_code divergente',
      `create or replace function public.org_members_by_join_code(p_code text)
         returns table(user_id uuid, name text, email text) language sql stable security definer
         set search_path = public as $f$ select p.id, p.name, p.email from public.profiles p limit 0 $f$;`,
      /definição de org_members_by_join_code divergente/],
    ['índice único (org_id, ext_id) ausente',
      "drop index public.leads_org_extid_uniq;",
      /não há índice único/],
    ['policy esperada ausente',
      "drop policy messages_select on public.messages;",
      /policies divergentes/],
  ];
  for (const [nome, sabotagem, mensagem] of cenarios) {
    test(nome, async () => {
      const db = await createDb();
      await seed(db);
      await db.exec(sabotagem);
      const antes = await estadoIntacto(db);
      await assert.rejects(applyFile(db, A_FILE), mensagem);
      const depois = await estadoIntacto(db);
      same(depois, antes);                                   // nada mudou
      assert.equal(depois.semTabela, true, 'não criou a tabela de estado');
      assert.equal(depois.trig, 0, 'não criou trigger');
    });
  }
});

test('Fase D aborta se org_id aceitar nulo, sem alterar dados nem defaults', async () => {
  const db = await createDb({ phases: PHASES['A+C'] });
  await seed(db);
  await db.exec('alter table public.calls alter column org_id drop not null');
  await assert.rejects(applyFile(db, 'D-01-restricoes-finais.sql'), /aceita nulo em: calls/);
  const d = await one(db, `select column_default from information_schema.columns
    where table_schema='public' and table_name='leads' and column_name='org_id'`);
  assert.match(d.column_default, /my_org\(\)/, 'default preservado');
  assert.equal((await one(db, "select to_regprocedure('public.guard_leads_author()') is null as sem")).sem, true);
});

test('Fase D aborta se o default de org_id for diferente do esperado', async () => {
  const db = await createDb({ phases: PHASES['A+C'] });
  await seed(db);
  await db.exec("alter table public.messages alter column org_id set default '00000000-0000-0000-0000-000000000000'::uuid");
  await assert.rejects(applyFile(db, 'D-01-restricoes-finais.sql'), /default de org_id diferente do esperado/);
});

test('rollback A não amplia privilégio nenhum (ACL idêntica à de antes)', async () => {
  const acl = db => rows(db, `select p.oid::regprocedure::text f,
      coalesce((select string_agg(distinct coalesce(nullif(a.grantee::regrole::text,'-'),'public'), ',' order by coalesce(nullif(a.grantee::regrole::text,'-'),'public'))
        from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.privilege_type='EXECUTE'), '') papeis
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by 1`);
  const pols = db => rows(db, `select tablename||'.'||policyname||'|'||cmd||'|'||permissive||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') s
    from pg_policies where schemaname='public' order by 1`);
  const db = await createDb();
  await seed(db);
  const aclAntes = await acl(db), polAntes = await pols(db);
  await db.exec(fs.readFileSync(path.join(SECURITY_DIR, A_FILE), 'utf8'));
  await db.exec(fs.readFileSync(path.join(SECURITY_DIR, 'A-01-rollback.sql'), 'utf8'));
  same(await acl(db), aclAntes);
  same(await pols(db), polAntes);
  assert.equal((await one(db, "select to_regclass('public.seguranca_estado_anterior') is null as sem")).sem, true);
});

test('rollback A se recusa a rodar sem o estado registrado', async () => {
  const db = await createDb({ phases: [A_FILE] });
  await db.exec('drop table public.seguranca_estado_anterior');
  await assert.rejects(applyFile(db, 'A-01-rollback.sql'), /não existe|não foi aplicada/);
});

test('usuário em várias equipes: listagem legada x nova, e isolamento mantido', async () => {
  const db = await createDb({ phases: [A_FILE] });
  const f = await seed(db);
  // o usuário de A também entra na equipe B (fica com B como equipe ATIVA)
  await as(db, f.u.a, () => db.query('select public.join_org($1)', [f.codeB]));
  const orgs = await as(db, f.u.a, () => rows(db, 'select org_id from public.ext2_my_orgs()'));
  same(orgs.map(o => o.org_id).sort(), [f.orgA, f.orgB].sort());
  // legado (profiles.org_id = equipe ativa): ele some da lista de A
  const legado = await as(db, null, () => rows(db, 'select user_id from public.org_members_by_join_code($1)', [f.codeA]));
  assert.ok(!legado.some(m => m.user_id === f.u.a), 'legado lista só quem está com a equipe aberta');
  // novo (org_members): ele aparece nas duas equipes
  for (const org of [f.orgA, f.orgB]) {
    const novo = await as(db, f.u.a, () => rows(db, 'select user_id from public.ext2_org_members($1)', [org]));
    assert.ok(novo.some(m => m.user_id === f.u.a), 'ext2 lista todos os membros');
  }
  // e o isolamento continua: com B ativa, ele não lê os leads de A pelo RLS
  const n = await as(db, f.u.a, () => one(db, 'select count(*)::int n from public.leads where org_id = $1', [f.orgA]));
  assert.equal(n.n, 0);
  // mas pelas ext2_* ele opera nas duas equipes de que é membro
  assert.equal((await as(db, f.u.a, () => one(db, "select public.ext2_add_lead($1,'multi-1','Multi') id", [f.orgA]))).id != null, true);
  assert.equal((await as(db, f.u.a, () => one(db, "select public.ext2_delete_lead($1,'multi-1') n", [f.orgA]))).n, 1);
});

test('Fase D: autor bloqueado ou pendente é recusado', async () => {
  const db = await createDb({ phases: PHASES['A+C+D'] });
  const f = await seed(db);
  // bloqueado é membro da equipe A, mas não está ativo
  await assert.rejects(db.query("insert into public.leads(org_id, name, created_by) values ($1,'x',$2)", [f.orgA, f.u.bloq]),
    /Autor do lead não é membro ativo/);
  // e o autor ativo continua passando
  await db.query("insert into public.leads(org_id, name, created_by) values ($1,'ok',$2)", [f.orgA, f.u.a]);
});

/* ------------------------------------------------------------------ */
/* orgs_update: estado real da produção x estado pretendido (REV4)      */
/* ------------------------------------------------------------------ */
const nomeOrg = (db, org) => one(db, 'select name from public.orgs where id = $1', [org]);

describe('orgs_update', () => {
  test('produção (antes da Fase A): QUALQUER membro ativo altera a organização', async () => {
    const db = await createDb();           // espelho da produção
    const f = await seed(db);
    // membro comum (entrou por código, não é dono)
    const r = await as(db, f.u.removido, () => db.query("update public.orgs set name = 'mexido por membro' where id = $1", [f.orgA]));
    assert.equal(r.affectedRows, 1, 'é exatamente a superfície que a Fase A fecha');
    assert.equal((await nomeOrg(db, f.orgA)).name, 'mexido por membro');
  });

  test('depois da Fase A: só dono e admin da plataforma; membro, bloqueado e forasteiro não', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    const tenta = (uid, nome) => as(db, uid, () => db.query('update public.orgs set name = $1 where id = $2', [nome, f.orgA]));

    assert.equal((await tenta(f.u.removido, 'x')).affectedRows, 0, 'membro comum não altera');
    assert.equal((await tenta(f.u.bloq, 'x')).affectedRows, 0, 'bloqueado não altera');
    assert.equal((await tenta(f.u.b, 'x')).affectedRows, 0, 'usuário de outra equipe não altera');
    assert.equal((await nomeOrg(db, f.orgA)).name, 'Equipe A (teste)');

    assert.equal((await tenta(f.u.a, 'renomeada pelo dono')).affectedRows, 1, 'dono altera');
    assert.equal((await nomeOrg(db, f.orgA)).name, 'renomeada pelo dono');

    // admin da plataforma continua com acesso
    await db.exec(`set session_replication_role = replica; update public.profiles set platform_role='admin' where id='${f.u.b}'; set session_replication_role = origin;`);
    assert.equal((await tenta(f.u.b, 'ajustada pelo admin')).affectedRows, 1, 'admin da plataforma altera');
  });

  test('depois da Fase A: WITH CHECK impede o dono de jogar a linha para fora da própria policy', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await assert.rejects(
      as(db, f.u.a, () => db.query('update public.orgs set id = $1 where id = $2', [f.orgB, f.orgA])),
      /row-level security|duplicate key/);
  });

  test('divergência futura da policy faz a Fase A abortar antes de qualquer alteração', async () => {
    // producao:false = banco com a policy do repositório (dono), diferente da
    // que a fase espera encontrar. É o caso "alguém rodou outro SQL antes".
    const db = await createDb({ producao: false });
    await seed(db);
    const antes = await estadoIntacto(db);
    await assert.rejects(applyFile(db, A_FILE), /policies divergentes/);
    same(await estadoIntacto(db), antes);
  });
});

/* ------------------------------------------------------------------ */
/* Padrão histórico: negociação de uma equipe apontando lead de outra   */
/* ------------------------------------------------------------------ */
describe('negociações e ligações cruzadas (o padrão das 50 linhas de 16/09)', () => {
  test('antes da Fase A o cruzamento era possível (é o histórico já limpo)', async () => {
    const db = await createDb();
    const f = await seed(db);
    const d = await as(db, f.u.a, () => one(db,
      'insert into public.deals(org_id, lead_id) values ($1, $2) returning org_id', [f.orgA, f.leadB]));
    assert.equal(d.org_id, f.orgA, 'negociação na equipe A apontando lead da equipe B');
  });

  test('depois da Fase A o mesmo padrão é impossível, por qualquer caminho', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);

    // 1) INSERT de negociação com lead de outra equipe
    await assert.rejects(as(db, f.u.a, () => db.query('insert into public.deals(org_id, lead_id) values ($1, $2)', [f.orgA, f.leadB])),
      /Lead de outra equipe/);
    // 2) INSERT de ligação com lead de outra equipe
    await assert.rejects(as(db, f.u.a, () => db.query("insert into public.calls(org_id, lead_id, outcome) values ($1, $2, 'nao_atendeu')", [f.orgA, f.leadB])),
      /Lead de outra equipe/);
    // 3) UPDATE apontando para lead de outra equipe
    const own = await as(db, f.u.a, () => one(db, 'insert into public.deals(org_id, lead_id) values ($1, $2) returning id', [f.orgA, f.leadA]));
    await assert.rejects(db.query('update public.deals set lead_id = $1 where id = $2', [f.leadB, own.id]), /Lead de outra equipe/);
    // 4) UPDATE de org_id (mover a negociação de equipe)
    await assert.rejects(db.query('update public.deals set org_id = $1 where id = $2', [f.orgB, own.id]), /não pode ser alterado/);
    // 5) caminho SECURITY DEFINER (dono do banco, ignora RLS) também é barrado
    await assert.rejects(db.query('insert into public.deals(org_id, lead_id) values ($1, $2)', [f.orgA, f.leadB]), /Lead de outra equipe/);
    // 6) ligação sem lead continua permitida
    const semLead = await as(db, f.u.a, () => one(db, "insert into public.calls(org_id, outcome) values ($1, 'nao_atendeu') returning id", [f.orgA]));
    assert.ok(semLead.id);
    // 7) operação legítima na mesma equipe segue funcionando
    await as(db, f.u.a, () => db.query("insert into public.calls(org_id, lead_id, outcome) values ($1, $2, 'interessado')", [f.orgA, f.leadA]));
  });

  test('ensure_deal_for_lead cria a negociação com o org_id do próprio lead', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await as(db, f.u.b, () => db.query("update public.leads set status = 'contato' where id = $1 and org_id = $2", [f.leadB, f.orgB]));
    const d = await one(db, 'select org_id from public.deals where lead_id = $1', [f.leadB]);
    assert.equal(d.org_id, f.orgB, 'a negociação nasce na equipe do lead, nunca na equipe ativa de quem mexeu');
  });

  test('ext2_add_lead + trigger automático não produzem cruzamento', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await as(db, f.u.a, () => db.query("select public.ext2_add_lead($1, 'x-1', 'Novo', 'novo.user', '', '', '', 'contato')", [f.orgA]));
    const linhas = await rows(db, `select d.org_id d_org, l.org_id l_org from public.deals d join public.leads l on l.id = d.lead_id`);
    assert.ok(linhas.every(x => x.d_org === x.l_org), 'nenhuma negociação ficou em equipe diferente do lead');
  });
});

/* ------------------------------------------------------------------ */
/* Precondições agregadas de integridade (sem exibir dado)              */
/* ------------------------------------------------------------------ */
describe('precondições de integridade da Fase A', () => {
  const casos = [
    ['negociação com lead de outra equipe',
      f => `insert into public.deals(org_id, lead_id) values ('${f.orgA}', '${f.leadB}')`,
      /Negociações com lead de outra equipe: 1/],
    ['ligação com lead de outra equipe',
      f => `insert into public.calls(org_id, lead_id, outcome) values ('${f.orgA}', '${f.leadB}', 'nao_atendeu')`,
      /ligações com lead de outra equipe: 1/],
    ['lead com funil de outra equipe',
      f => `update public.leads set pipeline_id = '${f.plB}' where id = '${f.leadA}'`,
      /leads com funil de outra equipe: 1/],
  ];
  for (const [nome, sabotar, mensagem] of casos) {
    test(`${nome}: aborta, informa só a contagem e não cria nada`, async () => {
      const db = await createDb();
      const f = await seed(db);
      await db.exec(sabotar(f));
      const antes = await estadoIntacto(db);
      await assert.rejects(applyFile(db, A_FILE), mensagem);
      await assert.rejects(applyFile(db, A_FILE), /nada foi criado ou alterado/);
      same(await estadoIntacto(db), antes);
    });
  }

  test('a mensagem de aborto não expõe id, nome nem conteúdo de lead', async () => {
    const db = await createDb();
    const f = await seed(db);
    await db.exec(`insert into public.deals(org_id, lead_id) values ('${f.orgA}', '${f.leadB}')`);
    let msg = '';
    try { await applyFile(db, A_FILE); } catch (e) { msg = e.message; }
    assert.match(msg, /inconsistência histórica/);
    assert.doesNotMatch(msg, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/, 'sem UUID');
    assert.doesNotMatch(msg, /Lead A|Lead B|mesmo\.perfil/, 'sem nome/@usuário');
  });

  test('banco íntegro (o estado real da produção depois da limpeza): a fase aplica', async () => {
    const db = await createDb();
    await seed(db);
    await db.exec(fs.readFileSync(path.join(SECURITY_DIR, A_FILE), 'utf8'));
    assert.equal((await one(db, "select to_regprocedure('public.is_org_member(uuid)') is not null as ok")).ok, true);
  });
});

/* ------------------------------------------------------------------ */
/* REV5 — metas e destinatário do pagamento: contrato REAL do painel    */
/* ------------------------------------------------------------------ */
// O payload não é escrito à mão: sai do goalsForm() do app.js rodando de
// verdade (tests/harness-painel.js). Se o painel mudar o objeto, estes
// testes passam a exercitar o objeto novo automaticamente.
const { payloadRealDoPainel, FORMULARIO_COMPLETO } = require('../harness-painel');

const metas = (db, uid, org, goals) =>
  as(db, uid, () => one(db, 'select public.org_set_goals($1, $2::jsonb) g', [org, JSON.stringify(goals)]));
const destinatario = (db, uid, org, id) =>
  as(db, uid, () => one(db, 'select public.org_set_pay_recipient($1, $2) g', [org, id]));
const goalsGravadas = async (db, org) => (await one(db, 'select settings from public.orgs where id = $1', [org])).settings.goals;
const virarAdmin = (db, uid) => db.exec(`set session_replication_role = replica;
  update public.profiles set platform_role = 'admin' where id = '${uid}'; set session_replication_role = origin;`);

describe('REV5 · org_set_goals (metas) e org_set_pay_recipient (destinatário)', () => {
  let payload;
  before(async () => { payload = await payloadRealDoPainel(); });

  test('0. o payload do painel é o objeto completo de goalsForm(), com payFollowUp booleano', () => {
    same(Object.keys(payload).sort(), ['callsWeekly', 'commission', 'commissionPct', 'contacts', 'leadDailyMax', 'leadDailyMin',
      'payBasis', 'payBonusMinPerDay', 'payBonusRate', 'payDayRate', 'payFollowUp', 'payTargetPerDay', 'revenue', 'sales']);
    assert.equal(typeof payload.payFollowUp, 'boolean');
    assert.ok(!('payRecipientId' in payload), 'goalsForm não manda destinatário');
  });

  test('1/2/7. membro ativo salva o payload real completo e todas as chaves voltam iguais', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await db.query(`update public.orgs set settings = '{"agendorAuto":true}'::jsonb where id = $1`, [f.orgA]);
    const r = await metas(db, f.u.removido, f.orgA, payload);        // membro comum (não é dono)
    // deepEqual: jsonb não guarda a ordem das chaves, só o conteúdo
    assert.deepEqual(r.g, payload, 'a RPC devolve exatamente o que gravou');
    assert.deepEqual(await goalsGravadas(db, f.orgA), payload, 'gravado igual ao enviado');
    const s = await one(db, 'select settings from public.orgs where id = $1', [f.orgA]);
    assert.equal(s.settings.agendorAuto, true, 'o resto de settings fica intacto');
  });

  test('3. payFollowUp true e false funcionam (e só booleano)', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    for (const v of [true, false]) {
      await metas(db, f.u.a, f.orgA, { ...payload, payFollowUp: v });
      assert.equal((await goalsGravadas(db, f.orgA)).payFollowUp, v);
    }
    const semFollow = await payloadRealDoPainel({ ...FORMULARIO_COMPLETO, 'gf-pay-followup': false });
    assert.equal(semFollow.payFollowUp, false, 'o painel manda false de verdade');
    await metas(db, f.u.a, f.orgA, semFollow);
    for (const v of ['true', 1, 0, null, [], {}]) {
      await assert.rejects(metas(db, f.u.a, f.orgA, { ...payload, payFollowUp: v }), /payFollowUp \(valor inválido\)/, JSON.stringify(v));
    }
  });

  test('4. payBasis aceita só "seguidos" e "chamados"', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    for (const v of ['seguidos', 'chamados']) {
      await metas(db, f.u.a, f.orgA, { ...payload, payBasis: v });
      assert.equal((await goalsGravadas(db, f.orgA)).payBasis, v);
    }
    for (const v of ['Seguidos', 'outro', '', 1, true, null, ['chamados']]) {
      await assert.rejects(metas(db, f.u.a, f.orgA, { ...payload, payBasis: v }), /payBasis \(valor inválido\)/, JSON.stringify(v));
    }
  });

  test('5. número negativo, "infinito", texto, objeto, lista, nulo e fração em inteiro são recusados', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    const antes = await goalsGravadas(db, f.orgA);
    const ruins = [
      ['contacts', -1], ['revenue', -0.01], ['payDayRate', -5],
      ['contacts', '40'], ['revenue', '500000'], ['commissionPct', '0.1'],
      ['sales', { n: 5 }], ['callsWeekly', [30]], ['payBonusRate', null],
      ['leadDailyMin', 50.5], ['payTargetPerDay', 1e9], ['commissionPct', 101], ['revenue', 1e13],
    ];
    for (const [k, v] of ruins) {
      await assert.rejects(metas(db, f.u.a, f.orgA, { ...payload, [k]: v }), new RegExp(`${k} \\(valor inválido\\)`), `${k}=${JSON.stringify(v)}`);
    }
    // Infinity/NaN não existem em JSON: o navegador serializa como null (recusado
    // acima). E um número gigante escrito no JSON bate no limite.
    await assert.rejects(as(db, f.u.a, () => db.query(`select public.org_set_goals($1, '{"revenue": 1e400}'::jsonb)`, [f.orgA])), /revenue \(valor inválido\)/);
    same(JSON.parse(JSON.stringify({ x: Infinity })), { x: null });
    same(await goalsGravadas(db, f.orgA), antes, 'nada foi gravado em nenhuma recusa');
    // e os limites legítimos passam: zero em tudo e decimal nos campos de dinheiro
    await metas(db, f.u.a, f.orgA, { ...payload, contacts: 0, revenue: 1234.56, commissionPct: 0 });
  });

  test('6. chave desconhecida é recusada (inclusive os nomes inventados na REV4)', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    for (const k of ['payRate', 'dailyTarget', 'weeklyTarget', 'nome', 'join_code', 'agendor_token']) {
      await assert.rejects(metas(db, f.u.a, f.orgA, { ...payload, [k]: 1 }), new RegExp(`${k} \\(chave desconhecida\\)`), k);
    }
    for (const v of [[], 'x', 1, null]) {
      await assert.rejects(as(db, f.u.a, () => db.query('select public.org_set_goals($1, $2::jsonb)', [f.orgA, JSON.stringify(v)])), /Metas inválidas/);
    }
  });

  test('8. membro comum não troca, não apaga e não injeta destinatário — nem por chamada direta', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    // destinatário já gravado (como está hoje na produção), sem depender da RPC nova
    await db.query(`update public.orgs set settings = jsonb_build_object('goals', jsonb_build_object('payRecipientId', $1::text)) where id = $2`, [f.u.a, f.orgA]);
    for (const v of [f.u.removido, '', null]) {
      await assert.rejects(metas(db, f.u.removido, f.orgA, { contacts: 1, payRecipientId: v }), /destinatário do pagamento não é alterado por aqui/, JSON.stringify(v));
      assert.equal((await goalsGravadas(db, f.orgA)).payRecipientId, f.u.a, `continua o do dono depois de ${JSON.stringify(v)}`);
    }
    for (const v of [f.u.removido, '', null]) {
      await assert.rejects(destinatario(db, f.u.removido, f.orgA, v), /Só o dono da equipe/);
    }
    // e salvar metas sem a chave preserva o destinatário do dono
    await metas(db, f.u.removido, f.orgA, payload);
    assert.equal((await goalsGravadas(db, f.orgA)).payRecipientId, f.u.a);
    // nem o UPDATE direto na tabela passa mais (policy de dono/admin)
    const r = await as(db, f.u.removido, () => db.query(
      `update public.orgs set settings = jsonb_set(settings, '{goals,payRecipientId}', to_jsonb($1::text)) where id = $2`, [f.u.removido, f.orgA]));
    assert.equal(r.affectedRows, 0);
    assert.equal((await goalsGravadas(db, f.orgA)).payRecipientId, f.u.a);
  });

  test('9. dono define, troca e remove o destinatário ("todo mundo")', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await metas(db, f.u.a, f.orgA, payload);
    assert.equal((await destinatario(db, f.u.a, f.orgA, f.u.removido)).g.payRecipientId, f.u.removido);
    assert.equal((await destinatario(db, f.u.a, f.orgA, f.u.a.toUpperCase())).g.payRecipientId, f.u.a, 'UUID normalizado');
    for (const vazio of ['', '   ', null]) {
      await destinatario(db, f.u.a, f.orgA, f.u.a);
      const g = (await destinatario(db, f.u.a, f.orgA, vazio)).g;
      assert.ok(!('payRecipientId' in g), `vazio (${JSON.stringify(vazio)}) = todo mundo`);
    }
    assert.deepEqual(await goalsGravadas(db, f.orgA), payload, 'as metas não foram tocadas pelo destinatário');
  });

  test('10. admin da plataforma mantém o acesso previsto nas duas RPCs', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await virarAdmin(db, f.u.b);                                     // admin, mas não é membro de A
    await metas(db, f.u.b, f.orgA, payload);
    assert.equal((await destinatario(db, f.u.b, f.orgA, f.u.removido)).g.payRecipientId, f.u.removido);
    // mesmo o admin só aponta para membro ativo DA equipe
    await assert.rejects(destinatario(db, f.u.b, f.orgA, f.u.b), /não é membro ativo desta equipe/);
  });

  test('11. destinatário de outra equipe, bloqueado, inexistente ou inválido é recusado', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await assert.rejects(destinatario(db, f.u.a, f.orgA, f.u.b), /não é membro ativo desta equipe/, 'outra equipe');
    await assert.rejects(destinatario(db, f.u.a, f.orgA, f.u.bloq), /não é membro ativo desta equipe/, 'bloqueado');
    await assert.rejects(destinatario(db, f.u.a, f.orgA, '00000000-0000-4000-8000-000000000000'), /não é membro ativo/, 'inexistente');
    for (const v of ['abc', `${f.u.a}x`, "'; drop table x; --", '{}']) {
      await assert.rejects(destinatario(db, f.u.a, f.orgA, v), /Destinatário inválido/, v);
    }
    assert.ok(!('payRecipientId' in ((await goalsGravadas(db, f.orgA)) || {})));
  });

  test('12. bloqueado, removido, anônimo e forasteiro são recusados nas duas RPCs', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    await as(db, f.u.a, () => db.query('select public.remove_team_member($1)', [f.u.removido]));
    for (const [quem, uid] of [['bloqueado', f.u.bloq], ['removido', f.u.removido], ['forasteiro', f.u.b]]) {
      await assert.rejects(metas(db, uid, f.orgA, payload), /Sem acesso a esta equipe/, quem);
      await assert.rejects(destinatario(db, uid, f.orgA, null), /Só o dono da equipe/, quem);
    }
    await assert.rejects(metas(db, null, f.orgA, payload), /permission denied/, 'anônimo');
    await assert.rejects(destinatario(db, null, f.orgA, null), /permission denied/, 'anônimo');
    // dono bloqueado também perde o acesso
    await db.exec(`set session_replication_role = replica; update public.profiles set status = 'blocked' where id = '${f.u.a}'; set session_replication_role = origin;`);
    await assert.rejects(destinatario(db, f.u.a, f.orgA, null), /Só o dono da equipe/);
    await assert.rejects(metas(db, f.u.a, f.orgA, payload), /Sem acesso a esta equipe/);
  });

  test('13. usuário em várias equipes: vale o p_org_id, não a equipe aberta', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const f = await seed(db);
    // dono de A entra em B como membro — B passa a ser a equipe ATIVA dele
    await as(db, f.u.a, () => db.query('select public.join_org($1)', [f.codeB]));
    assert.equal((await one(db, 'select org_id, org_role from public.profiles where id = $1', [f.u.a])).org_id, f.orgB);
    await metas(db, f.u.a, f.orgA, payload);                         // A, mesmo com B aberta
    await metas(db, f.u.a, f.orgB, { ...payload, contacts: 7 });     // B, como membro
    assert.equal((await goalsGravadas(db, f.orgA)).contacts, payload.contacts);
    assert.equal((await goalsGravadas(db, f.orgB)).contacts, 7);
    // continua dono de A (org_members), mesmo com a equipe ativa sendo B
    assert.equal((await destinatario(db, f.u.a, f.orgA, f.u.removido)).g.payRecipientId, f.u.removido);
    // mas em B é só membro
    await assert.rejects(destinatario(db, f.u.a, f.orgB, f.u.b), /Só o dono da equipe/);
    // e o dono de B aponta para ele, que agora é membro ativo de B
    assert.equal((await destinatario(db, f.u.b, f.orgB, f.u.a)).g.payRecipientId, f.u.a);
  });
});

/* ------------------------------------------------------------------ */
/* REV5 — verificação posterior da Fase A e do rollback                 */
/* ------------------------------------------------------------------ */
const A_SQL = () => fs.readFileSync(path.join(SECURITY_DIR, A_FILE), 'utf8');
const R_SQL = () => fs.readFileSync(path.join(SECURITY_DIR, 'A-01-rollback.sql'), 'utf8');
const execSql = async (db, sql) => {
  try { await db.exec(sql); } finally { try { await db.exec('rollback'); } catch { /* sem transação aberta */ } }
};
const polOrgsUpdate = db => one(db, `select cmd, permissive, array(select r::text from unnest(roles) r) roles, qual, with_check
  from pg_policies where schemaname='public' and tablename='orgs' and policyname='orgs_update'`);
const mutar = (sql, de, para) => { assert.ok(sql.includes(de), `trecho não encontrado: ${de}`); return sql.replace(de, para); };

describe('REV5 · verificação posterior da Fase A confere tudo', () => {
  test('aplicada: orgs_update completa (UPDATE, PERMISSIVE, public, USING e WITH CHECK) e as duas RPCs só para authenticated', async () => {
    const db = await createDb({ phases: [A_FILE] });
    const p = await polOrgsUpdate(db);
    same([p.cmd, p.permissive, p.roles], ['UPDATE', 'PERMISSIVE', ['public']]);
    const norm = x => x.replace(/[()"'\s]/g, '').toLowerCase();
    assert.equal(norm(p.qual), 'id=my_organdis_org_owneroris_platform_admin');
    assert.equal(norm(p.with_check), 'id=my_organdis_org_owneroris_platform_admin');
    for (const fn of ['public.org_set_goals(uuid,jsonb)', 'public.org_set_pay_recipient(uuid,text)']) {
      const g = await one(db, `select has_function_privilege('anon', $1, 'EXECUTE') anon,
        has_function_privilege('authenticated', $1, 'EXECUTE') auth`, [fn]);
      same([g.anon, g.auth], [false, true], fn);
    }
  });

  const sabotagens = [
    ['WITH CHECK diferente do esperado (a REV4 só conferia o USING)',
      s => mutar(s, "  with check ((id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());",
                    '  with check (true);'),
      /orgs_update não ficou exatamente como dono\/admin/],
    ['orgs_update sem WITH CHECK',
      s => mutar(s, "  with check ((id = public.my_org() and public.is_org_owner()) or public.is_platform_admin());", ';'),
      /orgs_update não ficou exatamente como dono\/admin/],
    ['orgs_update restrita a um papel diferente de public',
      s => mutar(s, 'create policy orgs_update on public.orgs for update\n', 'create policy orgs_update on public.orgs for update to authenticated\n'),
      /orgs_update não ficou exatamente como dono\/admin/],
    ['RPC do destinatário executável por anon',
      s => mutar(s, 'revoke execute on function public.org_set_pay_recipient(uuid, text) from public, anon;', ''),
      /RPC de metas ausente ou com acesso errado: public.org_set_pay_recipient/],
    ['RPC de metas sem search_path fixo',
      s => mutar(s, "create function public.org_set_goals(p_org_id uuid, p_goals jsonb)\nreturns jsonb\nlanguage plpgsql security definer\nset search_path = public, pg_temp",
                    "create function public.org_set_goals(p_org_id uuid, p_goals jsonb)\nreturns jsonb\nlanguage plpgsql security definer"),
      /RPC de metas ausente ou com acesso errado: public.org_set_goals/],
  ];
  for (const [nome, sabotar, msg] of sabotagens) {
    test(`aborta a Fase A inteira se: ${nome}`, async () => {
      const db = await createDb();
      await seed(db);
      const antes = await estadoIntacto(db);
      await assert.rejects(execSql(db, sabotar(A_SQL())), msg);
      same(await estadoIntacto(db), antes, 'transação desfeita: nada ficou');
      assert.equal((await one(db, "select to_regprocedure('public.org_set_goals(uuid,jsonb)') is null sem")).sem, true);
    });
  }
});

describe('REV5 · rollback da Fase A conferido de ponta a ponta', () => {
  test('depois do rollback: sem RPCs novas, sem triggers, orgs_update volta a is_active sem WITH CHECK e ACL idêntica', async () => {
    const db = await createDb();
    await seed(db);
    // cada item da ACL (quem recebeu, qual privilégio, quem concedeu, com
    // grant option?) — como CONJUNTO: revoke+grant pode reordenar o array
    // aclitem[] sem mudar privilégio nenhum
    const acl = () => rows(db, `select p.oid::regprocedure::text f,
        array(select coalesce(nullif(a.grantee::regrole::text,'-'),'public') || ':' || a.privilege_type || ':' ||
                     a.grantor::regrole::text || ':' || a.is_grantable
                from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a order by 1) itens
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1`);
    const aclAntes = await acl(), polAntes = await polOrgsUpdate(db);
    await db.exec(A_SQL());
    await db.exec(R_SQL());
    for (const fn of ['org_set_goals', 'org_set_pay_recipient', 'is_org_member', 'assert_org_member', 'guard_leads_org', 'guard_child_org']) {
      assert.equal((await one(db, 'select count(*)::int n from pg_proc where proname = $1', [fn])).n, 0, fn);
    }
    assert.equal((await one(db, "select count(*)::int n from pg_proc where proname like 'ext2\\_%'")).n, 0);
    assert.equal((await one(db, `select count(*)::int n from pg_trigger where not tgisinternal
      and tgname in ('leads_guard_org','deals_guard_org','calls_guard_org')`)).n, 0);
    const p = await polOrgsUpdate(db);
    same(p, polAntes, 'orgs_update idêntica à de antes');
    same([p.cmd, p.permissive, p.roles, p.with_check], ['UPDATE', 'PERMISSIVE', ['public'], null]);
    assert.match(p.qual.replace(/\s/g, ''), /is_active\(\)/);
    same(await acl(), aclAntes, 'ACL idêntica, item a item');
  });

  const sabotagens = [
    ['o registro de org_set_goals sumiu (a função sobraria)',
      "delete from public.seguranca_estado_anterior where tipo = 'objeto_criado' and objeto like 'org_set_goals%'",
      /função remanescente org_set_goals/],
    ['o registro de org_set_pay_recipient sumiu',
      "delete from public.seguranca_estado_anterior where tipo = 'objeto_criado' and objeto like 'org_set_pay_recipient%'",
      /função remanescente org_set_pay_recipient/],
    ['o registro da policy orgs_update sumiu (a de dono ficaria)',
      "delete from public.seguranca_estado_anterior where tipo = 'policy' and objeto = 'orgs.orgs_update'",
      /orgs_update não voltou a ser a policy anterior/],
    ['o registro de um trigger sumiu',
      "delete from public.seguranca_estado_anterior where tipo = 'objeto_criado' and objeto like 'deals_guard_org|%'",
      // o trigger sem registro segura a própria função: o DROP dela falha e a
      // transação inteira volta — também é recusa, só que antes da conferência
      /trigger remanescente deals_guard_org|other objects depend on it/],
  ];
  for (const [nome, sabotagem, msg] of sabotagens) {
    test(`rollback se recusa a concluir se ${nome}`, async () => {
      const db = await createDb({ phases: [A_FILE] });
      await db.exec(sabotagem);
      await assert.rejects(execSql(db, R_SQL()), msg);
      // transação desfeita: a Fase A continua inteira, nada ficou pela metade
      assert.equal((await one(db, "select to_regprocedure('public.org_set_goals(uuid,jsonb)') is not null ok")).ok, true);
      assert.equal((await one(db, "select to_regclass('public.seguranca_estado_anterior') is not null ok")).ok, true);
    });
  }

  test('rollback se recusa a concluir se a ACL restaurada não bater com a registrada', async () => {
    const db = await createDb({ phases: [A_FILE] });
    // o registro diz que create_org era só de authenticated; o rollback concede
    // isso, mas alguém "a mais" (anon) continua lá por fora do registro? Não:
    // o rollback revoga o que não está registrado. Aqui simulamos um registro
    // impossível de restaurar (papel inexistente na lista) para provar que a
    // conferência roda de fato.
    await db.exec(`update public.seguranca_estado_anterior set detalhe = jsonb_build_object('roles', '["anon","authenticated","service_role"]'::jsonb)
      where tipo = 'grant_execute' and objeto = 'create_org(text,text)'`);
    await assert.rejects(execSql(db, R_SQL()), /ACL diferente da registrada antes da Fase A: create_org/);
  });
});
