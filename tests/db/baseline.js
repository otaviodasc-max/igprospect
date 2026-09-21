// Monta, num Postgres em memória (PGlite), o banco do IGProspect como ele
// fica depois de rodar os SQL do repositório na ordem indicada nos cabeçalhos
// ("Execute APÓS ..."). É uma APROXIMAÇÃO da produção: o estado real do
// Supabase só se confirma com os blocos 13–15 do diagnóstico somente leitura.
// Scripts operacionais pontuais (diagnóstico, rotação de código, remoção de
// lotes, bônus de uma equipe) ficam de fora de propósito.

const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const ROOT = path.join(__dirname, '..', '..');

const BASELINE_ORDER = [
  'supabase-schema.sql',
  'supabase-org-members.sql',
  'supabase-deals.sql',
  'supabase-deal-paid.sql',
  'supabase-messages.sql',
  'supabase-fix-org-isolation.sql',
  'supabase-modules.sql',
  'supabase-pipelines.sql',
  'supabase-push.sql',
  'supabase-reports.sql',
  'supabase-team-management.sql',
  'supabase-features.sql',
  'supabase-super-admin.sql',
  'supabase-INSTALAR-TUDO.sql',
  'supabase-admin-delete-user.sql',
  'supabase-lock-orgs-owner.sql',
  'supabase-extension-team-link.sql',
  'supabase-extension-direct-sync.sql',
  'supabase-extension-prospector.sql',
  'supabase-leads-dedupe.sql',
  'supabase-leads-extid-fix.sql',
  'supabase-extension-name-fix.sql',
  'supabase-extension-pull-data.sql',
  'supabase-extension-delete-sync.sql',
  'supabase-extension-agendor-sync.sql',
  'supabase-extension-agendor-map.sql',
  'supabase-extension-notes-sync.sql',
  'supabase-my-orgs-cards.sql',
  'supabase-deals-multi.sql',
  'supabase-pipeline-sigla.sql',
  'supabase-agendor-error-column.sql',
  'supabase-leads-realtime.sql',
  'supabase-status-changed-at.sql',
  'supabase-security-join-code.sql',
  'supabase-lead-called-at.sql',
  'supabase-lead-stage-dates.sql',
  'supabase-agendor-origin.sql',
];

const SECURITY_DIR = path.join(ROOT, 'db', 'seguranca');

function read(p) { return fs.readFileSync(p, 'utf8'); }

async function runFile(db, file) {
  try { await db.exec(read(file)); }
  catch (e) { throw new Error(`${path.relative(ROOT, file)}: ${e.message}`); }
}

// phases: lista de migrations de db/seguranca a aplicar depois da baseline,
// ex.: ['A-01-aditiva-compativel.sql'].
async function createDb({ phases = [] } = {}) {
  const db = new PGlite();
  await db.exec(read(path.join(__dirname, 'supabase-stub.sql')));
  for (const f of BASELINE_ORDER) await runFile(db, path.join(ROOT, f));
  for (const f of phases) await runFile(db, path.join(SECURITY_DIR, f));
  return db;
}

module.exports = { createDb, BASELINE_ORDER, SECURITY_DIR, ROOT };
