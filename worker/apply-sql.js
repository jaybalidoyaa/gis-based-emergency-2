/**
 * Apply worker SQL via wrangler d1 execute --file (per statement).
 * Falls back to --command if --file import auth fails.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const db = 'barangay-dispatch-db';
const root = path.join(__dirname, '..');
const wranglerBin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function statementsFromFile(file) {
  const raw = fs.readFileSync(path.join(root, file), 'utf8');
  const noComments = raw.replace(/--[^\n]*/g, '');
  return noComments
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function run(sql) {
  console.log('>', sql.slice(0, 90) + (sql.length > 90 ? '…' : ''));
  const tmp = path.join(root, 'worker', '.tmp-statement.sql');
  fs.writeFileSync(tmp, sql + ';\n', 'utf8');
  try {
    try {
      execSync(`node "${wranglerBin}" d1 execute ${db} --remote --yes --file="${tmp}"`, {
        stdio: ['inherit', 'pipe', 'pipe'],
        cwd: root,
        shell: true,
        encoding: 'utf8',
      });
    } catch (fileErr) {
      const combined = `${String(fileErr)}\n${fileErr && fileErr.stderr ? String(fileErr.stderr) : ''}\n${
        fileErr && fileErr.stdout ? String(fileErr.stdout) : ''
      }`;
      if (/Authentication error|code: 10000/i.test(combined)) {
        console.log('retry via --command (file import auth failed)');
        const escaped = sql.replace(/"/g, '\\"');
        execSync(`node "${wranglerBin}" d1 execute ${db} --remote --yes --command "${escaped}"`, {
          stdio: ['inherit', 'pipe', 'pipe'],
          cwd: root,
          shell: true,
          encoding: 'utf8',
        });
        return;
      }
      const dup = /duplicate column|already exists|SQLITE_ERROR.*duplicate/i.test(combined);
      if (dup) {
        const skipErr = new Error(combined);
        skipErr.code = 'DUPLICATE';
        throw skipErr;
      }
      throw fileErr;
    }
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

const target = process.argv[2] || 'schema';
const file =
  target === 'seed'
    ? 'worker/seed.sql'
    : target === 'migrate'
      ? 'worker/migrate.sql'
      : target === 'migrate-v3-types'
        ? 'worker/migrate-v3-types.sql'
        : target === 'migrate-v4'
          ? 'worker/migrate-v4.sql'
          : target === 'migrate-v5'
            ? 'worker/migrate-v5-facilities.sql'
            : target === 'migrate-v5b'
              ? 'worker/migrate-v5b-facility-rows.sql'
              : target === 'migrate-v5c'
                ? 'worker/migrate-v5c-school-facilities.sql'
                : target === 'migrate-v6-facility-pins'
                  ? 'worker/migrate-v6-facility-pins.sql'
                  : target === 'migrate-v7-unit-bemo'
                    ? 'worker/migrate-v7-unit-bemo.sql'
                    : target === 'migrate-v8-push-subscriptions'
                      ? 'worker/migrate-v8-push-subscriptions.sql'
                      : target === 'migrate-v9-notification-tracking'
                        ? 'worker/migrate-v9-notification-tracking.sql'
                        : target === 'migrate-v10-attendance-leave'
                          ? 'worker/migrate-v10-attendance-leave.sql'
                          : target === 'migrate-v11-system-settings'
                            ? 'worker/migrate-v11-system-settings.sql'
                            : target === 'migrate-v12-ncr-hospitals'
                              ? 'worker/migrate-v12-ncr-hospitals.sql'
                              : target === 'migrate-v13-ops-accounts'
                                ? 'worker/migrate-v13-ops-accounts.sql'
                                : target === 'migrate-v14-reconcile-terminal-assignments'
                                  ? 'worker/migrate-v14-reconcile-terminal-assignments.sql'
                                  : target === 'migrate-v15-training-flag'
                                    ? 'worker/migrate-v15-training-flag.sql'
                                    : target === 'migrate-v16-transport-coords'
                                      ? 'worker/migrate-v16-transport-coords.sql'
                                      : target === 'migrate-v17-responder-ops'
                                        ? 'worker/migrate-v17-responder-ops.sql'
                                        : target === 'migrate-v18-team-unit-change'
                                          ? 'worker/migrate-v18-team-unit-change.sql'
                  : 'worker/schema.sql';
for (const sql of statementsFromFile(file)) {
  try {
    run(sql);
  } catch (err) {
    const msg = `${String(err)}\n${err && err.stderr ? String(err.stderr) : ''}\n${err && err.stdout ? String(err.stdout) : ''}`;
    if (
      err?.code === 'DUPLICATE' ||
      /duplicate column|already exists|SQLITE_ERROR.*duplicate/i.test(msg) ||
      /duplicate column name/i.test(msg)
    ) {
      console.log('skip (already applied)');
      continue;
    }
    throw err;
  }
}
console.log(`Done: ${file}`);
