// Personal tab: one employee's month calendar or week list, the selected day, stats, colleagues, the period picker and ICS export.
import * as schedule from './schedule.js';
import { store, data, months, employees, state, ensure, hasDate, VIEW_KEY } from './context.js';
import { element, textNode, dateLabel, onSwipe } from './dom.js';

// The period is page state only: every visit opens on the current month, so a saved home-screen URL never pins an old period.
// The month/week view is a preference and is remembered.
function storedView() {
    try { return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'; } catch (_) { return 'month'; }
}
let month = store.baseMonth;
let selectedDate = '';
let view = storedView();

const monthDay = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const weekdayLabel = date => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(new Date(`${date}T00:00:00+08:00`));

function renderSelectedDay() {
    const { employee } = state;
    element('selectedDate').textContent = dateLabel(selectedDate);
    const container = element('selectedShift');
    container.replaceChildren();
    const record = data.records.find(item => item.empId === employee.empId && item.date === selectedDate);
    element('employeeName').classList.toggle('leader', Boolean(record?.leader));
    if (!record) {
        container.append(textNode('p', '此日期沒有排班資料', 'empty'));
        return;
    }
    const shift = data.shifts[record.code];
    const detail = textNode('div', '', 'shift-detail');
    const description = textNode('div', '', 'shift-text');
    const colorClass = schedule.shiftClass(shift);
    description.append(textNode('p', shift.label, colorClass), textNode('small', schedule.workTimeLabel(shift), colorClass));
    detail.append(textNode('span', record.code, `shift-code ${colorClass}${record.leader ? ' leader-dot' : ''}`), description);
    container.append(detail);
}

function renderCalendar() {
    const { employee } = state;
    if (!employee) return;
    const records = data.records.filter(record => record.empId === employee.empId && record.date.startsWith(month));
    const byDate = new Map(records.map(record => [record.date, record]));
    const today = schedule.taipeiDate();
    syncSelectedDate();
    element('employeeName').textContent = employee.name;
    element('periodText').replaceChildren(`${month.slice(0, 4)} 年 `, textNode('span', Number(month.slice(5)), 'period-month'), ' 月');
    const position = months.indexOf(month);
    element('prevPeriod').disabled = position <= 0;
    element('nextPeriod').disabled = position >= months.length - 1;
    const calendar = element('calendar');
    calendar.replaceChildren();
    const firstDay = new Date(`${month}-01T00:00:00Z`);
    const offset = (firstDay.getUTCDay() + 6) % 7;
    const count = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, 0)).getUTCDate();
    for (let index = 0; index < offset; index++) calendar.append(textNode('span', ''));
    for (let day = 1; day <= count; day++) {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        const record = byDate.get(date);
        const shift = record && data.shifts[record.code];
        const button = textNode('button', '', `day${shift ? shift.rest ? ' rest' : ' work' : ''}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}${record?.leader ? ' leader' : ''}`);
        button.type = 'button';
        button.setAttribute('aria-label', `${dateLabel(date)}，${shift ? `${record.code} ${shift.label}${record.leader ? '，leader' : ''}` : '無資料'}`);
        button.setAttribute('aria-pressed', String(date === selectedDate));
        button.append(textNode('span', String(day), 'day-number'), textNode('span', record ? record.code : '—', `day-code ${schedule.shiftClass(shift)}`));
        button.addEventListener('click', () => { selectedDate = date; renderPersonal(); element('calendar').querySelector(`[aria-pressed="true"]`).focus({ preventScroll: true }); });
        calendar.append(button);
    }
    renderSelectedDay();
    renderInsights(`${month}-01`, `${month}-31`, '本月');
    sizeDays();
}

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

function syncSelectedDate() {
    const today = schedule.taipeiDate();
    if (!selectedDate.startsWith(month)) selectedDate = today.startsWith(month) ? today : `${month}-01`;
}

