// lib.js의 UMD 플럼빙용 느슨한 ambient (순수 로직 자체는 JSDoc로 엄격 검사)
declare var module: any;
declare var window: any;
declare var require: any;

declare var TC_J_COPY: { text(key: string, params?: Record<string,string|number>, tone?: unknown): string; normalizeTone(tone: unknown): "FRIENDLY"|"CASUAL"|"POLITE"; choices: {id:string;label:string;example:string}[] };
