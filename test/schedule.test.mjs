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

// Personal stats: counts per category, a streak across the month boundary, the next rest day.
const statShifts = { W: { rest: false, color: 'morning' }, N: { rest: false, color: null }, X: { rest: true, color: null } };
const statRecords = [['2026-10-30', 'W'], ['2026-10-31', 'W'], ['2026-11-01', 'N'], ['2026-11-02', 'X']].map(([date, code]) => ({ empId: '1', date, code }));
assert.deepEqual(core.categoryCounts(statRecords, statShifts), { morning: 2, afternoon: 0, night: 0, n: 1, rest: 1 });
const byDate = core.shiftsByDate(statRecords, statShifts);
assert.equal(core.workStreak(byDate, '2026-11-01'), 3);
assert.equal(core.nextRestDay(byDate, '2026-10-30'), '2026-11-02');

// Roster: categories in filter order, N-type shifts by their own group, base code before its variants.
const rosterShifts = {
    '1': { group: '1', color: 'morning', rest: false, start: '08:00' }, M1: { group: '1', color: 'morning', rest: false, start: '08:00' },
    '2': { group: '2', color: 'afternoon', rest: false, start: '16:00' }, N: { group: 'N', color: null, rest: false, start: '09:00' },
    N8: { group: 'N8', color: null, rest: false, start: '08:00' }, X: { group: 'X', color: null, rest: true }
};
const people = new Map(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(empId => [empId, { empId, name: empId.toUpperCase() }]));
const roster = core.groupRoster([['a', 'X'], ['b', 'N'], ['c', 'M1'], ['d', '2'], ['e', '1'], ['f', 'N8'], ['g', '1']].map(([empId, code]) => ({ empId, date: '2026-10-12', code })), rosterShifts, people);
assert.deepEqual(roster.map(group => group.key), ['morning', 'afternoon', 'N8', 'N', 'rest']);
assert.deepEqual(roster[0].records.map(record => record.empId), ['e', 'g', 'c']);

// ICS: only this person's work shifts, in UTC with the full working hours; untimed shifts are all-day; lines fold at 75 octets.
const longLabel = '班'.repeat(40);
const ics = core.icsCalendar({
    shifts: { M1: { label: 'Mobile', rest: false, start: '08:00', end: '16:00', fullStart: '08:00', fullEnd: '19:00' }, Q: { label: longLabel, rest: false }, X: { label: '例假日', rest: true } },
    records: [{ empId: '1', date: '2026-10-31', code: 'M1' }, { empId: '1', date: '2026-11-01', code: 'X' }, { empId: '1', date: '2026-11-02', code: 'Q' }, { empId: '2', date: '2026-10-31', code: 'M1' }]
}, { empId: '1', name: 'A' });
assert.equal(ics.split('BEGIN:VEVENT').length - 1, 2);
assert.ok(ics.includes('DTSTART:20261031T000000Z\r\nDTEND:20261031T110000Z'));
assert.ok(ics.includes('DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261103'));
assert.ok(ics.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75));
assert.ok(ics.replaceAll('\r\n ', '').includes(`SUMMARY:Q ${longLabel}`));
// Week export covers Monday to Sunday, across the month boundary.
assert.deepEqual(core.exportRange('week', '2026-10', '2026-11-01'), { from: '2026-10-26', to: '2026-11-01', suffix: '2026-10-26_2026-11-01' });
