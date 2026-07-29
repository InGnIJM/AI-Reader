import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      'src/**/test/test_*.{ts,tsx}',
    ],
  },
});
