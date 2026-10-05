'use strict';
/* global __dirname */

// Codex가 만든 변형을 검증하고 실행 파일로 포장한다. 외부 AI API는 호출하지 않는다.
const fs=require('node:fs');
const crypto=require('node:crypto');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=(name)=>JSON.parse(fs.readFileSync(path.join(root,'copy',name),'utf8'));
const hash=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const placeholders=(s)=>[...s.matchAll(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g)].map(m=>m[1]).sort().join(',');

function build(source, guides, variants){
  const guideHash=hash(JSON.stringify(guides));
  const tones=['FRIENDLY','CASUAL','POLITE'];
  const errors=[], pending=[];
  const catalogue={};
  for(const [key,row] of Object.entries(source)){
    const variant=variants[key];
    if(!variant || variant.sourceHash!==hash(row.text) || variant.guideHash!==guideHash) pending.push({key,...row,sourceHash:hash(row.text)});
    catalogue[key]={FRIENDLY:row.text};
    for(const tone of tones.slice(1)){
      const text=variant&&variant[tone];
      if(typeof text!=='string'||!text.trim()) errors.push(`${key}: ${tone} 문구 누락`);
      else if(placeholders(text)!==placeholders(row.text)) errors.push(`${key}: ${tone} 변수 불일치`);
      catalogue[key][tone]=text;
    }
  }
  for(const key of Object.keys(variants)) if(!source[key]) errors.push(`${key}: 원본 없는 변형`);
  return {catalogue,errors,pending,guideHash};
}

function outputs(source,guides,catalogue){
  const choices=Object.entries(guides).map(([id,row])=>({id,label:row.label,example:catalogue['tone.preview'][id]}));
  const js=`// 생성 파일 — copy/j-source.json·j-tones.json·j-variants.json에서 npm run copy:build로 만든다.\n// @ts-check\n(function(root){\n  'use strict';\n  /** @typedef {'FRIENDLY'|'CASUAL'|'POLITE'} JTone */\n  /** @type {Record<string,Record<JTone,string>>} */\n  const catalogue=${JSON.stringify(catalogue,null,2)};\n  const choices=${JSON.stringify(choices,null,2)};\n  /** @param {unknown} tone @returns {JTone} */\n  function normalizeTone(tone){ return tone==='CASUAL'||tone==='POLITE'?tone:'FRIENDLY'; }\n  /** @param {string} key @param {Record<string,string|number>=} params @param {unknown=} tone @returns {string} */\n  function text(key, params, tone){\n    const entry=catalogue[key];\n    if(!entry) throw new Error('Unknown J copy key: '+key);\n    return entry[normalizeTone(tone)].replace(/\\{([a-zA-Z][a-zA-Z0-9]*)\\}/g, (_, name)=>{\n      if(!params || params[name]==null) throw new Error('Missing J copy parameter: '+key+'.'+name);\n      return String(params[name]);\n    });\n  }\n  const API={text,normalizeTone,choices};\n  if(typeof module!=='undefined' && module.exports) module.exports=API;\n  else root.TC_J_COPY=API;\n})(typeof globalThis!=='undefined'?globalThis:window);\n`;
  const quote=s=>JSON.stringify(s).replace(/\\\//g,'/');
  const swiftRows=Object.entries(source).filter(([,v])=>v.local).map(([key])=>
    `        ${quote(key)}: [${Object.entries(catalogue[key]).map(([tone,text])=>`${quote(tone)}: ${quote(text)}`).join(', ')}]`).join(',\n');
  const swift=`// 생성 파일 — npm run copy:build. 원본은 copy/ 아래 파일이다.\nimport Foundation\n\nenum JTone: String, Codable, CaseIterable, Sendable {\n    case friendly = "FRIENDLY", casual = "CASUAL", polite = "POLITE"\n    var label: String {\n        switch self {\n${choices.map(c=>`        case .${c.id.toLowerCase()}: return ${quote(c.label)}`).join('\n')}\n        }\n    }\n    var example: String { JCopy.text("tone.preview", tone: self) }\n}\n\nenum JCopy {\n    private static let catalogue: [String: [String: String]] = [\n${swiftRows}\n    ]\n    static func text(_ key: String, params: [String: String] = [:], tone: JTone = .friendly) -> String {\n        guard let template = catalogue[key]?[tone.rawValue] else { preconditionFailure("Unknown J copy key: \\(key)") }\n        let regex = try! NSRegularExpression(pattern: "\\\\{([a-zA-Z][a-zA-Z0-9]*)\\\\}")\n        var result = template\n        for match in regex.matches(in: template, range: NSRange(template.startIndex..., in: template)).reversed() {\n            let name = String(template[Range(match.range(at: 1), in: template)!])\n            guard let value = params[name] else { preconditionFailure("Missing J copy parameter: \\(key).\\(name)") }\n            result.replaceSubrange(Range(match.range, in: result)!, with: value)\n        }\n        return result\n    }\n}\n`;
  return {'j-copy.js':js,'ios/TripCanvas/Core/Models/JCopy.swift':swift};
}

if(require.main===module){
  const source=read('j-source.json'),guides=read('j-tones.json'),variants=read('j-variants.json');
  const result=build(source,guides,variants);
  const mode=process.argv[2];
  if(mode==='--pending'){
    console.log(JSON.stringify({instructions:'기본 문구의 사실·불확실성·부정·조건·변수를 보존하고 두 말투를 생성한다. sourceHash=SHA256(text), guideHash는 아래 값을 사용한다. 의미는 사람이 검토한다.',guides,guideHash:result.guideHash,pending:result.pending},null,2));
  }else{
    if(result.pending.length) result.errors.push('원본/가이드 변경 후 다시 생성할 문구: '+result.pending.map(r=>r.key).join(', '));
    if(result.errors.length){ console.error(result.errors.join('\n')); process.exitCode=1; }
    else {
      for(const [file,text] of Object.entries(outputs(source,guides,result.catalogue))){
        const target=path.join(root,file);
        if(mode==='--check'){
          if(!fs.existsSync(target)||fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n')!==text){ console.error(file+': npm run copy:build 필요'); process.exitCode=1; }
        }else fs.writeFileSync(target,text);
      }
      if(!process.exitCode) console.log('J copy checked: '+Object.keys(source).length+' entries, 3 tones.');
    }
  }
}
module.exports={build,outputs};