function renderWeek() {
    const { employee } = state;
    syncSelectedDate();
    const start = schedule.weekStart(selectedDate);
    const days = Array.from({ length: 7 }, (_, index) => schedule.addDays(start, index));
    const byDate = new Map(data.records.filter(record => record.empId === employee.empId && record.date >= days[0] && record.date <= days[6]).map(record => [record.date, record]));
    const today = schedule.taipeiDate();
    const years = [days[0].slice(0, 4), days[6].slice(0, 4)];
    element('employeeName').textContent = employee.name;
    // Year sits on its own small line so the range still fits beside the controls at 360px.
    element('periodText').replaceChildren(textNode('small', `${years[0] === years[1] ? years[0] : years.join('–')} 年`, 'period-year'), `${monthDay(days[0])} – ${monthDay(days[6])}`);
    element('prevPeriod').disabled = days[0] <= data.range.start;
    element('nextPeriod').disabled = days[6] >= data.range.end;
    const list = element('weekList');
    list.replaceChildren();
    for (const date of days) {
        const record = byDate.get(date);
        const shift = record && data.shifts[record.code];
        const colorClass = schedule.shiftClass(shift);
        const row = textNode('button', '', `week-row${shift ? shift.rest ? ' rest' : ' work' : ''}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}`);
        row.type = 'button';
        row.setAttribute('aria-pressed', String(date === selectedDate));
        row.addEventListener('click', () => {
            if (!hasDate(date)) return;
            selectedDate = date;
            month = date.slice(0, 7);
            showPersonal();
        });
        const day = textNode('div', '', 'week-day');
        day.append(textNode('strong', monthDay(date)), textNode('small', weekdayLabel(date)));
        const description = textNode('div', '', 'shift-text');
        description.append(textNode('p', shift ? shift.label : '無排班資料', colorClass), textNode('small', shift ? schedule.workTimeLabel(shift) : '—', colorClass));
        row.append(day, textNode('span', record ? record.code : '—', `shift-code ${colorClass}${record?.leader ? ' leader-dot' : ''}`), description);
        list.append(row);
    }
    renderSelectedDay();
    renderInsights(days[0], days[6], '本週');
}

function renderPersonal() {
    if (!state.employee) return;
    const isWeek = view === 'week';
    for (const id of ['calendar', 'weekdays']) element(id).hidden = isWeek;
    element('weekList').hidden = !isWeek;
    element('calendar').parentElement.classList.toggle('month', !isWeek);
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
    element('prevPeriod').title = isWeek ? '上一週' : '上個月';
    element('nextPeriod').title = isWeek ? '下一週' : '下個月';
    element('prevPeriod').setAttribute('aria-label', element('prevPeriod').title);
    element('nextPeriod').setAttribute('aria-label', element('nextPeriod').title);
    // The picker chooses months, so it only belongs to the month view.
    element('periodLabel').disabled = isWeek;
    element('periodLabel').title = isWeek ? '' : '選擇年月';
    element('exportIcs').title = isWeek ? '匯出此週行事曆（.ics）' : '匯出此月行事曆（.ics）';
    if (isWeek) renderWeek();
    else renderCalendar();
}

// Loads the months the current view needs (and their neighbours) before drawing it.
async function showPersonal() {
    if (!state.employee) return;
    syncSelectedDate();
    const start = schedule.weekStart(selectedDate);
    await ensure(view === 'week' ? [...new Set([start.slice(0, 7), schedule.addDays(start, 6).slice(0, 7)])] : [month]);
    renderPersonal();
}

// Shows a person; switching to someone else starts again from the base month and the remembered view.
export function showEmployee(person) {
    if (state.employee !== person) {
        month = store.baseMonth;
        selectedDate = '';
        view = storedView();
    }
    state.employee = person;
    showPersonal();
}

// Counts for the shown range and same-shift colleagues relative to the selected day.
function renderInsights(from, to, scope) {
    const { employee } = state;
    const mine = data.records.filter(record => record.empId === employee.empId);
    const counts = schedule.categoryCounts(mine.filter(record => record.date >= from && record.date <= to), data.shifts);
    element('statCounts').replaceChildren(textNode('em', scope), ...schedule.shiftCategories.map(([id, label]) => {
        const item = textNode('span', '');
        item.append(textNode('b', label[0], schedule.shiftClass({ color: id })), textNode('strong', String(counts[id])));
        return item;
    }));
    const byDate = schedule.shiftsByDate(mine, data.shifts);
    const streak = schedule.workStreak(byDate, selectedDate);
    const nextRest = schedule.nextRestDay(byDate, selectedDate);
    const parts = [];
    if (streak) parts.push(`至 ${monthDay(selectedDate)} 已連續上班 ${streak} 天`);
    else if (byDate.get(selectedDate)?.rest) parts.push(`${monthDay(selectedDate)} 休假`);
    if (nextRest) parts.push(`下個休假日 ${monthDay(nextRest)}（${Math.round((Date.parse(`${nextRest}T00:00:00Z`) - Date.parse(`${selectedDate}T00:00:00Z`)) / 86400000)} 天後）`);
    element('statStreak').textContent = parts.join(' · ');
    const record = mine.find(item => item.date === selectedDate);
    const shift = record && data.shifts[record.code];
    element('colleagues').hidden = !shift || shift.rest;
    if (element('colleagues').hidden) return;
    const others = data.records.filter(item => item.date === selectedDate && data.shifts[item.code].group === shift.group && item.empId !== employee.empId)
        .map(item => ({ ...employees.get(item.empId), leader: item.leader })).sort((left, right) => left.name.localeCompare(right.name));
    element('colleaguesTitle').textContent = others.length ? `同班同事 ${others.length} 人` : '當天沒有其他同班同事';
    element('colleaguesList').replaceChildren(...others.map(person => {
        const chip = textNode('span', person.name, person.leader ? 'leader' : '');
        chip.title = person.empId;
        return chip;
    }));
}

