export function normalizeEmpId(value) {
    return String(value || '').trim().replace(/^f/i, '').toUpperCase();
}

// Built once: creating an Intl.DateTimeFormat is far slower than using one.
const taipeiParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' });

export function taipeiDate(now = new Date()) {
    const parts = taipeiParts.formatToParts(now);
    const value = type => parts.find(part => part.type === type).value;
    return `${value('year')}-${value('month')}-${value('day')}`;
}

export function addDays(date, count) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + count);
    return value.toISOString().slice(0, 10);
}

// `full`: the hours actually worked (with support time) instead of the duty hours.
export function bounds(record, shifts, full = false) {
    const shift = shifts[record.code];
    if (!shift || shift.rest || !shift.start || !shift.end) return null;
    const timestamp = time => {
        const date = time === '24:00' ? addDays(record.date, 1) : record.date;
        return Date.parse(`${date}T${time === '24:00' ? '00:00' : time}:00+08:00`);
    };
    const start = timestamp(full ? shift.fullStart || shift.start : shift.start);
    let end = timestamp(full ? shift.fullEnd || shift.end : shift.end);
    if (end <= start) end += 86400000;
    return { start, end };
}

// Shifts last under a day, so only today's and yesterday's can be running now.
export function currentRecords(data, now = new Date()) {
    const instant = now.getTime();
    const today = taipeiDate(now);
    const days = new Set([addDays(today, -1), today]);
    return data.records.filter(record => {
        if (!days.has(record.date)) return false;
        const interval = bounds(record, data.shifts);
        return interval && interval.start <= instant && instant < interval.end;
    });
}

export function dayRecords(data, date) {
    return data.records.filter(record => record.date === date);
}

// `data` is one parsed month (build) or the months merged so far (page). A month missing from writtenDays is unpublished
// or not loaded yet; a date past its date row is unwritten for everyone; a written date without a code is none.
export const DAY_STATE = { WORK: 'work', REST: 'rest', UNWRITTEN: 'unwritten', NONE: 'none', UNPUBLISHED: 'unpublished' };

// True when the month's date row reaches this date.
export function isWritten(data, date) {
    return Number(date.slice(8)) <= (data.writtenDays[date.slice(0, 7)] ?? 0);
}

// "empId|date" -> record, rebuilt when more records are merged in.
const indexes = new WeakMap();
function recordAt(data, empId, date) {
    let index = indexes.get(data.records);
    if (index?.count !== data.records.length) {
        index = { count: data.records.length, byKey: new Map(data.records.map(record => [`${record.empId}|${record.date}`, record])) };
        indexes.set(data.records, index);
    }
    return index.byKey.get(`${empId}|${date}`);
}

export function dayState(data, empId, date) {
    const record = recordAt(data, empId, date);
    const shift = record && data.shifts[record.code];
    if (shift) return { state: shift.rest ? DAY_STATE.REST : DAY_STATE.WORK, record, shift };
    if (!(date.slice(0, 7) in data.writtenDays)) return { state: DAY_STATE.UNPUBLISHED };
    return { state: isWritten(data, date) ? DAY_STATE.NONE : DAY_STATE.UNWRITTEN };
}

export function shiftClass(shift) {
    return shift?.color ? `shift-${shift.color}` : '';
}

export const shiftCategories = [['morning', '早班'], ['afternoon', '中班'], ['night', '晚班'], ['n', 'N班'], ['rest', '休假']];

export function shiftCategory(shift) {
    if (shift.rest) return 'rest';
    return ['morning', 'afternoon', 'night'].includes(shift.color) ? shift.color : 'n';
}

export function categoryCounts(records, shifts) {
    const counts = Object.fromEntries(shiftCategories.map(([id]) => [id, 0]));
    for (const record of records) counts[shiftCategory(shifts[record.code])]++;
    return counts;
}

export function shiftsByDate(records, shifts) {
    return new Map(records.map(record => [record.date, shifts[record.code]]));
}

export function workStreak(byDate, date) {
    let count = 0;
    for (let day = date; byDate.get(day) && !byDate.get(day).rest; day = addDays(day, -1)) count++;
    return count;
}

