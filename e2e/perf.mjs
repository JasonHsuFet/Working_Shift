// Performance profile of a served build: cold load, then bursts of fast interactions.
// node e2e/perf.mjs [baseURL ...] [--runs=3] [--cpu=1,4]   (default http://localhost:4173, i.e. `pnpm preview`)
// Several URLs are profiled side by side, e.g. an older build on another port. Prints medians; asserts nothing.
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const urls = args.filter(arg => !arg.startsWith('--'));
if (!urls.length) urls.push('http://localhost:4173');
const option = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const RUNS = Number(option('runs', 3));
const CPU = option('cpu', '1,4').split(',').map(Number);
const NOW = new Date('2026-11-26T10:00:00+08:00');

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const p95 = values => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)];

// Runs in the page: helpers shared by the scenarios, installed before the site's own scripts and before page.clock,
// which fakes `performance` and `requestAnimationFrame`; the real ones are kept as __perf / __raf for measuring.
function pageHelpers() {
    window.__perf = performance;
    window.__raf = requestAnimationFrame.bind(window);
    window.__long = [];
    new PerformanceObserver(list => window.__long.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true });
    const frame = () => new Promise(resolve => window.__raf(() => resolve()));
    window.__frame = frame;
    window.__until = async (condition, limit = 10000) => {
        const start = window.__perf.now();
        while (!condition()) {
            if (window.__perf.now() - start > limit) throw new Error('timed out waiting for the page');
            await frame();
        }
    };
    window.__text = id => document.getElementById(id).textContent.replace(/\s+/g, ' ').trim();
    // Clicks, then waits until `changed()` holds and one more frame is painted; returns the latency in ms.
    window.__step = async (click, changed) => {
        const start = window.__perf.now();
        click();
        await window.__until(changed);
        await frame();
        return window.__perf.now() - start;
    };
}

