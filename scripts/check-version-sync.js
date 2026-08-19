'use strict';

const fs=require('node:fs');
const sw=fs.readFileSync('sw.js','utf8');
const html=fs.readFileSync('index.html','utf8');
const match=/const VER = '(tc-v\d+)'/.exec(sw);
if(!match){ console.error('sw.js VER를 찾지 못했습니다.'); process.exit(1); }
const versions=[...html.matchAll(/(?:\.css|\.js)\?v=(tc-v\d+)/g)].map(item=>item[1]);
if(!versions.length||versions.some(version=>version!==match[1])){
  console.error(`버전 불일치: sw=${match[1]}, assets=${versions.join(',')}`); process.exit(1);
}
console.log(`Version sync passed (${match[1]}, ${versions.length} assets).`);
