// On-duty tab (x-data="onDuty"): one day's roster with category filters, date controls and the live 'now' view of today.
import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { data, employees, state, ensure, hasDate } from './context.js';
import { dateLabel, onSwipe } from './dom.js';

const categoryLabel = Object.fromEntries(schedule.shiftCategories);
const isDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date);
const clock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', timeStyle: 'short' });
// Getters that read `data` start with `void state.version` so Alpine recomputes them when more months load.

// Roster groups in the shape the template draws.
function rosterGroups(records) {
    return schedule.groupRoster(records, data.shifts, employees).map(({ key, shift, records: group }) => ({
        key,
        title: categoryLabel[key] || `${key} · ${shift.label}`,
        meta: `${[...new Set(group.map(record => schedule.timeLabel(data.shifts[record.code])))].join(' / ')} · ${group.length} 人`,
        colorClass: schedule.shiftClass(shift),
        people: group.map(record => ({ ...employees.get(record.empId), code: record.code, leader: Boolean(record.leader), me: record.empId === state.employee?.empId }))
    }));
}

Alpine.data('onDuty', () => ({
    filters: [['now', '目前值班', '現'], ['', '全部班別', '全'], ...schedule.shiftCategories.map(([id, label]) => [id, label, label[0]])]
        .map(([id, label, short]) => ({ id, label, short, cat: id || 'all' })),
    range: data.range,
    date: state.today, // the date input
    shown: '', // the date drawn: set once its month has loaded, so a slow download never shows a half-loaded day
    filter: 'now',
    followToday: true, // the date moves along with today (midnight while open, the 今天 button)
    run: 0,

    init() {
        onSwipe(this.$root, () => this.step(-1), () => this.step(1));
        this.$watch('$store.app.activeTab', tab => { if (tab === 'on-duty') this.show(); });
        this.$watch('$store.app.today', today => {
            if (!this.followToday || state.activeTab !== 'on-duty') return;
            this.date = today;
            this.load();
        });
    },

    get prevDisabled() { return !isDate(this.date) || this.date <= this.range.start; },
    get nextDisabled() { return !isDate(this.date) || this.date >= this.range.end; },
    get written() {
        void state.version;
        return hasDate(this.shown) && schedule.isWritten(data, this.shown);
    },
    // The 'now' filter only makes sense for today, once its date is scheduled.
    get live() { return this.written && this.shown === state.today; },
    get label() {
        if (!isDate(this.shown)) return '';
        return this.live ? `${dateLabel(this.shown)} ${clock.format(new Date(state.now))}` : dateLabel(this.shown);
    },
    get records() {
        void state.version;
        return schedule.dayRecords(data, this.shown);
    },
    get current() {
        void state.version;
        return schedule.currentRecords(data, new Date(state.now));
    },
    get unknown() {
        if (this.filter !== 'now') return [];
        return this.records.filter(record => {
            const shift = data.shifts[record.code];
            return !shift.rest && (!shift.start || !shift.end);
        });
    },
    get summary() {
        if (this.filter === 'now') return [['值班中', this.current.length], ...(this.unknown.length ? [['時間未定義', this.unknown.length]] : [])];
        const rest = this.records.filter(record => data.shifts[record.code].rest).length;
        return [['出勤', this.records.length - rest], ['休假', rest]];
    },
    get notice() {
        if (this.filter === 'now') return this.unknown.length ? '部分班別時間未定義；以下僅列已知時段的值班人員。' : '';
        return this.written ? '' : hasDate(this.shown) ? '此日期尚未排班。' : '此日期不在已發布資料期間。';
    },
    get groups() {
        if (this.filter === 'now') return rosterGroups(this.current);
        return rosterGroups(this.records.filter(record => !this.filter || schedule.shiftCategory(data.shifts[record.code]) === this.filter));
    },
    get emptyMessage() {
        if (this.filter === 'now') return '此刻沒有已知時段的值班人員';
        return this.records.length ? '沒有符合篩選的排班' : '此日期沒有排班資料';
    },
    get unknownGroups() { return rosterGroups(this.unknown); },

    // Loads the month of the input's date, then draws it; an older request that finishes late is dropped.
    async load() {
        const date = this.date;
        const run = ++this.run;
        if (hasDate(date)) await ensure([date.slice(0, 7)]);
        if (run !== this.run) return;
        this.shown = date;
        if (!this.live && this.filter === 'now') this.filter = '';
    },
    show() {
        this.date = schedule.liveDate(this.date, state.today, this.followToday);
        this.load();
    },
    picked() {
        this.followToday = this.date === state.today;
        this.load();
    },
    step(delta) {
        if (!this.date) return;
        this.followToday = false;
        this.date = schedule.addDays(this.date, delta);
        this.load();
    },
    goToday() {
        this.date = state.today;
        this.followToday = true;
        this.filter = 'now';
        this.load();
    },
    setFilter(id) {
        this.filter = id;
        this.load();
    }
}));
