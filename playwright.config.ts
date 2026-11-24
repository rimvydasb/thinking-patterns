import {defineConfig, devices} from '@playwright/test';

/** Port of the MCP/sync server started for the e2e run (kept apart from a dev server on 3001). */
export const E2E_SERVER_PORT = 3012;

/** GUI tests for the stand-alone app only (Storybook stories are covered by play functions). */
export default defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://localhost:5174',
        trace: 'retain-on-failure',
    },
    projects: [{name: 'chromium', use: {...devices['Desktop Chrome']}}],
    // The MCP/sync server is started by the tests that need it (e2e/server.ts), so they can restart it and give it
    // a maps directory of their own.
    webServer: [
        {
            command: `SERVER_URL=http://127.0.0.1:${E2E_SERVER_PORT} npm run dev -- --port 5174 --strictPort`,
            url: 'http://localhost:5174',
            reuseExistingServer: !process.env.CI,
        },
    ],
});
