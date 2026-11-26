import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DB_FILE, readWorkbook, sheetRows, sheetLeaders, readLookups, parseMonthSheet } from '../scripts/lib/excel.mjs';
import { dayState } from '../web/js/schedule.js';

// Deploy gate: every month in data/ parses. Checks shape only, so a changed schedule never breaks the deploy.
const { ids, defs } = readLookups(readWorkbook(DB_FILE));
const SUMMARY_NAMES = ['1', '早', 'N', 'OFF (X)', 'Total', 'Leader', 'On Job'];
let months = 0;
let leaderRecords = 0;
for (const file of fs.readdirSync(new URL('../data/', import.meta.url))) {
    const year = Number(/^All_(\d{4})\.xlsx$/.exec(file)?.[1]);
    if (!year) continue;
    const book = readWorkbook(file);
    for (const sheet of book.SheetNames.filter(name => /^(0[1-9]|1[0-2])$/.test(name.trim()))) {
        const data = parseMonthSheet(sheetRows(book, sheet), year, Number(sheet), ids, defs, sheetLeaders(book, sheet));
        assert.ok(data, `${file} ${sheet}: day header not found`);
        const people = new Set(data.employees.map(employee => employee.empId));
        assert.ok(data.records.every(record => people.has(record.empId) && data.dates.includes(record.date)));
        assert.ok(!data.employees.some(employee => SUMMARY_NAMES.includes(employee.name)), `${file} ${sheet}: summary rows leaked in`);
        leaderRecords += data.records.filter(record => record.leader).length;
        months++;
    }
}
assert.ok(months > 0, 'no month sheets in data/');
assert.ok(leaderRecords > 0, 'no leader (orange) cells found in data/');

// Staff rows end at the summary block; unknown names are left out; leader keys line up with the row arrays.
const days = Array.from({ length: 31 }, (_, i) => i + 1);
const sheet = [
    ['', '', 'Total', 'Name', ...days],
    ['', '', 8, 'A', 'M1', 'X'],
    ['', '', '', 'B', '2', 'X'],
    ['', '', '', 'C', '2', 'X'],
    ['', '', '', '1', 5, 4]
];
const month = parseMonthSheet(sheet, 2026, 10, new Map([['A', '1'], ['B', '2']]), defs, new Set(['1,4']));
assert.deepEqual(month.employees.map(employee => employee.name), ['A', 'B']);
assert.deepEqual(month.warnings, ['C 在工號表找不到工號，未納入']);
assert.deepEqual(month.records.filter(record => record.leader).map(record => [record.empId, record.date]), [['1', '2026-10-01']]);
// Support shifts keep duty hours apart from the hours worked.
assert.deepEqual(month.shifts.M1, { ...month.shifts.M1, start: '08:00', end: '16:00', fullStart: '08:00', fullEnd: '19:00', group: '1' });

// A month still being written: the date row stops at day 2, "Total" in the row above confirms it.
const partial = parseMonthSheet([
    ['', '', 'Total', 'Name'],
    ['', '', '', '', 1, 2, '前月欠補'],
    ['', '', 2, 'A', '1', 'X', 0],
    ['', '', 1, 'B', '2', '', 5]
], 2027, 1, new Map([['A', '1'], ['B', '2']]), defs);
assert.deepEqual(partial.writtenDays, { '2027-01': 2 });
assert.deepEqual(
    [['1', '2027-01-01'], ['1', '2027-01-02'], ['1', '2027-01-03'], ['2', '2027-01-02'], ['1', '2027-02-01']].map(([empId, date]) => dayState(partial, empId, date).state),
    ['work', 'rest', 'unwritten', 'none', 'unpublished']
);
// Without "Total" a short run of numbers is not a date row; more days than the month has is an error.
assert.equal(parseMonthSheet([['', '', '', 'Name', 1, 2], ['', '', 2, 'A', '1', 'X']], 2027, 1, ids, defs), null);
assert.throws(() => parseMonthSheet([['', '', 'Total', 'Name', ...days.slice(0, 29)], ['', '', 1, 'A', '1']], 2027, 2, ids, defs), /應為 28 天/);

console.log(`ok (${months} months)`);
