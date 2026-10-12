(function (root) {
    'use strict';

    function normalizeEmpId(value) {
        return String(value || '').trim().replace(/^f/i, '').toUpperCase();
    }

    function taipeiDate(now = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const value = type => parts.find(part => part.type === type).value;
        return `${value('year')}-${value('month')}-${value('day')}`;
    }

    function addDays(date, count) {
        const value = new Date(`${date}T00:00:00Z`);
        value.setUTCDate(value.getUTCDate() + count);
        return value.toISOString().slice(0, 10);
    }

    function bounds(record, shifts) {
        const shift = shifts[record.code];
        if (!shift || shift.rest || !shift.start || !shift.end) return null;
        const timestamp = time => {
            const date = time === '24:00' ? addDays(record.date, 1) : record.date;
            return Date.parse(`${date}T${time === '24:00' ? '00:00' : time}:00+08:00`);
        };
        const start = timestamp(shift.start);
        let end = timestamp(shift.end);
        if (end <= start) end += 86400000;
        return { start, end };
    }

    function currentRecords(data, now = new Date()) {
        const instant = now.getTime();
        return data.records.filter(record => {
            const interval = bounds(record, data.shifts);
            return interval && interval.start <= instant && instant < interval.end;
        });
    }

    function dayRecords(data, date) {
        return data.records.filter(record => record.date === date);
    }

    function shiftClass(shift) {
        return shift?.color ? `shift-${shift.color}` : '';
    }

    // Weeks run Monday to Sunday, matching the calendar grid.
    function weekStart(date) {
        return addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
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
    function icsCalendar(data, person, now = new Date()) {
        const stamp = icsUtc(now.getTime());
        const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NOC Schedule//Working_Shift//ZH-TW', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(`NOC 班表 ${person.name}`)}`, 'X-WR-TIMEZONE:Asia/Taipei'];
        for (const record of data.records) {
            const shift = data.shifts[record.code];
            if (record.empId !== person.empId || !shift || shift.rest) continue;
            const interval = bounds(record, data.shifts);
            lines.push('BEGIN:VEVENT', `UID:${person.empId}-${record.date}-${encodeURIComponent(record.code)}@noc-schedule`, `DTSTAMP:${stamp}`);
            if (interval) lines.push(`DTSTART:${icsUtc(interval.start)}`, `DTEND:${icsUtc(interval.end)}`);
            else lines.push(`DTSTART;VALUE=DATE:${record.date.replaceAll('-', '')}`, `DTEND;VALUE=DATE:${addDays(record.date, 1).replaceAll('-', '')}`);
            lines.push(`SUMMARY:${icsText(`${record.code} ${shift.label}`)}`, 'END:VEVENT');
        }
        lines.push('END:VCALENDAR');
        return `${lines.map(foldLine).join('\r\n')}\r\n`;
    }

    const api = { normalizeEmpId, taipeiDate, addDays, bounds, currentRecords, dayRecords, shiftClass, weekStart, icsCalendar };
    root.ScheduleCore = api;
})(globalThis);