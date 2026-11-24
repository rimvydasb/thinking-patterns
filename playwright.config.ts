import {defineConfig, devices} from '@playwright/test';

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
    webServer: {
        command: 'npm run dev -- --port 5174 --strictPort',
        url: 'http://localhost:5174',
        reuseExistingServer: !process.env.CI,
    },
});
