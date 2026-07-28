import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@ai-reader/shared': resolve(__dirname, '../../packages/shared/src'),
        '@ai-reader/core': resolve(__dirname, '../../packages/core/src'),
      },
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@ai-reader/shared', '@ai-reader/core'],
      }),
    ],
    build: {
      outDir: 'dist/main',
    },
  },
  preload: {
    resolve: {
      alias: {
        '@ai-reader/shared': resolve(__dirname, '../../packages/shared/src'),
        '@ai-reader/core': resolve(__dirname, '../../packages/core/src'),
      },
    },
    plugins: [
      externalizeDepsPlugin({
        exclude: ['@ai-reader/shared', '@ai-reader/core'],
      }),
    ],
    build: {
      outDir: 'dist/preload',
    },
  },
  renderer: {
    plugins: [react()],
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: 'dist/renderer',
    },
  },
});
