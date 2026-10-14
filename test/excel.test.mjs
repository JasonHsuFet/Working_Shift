import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DB_FILE, readWorkbook, sheetRows, sheetLeaders, readLookups, parseMonthSheet } from '../scripts/lib/excel.mjs';
import { shiftCategory } from '../web/js/schedule.js';

// Checks shape only, so uploading a changed schedule never breaks the deploy.
const { ids, defs } = readLookups(readWorkbook(DB_FILE));
const SUMMARY_NAMES = ['1', '早', 'N', 'OFF (X)', 'Total', 'Leader', 'On Job'];
let months = 0;
let leaderRecords = 0;
for (const file of fs.readdirSync(new URL('../data/', import.meta.url))) {
    const year = Number(/^All_(\d{4})\.xlsx$/.exec(file)?.[1]);
    if (!year) continue;
    const book = readWorkbook(file);
    for (const sheet of book.SheetNames.filter(name => /^(0[1-9]|1[0-2])$/.test(name.trim()))) {
        const month = Number(sheet);
        const data = parseMonthSheet(sheetRows(book, sheet), year, month, ids, defs, sheetLeaders(file, book, sheet));
        assert.ok(data, `${file} ${sheet}: day header not found`);
        assert.equal(data.dates.length, new Date(Date.UTC(year, month, 0)).getUTCDate());
        assert.ok(data.employees.length > 0);
        const people = new Set(data.employees.map(employee => employee.empId));
        assert.ok(data.records.every(record => people.has(record.empId) && data.dates.includes(record.date)));
        assert.ok(!data.employees.some(employee => SUMMARY_NAMES.includes(employee.name)), `${file} ${sheet}: summary rows leaked in`);
        assert.ok(!data.warnings.some(warning => SUMMARY_NAMES.some(name => warning.startsWith(`${name} 在工號表`))), `${file} ${sheet}: summary rows reported as staff`);
        leaderRecords += data.records.filter(record => record.leader).length;
        months++;
    }
}
assert.ok(months > 0, 'no month sheets in data/');
// Leader = orange-filled shift cell; zero across all months means the fill reader broke.
assert.ok(leaderRecords > 0, 'no leader (orange) cells found in data/');

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
// Leader keys are "row,col" of the sheet array: only A's first day is marked here.
const led = parseMonthSheet(sheet, 2026, 10, new Map([['A', '1'], ['B', '2']]), defs, new Set(['1,4']));
assert.deepEqual(led.records.filter(record => record.leader).map(record => [record.empId, record.date]), [['1', '2026-10-01']]);

// M1/T早/M2/T中 keep their duty hours, full hours and roster group.
const timedSheet = [
    ['', '', 'Total', 'Name', ...Array.from({ length: 31 }, (_, i) => i + 1)],
    ['', '', 8, 'A', 'M1', 'T早', 'M2', 'T中', ...Array(27).fill('')]
];
const timed = parseMonthSheet(timedSheet, 2026, 10, new Map([['A', '1']]), defs).shifts;
assert.deepEqual(['M1', 'T早'].map(code => [timed[code].start, timed[code].end]), [['08:00', '16:00'], ['08:00', '16:00']]);
assert.deepEqual(['M2', 'T中'].map(code => [timed[code].start, timed[code].end]), [['16:00', '24:00'], ['16:00', '24:00']]);
assert.deepEqual(['M1', 'T早', 'M2', 'T中'].map(code => [timed[code].fullStart, timed[code].fullEnd]), [['08:00', '19:00'], ['08:00', '19:00'], ['13:00', '24:00'], ['13:00', '24:00']]);
assert.deepEqual(['M1', 'T早', 'M2', 'T中'].map(code => timed[code].group), ['1', '早', '2', '中']);
assert.deepEqual(['M1', 'T早', 'M2', 'T中'].map(code => shiftCategory(timed[code])), ['morning', 'morning', 'afternoon', 'afternoon']);

console.log(`ok (${months} months)`);
