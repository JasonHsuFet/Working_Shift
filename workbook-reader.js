(function (root, factory) {
    'use strict';
    if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('../src/main/webapp/js/xlsx.full.min.js'));
    else root.ScheduleWorkbook = factory(root.XLSX);
})(typeof window === 'undefined' ? globalThis : window, function (XLSX) {
    'use strict';
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

    function parseDate(value, date1904) {
        if (typeof value === 'number') {
            const date = XLSX.SSF.parse_date_code(value, { date1904 });
            if (!date || date.y < 2000 || date.y > 2100) return null;
            return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
        const date = text(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
        const parsed = new Date(`${date}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
    }

    function parseWorkbook(workbook) {
        for (const name of ['班表', '工號', 'NNOC班別']) {
            if (!workbook.Sheets[name]) throw new Error(`缺少工作表：${name}`);
        }
        const rows = name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: true });
        const names = new Map();
        const warnings = new Set();
        for (const row of rows('工號')) {
            const name = text(row[0]);
            const empId = text(row[1]).toUpperCase();
            if (!name || !/^(T\d+|\d+)$/.test(empId)) continue;
            if (names.has(name)) {
                if (names.get(name) !== empId) warnings.add(`工號表姓名 ${name} 重複，依既有 VLOOKUP 規則採第一筆`);
                continue;
            }
            names.set(name, empId);
        }
        const definitions = new Map();
        for (const row of rows('NNOC班別').slice(1)) {
            const type = text(row[0]);
            if (!type) continue;
            const time = value => {
                if (typeof value === 'number') {
                    const minutes = Math.round(value * 1440);
                    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
                }
                const result = text(value);
                return /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(result) ? result : null;
            };
            definitions.set(type, { label: text(row[1]), start: time(row[2]), end: time(row[3]) });
        }
        const schedule = rows('班表');
        const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
        const columns = (schedule[0] || []).map((value, index) => ({ index, date: index ? parseDate(value, date1904) : null })).filter(column => column.date);
        if (!columns.length) throw new Error('班表第一列沒有有效日期');
        if (new Set(columns.map(column => column.date)).size !== columns.length) throw new Error('班表日期重複');
        const shifts = {};
        const employees = new Map();
        const records = [];
        const keys = new Set();
        for (const [index, row] of schedule.entries()) {
            if (!index || !text(row[0])) continue;
            const name = text(row[0]);
            const populated = columns.some(column => text(row[column.index]));
            if (!populated) continue;
            const empId = names.get(name);
            if (!empId) throw new Error(`班表第 ${index + 1} 列姓名無對應工號：${name}`);
            if (employees.has(empId) && employees.get(empId).name !== name) throw new Error(`工號對應多個姓名：${empId}`);
            employees.set(empId, { empId, name });
            for (const column of columns) {
                const code = text(row[column.index]);
                if (!code) continue;
                const type = SHIFT_TYPES[code];
                if (!type) throw new Error(`無法辨識班別：第 ${index + 1} 列 ${column.date}「${code}」`);
                const definition = definitions.get(type);
                const timeDefinition = definitions.get(SHIFT_TYPES[TIME_ALIASES[code] || code]);
                const rest = REST_CODES.has(code);
                shifts[code] = { type, label: definition?.label || type, rest, start: rest ? null : timeDefinition?.start || null, end: rest ? null : timeDefinition?.end || null };
                if (!rest && (!shifts[code].start || !shifts[code].end)) warnings.add(`班別 ${code} (${type}) 缺少時間，未納入當前值班判斷`);
                const key = `${empId}|${column.date}`;
                if (keys.has(key)) throw new Error(`重複排班：${key}`);
                keys.add(key);
                records.push({ empId, date: column.date, code });
            }
        }
        if (!records.length) throw new Error('Excel 沒有任何可用排班');
        const dates = columns.map(column => column.date).sort();
        return { schemaVersion: 1, generatedAt: new Date().toISOString(), timeZone: 'Asia/Taipei', range: { start: dates[0], end: dates.at(-1) }, dates, shifts, employees: [...employees.values()], records, warnings: [...warnings] };
    }

    async function loadWorkbook(url) {
        if (!XLSX) throw new Error('Excel 解析套件未載入，請確認 xlsx.full.min.js 已發布');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error(`Excel 下載失敗（HTTP ${response.status}）`);
            const workbook = XLSX.read(await response.arrayBuffer(), { type: 'array' });
            const data = parseWorkbook(workbook);
            const modified = response.headers.get('Last-Modified');
            if (modified && Number.isFinite(Date.parse(modified))) data.sourceUpdatedAt = new Date(modified).toISOString();
            return data;
        } catch (error) {
            if (error.name === 'AbortError') throw new Error('Excel 下載逾時，請重新整理重試');
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    return { parseWorkbook, parseDate, loadWorkbook };
});