async function profile(baseURL, cpu, person) {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, timezoneId: 'Asia/Taipei', locale: 'zh-TW', serviceWorkers: 'block' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
    const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return (await metrics()).JSHeapUsedSize / 1048576;
    };
    const cost = (before, after) => ({
        script: (after.ScriptDuration - before.ScriptDuration) * 1000,
        layout: (after.LayoutDuration - before.LayoutDuration) * 1000,
        style: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000
    });
    await page.addInitScript(pageHelpers);
    await page.clock.install({ time: NOW });
    const result = {};

    // Cold load until the calendar shows today.
    let before = await metrics();
    await page.goto(`${baseURL}/#/personal/${person.empId}`);
    await page.evaluate(() => window.__until(() => document.querySelector('#calendar button.day.today')));
    const shown = await page.evaluate(() => window.__perf.now());
    let after = await metrics();
    const navigation = await page.evaluate(() => {
        const [nav] = window.__perf.getEntriesByType('navigation');
        const bytes = window.__perf.getEntriesByType('resource').reduce((sum, entry) => sum + entry.encodedBodySize, nav.encodedBodySize);
        return { dcl: nav.domContentLoadedEventEnd, kb: bytes / 1024 };
    });
    result.load = { ready: shown, ...navigation, ...cost(before, after), heap: await heap() };

    // Personal tab bursts.
    before = await metrics();
    const burst = await page.evaluate(async () => {
        const { months } = await (await fetch('./data/index.json')).json();
        const label = month => `${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月`;
        const current = window.__text('periodText');
        const index = months.findIndex(month => label(month) === current);
        // As many quick taps back as there are earlier months (up to 24), then the same number forward again.
        const taps = Math.min(24, index);
        const target = label(months[index - taps]);
        const start = window.__perf.now();
        for (let i = 0; i < taps; i++) document.getElementById('prevPeriod').click();
        await window.__until(() => window.__text('periodText') === target);
        for (let i = 0; i < taps; i++) document.getElementById('nextPeriod').click();
        await window.__until(() => window.__text('periodText') === current);
        return window.__perf.now() - start;
    });
    result.monthBurst = { ms: burst, ...cost(before, await metrics()) };

    before = await metrics();
    const days = await page.evaluate(async () => {
        const times = [];
        const count = document.querySelectorAll('#calendar button.day').length;
        for (let i = 0; i < count; i++) {
            times.push(await window.__step(() => document.querySelectorAll('#calendar button.day')[i].click(), () => document.querySelectorAll('#calendar button.day')[i].getAttribute('aria-pressed') === 'true'));
        }
        return times;
    });
    result.daySelect = { p50: median(days), p95: p95(days), ...cost(before, await metrics()) };

    await page.locator('[data-view="week"]').click();
    await page.evaluate(() => window.__until(() => document.querySelectorAll('#weekList button.week-row').length === 7 && !document.getElementById('weekList').hidden));
    before = await metrics();
    const weeks = await page.evaluate(async () => {
        const times = [];
        for (const id of [...Array(20).fill('prevPeriod'), ...Array(20).fill('nextPeriod')]) {
            const was = window.__text('periodText');
            times.push(await window.__step(() => document.getElementById(id).click(), () => window.__text('periodText') !== was));
        }
        return times;
    });
    result.weekSteps = { p50: median(weeks), p95: p95(weeks), ...cost(before, await metrics()) };
    await page.locator('[data-view="month"]').click();

    // On-duty bursts.
    await page.evaluate(() => { location.hash = '#/on-duty'; });
    await page.evaluate(() => window.__until(() => !document.getElementById('on-duty').hidden && window.__text('onDutySummary').includes('值班中')));
    before = await metrics();
    const dates = await page.evaluate(async () => {
        const times = [];
        for (let i = 0; i < 30; i++) {
            const was = window.__text('onDutyDateLabel');
            times.push(await window.__step(() => document.getElementById('nextDay').click(), () => window.__text('onDutyDateLabel') !== was));
        }
        return times;
    });
    result.dayStepsOnDuty = { p50: median(dates), p95: p95(dates), ...cost(before, await metrics()) };

    before = await metrics();
    const filters = await page.evaluate(async () => {
        const times = [];
        for (let round = 0; round < 5; round++) {
            for (const cat of ['all', 'morning', 'afternoon', 'night', 'n', 'rest', 'all']) {
                const button = document.querySelector(`#shiftFilter [data-cat="${cat}"]`);
                times.push(await window.__step(() => button.click(), () => button.getAttribute('aria-pressed') === 'true'));
            }
        }
        return times;
    });
    result.filters = { p50: median(filters), p95: p95(filters), ...cost(before, await metrics()) };

    // The 30-second clock on today's live roster.
    await page.locator('#goToday').click();
    await page.evaluate(() => window.__until(() => window.__text('onDutySummary').includes('值班中')));
    before = await metrics();
    for (let i = 0; i < 10; i++) await page.clock.runFor(30000);
    await page.evaluate(() => window.__frame());
    result.clockTicks = cost(before, await metrics());

    result.longTasks = await page.evaluate(() => ({ count: window.__long.length, ms: window.__long.reduce((sum, value) => sum + value, 0) }));
    result.heapAfter = await heap();
    await browser.close();
    return result;
}

// Medians over runs, flattened to "scenario.metric" rows.
function summarize(runs) {
    const rows = {};
    for (const run of runs) {
        for (const [scenario, values] of Object.entries(run)) {
            for (const [metric, value] of Object.entries(typeof values === 'object' ? values : { value: values })) {
                (rows[`${scenario}.${metric}`] ??= []).push(value);
            }
        }
    }
    return Object.fromEntries(Object.entries(rows).map(([key, values]) => [key, median(values)]));
}

const browser = await chromium.launch();
const request = await (await browser.newContext()).request;
const { months } = await (await request.get(`${urls[0]}/data/index.json`)).json();
const person = (await (await request.get(`${urls[0]}/data/${months.includes('2026-11') ? '2026-11' : months.at(-1)}.json`)).json()).employees[0];
await browser.close();

for (const cpu of CPU) {
    const columns = [];
    for (const url of urls) {
        const runs = [];
        for (let i = 0; i < RUNS; i++) runs.push(await profile(url, cpu, person));
        columns.push(summarize(runs));
    }
    console.log(`\n## CPU ${cpu}x (median of ${RUNS} runs; ms unless noted)`);
    console.log(['metric', ...urls].join(' | '));
    for (const key of Object.keys(columns[0])) {
        console.log([key, ...columns.map(column => (column[key] ?? NaN).toFixed(key.includes('count') ? 0 : 1))].join(' | '));
    }
}
