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

// Roster filter has five categories; N/N8 carry no color and fall into N.
const timedSheet = [
    ['', '', 'Total', 'Name', ...Array.from({ length: 31 }, (_, i) => i + 1)],
    ['', '', 8, 'A', 'M1', 'T早', 'M2', 'T中', ...Array(27).fill('')]
];
const timed = parseMonthSheet(timedSheet, 2026, 10, new Map([['A', '1']]), defs).shifts;
// M1/T早/M2/T中: duty is a normal 8 hours and they roster with the base code; the hours actually worked are kept separately.
assert.deepEqual(['M1', 'T早'].map(code => [timed[code].start, timed[code].end]), [['08:00', '16:00'], ['08:00', '16:00']]);
assert.deepEqual(['M2', 'T中'].map(code => [timed[code].start, timed[code].end]), [['16:00', '24:00'], ['16:00', '24:00']]);
assert.deepEqual(['M1', 'T早', 'M2', 'T中'].map(code => [timed[code].fullStart, timed[code].fullEnd]), [['08:00', '19:00'], ['08:00', '19:00'], ['13:00', '24:00'], ['13:00', '24:00']]);
assert.deepEqual(['M1', 'T早', 'M2', 'T中'].map(code => timed[code].group), ['1', '早', '2', '中']);
assert.deepEqual(['M1', 'T早', 'M2', 'T中'].map(code => core.shiftCategory(timed[code])), ['morning', 'morning', 'afternoon', 'afternoon']);
const category = shift => core.shiftCategory(shift);
assert.deepEqual(core.shiftCategories.map(([, label]) => label), ['早班', '中班', '晚班', 'N班', '休假']);
assert.equal(category({ rest: false, color: 'morning' }), 'morning');
assert.equal(category({ rest: false, color: 'afternoon' }), 'afternoon');
assert.equal(category({ rest: false, color: 'night' }), 'night');
assert.equal(category({ rest: false, color: null }), 'n');
assert.equal(category({ rest: true, color: null }), 'rest');

// Month stats: category counts, streak across the month boundary, next rest day.
const statShifts = { W: { rest: false, color: 'morning' }, N: { rest: false, color: null }, X: { rest: true, color: null } };
const statRecords = [['2026-10-30', 'W'], ['2026-10-31', 'W'], ['2026-11-01', 'N'], ['2026-11-02', 'X'], ['2026-11-03', 'W']].map(([date, code]) => ({ empId: '1', date, code }));
assert.deepEqual(core.categoryCounts(statRecords, statShifts), { morning: 3, afternoon: 0, night: 0, n: 1, rest: 1 });
const statDays = core.shiftsByDate(statRecords, statShifts);
assert.equal(core.workStreak(statDays, '2026-11-01'), 3);
assert.equal(core.workStreak(statDays, '2026-11-02'), 0);
assert.equal(core.workStreak(statDays, '2026-11-09'), 0);
assert.equal(core.nextRestDay(statDays, '2026-10-30'), '2026-11-02');
assert.equal(core.nextRestDay(statDays, '2026-11-02'), null);

// Weeks start on Monday.
assert.equal(core.weekStart('2026-10-12'), '2026-10-12');
assert.equal(core.weekStart('2026-10-18'), '2026-10-12');
assert.equal(core.weekStart('2026-11-01'), '2026-10-26');

// ICS export: only this person's work shifts; midnight end stays in Asia/Taipei; untimed shifts are all-day; long lines are folded.
const supportShifts = { M1: { label: 'Mobile', rest: false, start: '08:00', end: '16:00', fullStart: '08:00', fullEnd: '19:00' } };
const supportRecord = { empId: '1', date: '2026-10-12', code: 'M1' };
assert.equal(core.bounds(supportRecord, supportShifts).end, Date.parse('2026-10-12T16:00:00+08:00'));
assert.equal(core.bounds(supportRecord, supportShifts, true).end, Date.parse('2026-10-12T19:00:00+08:00'));
assert.ok(core.icsCalendar({ shifts: supportShifts, records: [supportRecord] }, { empId: '1', name: 'A' }).includes('DTEND:20261012T110000Z'));
const longLabel = '班'.repeat(40);
const icsData = {
    shifts: { '2': { label: 'TX 中班', start: '16:00', end: '24:00', rest: false }, Q: { label: longLabel, rest: false }, X: { label: '例假日', rest: true } },
    records: [
        { empId: '1', date: '2026-10-31', code: '2' }, { empId: '1', date: '2026-11-01', code: 'X' },
        { empId: '1', date: '2026-11-02', code: 'Q' }, { empId: '2', date: '2026-10-31', code: '2' }
    ]
};
const ics = core.icsCalendar(icsData, { empId: '1', name: 'A' }, new Date('2026-10-01T00:00:00Z'));
assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2);
assert.ok(ics.includes('DTSTART:20261031T080000Z\r\nDTEND:20261031T160000Z'));
assert.ok(ics.includes('DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261103'));
assert.ok(ics.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
assert.ok(ics.replaceAll('\r\n ', '').includes(`SUMMARY:Q ${longLabel}`));

console.log(`ok (${months} months)`);