export function nextRestDay(byDate, date) {
    for (let offset = 1; offset <= 62; offset++) {
        const day = addDays(date, offset);
        if (byDate.get(day)?.rest) return day;
    }
    return null;
}

// Weeks run Monday to Sunday, matching the calendar grid.
export function weekStart(date) {
    return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
}

export function timeLabel(shift) {
    if (shift.rest) return '休假';
    if (!shift.start || !shift.end) return '時間未定義';
    const nextDay = shift.end !== '24:00' && shift.end <= shift.start ? '（翌日）' : '';
    return `${shift.start}–${shift.end}${nextDay}`;
}

export function workTimeLabel(shift) {
    return shift.fullStart ? `${shift.fullStart}–${shift.fullEnd}（值班 ${shift.start}–${shift.end}）` : timeLabel(shift);
}

// Morning, afternoon, night and rest are one group each; N-type shifts keep their own. Groups follow the filter order,
// then start time; inside a group the base code comes before its variants (1 before M1).
export function groupRoster(records, shifts, employees) {
    const order = shiftCategories.map(([id]) => id);
    const groups = new Map();
    for (const record of records) {
        const shift = shifts[record.code];
        const category = shiftCategory(shift);
        const key = category === 'n' ? shift.group : category;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record);
    }
    const tagOrder = record => [shifts[record.code].group, record.code === shifts[record.code].group ? 0 : 1];
    return [...groups].map(([key, group]) => ({
        key,
        shift: shifts[group[0].code],
        records: group.sort((left, right) => {
            const [leftBase, leftVariant] = tagOrder(left);
            const [rightBase, rightVariant] = tagOrder(right);
            return leftBase.localeCompare(rightBase) || leftVariant - rightVariant || left.code.localeCompare(right.code) || employees.get(left.empId).name.localeCompare(employees.get(right.empId).name);
        })
    })).sort((left, right) => order.indexOf(shiftCategory(left.shift)) - order.indexOf(shiftCategory(right.shift)) || (left.shift.start || '99').localeCompare(right.shift.start || '99') || left.key.localeCompare(right.key));
}

export function exportRange(view, month, selectedDate) {
    const from = view === 'week' ? weekStart(selectedDate) : `${month}-01`;
    return { from, to: view === 'week' ? addDays(from, 6) : `${month}-31`, suffix: view === 'week' ? `${from}_${addDays(from, 6)}` : month };
}

const icsUtc = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = value => value.replace(/\\/g, '\\\\').replace(/[;,]/g, '\\$&').replace(/\r?\n/g, '\\n');

// RFC 5545 limits lines to 75 octets; continuation lines start with a space.
function foldLine(line) {
    const encoder = new TextEncoder();
    const parts = [];
    let current = '';
    let size = 0;
    for (const char of line) {
        const width = encoder.encode(char).length;
        if (size + width > (parts.length ? 74 : 75)) {
            parts.push(current);
            current = '';
            size = 0;
        }
        current += char;
        size += width;
    }
    parts.push(current);
    return parts.join('\r\n ');
}

// Work shifts only; shifts without a defined time become all-day events.
export function icsCalendar(data, person, now = new Date()) {
    const stamp = icsUtc(now.getTime());
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NOC Schedule//Working_Shift//ZH-TW', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(`NOC 班表 ${person.name}`)}`, 'X-WR-TIMEZONE:Asia/Taipei'];
    for (const record of data.records) {
        const shift = data.shifts[record.code];
        if (record.empId !== person.empId || !shift || shift.rest) continue;
        const interval = bounds(record, data.shifts, true);
        lines.push('BEGIN:VEVENT', `UID:${person.empId}-${record.date}-${encodeURIComponent(record.code)}@noc-schedule`, `DTSTAMP:${stamp}`);
        if (interval) lines.push(`DTSTART:${icsUtc(interval.start)}`, `DTEND:${icsUtc(interval.end)}`);
        else lines.push(`DTSTART;VALUE=DATE:${record.date.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${addDays(record.date, 1).replaceAll('-', '')}`);
        lines.push(`SUMMARY:${icsText(`${record.code} ${shift.label}`)}`, 'END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
