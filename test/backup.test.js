const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

/** 가짜 pg 도구를 깐 임시 루트에서 backup.sh를 돌린다 */
function runBackup(t, { dumpFails = false, psqlExit = 0, sourceUrl = '', record = '1' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'tc-backup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, 'backups'));
  writeFileSync(join(root, 'bin/pg_isready'), `#!/bin/sh\necho "$@" >> "${root}/isready.log"\nexit 0\n`, { mode: 0o755 });
  writeFileSync(join(root, 'bin/pg_dump'), `#!/bin/sh\necho "$@" >> "${root}/dump.log"\nfor arg do case "$arg" in --file=*) printf 'synthetic' > "\${arg#--file=}" ;; esac; done\nexit ${dumpFails ? 1 : 0}\n`, { mode: 0o755 });
  writeFileSync(join(root, 'bin/psql'), `#!/bin/sh\necho "$@" >> "${root}/psql.log"\nexit ${psqlExit}\n`, { mode: 0o755 });
  const r = spawnSync('/bin/sh', [join(__dirname, '../deploy/backup.sh')], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, BACKUP_DIR: join(root, 'backups'), BACKUP_SOURCE_URL: sourceUrl, BACKUP_DESTINATION: 'nas', BACKUP_RECORD: record }
  });
  const log = (name) => (existsSync(join(root, name)) ? readFileSync(join(root, name), 'utf8') : '');
  return { r, files: readdirSync(join(root, 'backups')), psql: log('psql.log'), dump: log('dump.log'), isready: log('isready.log') };
}

test('backup success publishes completed dump and records the run for /api/health', (t) => {
  const { r, files, psql } = runBackup(t);
  assert.equal(r.status, 0);
  assert.equal(files.length, 1);
  assert.match(files[0], /^tripcanvas-.*\.dump$/);
  assert.match(r.stdout, /wrote/);
  assert.match(psql, /insert into ops_backup_runs/);
  assert.match(psql, /'nas'/);
});

test('backup failure removes partial output without claiming success or recording a run', (t) => {
  const { r, files, psql } = runBackup(t, { dumpFails: true });
  assert.equal(r.status, 1);
  assert.deepEqual(files, []);
  assert.doesNotMatch(r.stdout, /wrote/);
  assert.equal(psql, '', '실패한 회차를 성공으로 기록하지 않는다');
});

test('recording failure is loud but does not fail the backup — the dump is already complete', (t) => {
  const { r, files } = runBackup(t, { psqlExit: 1 });
  assert.equal(r.status, 0);
  assert.equal(files.length, 1);
  assert.match(r.stderr, /ops_backup_runs/);
});

test('BACKUP_SOURCE_URL points pg_dump and the run record at the remote DB, and never appears in output', (t) => {
  const url = 'postgres://tc:s3cret@db.managed.example:5432/tripcanvas';
  const { r, dump, psql, isready } = runBackup(t, { sourceUrl: url });
  assert.equal(r.status, 0);
  assert.match(dump, /db\.managed\.example/, 'pg_dump가 원격 주소를 받는다');
  assert.match(psql, /db\.managed\.example/, '기록도 같은 DB에 남긴다');
  assert.match(isready, /db\.managed\.example/);
  assert.doesNotMatch(r.stdout + r.stderr, /s3cret|db\.managed\.example/, '주소·비밀은 출력에 나오지 않는다');
});

test('BACKUP_RECORD=0 takes the dump without touching the source — the final cutover dump must not add a row', (t) => {
  const { r, files, psql } = runBackup(t, { record: '0' });
  assert.equal(r.status, 0);
  assert.equal(files.length, 1);
  assert.equal(psql, '', '기록을 남기지 않는다');
  assert.match(r.stdout, /BACKUP_RECORD=0/);
});
