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
      if (hasPhase(state, 'A')) await assert.rejects(ins, /row-level security/);
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
    const bad = top.match(/\b(delete\s+from|truncate|update\s+public\.|insert\s+into|drop\s+(table|schema|column|database)|alter\s+table\s+\S+\s+drop\s+column)\b/gi);
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
