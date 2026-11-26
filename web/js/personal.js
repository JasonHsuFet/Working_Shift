// Personal tab (x-data="personal"): one employee's month calendar or week list, the selected day, stats, colleagues, the period picker and ICS export.
import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { store, data, months, employees, state, ensure, hasDate, VIEW_KEY } from './context.js';
import { element, dateLabel, onSwipe } from './dom.js';
import { clearEmployee } from './employee.js';

// The period is page state only: every visit opens on the current month, so a saved home-screen URL never pins an old period.
// The month/week view is a preference and is remembered.
function storedView() {
    try { return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'; } catch (_) { return 'month'; }
}
// Keeps the selected date inside the shown month: today when it is in that month, otherwise the 1st.
const dateIn = (month, date, today) => (date.startsWith(month) ? date : today.startsWith(month) ? today : `${month}-01`);
const monthDay = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const weekdayLabel = date => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(new Date(`${date}T00:00:00+08:00`));
const UNWRITTEN = schedule.DAY_STATE.UNWRITTEN;

// On phones, measure the cell height a six-week month gets from the free height, so every month uses it and fits on screen.
const phone = matchMedia('(max-width: 520px)');
function sizeDays() {
    const calendar = element('calendar');
    if (!phone.matches || !calendar.offsetParent) return;
    document.body.classList.add('measuring');
    const height = parseFloat(getComputedStyle(calendar).gridTemplateRows);
    document.body.classList.remove('measuring');
    if (height) calendar.style.setProperty('--day-height', `${height}px`);
}

Alpine.data('personal', () => ({
    month: store.baseMonth,
    selectedDate: dateIn(store.baseMonth, '', state.today),
    view: storedView(),
    pickerYear: '',
    run: 0,

    init() {
        // A different person starts again from the base month and the remembered view.
        this.$watch('$store.app.employee', person => {
            if (person) this.go(store.baseMonth, '', storedView());
        });
        onSwipe(this.$root, () => this.step(-1), () => this.step(1));
        // Grow the page by the colleagues card (plus its gap) so the mobile calendar keeps the same height.
        new ResizeObserver(() => {
            const colleagues = this.$refs.colleagues;
            const height = colleagues.offsetParent ? colleagues.getBoundingClientRect().bottom - this.$refs.dayDetail.getBoundingClientRect().bottom : 0;
            document.body.style.setProperty('--colleagues-height', `${height}px`);
            sizeDays();
        }).observe(this.$refs.colleagues);
        // Cell height is a pure function of (width, svh): recompute on every resize, not just lazily at the next
        // month switch, so it can never get stuck at a height that no longer applies. A phone's toolbar hiding or
        // showing changes innerHeight but not svh, so a real device remeasures to the same value; a genuine height
        // change (a resized desktop window, split screen) is picked up right away. One measurement per frame.
        let resizeFrame = null;
        window.addEventListener('resize', () => {
            if (resizeFrame) return;
            resizeFrame = requestAnimationFrame(() => { resizeFrame = null; sizeDays(); });
        });
    },

    // Loads the months a period needs (and their neighbours), then shows it; an older request that finishes late is dropped.
    async go(month, date, view = this.view) {
        date = dateIn(month, date, state.today);
        const start = schedule.weekStart(date);
        const run = ++this.run;
        await ensure(view === 'week' ? [...new Set([start.slice(0, 7), schedule.addDays(start, 6).slice(0, 7)])] : [month]);
        if (run !== this.run) return;
        Object.assign(this, { month, selectedDate: date, view });
    },
    sizeDays,
    clearEmployee,

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

    get offset() { return (new Date(`${this.month}-01T00:00:00Z`).getUTCDay() + 6) % 7; },
    get calendarDays() {
        const [year, month] = this.month.split('-').map(Number);
        return Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, index) => {
            const date = `${this.month}-${String(index + 1).padStart(2, '0')}`;
            const slot = this.slot(date);
            const { record, shift } = slot;
            return {
                date,
                day: index + 1,
                className: `day ${slot.state}${date === state.today ? ' today' : ''}${date === this.selectedDate ? ' selected' : ''}${record?.leader ? ' leader' : ''}`,
                label: `${dateLabel(date)}，${shift ? `${record.code} ${shift.label}${record.leader ? '，leader' : ''}` : slot.state === UNWRITTEN ? '尚未排班' : '無資料'}`,
                code: record ? record.code : '—',
                codeClass: `day-code ${schedule.shiftClass(shift)}`
            };
        });
    },
    get weekRows() {
        return this.weekDays.map(date => {
            const slot = this.slot(date);
            const { record, shift } = slot;
            const colorClass = schedule.shiftClass(shift);
            return {
                date,
                className: `week-row ${slot.state}${date === state.today ? ' today' : ''}${date === this.selectedDate ? ' selected' : ''}`,
                monthDay: monthDay(date),
                weekday: weekdayLabel(date),
                code: record ? record.code : '—',
                codeClass: `shift-code ${colorClass}${record?.leader ? ' leader-dot' : ''}`,
                colorClass,
                label: shift ? shift.label : slot.state === UNWRITTEN ? '尚未排班' : '無排班資料',
                time: shift ? schedule.workTimeLabel(shift) : '—'
            };
        });
    },
    get selected() {
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
    // Counts for the shown range and same-shift colleagues relative to the selected day.
    get insights() {
        void state.version;
        const [from, to, scope] = this.isWeek ? [this.weekDays[0], this.weekDays[6], '本週'] : [`${this.month}-01`, `${this.month}-31`, '本月'];
        const mine = data.records.filter(record => record.empId === this.person.empId);
        const counts = schedule.categoryCounts(mine.filter(record => record.date >= from && record.date <= to), data.shifts);
        const byDate = schedule.shiftsByDate(mine, data.shifts);
        const streak = schedule.workStreak(byDate, this.selectedDate);
        const nextRest = schedule.nextRestDay(byDate, this.selectedDate);
        const parts = [];
        if (streak) parts.push(`至 ${monthDay(this.selectedDate)} 已連續上班 ${streak} 天`);
        else if (byDate.get(this.selectedDate)?.rest) parts.push(`${monthDay(this.selectedDate)} 休假`);
        if (nextRest) parts.push(`下個休假日 ${monthDay(nextRest)}（${Math.round((Date.parse(`${nextRest}T00:00:00Z`) - Date.parse(`${this.selectedDate}T00:00:00Z`)) / 86400000)} 天後）`);
        const { shift } = this.slot(this.selectedDate);
        const colleagues = !shift || shift.rest ? null : data.records
            .filter(item => item.date === this.selectedDate && data.shifts[item.code].group === shift.group && item.empId !== this.person.empId)
            .map(item => ({ ...employees.get(item.empId), leader: Boolean(item.leader) }))
            .sort((left, right) => left.name.localeCompare(right.name));
        return {
            scope,
            counts: schedule.shiftCategories.map(([id, label]) => ({ id, initial: label[0], className: schedule.shiftClass({ color: id }), count: counts[id] })),
            streak: parts.join(' · '),
            colleagues
        };
    },

    select(date) { this.selectedDate = date; },
    selectRow(date) {
        if (hasDate(date)) this.go(date.slice(0, 7), date);
    },
    step(delta) {
        if (this.isWeek) {
            const moved = schedule.addDays(this.selectedDate, delta * 7);
            const date = moved < data.range.start ? data.range.start : moved > data.range.end ? data.range.end : moved;
            this.go(date.slice(0, 7), date);
            return;
        }
        const target = months[months.indexOf(this.month) + delta];
        if (target) this.go(target, this.selectedDate);
    },
    setView(view) {
        try { localStorage.setItem(VIEW_KEY, view); } catch (_) { }
        this.go(this.month, this.selectedDate, view);
    },
    goCurrent() {
        if (hasDate(state.today)) this.go(state.today.slice(0, 7), state.today);
    },

    // The period title opens a year/month picker.
    get pickerMonths() {
        return Array.from({ length: 12 }, (_, index) => {
            const value = `${this.pickerYear}-${String(index + 1).padStart(2, '0')}`;
            return { value, label: `${index + 1} 月`, now: value === state.today.slice(0, 7), published: months.includes(value) };
        });
    },
    get firstYear() { return months[0].slice(0, 4); },
    get lastYear() { return months.at(-1).slice(0, 4); },
    openPicker() {
        const picker = this.$refs.picker;
        // Browsers without <dialog> keep the old tap-to-return behaviour.
        if (!picker.showModal) return this.goCurrent();
        this.pickerYear = this.month.slice(0, 4);
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
}));
