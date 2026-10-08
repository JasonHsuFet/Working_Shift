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

    function rosterCode(code) {
        return ({ M1: '1', 'T早': '早', 'T中': '中' })[code] || code;
    }

    function rosterLabel(code, shift) {
        return ({ '1': 'Mobile 早班', '早': 'TX 早班', '中': 'TX 中班' })[rosterCode(code)] || shift.label.replaceAll('NNOC', 'NOC').replace(/^NOC-/, '');
    }

    const api = { normalizeEmpId, taipeiDate, addDays, bounds, currentRecords, dayRecords, rosterCode, rosterLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.ScheduleCore = api;
})(typeof window === 'undefined' ? globalThis : window);