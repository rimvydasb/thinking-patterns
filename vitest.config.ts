import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vitest/config';
import {playwright} from '@vitest/browser-playwright';
import {storybookTest} from '@storybook/addon-vitest/vitest-plugin';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Two Vitest projects:
 * - `unit`: model, layout, store, sync client and server tests (`*.test.ts`) in Node.
 * - `storybook`: the story play functions in a real browser (Chromium through Playwright).
 */
export default defineConfig({
    test: {
        projects: [
            {
                extends: './vite.config.ts',
                test: {
                    name: 'unit',
                    environment: 'node',
                    include: ['app/**/*.test.ts', 'server/**/*.test.ts'],
                    globals: true,
                },
            },
            {
                extends: './vite.config.ts',
                plugins: [storybookTest({configDir: path.join(dirname, '.storybook')})],
                test: {
                    name: 'storybook',
                    browser: {
                        enabled: true,
                        headless: true,
                        provider: playwright(),
                        instances: [{browser: 'chromium'}],
                    },
                },
            },
        ],
    },
});
