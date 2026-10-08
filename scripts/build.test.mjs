import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { readLookups, parseMonthSheet } from './build.mjs';

const read = file => XLSX.read(fs.readFileSync(new URL(`../data/${file}`, import.meta.url)));
const rows = (workbook, sheet) => XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1, defval: '', raw: true });
const { ids, defs } = readLookups(read('TPKC_NNOC班表模板_V1_3_DB版.xlsm'));
const book = read('All_2026.xlsx');

const october = parseMonthSheet(rows(book, '10'), 2026, 10, ids, defs);
assert.equal(october.dates.length, 31);
assert.equal(october.employees.length, 43);
assert.deepEqual(october.records[0], { empId: '61668', date: '2026-10-01', code: '3' });
assert.deepEqual(october.shifts['3'], { type: 'NT-3', label: 'NNOC-Mobile晚班', rest: false, start: '00:00', end: '08:00' });
assert.ok(!october.employees.some(employee => ['早', 'OFF (X)', 'Total', 'Leader'].includes(employee.name)), 'summary rows leaked in');

// July has an extra "T" column, so names and days sit one column further right.
const july = parseMonthSheet(rows(book, '07'), 2026, 7, ids, defs);
assert.equal(july.dates.length, 31);
assert.deepEqual(july.records.slice(0, 3).map(record => record.code), ['3', '3', '3']);
assert.equal(july.records[0].empId, '61668');

console.log('ok');
