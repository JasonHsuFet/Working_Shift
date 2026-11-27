import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { data, employees, state, ensure, hasDate, isDate } from './context.js';
import { dateLabel, memo, onSwipe } from './dom.js';

const categoryLabel = Object.fromEntries(schedule.shiftCategories);
const clock = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', timeStyle: 'short' });
// `me`: empId of the person on the personal tab, marked in the roster.
function rosterGroups(records, me) {
    return schedule.groupRoster(records, data.shifts, employees).map(({ key, shift, records: group }) => ({
        key,
        title: categoryLabel[key] || `${key} · ${shift.label}`,
        meta: `${[...new Set(group.map(record => schedule.timeLabel(data.shifts[record.code])))].join(' / ')} · ${group.length} 人`,
        colorClass: schedule.shiftClass(shift),
        people: group.map(record => ({ ...employees.get(record.empId), code: record.code, leader: Boolean(record.leader), me: record.empId === me }))
    }));
}

Alpine.data('onDuty', () => {
    const cached = { records: memo(), current: memo(), groups: memo() };
    return {
        filters: [['now', '目前值班', '現'], ['', '全部班別', '全'], ...schedule.shiftCategories.map(([id, label]) => [id, label, label[0]])]
            .map(([id, label, short]) => ({ id, label, short, cat: id || 'all' })),
        range: data.range,
        date: state.today, // the date input's value
        shown: '', // the date drawn, set once its month has loaded
        filter: 'now',
        followToday: true, // the date follows today across midnight
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
        // 'now' applies only to today, once it is scheduled.
        get live() { return this.written && this.shown === state.today; },
        get label() {
            if (!isDate(this.shown)) return '';
            return this.live ? `${dateLabel(this.shown)} ${clock.format(new Date(state.now))}` : dateLabel(this.shown);
        },
        get records() {
            const { shown } = this;
            return cached.records(`${state.version}|${shown}`, () => schedule.dayRecords(data, shown));
        },
        get current() {
            const { now, version } = state;
            return cached.current(`${version}|${now}`, () => schedule.currentRecords(data, new Date(now)));
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
            if (this.written) return '';
            if (!hasDate(this.shown)) return '此日期不在已發布資料期間。';
            // A month that failed to download: the load error is already shown at the top.
            return this.shown.slice(0, 7) in data.writtenDays ? '此日期尚未排班。' : '';
        },
        // Empty while the tab is hidden, so loads and clock ticks do not redraw it.
        get groups() {
            if (state.activeTab !== 'on-duty') return [];
            const { filter, records, current } = this;
            const me = state.employee?.empId;
            return cached.groups(`${filter}|${state.version}|${this.shown}|${state.now}|${me}`, () => (filter === 'now'
                ? rosterGroups(current, me)
                : rosterGroups(records.filter(record => !filter || schedule.shiftCategory(data.shifts[record.code]) === filter), me)));
        },
        get emptyMessage() {
            if (this.filter === 'now') return '此刻沒有已知時段的值班人員';
            return this.records.length ? '沒有符合篩選的排班' : '此日期沒有排班資料';
        },
        get unknownGroups() { return state.activeTab === 'on-duty' ? rosterGroups(this.unknown, state.employee?.empId) : []; },

        // An older request that finishes late is dropped.
        async load() {
            const date = this.date;
            const run = ++this.run;
            if (hasDate(date)) await ensure([date.slice(0, 7)]);
            if (run !== this.run) return;
            this.shown = date;
            if (!this.live && this.filter === 'now') this.filter = '';
        },
        show() {
            if (this.followToday) this.date = state.today;
            this.load();
        },
        picked() {
            this.followToday = this.date === state.today;
            this.load();
        },
        step(delta) {
            if (delta < 0 ? this.prevDisabled : this.nextDisabled) return;
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
    };
});
