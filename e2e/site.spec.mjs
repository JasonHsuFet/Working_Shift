// End-to-end checks in a real browser. Like test/excel.test.mjs they do not pin people or shifts: each test picks
// the latest fully written month and its first person from the published data, and sets "today" to the 15th of it.
import { test as base, expect } from '@playwright/test';

const test = base.extend({
    // { month: 'YYYY-MM', days, person: { empId, name }, today: 'YYYY-MM-15', data } of the latest fully written month.
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
    // Fails the test on any uncaught error in the page.
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

test('the period picker jumps to another published month', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    await page.locator('#periodLabel').click();
    const picker = page.locator('#periodDialog');
    await expect(picker).toBeVisible();
    await expect(picker.locator('button[aria-pressed="true"]')).toBeFocused();
    const other = picker.locator('#monthGrid button:not([disabled]):not([aria-pressed="true"])').first();
    const label = (await other.textContent()).trim();
    await other.click();
    await expect(picker).toBeHidden();
    await expect(periodText(page)).toContainText(label.replace(' 月', ''));
});

test('a horizontal drag changes the month, but not inside the picker', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    const drag = async (from, to) => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 5 });
        await page.mouse.up();
    };
    const box = await page.locator('#calendar').boundingBox();
    const shown = await periodText(page).textContent();
    // Dragging leftwards is "next"; go right instead so the latest month still has somewhere to go.
    await drag({ x: box.x + 20, y: box.y + box.height / 2 }, { x: box.x + box.width - 20, y: box.y + box.height / 2 });
    await expect(periodText(page)).not.toHaveText(shown);
    const moved = await periodText(page).textContent();

    // Pointer events straight on the picker: a mouse drag there would select its text, which the swipe already ignores.
    await page.locator('#periodLabel').click();
    const picker = page.locator('#periodDialog');
    await picker.dispatchEvent('pointerdown', { isPrimary: true, pointerId: 7, clientX: 300, clientY: 40, bubbles: true });
    await picker.dispatchEvent('pointerup', { isPrimary: true, pointerId: 7, clientX: 60, clientY: 40, bubbles: true });
    await page.keyboard.press('Escape');
    await expect(periodText(page)).toHaveText(moved);
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

test('the on-duty date and clock follow today across midnight', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today, '23:59') });
    await page.goto('/#/on-duty');
    await expect(page.locator('#onDutyDateLabel')).toContainText('11:59');
    await page.clock.runFor('01:00');
    await expect(page.locator('#onDutyDate')).not.toHaveValue(sample.today);
    await expect(page.locator('#onDutyDateLabel')).toContainText('12:00');
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

test('clearing the employee returns to the form', async ({ page, sample }) => {
    await page.clock.install({ time: at(sample.today) });
    await page.goto(`/#/personal/${sample.person.empId}`);
    await page.locator('#clearEmployee').click();
    await expect(page.locator('#employeeForm')).toBeVisible();
    await expect(page.locator('#personalSchedule')).toBeHidden();
    await expect(page.locator('#empId')).toBeFocused();
    await expect(page).toHaveURL(/#\/personal$/);
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
