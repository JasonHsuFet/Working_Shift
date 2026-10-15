// Page UI: renders the personal schedule and the on-duty roster, and wires routes and controls to them.
import * as schedule from './schedule.js';
import { createStore } from './store.js';
import { createRouter } from './router.js';

const element = id => document.getElementById(id);
const EMP_ID_KEY = 'noc.empId';
const VIEW_KEY = 'noc.view';

// legacy: ?empno=/?theme= from old links and home-screen icons; remove when no longer used
if (location.search) {
    const legacyEmpId = new URLSearchParams(location.search).get('empno')?.trim();
    history.replaceState(null, '', location.pathname + (legacyEmpId ? `#/personal/${encodeURIComponent(legacyEmpId)}` : location.hash));
}
// legacy: keys before the noc.* naming; remove once old installs have migrated
try {
    for (const [oldKey, key] of [['nnoc-static-empId', EMP_ID_KEY], ['nnoc-static-view', VIEW_KEY]]) {
        const old = localStorage.getItem(oldKey);
        if (old && !localStorage.getItem(key)) localStorage.setItem(key, old);
        localStorage.removeItem(oldKey);
    }
} catch (_) { }

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { });
const main = document.querySelector('main');
main.setAttribute('aria-busy', 'true');
element('empId').disabled = true;
element('employeeForm').querySelector('button').disabled = true;

let store;
try {
    if (location.protocol === 'file:') throw new Error('請從 GitHub Pages 或本機 HTTP 網站開啟；直接開啟 HTML 無法下載班表');
    store = await createStore(schedule.taipeiDate());
} catch (error) {
    element('fatal').hidden = false;
    element('fatal').textContent = `班表載入失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}。請重新整理再試一次。`;
    element('employeeForm').hidden = true;
    main.setAttribute('aria-busy', 'false');
    throw error;
}
const { data, months, employees } = store;
main.setAttribute('aria-busy', 'false');
element('empId').disabled = false;
element('employeeForm').querySelector('button').disabled = false;
if (data.warnings.length) {
    const warnings = element('sourceWarnings');
    warnings.textContent = `來源資料提醒：${data.warnings.join('；')}`;
    warnings.hidden = false;
    // Browsers without popover (Safari < 17) keep it as the inline notice.
    if (warnings.showPopover) {
        warnings.addEventListener('animationend', () => warnings.hidePopover());
        warnings.showPopover();
    }
}

// <datalist> filters by substring, so the list is rebuilt to hold only IDs that start with the typed text.
function suggestEmployees(event) {
    const typed = schedule.normalizeEmpId(event.target.value);
    const matches = typed ? [...employees.values()].filter(person => person.empId.startsWith(typed)).sort((left, right) => left.empId.localeCompare(right.empId, undefined, { numeric: true })).slice(0, 10) : [];
    element('empList').replaceChildren(...matches.map(person => {
        const option = document.createElement('option');
        option.value = person.empId;
        option.label = person.name;
        return option;
    }));
}
for (const id of ['empId', 'empDialogId']) element(id).addEventListener('input', suggestEmployees);
// The period is page state only: every visit opens on the current month, so a saved home-screen URL never pins an old period.
// The month/week view is a preference and is remembered.
function storedView() {
    try { return localStorage.getItem(VIEW_KEY) === 'week' ? 'week' : 'month'; } catch (_) { return 'month'; }
}
let employee = null;
let month = store.baseMonth;
let selectedDate = '';
let activeTab = 'personal';
let view = storedView();

function textNode(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}

function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    return svg;
}

function notice(id, message) {
    element(id).textContent = message;
    element(id).hidden = !message;
}

async function ensure(wanted) {
    try {
        await store.ensure(wanted);
        notice('fatal', '');
        return true;
    } catch (error) {
        notice('fatal', `載入班表失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}`);
        return false;
    }
}

const hasDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && months.includes(date.slice(0, 7));

function summary(id, entries) {
    element(id).replaceChildren(...entries.map(([label, count]) => {
        const node = textNode('span', '');
        node.append(textNode('strong', String(count)), document.createTextNode(label));
        return node;
    }));
}

