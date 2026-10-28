const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('iOS 실제 서명·프로파일 검사와 업로드 차단 회귀', () => {
  const result = spawnSync('python3', ['-B', 'test/ios_signing_test.py'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
