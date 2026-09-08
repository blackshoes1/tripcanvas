const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

for (const fail of [false, true]) {
  test(`backup ${fail ? 'failure removes partial output without claiming success' : 'success publishes completed dump'}`, (t) => {
    const root = mkdtempSync(join(tmpdir(), 'tc-backup-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'bin'));
    mkdirSync(join(root, 'backups'));
    writeFileSync(join(root, 'bin/pg_isready'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(join(root, 'bin/pg_dump'), `#!/bin/sh\nfor arg do case "$arg" in --file=*) printf 'synthetic' > "\${arg#--file=}" ;; esac; done\nexit ${fail ? 1 : 0}\n`, { mode: 0o755 });
    const r = spawnSync('/bin/sh', [join(__dirname, '../deploy/backup.sh')], {
      encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, BACKUP_DIR: join(root, 'backups') }
    });
    assert.equal(r.status, fail ? 1 : 0);
    const files = readdirSync(join(root, 'backups'));
    if (fail) {
      assert.deepEqual(files, []);
      assert.doesNotMatch(r.stdout, /wrote/);
    } else {
      assert.equal(files.length, 1);
      assert.match(files[0], /^tripcanvas-.*\.dump$/);
      assert.match(r.stdout, /wrote/);
    }
  });
}
