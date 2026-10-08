// Extracts every month sheet of data/All_YYYY.xlsx into dist/data/YYYY-MM.json and copies the SPA into dist/.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
export const DB_FILE = 'TPKC_NNOC班表模板_V1_3_DB版.xlsm';
const SITE_FILES = ['index.html', 'app.js', 'schedule-core.js', 'style.css', 'manifest.webmanifest', 'sw.js'];

const SHIFT_TYPES = {
    '1': 'NT-1', M1: 'NT-M1', '2': 'NT-2', M2: 'NT-M2', '3': 'NT-3',
    '早': 'NT-早', 'T早': 'NT-T早', '中': 'NT-中', 'T中': 'NT-T中',
    '晚': 'NT-晚', '日': 'NT-日', '小夜': 'NT-小夜', '大夜': 'NT-大夜',
    N: 'NT-正', N8: 'E001', X: '例假日', Y: '休息日', Z: '國定假日', S: 'NT-S', T: 'NT-T'
};
const TIME_ALIASES = { 'T早': '早', 'T中': '中', M1: '1', '大夜': '3', '小夜': '2', '日': '1' };
const REST_CODES = new Set(['X', 'Y', 'Z', 'S', 'T']);
// Codes listed together in the roster, colors and roster labels; the page reads these from shifts[code].
const ROSTER_GROUPS = { M1: '1', 'T早': '早', 'T中': '中' };
const COLORS = {
    '1': 'morning', M1: 'morning', '早': 'morning', 'T早': 'morning', '日': 'morning',
    '2': 'afternoon', M2: 'afternoon', '中': 'afternoon', 'T中': 'afternoon', '小夜': 'afternoon',
    '3': 'night', '晚': 'night', '大夜': 'night'
};
const GROUP_LABELS = { '1': 'Mobile 早班', '早': 'TX 早班', '中': 'TX 中班' };

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
            const group = ROSTER_GROUPS[code] || code;
            const label = GROUP_LABELS[group] || (defs.get(type)?.label || type).replaceAll('NNOC', 'NOC').replace(/^NOC-/, '');
            shifts[code] = { type, label, group, color: COLORS[code] || null, rest, start: rest ? null : timeDef?.start || null, end: rest ? null : timeDef?.end || null };
            if (!rest && (!shifts[code].start || !shifts[code].end)) warnings.add(`班別 ${code} (${type}) 缺少時間，未納入當前值班判斷`);
            records.push({ empId, date, code });
        });
    }
    if (!records.length) throw new Error(`${monthKey} 沒有任何可用排班`);
    return { dates, shifts, employees: [...employees.values()], records, warnings: [...warnings] };
}

function build() {
    const { ids, defs, warnings: dbWarnings } = readLookups(readWorkbook(DB_FILE));
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
    const months = [];
    for (const file of fs.readdirSync(DATA).sort()) {
        const year = Number(/^All_(\d{4})\.xlsx$/.exec(file)?.[1]);
        if (!year) continue;
        const workbook = readWorkbook(file);
        for (const sheet of workbook.SheetNames) {
            const month = /^(0[1-9]|1[0-2])$/.test(sheet.trim()) ? Number(sheet) : 0;
            if (!month) {
                console.warn(`warning: ${file} 工作表「${sheet}」不是月份班表，已略過`);
                continue;
            }
            const data = parseMonthSheet(sheetRows(workbook, sheet), year, month, ids, defs);
            if (!data) throw new Error(`${file} 工作表「${sheet}」前 10 列找不到日期欄（1、2、3…）`);
            data.warnings.unshift(...dbWarnings);
            const key = data.dates[0].slice(0, 7);
            if (months.includes(key)) throw new Error(`${key} 重複出現在多個檔案`);
            months.push(key);
            data.warnings.forEach(warning => console.warn(`warning: ${warning}`));
            fs.writeFileSync(path.join(DIST, 'data', `${key}.json`), JSON.stringify(data));
            console.log(`${file} ${sheet} -> data/${key}.json (${data.employees.length} 人, ${data.records.length} 筆)`);
        }
    }
    if (!months.length) throw new Error('data/ 沒有任何 All_YYYY.xlsx 月份班表');
    fs.writeFileSync(path.join(DIST, 'data', 'index.json'), JSON.stringify({ months: months.sort(), generatedAt: new Date().toISOString() }));
    for (const file of SITE_FILES) fs.copyFileSync(path.join(ROOT, file), path.join(DIST, file));
    fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build();
