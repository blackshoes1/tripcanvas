'use strict';

const fs=require('node:fs');
const sw=fs.readFileSync('sw.js','utf8');
const match=/const VER = 'tc-v(\d+)'/.exec(sw);
if(!match) throw new Error('sw.js VER를 찾지 못했습니다.');
const next=`tc-v${Number(match[1])+1}`;
fs.writeFileSync('sw.js',sw.replace(/const VER = 'tc-v\d+'/,`const VER = '${next}'`));
const html=fs.readFileSync('index.html','utf8').replace(/([.]css|[.]js)\?v=tc-v\d+/g,`$1?v=${next}`);
fs.writeFileSync('index.html',html);
console.log(`Version bumped to ${next}.`);
