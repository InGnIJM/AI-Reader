import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    main: {
        resolve: {
            extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
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
            rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
        },
    },
    preload: {
        resolve: {
            extensions: ['.ts', '.tsx', '.mjs', '.js', '.mts', '.jsx', '.json'],
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
            rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
        },
    },
    renderer: {
        plugins: [react()],
        root: resolve(__dirname, 'src/renderer'),
        build: {
            outDir: 'dist/renderer',
            rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
        },
    },
});
//# sourceMappingURL=electron.vite.config.js.map
