import { defineConfig } from 'vitest/config';

import { aliases } from './vitest.aliases.js';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  resolve: { alias: aliases },
});
