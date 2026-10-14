// Extracts every month sheet of data/All_YYYY.xlsx into dist/data/YYYY-MM.json and copies the SPA (web/) into dist/.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DATA, DB_FILE, readWorkbook, sheetRows, sheetLeaders, readLookups, parseMonthSheet } from './lib/excel.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

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
            const data = parseMonthSheet(sheetRows(workbook, sheet), year, month, ids, defs, sheetLeaders(file, workbook, sheet));
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
    fs.cpSync(path.join(ROOT, 'web'), DIST, { recursive: true });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) build();
