import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@core': path.join(root, 'src/core'),
      '@adapters': path.join(root, 'src/adapters'),
      '@agents': path.join(root, 'src/agents'),
      '@config': path.join(root, 'src/config'),
      '@services': path.join(root, 'src/services'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