function dateLabel(date) {
    return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00+08:00`));
}

const categoryLabel = Object.fromEntries(schedule.shiftCategories);

function renderRoster(id, records, emptyMessage) {
    const container = element(id);
    container.replaceChildren();
    if (!records.length) {
        container.append(textNode('p', emptyMessage, 'empty'));
        return;
    }
    for (const { key, shift, records: group } of schedule.groupRoster(records, data.shifts, employees)) {
        const section = textNode('section', '', 'roster-group');
        const heading = textNode('div', '', 'group-heading');
        const colorClass = schedule.shiftClass(shift);
        const times = [...new Set(group.map(record => schedule.timeLabel(data.shifts[record.code])))].join(' / ');
        heading.append(textNode('h3', categoryLabel[key] || `${key} · ${shift.label}`, colorClass), textNode('span', `${times} · ${group.length} 人`, colorClass));
        section.append(heading);
        const people = textNode('div', '', 'roster-people');
        people.setAttribute('role', 'list');
        for (const record of group) {
            const person = employees.get(record.empId);
            const row = textNode('div', '', `roster-item${record.empId === employee?.empId ? ' me' : ''}`);
            row.setAttribute('role', 'listitem');
            const name = textNode('strong', person.name, record.leader ? 'leader' : '');
            name.append(textNode('small', person.empId));
            row.append(name, textNode('span', record.code, 'roster-tag'));
            people.append(row);
        }
        section.append(people);
        container.append(section);
    }
}

function renderSelectedDay() {
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
}

function syncSelectedDate() {
    const today = schedule.taipeiDate();
    if (!selectedDate.startsWith(month)) selectedDate = today.startsWith(month) ? today : `${month}-01`;
}

const monthDay = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
const weekdayLabel = date => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(new Date(`${date}T00:00:00+08:00`));

function renderWeek() {
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
    if (!employee) return;
    const isWeek = view === 'week';
    for (const id of ['calendar', 'weekdays']) element(id).hidden = isWeek;
    element('weekList').hidden = !isWeek;
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
    if (!employee) return;
    syncSelectedDate();
    const start = schedule.weekStart(selectedDate);
    await ensure(view === 'week' ? [...new Set([start.slice(0, 7), schedule.addDays(start, 6).slice(0, 7)])] : [month]);
    renderPersonal();
}

// Counts for the shown range and same-shift colleagues relative to the selected day.
function renderInsights(from, to, scope) {
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

function updateStatus() {
    const offline = !navigator.onLine || store.fromCache;
    const outOfRange = !hasDate(schedule.taipeiDate());
    const status = element('dataStatus');
    status.hidden = false;
    status.className = `status${offline || outOfRange ? ' warn' : ''}`;
    status.textContent = offline ? '無法連線，目前顯示已儲存的班表' : outOfRange ? '今日不在班表涵蓋期間' : '已連線，班表已同步';
    element('liveDot').classList.toggle('warn', offline || outOfRange);
    element('todayPeriod').disabled = outOfRange;
}

// Reloads when a newer schedule was published; otherwise just refreshes the connection status.
async function checkPublished() {
    if (await store.isOutdated()) {
        location.reload();
        return;
    }
    updateStatus();
}

function showEmployeeForm(error) {
    employee = null;
    element('personalSchedule').hidden = true;
    element('employeeForm').hidden = false;
    notice('employeeError', error);
    element('empId').toggleAttribute('aria-invalid', Boolean(error));
}

// Shows a known employee from the current month; an unknown ID keeps the form with an error.
function selectEmployee(empId) {
    const selected = employees.get(empId);
    element('empId').value = empId;
    if (!selected) {
        showEmployeeForm('此工號不在本次班表資料中，請確認工號。');
        return;
    }
    if (employee !== selected) {
        month = store.baseMonth;
        selectedDate = '';
        view = storedView();
    }
    employee = selected;
    element('empId').removeAttribute('aria-invalid');
    notice('employeeError', '');
    element('personalSchedule').hidden = false;
    element('employeeForm').hidden = true;
    try { localStorage.setItem(EMP_ID_KEY, empId); } catch (_) { }
    showPersonal();
}

let onDutyRun = 0;
async function renderOnDuty() {
    const date = element('onDutyDate').value;
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
    element('prevDay').disabled = !validDate || date <= data.range.start;
    element('nextDay').disabled = !validDate || date >= data.range.end;
    const run = ++onDutyRun;
    if (hasDate(date)) await ensure([date.slice(0, 7)]);
    if (run !== onDutyRun) return;
    const now = new Date();
    // The 'now' filter only makes sense for today's published date.
    const live = hasDate(date) && date === schedule.taipeiDate(now);
    filterBar.querySelector('[data-cat="now"]').disabled = !live;
    if (!live && rosterFilter === 'now') setFilter('');
    element('onDutyDateLabel').textContent = !validDate ? '' : live ? `${dateLabel(date)} ${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', timeStyle: 'short' }).format(now)}` : dateLabel(date);
    const records = schedule.dayRecords(data, date);
    const onNow = rosterFilter === 'now';
    const unknown = onNow ? records.filter(record => {
        const shift = data.shifts[record.code];
        return !shift.rest && (!shift.start || !shift.end);
    }) : [];
    if (onNow) {
        const current = schedule.currentRecords(data, now);
        summary('onDutySummary', [['值班中', current.length], ...(unknown.length ? [['時間未定義', unknown.length]] : [])]);
        notice('onDutyNotice', unknown.length ? '部分班別時間未定義；以下僅列已知時段的值班人員。' : '');
        renderRoster('onDutyRoster', current, '此刻沒有已知時段的值班人員');
    } else {
        const restCount = records.filter(record => data.shifts[record.code].rest).length;
        summary('onDutySummary', [['出勤', records.length - restCount], ['休假', restCount]]);
        notice('onDutyNotice', hasDate(date) ? '' : '此日期不在已發布資料期間。');
        const visible = records.filter(record => !rosterFilter || schedule.shiftCategory(data.shifts[record.code]) === rosterFilter);
        renderRoster('onDutyRoster', visible, records.length ? '沒有符合篩選的排班' : '此日期沒有排班資料');
    }
    element('unknownTimes').hidden = !unknown.length;
    renderRoster('unknownRoster', unknown, '');
}

let rosterFilter = 'now';
const filterBar = element('shiftFilter');
function setFilter(id) {
    rosterFilter = id;
    filterBar.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String((item.dataset.cat === 'all' ? '' : item.dataset.cat) === id)));
}
for (const [id, label, short] of [['now', '目前值班', '現'], ['', '全部班別', '全'], ...schedule.shiftCategories.map(([id, label]) => [id, label, label[0]])]) {
    const button = textNode('button', '', '');
    button.type = 'button';
    button.dataset.cat = id || 'all';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(id === rosterFilter));
    button.append(icon(id || 'all'), textNode('span', short));
    button.addEventListener('click', () => {
        setFilter(id);
        renderOnDuty();
    });
    filterBar.append(button);
}

