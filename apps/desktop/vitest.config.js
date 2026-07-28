import { defineConfig } from 'vitest/config';
export default defineConfig({
    test: {
        // Externalize native modules so vite-node doesn't try to transform them
        server: {
            deps: {
                external: [/better-sqlite3/],
            },
        },
    },
});
//# sourceMappingURL=vitest.config.js.map