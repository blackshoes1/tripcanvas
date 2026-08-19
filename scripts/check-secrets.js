'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const textExtensions = new Set(['.js', '.json', '.html', '.css', '.md', '.yml', '.yaml', '.sql']);
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/],
  ['Supabase secret/service key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b|\bservice_role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i]
];
const failures = [];

for (const file of files) {
  if (!textExtensions.has(path.extname(file))) continue;
  const value = fs.readFileSync(file, 'utf8');
  for (const [label, pattern] of patterns) if (pattern.test(value)) failures.push(`${file}: possible ${label}`);
}
const browser = fs.readFileSync('app.js', 'utf8');
if (/KAKAO_REST_API_KEY|KAKAO_REST_KEY|Authorization\s*:\s*['"`]KakaoAK/.test(browser)) failures.push('app.js: Kakao REST credential usage must remain server-only');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Secret scan passed (${files.length} tracked files checked).`);
