// No pinned people or shifts: each test takes the latest fully written month and its first person, with "today" on the 15th.
import { test as base, expect } from '@playwright/test';

const test = base.extend({
    sample: async ({ request }, use) => {
        const { months } = await (await request.get('/data/index.json')).json();
        for (const month of [...months].reverse()) {
            const data = await (await request.get(`/data/${month}.json`)).json();
            if (data.writtenDays[month] !== data.dates.length) continue;
            await use({ month, days: data.dates.length, person: data.employees[0], today: `${month}-15`, data });
            return;
        }
        throw new Error('no fully written month published');
    },
    // Any uncaught page error fails the test.
    page: async ({ page }, use) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await use(page);
        expect(errors).toEqual([]);
    }
});

const at = (date, time = '10:00') => new Date(`${date}T${time}:00+08:00`);
const remember = (page, empId) => page.addInitScript(id => localStorage.setItem('noc.empId', id), empId);
const periodText = page => page.locator('#periodText');

test('a remembered person opens on this month with today selected', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await remember(page, sample.person.empId);
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`#/personal/${sample.person.empId}$`));
    await expect(page.locator('#employeeName')).toHaveText(sample.person.name);
    await expect(page.locator('#calendar button.day')).toHaveCount(sample.days);
    await expect(page.locator('#calendar button.day.today.selected')).toHaveCount(1);
    await expect(page.locator('#selectedShift')).not.toBeEmpty();
    await expect(page.locator('#statCounts')).toContainText('本月');
    await expect(page.locator('#dataStatus')).toHaveText('已連線，班表已同步');
});

test('a first visit asks for the employee ID and rejects unknown ones', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto('/');
    const dialog = page.locator('#empDialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('#empDialogId').fill('NOBODY');
    await dialog.getByRole('button', { name: '確定' }).click();
    await expect(page.locator('#empDialogError')).toBeVisible();
    await dialog.locator('#empDialogId').fill(sample.person.empId);
    await dialog.getByRole('button', { name: '確定' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('#employeeName')).toHaveText(sample.person.name);
});

test('month and week navigation', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    const shown = await periodText(page).textContent();
    await page.locator('#prevPeriod').click();
    await expect(periodText(page)).not.toHaveText(shown);
    await page.locator('#nextPeriod').click();
    await expect(periodText(page)).toHaveText(shown);

    await page.locator('[data-view="week"]').click();
    await expect(page.locator('#weekList button.week-row')).toHaveCount(7);
    await expect(page.locator('#calendar')).toBeHidden();
    await expect(page.locator('#periodLabel')).toBeDisabled();
    const week = await periodText(page).textContent();
    await page.locator('#nextPeriod').click();
    await expect(periodText(page)).not.toHaveText(week);
    await page.locator('[data-view="month"]').click();
    await expect(page.locator('#calendar')).toBeVisible();
});

test('quick repeated taps add up before the months finish loading', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    await expect(page.locator('#calendar button.day.today')).toHaveCount(1);
    const months = (await (await page.request.get('/data/index.json')).json()).months;
    const back = months[months.indexOf(sample.month) - 3];
    // Three clicks in one go, without waiting for the page in between.
    await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('prevPeriod').click(); });
    await expect(periodText(page)).toHaveText(`${Number(back.slice(0, 4))} 年 ${Number(back.slice(5))} 月`);
});

test('a horizontal drag changes the month', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    const box = await page.locator('#calendar').boundingBox();
    const shown = await periodText(page).textContent();
    // Rightwards is "previous", so the latest month still has somewhere to go.
    await page.mouse.move(box.x + 20, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(periodText(page)).not.toHaveText(shown);
});

test('on-duty roster, filters and the today button', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto('/#/on-duty');
    const now = page.locator('#shiftFilter [data-cat="now"]');
    await expect(now).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#onDutyDate')).toHaveValue(sample.today);
    await expect(page.locator('#onDutyDateLabel')).toContainText('10:00');
    await expect(page.locator('#onDutySummary')).toContainText('值班中');

    await page.locator('#nextDay').click();
    await expect(now).toBeDisabled();
    await expect(page.locator('#shiftFilter [data-cat="all"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#onDutySummary')).toContainText('出勤');
    await page.locator('#shiftFilter [data-cat="rest"]').click();
    const headings = page.locator('#onDutyRoster .roster-group h3');
    await expect(headings).toHaveText(['休假']);

    await page.locator('#goToday').click();
    await expect(page.locator('#onDutyDate')).toHaveValue(sample.today);
    await expect(now).toHaveAttribute('aria-pressed', 'true');
});

test('a month written only up to day 10 shows the rest as unwritten', async ({ page, sample }) => {
    // Rewrite the published month as if its date row stopped at day 10.
    await page.route(`**/data/${sample.month}.json`, route => route.fulfill({
        json: {
            ...sample.data,
            writtenDays: { [sample.month]: 10 },
            records: sample.data.records.filter(record => Number(record.date.slice(8)) <= 10)
        }
    }));
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    await expect(page.locator('#calendar button.day.unwritten')).toHaveCount(sample.days - 10);
    await expect(page.locator('#selectedShift')).toHaveText('尚未排班');
    await expect(page.locator('#dataStatus')).toHaveText('今日尚未排班');

    await page.locator('a[data-tab="on-duty"]').click();
    await expect(page.locator('#onDutyNotice')).toHaveText('此日期尚未排班。');
    await expect(page.locator('#shiftFilter [data-cat="now"]')).toBeDisabled();
});

test('ICS export downloads the shown month', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportIcs').click()]);
    expect(download.suggestedFilename()).toBe(`noc-shift-${sample.person.empId}-${sample.month}.ics`);
    const text = await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString());
    expect(text.startsWith('BEGIN:VCALENDAR')).toBe(true);
});

test('on a phone the whole month fits on screen', async ({ page, sample }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone', 'phone layout only');
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    const lastDay = page.locator('#calendar button.day').last();
    await expect(lastDay).toBeVisible();
    const box = await lastDay.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
    expect(box.height).toBeGreaterThanOrEqual(36);
});