updateStatus();
element('onDutyDate').value = schedule.taipeiDate();
element('onDutyDate').min = data.range.start;
element('onDutyDate').max = data.range.end;
let followToday = true;
const router = createRouter();
element('employeeForm').addEventListener('submit', event => {
    event.preventDefault();
    router.navigate(`/personal/${encodeURIComponent(schedule.normalizeEmpId(element('empId').value))}`, { replace: true });
});
element('clearEmployee').addEventListener('click', () => {
    try { localStorage.removeItem(EMP_ID_KEY); } catch (_) { }
    showEmployeeForm('');
    element('empId').value = '';
    router.navigate('/personal');
    element('empId').focus();
});
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
element('onDutyDate').addEventListener('change', () => {
    followToday = element('onDutyDate').value === schedule.taipeiDate();
    renderOnDuty();
});
element('goToday').addEventListener('click', () => { element('onDutyDate').value = schedule.taipeiDate(); followToday = true; setFilter('now'); renderOnDuty(); });
for (const [id, delta] of [['prevDay', -1], ['nextDay', 1]]) {
    element(id).addEventListener('click', () => {
        if (!element('onDutyDate').value) return;
        followToday = false;
        element('onDutyDate').value = schedule.addDays(element('onDutyDate').value, delta);
        renderOnDuty();
    });
}

