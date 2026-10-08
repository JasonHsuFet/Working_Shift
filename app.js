(function () {
    'use strict';
    const element = id => document.getElementById(id);
    const data = window.SCHEDULE_DATA;
    const core = window.ScheduleCore;
    if (!data || !core || data.schemaVersion !== 1) {
        element('fatal').hidden = false;
        element('fatal').textContent = '班表資料載入失敗，請確認 data.js 與網頁一併發布，然後重新整理。';
        element('coverage').textContent = '資料無法載入';
        element('employeeForm').hidden = true;
        document.querySelectorAll('[data-tab]').forEach(button => { button.disabled = true; });
        return;
    }

    const employees = new Map(data.employees.map(employee => [employee.empId, employee]));
    const months = [...new Set(data.dates.map(date => date.slice(0, 7)))].sort();
    let employee = null;
    let month = months.includes(core.taipeiDate().slice(0, 7)) ? core.taipeiDate().slice(0, 7) : months.at(-1);
    let selectedDate = '';
    let activeTab = 'personal';

    function textNode(tag, text, className) {
        const node = document.createElement(tag);
        node.textContent = text;
        if (className) node.className = className;
        return node;
    }

    function notice(id, message) {
        element(id).textContent = message;
        element(id).hidden = !message;
    }

    function summary(id, entries) {
        element(id).replaceChildren(...entries.map(([label, count]) => {
            const node = textNode('span', '');
            node.append(textNode('strong', String(count)), document.createTextNode(label));
            return node;
        }));
    }

    function timeLabel(shift) {
        if (shift.rest) return '休假';
        if (!shift.start || !shift.end) return '時間未定義';
        const nextDay = shift.end !== '24:00' && shift.end <= shift.start ? '（翌日）' : '';
        return `${shift.start}–${shift.end}${nextDay}`;
    }

    function dateLabel(date) {
        return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00+08:00`));
    }

    function renderRoster(id, records, emptyMessage) {
        const container = element(id);
        container.replaceChildren();
        if (!records.length) {
            container.append(textNode('p', emptyMessage, 'empty'));
            return;
        }
        const groups = new Map();
        for (const record of records) {
            const code = core.rosterCode(record.code);
            if (!groups.has(code)) groups.set(code, []);
            groups.get(code).push(record);
        }
        const ordered = [...groups].sort(([left, leftGroup], [right, rightGroup]) => {
            const leftShift = data.shifts[left] || data.shifts[leftGroup[0].code];
            const rightShift = data.shifts[right] || data.shifts[rightGroup[0].code];
            return Number(leftShift.rest) - Number(rightShift.rest) || (leftShift.start || '99').localeCompare(rightShift.start || '99') || left.localeCompare(right);
        });
        for (const [code, group] of ordered) {
            const shift = data.shifts[code] || data.shifts[group[0].code];
            const section = textNode('section', '', 'roster-group');
            const heading = textNode('div', '', 'group-heading');
            heading.append(textNode('h3', `${code} · ${core.rosterLabel(code, shift)}`, core.shiftClass(code)), textNode('span', `${timeLabel(shift)} · ${group.length} 人`, core.shiftClass(code)));
            section.append(heading);
            for (const record of group.sort((left, right) => employees.get(left.empId).name.localeCompare(employees.get(right.empId).name))) {
                const person = employees.get(record.empId);
                const row = textNode('div', '', 'roster-item');
                const name = textNode('strong', person.name);
                name.append(textNode('small', person.empId));
                row.append(name, textNode('span', record.date.slice(5).replace('-', '/'), 'date-tag'));
                section.append(row);
            }
            container.append(section);
        }
    }

    function renderSelectedDay() {
        element('selectedDate').textContent = dateLabel(selectedDate);
        const container = element('selectedShift');
        container.replaceChildren();
        const record = data.records.find(item => item.empId === employee.empId && item.date === selectedDate);
        if (!record) {
            container.append(textNode('p', '此日期沒有排班資料', 'empty'));
            return;
        }
        const shift = data.shifts[record.code];
        const detail = textNode('div', '', 'shift-detail');
        const description = textNode('div', '', 'shift-text');
        const colorClass = core.shiftClass(record.code);
        description.append(textNode('p', core.rosterLabel(record.code, shift), colorClass), textNode('small', timeLabel(shift), colorClass));
        detail.append(textNode('span', record.code, `shift-code ${colorClass}`), description);
        container.append(detail);
    }

    function renderCalendar() {
        if (!employee) return;
        const records = data.records.filter(record => record.empId === employee.empId && record.date.startsWith(month));
        const byDate = new Map(records.map(record => [record.date, record]));
        const today = core.taipeiDate();
        if (!selectedDate.startsWith(month)) selectedDate = today.startsWith(month) ? today : `${month}-01`;
        element('employeeName').textContent = employee.name;
        element('monthLabel').textContent = `${month.slice(0, 4)} 年 ${Number(month.slice(5))} 月`;
        const position = months.indexOf(month);
        element('previousMonth').disabled = position <= 0;
        element('nextMonth').disabled = position >= months.length - 1;
        const restCount = records.filter(record => data.shifts[record.code].rest).length;
        summary('monthSummary', [['出勤', records.length - restCount], ['休假', restCount]]);
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
            const button = textNode('button', '', `day${shift ? shift.rest ? ' rest' : ' work' : ''}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}`);
            button.type = 'button';
            button.setAttribute('aria-label', `${dateLabel(date)}，${shift ? `${record.code} ${core.rosterLabel(record.code, shift)}` : '無資料'}`);
            button.setAttribute('aria-pressed', String(date === selectedDate));
            button.append(textNode('span', String(day), 'day-number'), textNode('span', record ? record.code : '—', `day-code ${record ? core.shiftClass(record.code) : ''}`));
            button.addEventListener('click', () => { selectedDate = date; renderCalendar(); element('calendar').querySelector(`[aria-pressed="true"]`).focus({ preventScroll: true }); });
            calendar.append(button);
        }
        renderSelectedDay();
    }

    function selectEmployee(empId) {
        const normalized = core.normalizeEmpId(empId);
        const selected = employees.get(normalized);
        if (!selected) {
            notice('employeeError', '此工號不在本次班表資料中，請確認工號。');
            element('empId').setAttribute('aria-invalid', 'true');
            employee = null;
            element('personalSchedule').hidden = true;
            try { localStorage.removeItem('nnoc-static-empId'); } catch (_) { }
            return;
        }
        employee = selected;
        element('empId').value = normalized;
        element('empId').removeAttribute('aria-invalid');
        notice('employeeError', '');
        element('personalSchedule').hidden = false;
        try { localStorage.setItem('nnoc-static-empId', normalized); } catch (_) { }
        renderCalendar();
    }

    function renderCurrent() {
        const now = new Date();
        const today = core.taipeiDate(now);
        element('currentTime').textContent = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(now);
        const records = core.currentRecords(data, now);
        const inRange = data.dates.includes(today);
        const unknown = core.dayRecords(data, today).filter(record => {
            const shift = data.shifts[record.code];
            return !shift.rest && (!shift.start || !shift.end);
        });
        notice('currentNotice', !inRange ? '今日不在已發布資料期間，無法提供完整的當前班表。' : unknown.length ? '部分班別時間未定義；以下僅列已知時段的值班人員。' : '');
        summary('currentSummary', [['已知時段值班', records.length], ['時間未定義', unknown.length]]);
        renderRoster('currentRoster', records, inRange ? '此刻沒有已知時段的值班人員' : '今日班表尚未發布');
        element('unknownTimes').hidden = !unknown.length;
        renderRoster('unknownRoster', unknown, '');
    }

    function renderDaily(resetFilter = false) {
        const date = element('rosterDate').value;
        const records = core.dayRecords(data, date);
        const filter = element('shiftFilter');
        if (resetFilter) {
            filter.replaceChildren();
            const all = textNode('option', '全部班別');
            all.value = '';
            filter.append(all);
            for (const code of [...new Set(records.map(record => core.rosterCode(record.code)))]) {
                const record = records.find(item => core.rosterCode(item.code) === code);
                const shift = data.shifts[code] || data.shifts[record.code];
                const option = textNode('option', `${code} · ${core.rosterLabel(code, shift)}`, core.shiftClass(code));
                option.value = code;
                filter.append(option);
            }
        }
        const restCount = records.filter(record => data.shifts[record.code].rest).length;
        filter.className = core.shiftClass(filter.value);
        summary('dailySummary', [['出勤', records.length - restCount], ['休假', restCount]]);
        notice('dailyNotice', data.dates.includes(date) ? '' : '此日期不在已發布資料期間。');
        const visible = records.filter(record => (element('includeRest').checked || !data.shifts[record.code].rest) && (!filter.value || filter.value === core.rosterCode(record.code)));
        renderRoster('dailyRoster', visible, records.length ? '沒有符合篩選的排班' : '此日期沒有排班資料');
    }

    element('coverage').textContent = `${data.range.start.replaceAll('-', '/')} — ${data.range.end.replaceAll('-', '/')} · ${data.employees.length} 人`;
    element('updatedAt').textContent = `資料產生：${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.generatedAt))}`;
    element('rosterDate').value = core.taipeiDate();
    element('employeeForm').addEventListener('submit', event => { event.preventDefault(); selectEmployee(element('empId').value); });
    element('clearEmployee').addEventListener('click', () => {
        employee = null;
        element('empId').value = '';
        element('personalSchedule').hidden = true;
        notice('employeeError', '');
        element('empId').removeAttribute('aria-invalid');
        try { localStorage.removeItem('nnoc-static-empId'); } catch (_) { }
        element('empId').focus();
    });
    for (const [id, delta] of [['previousMonth', -1], ['nextMonth', 1]]) {
        element(id).addEventListener('click', () => { month = months[months.indexOf(month) + delta]; renderCalendar(); });
    }
    document.querySelectorAll('[data-tab]').forEach(button => {
        button.addEventListener('click', () => {
            activeTab = button.dataset.tab;
            for (const id of ['personal', 'current', 'daily']) element(id).hidden = id !== activeTab;
            document.querySelectorAll('[data-tab]').forEach(tab => {
                if (tab === button) tab.setAttribute('aria-current', 'page');
                else tab.removeAttribute('aria-current');
            });
            if (activeTab === 'current') renderCurrent();
            if (activeTab === 'daily') renderDaily();
        });
    });
    element('rosterDate').addEventListener('change', () => renderDaily(true));
    element('shiftFilter').addEventListener('change', () => renderDaily());
    element('includeRest').addEventListener('change', () => renderDaily());
    element('goToday').addEventListener('click', () => { element('rosterDate').value = core.taipeiDate(); renderDaily(true); });
    renderDaily(true);
    try {
        const remembered = localStorage.getItem('nnoc-static-empId');
        if (remembered && employees.has(remembered)) selectEmployee(remembered);
    } catch (_) { }
    setInterval(() => { if (activeTab === 'current') renderCurrent(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && activeTab === 'current') renderCurrent(); });
})();