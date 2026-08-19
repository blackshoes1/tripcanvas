const {defineConfig,devices}=require('@playwright/test');

module.exports=defineConfig({
  testDir:'./e2e',
  fullyParallel:false,
  workers:1,
  retries:process.env.CI?1:0,
  reporter:process.env.CI?'github':'list',
  use:{baseURL:'http://127.0.0.1:8000',trace:'retain-on-failure',...devices['Desktop Chrome']},
  webServer:{command:'node scripts/e2e-server.js',url:'http://127.0.0.1:8000',reuseExistingServer:!process.env.CI,timeout:15_000}
});
