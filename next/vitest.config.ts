import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.join(__dirname, 'src'), '@legacy': path.join(__dirname, '..') } },
  test: { include: ['src/**/*.test.ts'] }
});
