const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e-next',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://localhost:8000', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: {
    command: 'npm --prefix next run dev:8000', url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI, timeout: 60_000
  }
});