async function shiftWeek(delta) {
    const moved = schedule.addDays(selectedDate, delta * 7);
    selectedDate = moved < data.range.start ? data.range.start : moved > data.range.end ? data.range.end : moved;
    month = selectedDate.slice(0, 7);
    await showPersonal();
}

function exportIcs() {
    const { employee } = state;
    if (!employee) return;
    const { from, to, suffix } = schedule.exportRange(view, month, selectedDate);
    const shown = { shifts: data.shifts, records: data.records.filter(record => record.date >= from && record.date <= to) };
    const url = URL.createObjectURL(new Blob([schedule.icsCalendar(shown, employee)], { type: 'text/calendar;charset=utf-8' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `noc-shift-${employee.empId}-${suffix}.ics` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

for (const [id, delta] of [['prevPeriod', -1], ['nextPeriod', 1]]) {
    element(id).addEventListener('click', async () => {
        if (view === 'week') {
            await shiftWeek(delta);
            return;
        }
        const target = months[months.indexOf(month) + delta];
        if (!target) return;
        month = target;
        await showPersonal();
    });
}
document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
        view = button.dataset.view;
        try { localStorage.setItem(VIEW_KEY, view); } catch (_) { }
        showPersonal();
    });
});
function goCurrent() {
    if (!hasDate(schedule.taipeiDate())) return;
    selectedDate = schedule.taipeiDate();
    month = selectedDate.slice(0, 7);
    showPersonal();
}
// The period title opens a year/month picker.
const picker = element('periodDialog');
let pickerYear = '';
function renderPicker() {
    const years = months.map(item => item.slice(0, 4));
    const now = schedule.taipeiDate().slice(0, 7);
    element('pickerYear').textContent = `${pickerYear} 年`;
    element('prevYear').disabled = pickerYear <= years[0];
    element('nextYear').disabled = pickerYear >= years.at(-1);
    element('monthGrid').replaceChildren(...Array.from({ length: 12 }, (_, index) => {
        const value = `${pickerYear}-${String(index + 1).padStart(2, '0')}`;
        const button = textNode('button', `${index + 1} 月`, value === now ? 'now' : '');
        button.type = 'button';
        button.disabled = !months.includes(value);
        button.setAttribute('aria-pressed', String(value === month));
        button.addEventListener('click', () => {
            picker.close();
            month = value;
            selectedDate = schedule.taipeiDate().startsWith(value) ? schedule.taipeiDate() : `${value}-01`;
            showPersonal();
        });
        return button;
    }));
}
element('periodLabel').addEventListener('click', () => {
    // Browsers without <dialog> keep the old tap-to-return behaviour.
    if (!picker.showModal) return goCurrent();
    pickerYear = month.slice(0, 4);
    renderPicker();
    picker.showModal();
    picker.querySelector('[aria-pressed="true"]')?.focus();
});
for (const [id, delta] of [['prevYear', -1], ['nextYear', 1]]) {
    element(id).addEventListener('click', () => { pickerYear = String(Number(pickerYear) + delta); renderPicker(); });
}
element('todayPeriod').addEventListener('click', goCurrent);
element('pickerClose').addEventListener('click', () => picker.close());
picker.addEventListener('click', event => { if (event.target === picker) picker.close(); });
element('exportIcs').addEventListener('click', exportIcs);

onSwipe(element('personalSchedule'), () => element('prevPeriod').click(), () => element('nextPeriod').click());
// Grow the page by the colleagues card (plus its gap) so the mobile calendar keeps the same height.
new ResizeObserver(() => {
    const colleagues = element('colleagues');
    const height = colleagues.offsetParent ? colleagues.getBoundingClientRect().bottom - element('dayDetail').getBoundingClientRect().bottom : 0;
    document.body.style.setProperty('--colleagues-height', `${height}px`);
    sizeDays();
}).observe(element('colleagues'));
// Cell height is a pure function of (width, svh): recompute on every resize, not just lazily at the next
// month switch, so it can never get stuck at a height that no longer applies. A phone's toolbar hiding or
// showing changes innerHeight but not svh, so a real device remeasures to the same value; a genuine height
// change (a resized desktop window, split screen) is picked up right away. One measurement per frame.
let resizeFrame = null;
window.addEventListener('resize', () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => { resizeFrame = null; sizeDays(); });
});
