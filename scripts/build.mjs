// Extracts every month sheet of data/All_YYYY.xlsx into dist/data/YYYY-MM.json and copies the SPA into dist/.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = path.join(ROOT, 'data');
const DIST = path.join(ROOT, 'dist');
const DB_FILE = 'TPKC_NNOC班表模板_V1_3_DB版.xlsm';
const SITE_FILES = ['index.html', 'app.js', 'schedule-core.js', 'style.css', 'fetLogo.png'];

const SHIFT_TYPES = {
    '1': 'NT-1', M1: 'NT-M1', '2': 'NT-2', M2: 'NT-M2', '3': 'NT-3',
    '早': 'NT-早', 'T早': 'NT-T早', '中': 'NT-中', 'T中': 'NT-T中',
    '晚': 'NT-晚', '日': 'NT-日', '小夜': 'NT-小夜', '大夜': 'NT-大夜',
    N: 'NT-正', N8: 'E001', X: '例假日', Y: '休息日', Z: '國定假日', S: 'NT-S', T: 'NT-T'
};
const TIME_ALIASES = { 'T早': '早', 'T中': '中', M1: '1', '大夜': '3', '小夜': '2', '日': '1' };
const REST_CODES = new Set(['X', 'Y', 'Z', 'S', 'T']);

function text(value) {
    return value == null ? '' : String(value).trim();
}

function sheetRows(workbook, name) {
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
        if (text(row[totalCol]) === '') break; // summary tables below the staff rows have no Total
        const name = text(row[nameCol]);
        if (!name || !dates.some((_, day) => text(row[header.dayCol + day]))) continue;
        const empId = ids.get(name);
        if (!empId) {
            console.warn(`warning: ${monthKey} ${name} 在工號表找不到工號，未納入`); // build log only, not the page banner
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
            shifts[code] = { type, label: defs.get(type)?.label || type, rest, start: rest ? null : timeDef?.start || null, end: rest ? null : timeDef?.end || null };
            if (!rest && (!shifts[code].start || !shifts[code].end)) warnings.add(`班別 ${code} (${type}) 缺少時間，未納入當前值班判斷`);
            records.push({ empId, date, code });
        });
    }
    if (!records.length) throw new Error(`${monthKey} 沒有任何可用排班`);
    return {
        schemaVersion: 1, generatedAt: new Date().toISOString(), timeZone: 'Asia/Taipei',
        range: { start: dates[0], end: dates.at(-1) }, dates, shifts,
        employees: [...employees.values()], records, warnings: [...warnings]
    };
}

function build() {
    const { ids, defs, warnings: dbWarnings } = readLookups(XLSX.read(fs.readFileSync(path.join(DATA, DB_FILE))));
    dbWarnings.forEach(warning => console.warn(`warning: ${warning}`));
    fs.rmSync(DIST, { recursive: true, force: true });
    fs.mkdirSync(path.join(DIST, 'data'), { recursive: true });
    const months = [];
    for (const file of fs.readdirSync(DATA).sort()) {
        const year = Number(/^All_(\d{4})\.xlsx$/.exec(file)?.[1]);
        if (!year) continue;
        // ponytail: sheetRows cap, since some sheets claim 1,048,576 used rows; raise it if staff tables ever pass 1000 rows
        const workbook = XLSX.read(fs.readFileSync(path.join(DATA, file)), { sheetRows: 1000 });
        for (const sheet of workbook.SheetNames) {
            const month = /^(0[1-9]|1[0-2])$/.test(sheet.trim()) ? Number(sheet) : 0;
            const data = month && parseMonthSheet(sheetRows(workbook, sheet), year, month, ids, defs);
            if (!data) {
                console.warn(`warning: ${file} 工作表「${sheet}」不是月份班表，已略過`);
                continue;
            }
            const key = data.range.start.slice(0, 7);
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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) build();
