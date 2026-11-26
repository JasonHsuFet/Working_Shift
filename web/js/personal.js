import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { store, data, months, employees, state, ensure, hasDate, VIEW_KEY } from './context.js';
import { element, dateLabel, memo, onSwipe } from './dom.js';
import { clearEmployee } from './employee.js';

// Only the month/week view is remembered; the period always opens on the current month.
function storedView() {
    try { return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'; } catch (_) { return 'month'; }
}
// Keeps the selected date inside the month: today if it is in that month, else the 1st.
const dateIn = (month, date, today) => (date.startsWith(month) ? date : today.startsWith(month) ? today : `${month}-01`);
const monthDay = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const weekday = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' });
const weekdayLabel = date => weekday.format(new Date(`${date}T00:00:00+08:00`));
const UNWRITTEN = schedule.DAY_STATE.UNWRITTEN;

// On phones every month uses the cell height a six-week month gets from the free height, so it always fits on screen.
const phone = matchMedia('(max-width: 32.5rem)'); // same breakpoint as style.css
function sizeDays() {
    const calendar = element('calendar');
    if (!phone.matches || !calendar.offsetParent) return;
    document.body.classList.add('measuring');
    const height = parseFloat(getComputedStyle(calendar).gridTemplateRows);
    document.body.classList.remove('measuring');
    if (height) calendar.style.setProperty('--day-height', `${height}px`);
}

Alpine.data('personal', () => {
    const cached = { calendar: memo(), week: memo(), selected: memo(), insights: memo() };
    return {
        month: store.baseMonth,
        selectedDate: dateIn(store.baseMonth, '', state.today),
        view: storedView(),
        // The period last asked for. It changes at once while month/selectedDate/view wait for the download,
        // so quick repeated taps add up (three taps on ‹ go back three months).
        wanted: null,
        pickerYear: '',
        pickerOpen: false,
        run: 0,

        init() {
            // A different person starts again from the base month.
            this.$watch('$store.app.employee', person => {
                if (person) this.go(store.baseMonth, '', storedView());
            });
            onSwipe(this.$root, () => this.step(-1), () => this.step(1));
            // Grow the page by the colleagues card so the phone calendar keeps its height.
            new ResizeObserver(() => {
                const colleagues = this.$refs.colleagues;
                const height = colleagues.offsetParent ? colleagues.getBoundingClientRect().bottom - this.$refs.dayDetail.getBoundingClientRect().bottom : 0;
                document.body.style.setProperty('--colleagues-height', `${height}px`);
                sizeDays();
            }).observe(this.$refs.colleagues);
            // The height depends only on width and svh, so remeasuring on every resize (once per frame) is safe:
            // a phone toolbar showing or hiding gives the same value.
            let resizeFrame = null;
            window.addEventListener('resize', () => {
                if (resizeFrame) return;
                resizeFrame = requestAnimationFrame(() => { resizeFrame = null; sizeDays(); });
            });
        },

        // Shows a period once its months have loaded; an older request that finishes late is dropped.
        async go(month, date, view = this.target.view) {
            date = dateIn(month, date, state.today);
            this.wanted = { month, date, view };
            const start = schedule.weekStart(date);
            const run = ++this.run;
            await ensure(view === 'week' ? [...new Set([start.slice(0, 7), schedule.addDays(start, 6).slice(0, 7)])] : [month]);
            if (run !== this.run) return;
            Object.assign(this, { month, selectedDate: date, view });
        },
        sizeDays,
        clearEmployee,

        get target() { return this.wanted ?? { month: this.month, date: this.selectedDate, view: this.view }; },
        get person() { return state.employee || { empId: '', name: '' }; },
        get isWeek() { return this.view === 'week'; },
        slot(date) {
            void state.version; // recompute when more months load
            return schedule.dayState(data, this.person.empId, date);
        },
        get weekDays() {
            const start = schedule.weekStart(this.selectedDate);
            return Array.from({ length: 7 }, (_, index) => schedule.addDays(start, index));
        },
        get weekYears() {
            const years = [...new Set([this.weekDays[0].slice(0, 4), this.weekDays[6].slice(0, 4)])];
            return `${years.join('–')} 年`;
        },
        get weekRange() { return `${monthDay(this.weekDays[0])} – ${monthDay(this.weekDays[6])}`; },
        get prevDisabled() { return this.isWeek ? this.weekDays[0] <= data.range.start : months.indexOf(this.month) <= 0; },
        get nextDisabled() { return this.isWeek ? this.weekDays[6] >= data.range.end : months.indexOf(this.month) >= months.length - 1; },
        get stepTitles() { return this.isWeek ? ['上一週', '下一週'] : ['上個月', '下個月']; },
        get todayPublished() { return hasDate(state.today); },

        // The hidden view returns nothing, so stepping in one view never redraws the other.
        get offset() { return this.isWeek ? 0 : (new Date(`${this.month}-01T00:00:00Z`).getUTCDay() + 6) % 7; },
        get calendarDays() {
            if (this.isWeek) return [];
            const { month, selectedDate } = this;
            const { today, version } = state;
            return cached.calendar(`${version}|${this.person.empId}|${month}|${selectedDate}|${today}`, () => {
                const [year, monthNumber] = month.split('-').map(Number);
                return Array.from({ length: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() }, (_, index) => {
                    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
                    const slot = this.slot(date);
                    const { record, shift } = slot;
                    return {
                        date,
                        day: index + 1,
                        className: `day ${slot.state}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}${record?.leader ? ' leader' : ''}`,
                        label: `${dateLabel(date)}，${shift ? `${record.code} ${shift.label}${record.leader ? '，leader' : ''}` : slot.state === UNWRITTEN ? '尚未排班' : '無資料'}`,
                        code: record ? record.code : '—',
                        codeClass: `day-code ${schedule.shiftClass(shift)}`
                    };
                });
            });
        },
        get weekRows() {
            if (!this.isWeek) return [];
            const { selectedDate } = this;
            const { today, version } = state;
            return cached.week(`${version}|${this.person.empId}|${selectedDate}|${today}`, () => this.weekDays.map(date => {
                const slot = this.slot(date);
                const { record, shift } = slot;
                const colorClass = schedule.shiftClass(shift);
                return {
                    date,
                    className: `week-row ${slot.state}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}`,
                    monthDay: monthDay(date),
                    weekday: weekdayLabel(date),
                    code: record ? record.code : '—',
                    codeClass: `shift-code ${colorClass}${record?.leader ? ' leader-dot' : ''}`,
                    colorClass,
                    label: shift ? shift.label : slot.state === UNWRITTEN ? '尚未排班' : '無排班資料',
                    time: shift ? schedule.workTimeLabel(shift) : '—'
                };
            }));
        },
        get selected() {
            return cached.selected(`${state.version}|${this.person.empId}|${this.selectedDate}`, () => this.selectedDetail());
        },
        selectedDetail() {
            const slot = this.slot(this.selectedDate);
            const { record, shift } = slot;
            const colorClass = schedule.shiftClass(shift);
            return {
                dateLabel: dateLabel(this.selectedDate),
                leader: Boolean(record?.leader),
                empty: shift ? '' : slot.state === UNWRITTEN ? '尚未排班' : '此日期沒有排班資料',
                code: record?.code,
                codeClass: `shift-code ${colorClass}${record?.leader ? ' leader-dot' : ''}`,
                colorClass,
                label: shift?.label,
                time: shift && schedule.workTimeLabel(shift)
            };
        },
        get insights() {
            const { isWeek, month, selectedDate } = this;
            const empId = this.person.empId;
            return cached.insights(`${state.version}|${empId}|${isWeek}|${month}|${selectedDate}`, () => this.insightsFor(empId, isWeek, month, selectedDate));
        },
        // Plain values in, so the loops over all records never touch Alpine's reactive proxies.
        insightsFor(empId, isWeek, month, selectedDate) {
            const start = schedule.weekStart(selectedDate);
            const [from, to, scope] = isWeek ? [start, schedule.addDays(start, 6), '本週'] : [`${month}-01`, `${month}-31`, '本月'];
            const mine = data.records.filter(record => record.empId === empId);
            const counts = schedule.categoryCounts(mine.filter(record => record.date >= from && record.date <= to), data.shifts);
            const byDate = schedule.shiftsByDate(mine, data.shifts);
            const streak = schedule.workStreak(byDate, selectedDate);
            const nextRest = schedule.nextRestDay(byDate, selectedDate);
            const parts = [];
            if (streak) parts.push(`至 ${monthDay(selectedDate)} 已連續上班 ${streak} 天`);
            else if (byDate.get(selectedDate)?.rest) parts.push(`${monthDay(selectedDate)} 休假`);
            if (nextRest) parts.push(`下個休假日 ${monthDay(nextRest)}（${Math.round((Date.parse(`${nextRest}T00:00:00Z`) - Date.parse(`${selectedDate}T00:00:00Z`)) / 86400000)} 天後）`);
            const { shift } = schedule.dayState(data, empId, selectedDate);
            const colleagues = !shift || shift.rest ? null : data.records
                .filter(item => item.date === selectedDate && data.shifts[item.code].group === shift.group && item.empId !== empId)
                .map(item => ({ ...employees.get(item.empId), leader: Boolean(item.leader) }))
                .sort((left, right) => left.name.localeCompare(right.name));
            return {
                scope,
                counts: schedule.shiftCategories.map(([id, label]) => ({ id, initial: label[0], className: schedule.shiftClass({ color: id }), count: counts[id] })),
                streak: parts.join(' · '),
                colleagues
            };
        },

        select(date) {
            this.selectedDate = date;
            this.wanted = { ...this.target, date };
        },
        selectRow(date) {
            if (hasDate(date)) this.go(date.slice(0, 7), date);
        },
        step(delta) {
            const { month, date: selected, view } = this.target;
            if (view === 'week') {
                const moved = schedule.addDays(selected, delta * 7);
                const date = moved < data.range.start ? data.range.start : moved > data.range.end ? data.range.end : moved;
                this.go(date.slice(0, 7), date);
                return;
            }
            const next = months[months.indexOf(month) + delta];
            if (next) this.go(next, selected);
        },
        setView(view) {
            try { localStorage.setItem(VIEW_KEY, view); } catch (_) { }
            this.go(this.target.month, this.target.date, view);
        },
        goCurrent() {
            if (hasDate(state.today)) this.go(state.today.slice(0, 7), state.today);
        },

        get pickerMonths() {
            if (!this.pickerOpen) return [];
            return Array.from({ length: 12 }, (_, index) => {
                const value = `${this.pickerYear}-${String(index + 1).padStart(2, '0')}`;
                return { value, label: `${index + 1} 月`, now: value === state.today.slice(0, 7), published: months.includes(value) };
            });
        },
        get firstYear() { return months[0].slice(0, 4); },
        get lastYear() { return months.at(-1).slice(0, 4); },
        openPicker() {
            const picker = this.$refs.picker;
            // No <dialog> support: jump to today instead.
            if (!picker.showModal) return this.goCurrent();
            this.pickerYear = this.month.slice(0, 4);
            this.pickerOpen = true;
            picker.showModal();
            this.$nextTick(() => picker.querySelector('[aria-pressed="true"]')?.focus());
        },
        pickMonth(value) {
            this.$refs.picker.close();
            this.go(value, '');
        },

        exportIcs() {
            const person = state.employee;
            if (!person) return;
            const { from, to, suffix } = schedule.exportRange(this.view, this.month, this.selectedDate);
            const shown = { shifts: data.shifts, records: data.records.filter(record => record.date >= from && record.date <= to) };
            const url = URL.createObjectURL(new Blob([schedule.icsCalendar(shown, person)], { type: 'text/calendar;charset=utf-8' }));
            const link = Object.assign(document.createElement('a'), { href: url, download: `noc-shift-${person.empId}-${suffix}.ics` });
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };
});
