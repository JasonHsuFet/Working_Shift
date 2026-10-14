import assert from 'node:assert/strict';
import * as core from '../web/js/schedule.js';

// Who is on duty: 16:00–24:00 ends at midnight, 00:00–08:00 belongs to its own date, 22:00–06:00 runs into the next day.
const shifts = { '2': { start: '16:00', end: '24:00', rest: false }, '3': { start: '00:00', end: '08:00', rest: false }, L: { start: '22:00', end: '06:00', rest: false }, X: { rest: true } };
const onDuty = (code, date, at) => core.currentRecords({ shifts, records: [{ empId: '1', date, code }] }, new Date(at)).length === 1;
assert.ok(onDuty('2', '2026-10-31', '2026-10-31T23:59:00+08:00'));
assert.ok(!onDuty('2', '2026-10-31', '2026-11-01T00:00:00+08:00'));
assert.ok(onDuty('3', '2026-11-01', '2026-11-01T07:59:00+08:00'));
assert.ok(!onDuty('3', '2026-11-01', '2026-11-01T08:00:00+08:00'));
assert.ok(onDuty('L', '2026-10-31', '2026-11-01T05:59:00+08:00'));
assert.ok(!onDuty('X', '2026-10-31', '2026-10-31T12:00:00+08:00'));
assert.equal(core.taipeiDate(new Date('2026-10-31T16:30:00Z')), '2026-11-01');

// Live on-duty view follows the calendar date change; a manually selected date is not overridden.
assert.equal(core.liveDate('2026-10-14', '2026-10-15', true), '2026-10-15');
assert.equal(core.liveDate('2026-10-13', '2026-10-15', false), '2026-10-13');

// Roster filter has five categories; N/N8 carry no color and fall into N.
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


// Time labels: overnight shifts are marked, support hours show the duty part.
assert.equal(core.timeLabel({ rest: true }), '休假');
assert.equal(core.timeLabel({ rest: false }), '時間未定義');
assert.equal(core.timeLabel({ rest: false, start: '22:00', end: '06:00' }), '22:00–06:00（翌日）');
assert.equal(core.timeLabel({ rest: false, start: '16:00', end: '24:00' }), '16:00–24:00');
assert.equal(core.workTimeLabel(supportShifts.M1), '08:00–19:00（值班 08:00–16:00）');

// Roster groups: categories in filter order, N-type shifts by their own group, base code before its variants.
const rosterShifts = {
    '1': { group: '1', color: 'morning', rest: false, start: '08:00' }, M1: { group: '1', color: 'morning', rest: false, start: '08:00' },
    '2': { group: '2', color: 'afternoon', rest: false, start: '16:00' }, N: { group: 'N', color: null, rest: false, start: '09:00' },
    N8: { group: 'N8', color: null, rest: false, start: '08:00' }, X: { group: 'X', color: null, rest: true }
};
const rosterPeople = new Map(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(empId => [empId, { empId, name: empId.toUpperCase() }]));
const roster = core.groupRoster([['a', 'X'], ['b', 'N'], ['c', 'M1'], ['d', '2'], ['e', '1'], ['f', 'N8'], ['g', '1']].map(([empId, code]) => ({ empId, date: '2026-10-12', code })), rosterShifts, rosterPeople);
assert.deepEqual(roster.map(group => group.key), ['morning', 'afternoon', 'N8', 'N', 'rest']);
assert.deepEqual(roster[0].records.map(record => record.empId), ['e', 'g', 'c']);

// ICS range follows the shown month or Monday-Sunday week.
assert.deepEqual(core.exportRange('month', '2026-10', '2026-10-14'), { from: '2026-10-01', to: '2026-10-31', suffix: '2026-10' });
assert.deepEqual(core.exportRange('week', '2026-10', '2026-11-01'), { from: '2026-10-26', to: '2026-11-01', suffix: '2026-10-26_2026-11-01' });