// A horizontal swipe (touch, pen or mouse drag) does what the previous/next buttons do.
function onSwipe(target, previous, next) {
    let start = null;
    target.addEventListener('pointerdown', event => {
        start = event.isPrimary && !event.target.closest('input') ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
    });
    target.addEventListener('pointercancel', () => { start = null; });
    target.addEventListener('pointerup', event => {
        if (!start || event.pointerId !== start.id) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        start = null;
        // A drag that selected text is a selection, not a swipe.
        if (window.getSelection().toString()) return;
        if (Math.abs(dx) >= 60 && Math.abs(dx) >= Math.abs(dy) * 1.5) (dx < 0 ? next : previous)();
    });
}
onSwipe(element('personalSchedule'), () => element('prevPeriod').click(), () => element('nextPeriod').click());
onSwipe(element('on-duty'), () => element('prevDay').click(), () => element('nextDay').click());
// Grow the page by the colleagues card (plus its gap) so the mobile calendar keeps the same height.
new ResizeObserver(() => {
    const colleagues = element('colleagues');
    const height = colleagues.offsetParent ? colleagues.getBoundingClientRect().bottom - element('dayDetail').getBoundingClientRect().bottom : 0;
    document.body.style.setProperty('--colleagues-height', `${height}px`);
}).observe(element('colleagues'));

const dialog = element('empDialog');
element('empDialogForm').addEventListener('submit', event => {
    event.preventDefault();
    const empId = schedule.normalizeEmpId(element('empDialogId').value);
    const error = element('empDialogError');
    error.hidden = employees.has(empId);
    if (!error.hidden) {
        element('empDialogId').setAttribute('aria-invalid', 'true');
        return;
    }
    dialog.close();
    router.navigate(`/personal/${encodeURIComponent(empId)}`, { replace: true });
});
element('empDialogSkip').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { if (!employee) element('empId').focus(); });

function showTab(tab) {
    activeTab = tab;
    for (const id of ['personal', 'on-duty']) element(id).hidden = id !== tab;
    document.querySelectorAll('[data-tab]').forEach(link => {
        if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

// Only the first visit without a known employee asks in a dialog; later visits (e.g. after 清除工號) use the inline form.
let asked = false;
router
    .on('/personal/:empId?', ({ data: { empId } }) => {
        showTab('personal');
        if (!empId) {
            let remembered = null;
            try { remembered = localStorage.getItem(EMP_ID_KEY); } catch (_) { }
            const known = employee?.empId || (employees.has(remembered) ? remembered : null);
            if (known) {
                router.navigate(`/personal/${encodeURIComponent(known)}`, { replace: true });
                return;
            }
            if (!asked) {
                asked = true;
                notice('employeeError', '請輸入工號以檢視個人班表。');
                // Browsers without <dialog> fall back to the inline form.
                if (dialog.showModal) dialog.showModal();
                else element('empId').focus();
            }
            return;
        }
        const normalized = schedule.normalizeEmpId(empId);
        if (normalized !== empId) {
            router.navigate(`/personal/${encodeURIComponent(normalized)}`, { replace: true });
            return;
        }
        asked = true;
        selectEmployee(normalized);
    })
    .on('/on-duty', () => {
        showTab('on-duty');
        element('onDutyDate').value = schedule.liveDate(element('onDutyDate').value, schedule.taipeiDate(), followToday);
        renderOnDuty();
    })
    .notFound(() => router.navigate('/personal', { replace: true }))
    .resolve();

// Only today's on-duty view shows a live clock and the 'now' roster, so only it needs the periodic refresh.
const refreshLive = () => {
    if (activeTab !== 'on-duty') return;
    const today = schedule.taipeiDate();
    element('onDutyDate').value = schedule.liveDate(element('onDutyDate').value, today, followToday);
    if (element('onDutyDate').value === today) renderOnDuty();
};
setInterval(refreshLive, 30000);
window.addEventListener('online', checkPublished);
window.addEventListener('offline', updateStatus);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshLive();
    // An installed app resumes without reloading, so pick up a newly published schedule here.
    checkPublished();
});
