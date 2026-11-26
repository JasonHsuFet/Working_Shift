// On-duty tab: one day's roster with category filters, date controls and the live 'now' view of today.
import * as schedule from './schedule.js';
import { data, employees, state, ensure, hasDate } from './context.js';
import { element, textNode, notice, dateLabel, onSwipe } from './dom.js';

const categoryLabel = Object.fromEntries(schedule.shiftCategories);
let rosterFilter = 'now';
// True while the date should move along with today (the 30-second refresh and the 今天 button).
let followToday = true;

function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`);
    svg.append(use);
    return svg;
}

function summary(id, entries) {
    element(id).replaceChildren(...entries.map(([label, count]) => {
        const node = textNode('span', '');
        node.append(textNode('strong', String(count)), document.createTextNode(label));
        return node;
    }));
}

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
            const row = textNode('div', '', `roster-item${record.empId === state.employee?.empId ? ' me' : ''}`);
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

element('onDutyDate').value = schedule.taipeiDate();
element('onDutyDate').min = data.range.start;
element('onDutyDate').max = data.range.end;
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
onSwipe(element('on-duty'), () => element('prevDay').click(), () => element('nextDay').click());

export function showOnDuty() {
    element('onDutyDate').value = schedule.liveDate(element('onDutyDate').value, schedule.taipeiDate(), followToday);
    renderOnDuty();
}

// Only today's on-duty view shows a live clock and the 'now' roster, so only it needs the periodic refresh.
export function refreshLive() {
    if (state.activeTab !== 'on-duty') return;
    const today = schedule.taipeiDate();
    element('onDutyDate').value = schedule.liveDate(element('onDutyDate').value, today, followToday);
    if (element('onDutyDate').value === today) renderOnDuty();
}
