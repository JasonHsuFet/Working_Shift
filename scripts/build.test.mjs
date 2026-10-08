import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DB_FILE, readWorkbook, sheetRows, readLookups, parseMonthSheet } from './build.mjs';

// Checks shape only, so uploading a changed schedule never breaks the deploy.
const { ids, defs } = readLookups(readWorkbook(DB_FILE));
const SUMMARY_NAMES = ['1', '早', 'N', 'OFF (X)', 'Total', 'Leader', 'On Job'];
let months = 0;
for (const file of fs.readdirSync(new URL('../data/', import.meta.url))) {
    const year = Number(/^All_(\d{4})\.xlsx$/.exec(file)?.[1]);
    if (!year) continue;
    const book = readWorkbook(file);
    for (const sheet of book.SheetNames.filter(name => /^(0[1-9]|1[0-2])$/.test(name.trim()))) {
        const month = Number(sheet);
        const data = parseMonthSheet(sheetRows(book, sheet), year, month, ids, defs);
        assert.ok(data, `${file} ${sheet}: day header not found`);
        assert.equal(data.dates.length, new Date(Date.UTC(year, month, 0)).getUTCDate());
        assert.ok(data.employees.length > 0);
        const people = new Set(data.employees.map(employee => employee.empId));
        assert.ok(data.records.every(record => people.has(record.empId) && data.dates.includes(record.date)));
        assert.ok(!data.employees.some(employee => SUMMARY_NAMES.includes(employee.name)), `${file} ${sheet}: summary rows leaked in`);
        assert.ok(!data.warnings.some(warning => SUMMARY_NAMES.some(name => warning.startsWith(`${name} 在工號表`))), `${file} ${sheet}: summary rows reported as staff`);
        months++;
    }
}
assert.ok(months > 0, 'no month sheets in data/');

// A staff row with an empty Total is still read; the summary block (first row named "1") ends the table.
const day = n => Array.from({ length: 31 }, (_, i) => (i < n ? 'X' : ''));
const sheet = [
    ['', '', 'Total', 'Name', ...Array.from({ length: 31 }, (_, i) => i + 1)],
    ['', '', 8, 'A', '1', ...day(30)],
    ['', '', '', 'B', '2', ...day(30)],
    ['', '', '', '1', 5, ...day(30)]
];
const fake = parseMonthSheet(sheet, 2026, 10, new Map([['A', '1'], ['B', '2']]), defs);
assert.deepEqual(fake.employees.map(employee => employee.name), ['A', 'B']);
assert.equal(fake.shifts['1'].color, 'morning');
assert.equal(fake.shifts['2'].group, '2');
assert.equal(parseMonthSheet(sheet, 2026, 10, new Map([['A', '1']]), defs).warnings[0], 'B 在工號表找不到工號，未納入');

// Who is on duty: 16:00–24:00 ends at midnight, 00:00–08:00 belongs to its own date, 22:00–06:00 runs into the next day.
await import('../schedule-core.js');
const core = globalThis.ScheduleCore;
const shifts = { '2': { start: '16:00', end: '24:00', rest: false }, '3': { start: '00:00', end: '08:00', rest: false }, L: { start: '22:00', end: '06:00', rest: false }, X: { rest: true } };
const onDuty = (code, date, at) => core.currentRecords({ shifts, records: [{ empId: '1', date, code }] }, new Date(at)).length === 1;
assert.ok(onDuty('2', '2026-10-31', '2026-10-31T23:59:00+08:00'));
assert.ok(!onDuty('2', '2026-10-31', '2026-11-01T00:00:00+08:00'));
assert.ok(onDuty('3', '2026-11-01', '2026-11-01T07:59:00+08:00'));
assert.ok(!onDuty('3', '2026-11-01', '2026-11-01T08:00:00+08:00'));
assert.ok(onDuty('L', '2026-10-31', '2026-11-01T05:59:00+08:00'));
assert.ok(!onDuty('X', '2026-10-31', '2026-10-31T12:00:00+08:00'));
assert.equal(core.taipeiDate(new Date('2026-10-31T16:30:00Z')), '2026-11-01');

console.log(`ok (${months} months)`);
