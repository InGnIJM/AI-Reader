import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Externalize native modules so vite-node doesn't try to transform them
    server: {
      deps: {
        external: [/better-sqlite3/],
      },
    },
    // Renderer component tests use jsdom
    environmentMatchGlobs: [
      ['src/renderer/**', 'jsdom'],
    ],
    setupFiles: ['src/renderer/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      include: ['src/main/services/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', '**/test/**', '**/types.ts'],
    },
  },
});
