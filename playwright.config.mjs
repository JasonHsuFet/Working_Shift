// Browser tests (pnpm test:e2e): builds the site, serves dist/ and drives it in headless Chromium at desktop and phone sizes.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174; // apart from the default preview port, so a running `pnpm preview` does not clash

export default defineConfig({
    testDir: 'e2e',
    fullyParallel: true,
    reporter: [['list']],
    use: {
        baseURL: `http://localhost:${PORT}`,
        timezoneId: 'Asia/Taipei',
        locale: 'zh-TW',
        // Each test starts from the network, not from a service worker cache left by another test.
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
