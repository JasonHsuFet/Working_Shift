// Reads the Excel sources: the 工號/NNOC班別 lookups and the month sheets.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { SHIFT_TYPES, TIME_ALIASES, DUTY_TIMES, FULL_TIMES, ROSTER_GROUPS, REST_CODES, COLORS, GROUP_LABELS } from './shift-rules.mjs';

export const DATA = path.resolve(import.meta.dirname, '../../data');
export const DB_FILE = 'TPKC_NNOC班表模板_V1_3_DB版.xlsm';

function text(value) {
    return value == null ? '' : String(value).trim();
}

// ponytail: sheetRows cap, since some sheets claim 1,048,576 used rows; raise it if staff tables ever pass 1000 rows
export function readWorkbook(file) {
    return XLSX.read(fs.readFileSync(path.join(DATA, file)), { sheetRows: 1000 });
}

export function sheetRows(workbook, name) {
    return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true });
}

// 工號 sheet: active staff in A/B, leavers in E/F as fallback. First entry per name wins.
export function readLookups(workbook) {
    for (const name of ['工號', 'NNOC班別']) {
        if (!workbook.Sheets[name]) throw new Error(`${DB_FILE} 缺少工作表：${name}`);
    }
    const ids = new Map();
    const warnings = [];
    const idRows = sheetRows(workbook, '工號');
    for (const [nameCol, idCol] of [[0, 1], [4, 5]]) {
        for (const row of idRows) {
            const name = text(row[nameCol]);
            const empId = text(row[idCol]).toUpperCase();
            if (!name || !/^(T\d+|\d+)$/.test(empId)) continue;
            if (ids.has(name)) {
                if (ids.get(name) !== empId) warnings.push(`工號表姓名 ${name} 重複，採第一筆 ${ids.get(name)}`);
                continue;
            }
            ids.set(name, empId);
        }
    }
    const defs = new Map();
    const time = value => {
        if (typeof value === 'number') {
            const minutes = Math.round(value * 1440);
            return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
        }
        const result = text(value);
        return /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(result) ? result : null;
    };
    for (const row of sheetRows(workbook, 'NNOC班別').slice(1)) {
        const type = text(row[0]);
        if (type) defs.set(type, { label: text(row[1]), start: time(row[2]), end: time(row[3]) });
    }
    return { ids, defs, warnings };
}

// Day header = the row holding a run 1,2,3,…,28+; name column sits left of day 1, the Total column left of that.
function findDayHeader(rows) {
    for (const [index, row] of rows.slice(0, 10).entries()) {
        for (let col = 2; col < row.length; col++) {
            if (row[col] !== 1) continue;
            let count = 0;
            while (row[col + count] === count + 1) count++;
            if (count >= 28) return { index, dayCol: col, count };
        }
    }
    return null;
}

export function parseMonthSheet(rows, year, month, ids, defs) {
    const header = findDayHeader(rows);
    if (!header) return null;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const monthLength = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (header.count !== monthLength) throw new Error(`${monthKey} 日期欄有 ${header.count} 天，應為 ${monthLength} 天`);
    const dates = Array.from({ length: monthLength }, (_, day) => `${monthKey}-${String(day + 1).padStart(2, '0')}`);
    const nameCol = header.dayCol - 1;
    const totalCol = header.dayCol - 2;
    const shifts = {};
    const employees = new Map();
    const records = [];
    const warnings = new Set();
    for (let index = header.index + 1; index < rows.length; index++) {
        const row = rows[index];
        const name = text(row[nameCol]);
        // summary tables below the staff rows have no Total and start with a shift-code row ("1")
        if (text(row[totalCol]) === '' && Object.hasOwn(SHIFT_TYPES, name)) break;
        if (!name || !dates.some((_, day) => text(row[header.dayCol + day]))) continue;
        const empId = ids.get(name);
        if (!empId) {
            warnings.add(`${name} 在工號表找不到工號，未納入`);
            continue;
        }
        if (employees.has(empId)) throw new Error(`${monthKey} 第 ${index + 1} 列：工號 ${empId}（${name}）重複出現`);
        employees.set(empId, { empId, name });
        dates.forEach((date, day) => {
            const code = text(row[header.dayCol + day]).toUpperCase();
            if (!code) return;
            const type = SHIFT_TYPES[code];
            if (!type) throw new Error(`${monthKey} 無法辨識班別：第 ${index + 1} 列 ${date}「${code}」`);
            const rest = REST_CODES.has(code);
            const timeDef = defs.get(SHIFT_TYPES[TIME_ALIASES[code] || code]);
            const duty = DUTY_TIMES[code];
            const full = FULL_TIMES[code];
            const group = ROSTER_GROUPS[code] || code;
            const label = GROUP_LABELS[group] || (defs.get(type)?.label || type).replaceAll('NNOC', 'NOC').replace(/^NOC-/, '');
            shifts[code] = { type, label, group, color: COLORS[code] || null, rest, start: rest ? null : duty?.[0] || timeDef?.start || null, end: rest ? null : duty?.[1] || timeDef?.end || null, ...(full && { fullStart: full[0], fullEnd: full[1] }) };
            if (!rest && (!shifts[code].start || !shifts[code].end)) warnings.add(`班別 ${code} (${type}) 缺少時間，未納入當前值班判斷`);
            records.push({ empId, date, code });
        });
    }
    if (!records.length) throw new Error(`${monthKey} 沒有任何可用排班`);
    return { dates, shifts, employees: [...employees.values()], records, warnings: [...warnings] };
}
