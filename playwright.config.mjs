import { defineConfig, devices } from '@playwright/test';

const PORT = 4174; // not the preview default, so a running `pnpm preview` does not clash

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        timezoneId: 'Asia/Taipei',
        locale: 'zh-TW',
        // No service worker cache carried between tests.
        serviceWorkers: 'block',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: false
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
        { name: 'phone', use: { ...devices['Pixel 7'] } }
    ]
});
