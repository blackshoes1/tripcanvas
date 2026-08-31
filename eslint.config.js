module.exports=[{
  files:['lib.js','sync.js','routing.js','price.js','adaptive.js','api/**/*.js','scripts/**/*.js'],
  languageOptions:{ecmaVersion:2022,sourceType:'script',globals:{window:'readonly',globalThis:'readonly',module:'readonly',require:'readonly',process:'readonly',Buffer:'readonly',TextEncoder:'readonly',URL:'readonly',URLSearchParams:'readonly',AbortController:'readonly',fetch:'readonly',setTimeout:'readonly',clearTimeout:'readonly',console:'readonly'}},
  rules:{'no-undef':'error','no-unused-vars':['error',{argsIgnorePattern:'^_','caughtErrors':'none'}],'no-constant-condition':'error'}
}];
