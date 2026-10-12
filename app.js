(async function () {
    'use strict';
    const element = id => document.getElementById(id);
    const themeSwitch = element('darkTheme');
    themeSwitch.checked = document.documentElement.dataset.theme === 'dark';
    themeSwitch.addEventListener('change', () => {
        const theme = themeSwitch.checked ? 'dark' : 'light';
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#212624' : '#ffffff';
        try { localStorage.setItem('noc-static-theme', theme); } catch (_) { }
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { });
    const core = window.ScheduleCore;
    const main = document.querySelector('main');
    main.setAttribute('aria-busy', 'true');
    element('coverage').textContent = '正在讀取班表…';
    element('empId').disabled = true;
    element('employeeForm').querySelector('button').disabled = true;
    document.querySelectorAll('[data-tab]').forEach(button => { button.disabled = true; });
    let fromCache = false;
    let data;
    try {
        if (location.protocol === 'file:') throw new Error('請從 GitHub Pages 或本機 HTTP 網站開啟；直接開啟 HTML 無法下載班表');
        if (!core) throw new Error('班表程式未完整載入，請確認所有 JavaScript 檔案已發布');
        const getJson = async file => {
            const response = await fetch(`./data/${file}`, { cache: 'no-cache', signal: AbortSignal.timeout?.(30000) });
            if (!response.ok) throw new Error(`${file} 下載失敗（HTTP ${response.status}）`);
            if (response.headers.has('x-offline-cache')) fromCache = true;
            return response.json();
        };
        const index = await getJson('index.json');
        // ponytail: loads all months up front (~50KB each); fetch per month if history grows large
        const parts = await Promise.all(index.months.map(month => getJson(`${month}.json`)));
        const people = new Map(parts.flatMap(part => part.employees.map(person => [person.empId, person])));
        const dates = parts.flatMap(part => part.dates).sort();
        data = {
            range: { start: dates[0], end: dates.at(-1) },
            dates,
            shifts: Object.assign({}, ...parts.map(part => part.shifts)),
            employees: [...people.values()],
            records: parts.flatMap(part => part.records),
            warnings: [...new Set(parts.flatMap(part => part.warnings))],
            sourceUpdatedAt: index.generatedAt
        };
    } catch (error) {
        element('fatal').hidden = false;
        element('fatal').textContent = `班表載入失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}。請重新整理再試一次。`;
        element('coverage').textContent = '資料無法載入';
        element('employeeForm').hidden = true;
        main.setAttribute('aria-busy', 'false');
        return;
    }
    main.setAttribute('aria-busy', 'false');
    element('empId').disabled = false;
    element('employeeForm').querySelector('button').disabled = false;
    document.querySelectorAll('[data-tab]').forEach(button => { button.disabled = false; });
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

    const employees = new Map(data.employees.map(employee => [employee.empId, employee]));
    const months = [...new Set(data.dates.map(date => date.slice(0, 7)))].sort();
    let employee = null;
    let month = months.includes(core.taipeiDate().slice(0, 7)) ? core.taipeiDate().slice(0, 7) : months.at(-1);
    let selectedDate = '';
    let activeTab = 'personal';
    let view = 'month';
    try { if (localStorage.getItem('nnoc-static-view') === 'week') view = 'week'; } catch (_) { }

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
            const code = data.shifts[record.code].group;
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
            const colorClass = core.shiftClass(shift);
            heading.append(textNode('h3', `${code} · ${shift.label}`, colorClass), textNode('span', `${timeLabel(shift)} · ${group.length} 人`, colorClass));
            section.append(heading);
            const people = textNode('div', '', 'roster-people');
            people.setAttribute('role', 'list');
            for (const record of group.sort((left, right) => employees.get(left.empId).name.localeCompare(employees.get(right.empId).name))) {
                const person = employees.get(record.empId);
                const row = textNode('div', '', 'roster-item');
                row.setAttribute('role', 'listitem');
                const name = textNode('strong', person.name);
                name.append(textNode('small', person.empId));
                row.append(name);
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
        if (!record) {
            container.append(textNode('p', '此日期沒有排班資料', 'empty'));
            return;
        }
        const shift = data.shifts[record.code];
        const detail = textNode('div', '', 'shift-detail');
        const description = textNode('div', '', 'shift-text');
        const colorClass = core.shiftClass(shift);
        description.append(textNode('p', shift.label, colorClass), textNode('small', timeLabel(shift), colorClass));
        detail.append(textNode('span', record.code, `shift-code ${colorClass}`), description);
        container.append(detail);
    }

    function renderCalendar() {
        if (!employee) return;
        const records = data.records.filter(record => record.empId === employee.empId && record.date.startsWith(month));
        const byDate = new Map(records.map(record => [record.date, record]));
        const today = core.taipeiDate();
        syncSelectedDate();
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
            button.setAttribute('aria-label', `${dateLabel(date)}，${shift ? `${record.code} ${shift.label}` : '無資料'}`);
            button.setAttribute('aria-pressed', String(date === selectedDate));
            button.append(textNode('span', String(day), 'day-number'), textNode('span', record ? record.code : '—', `day-code ${core.shiftClass(shift)}`));
            button.addEventListener('click', () => { selectedDate = date; renderPersonal(); element('calendar').querySelector(`[aria-pressed="true"]`).focus({ preventScroll: true }); });
            calendar.append(button);
        }
        renderSelectedDay();
    }

    function syncSelectedDate() {
        const today = core.taipeiDate();
        if (!selectedDate.startsWith(month)) selectedDate = today.startsWith(month) ? today : `${month}-01`;
    }

    const monthDay = date => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    const weekdayLabel = date => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', weekday: 'short' }).format(new Date(`${date}T00:00:00+08:00`));

    function renderWeek() {
        syncSelectedDate();
        const start = core.weekStart(selectedDate);
        const days = Array.from({ length: 7 }, (_, index) => core.addDays(start, index));
        const byDate = new Map(data.records.filter(record => record.empId === employee.empId && record.date >= days[0] && record.date <= days[6]).map(record => [record.date, record]));
        const today = core.taipeiDate();
        const years = [days[0].slice(0, 4), days[6].slice(0, 4)];
        element('employeeName').textContent = employee.name;
        element('monthLabel').textContent = `${years[0]} 年 ${monthDay(days[0])} – ${years[1] !== years[0] ? `${years[1]} 年 ` : ''}${monthDay(days[6])}`;
        element('previousMonth').disabled = days[0] <= data.range.start;
        element('nextMonth').disabled = days[6] >= data.range.end;
        const restCount = [...byDate.values()].filter(record => data.shifts[record.code].rest).length;
        summary('monthSummary', [['出勤', byDate.size - restCount], ['休假', restCount]]);
        const list = element('weekList');
        list.replaceChildren();
        for (const date of days) {
            const record = byDate.get(date);
            const shift = record && data.shifts[record.code];
            const colorClass = core.shiftClass(shift);
            const row = textNode('button', '', `week-row${shift ? shift.rest ? ' rest' : ' work' : ''}${date === today ? ' today' : ''}${date === selectedDate ? ' selected' : ''}`);
            row.type = 'button';
            row.setAttribute('aria-pressed', String(date === selectedDate));
            row.addEventListener('click', () => {
                if (!data.dates.includes(date)) return;
                selectedDate = date;
                month = date.slice(0, 7);
                renderPersonal();
            });
            const day = textNode('div', '', 'week-day');
            day.append(textNode('strong', monthDay(date)), textNode('small', weekdayLabel(date)));
            const description = textNode('div', '', 'shift-text');
            description.append(textNode('p', shift ? shift.label : '無排班資料', colorClass), textNode('small', shift ? timeLabel(shift) : '—', colorClass));
            row.append(day, textNode('span', record ? record.code : '—', `shift-code ${colorClass}`), description);
            list.append(row);
        }
        renderSelectedDay();
    }

    function renderPersonal() {
        if (!employee) return;
        const isWeek = view === 'week';
        for (const id of ['calendar', 'weekdays']) element(id).hidden = isWeek;
        element('weekList').hidden = !isWeek;
        document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === view)));
        element('previousMonth').title = isWeek ? '上一週' : '上個月';
        element('nextMonth').title = isWeek ? '下一週' : '下個月';
        element('previousMonth').setAttribute('aria-label', element('previousMonth').title);
        element('nextMonth').setAttribute('aria-label', element('nextMonth').title);
        element('goCurrent').textContent = isWeek ? '本週' : '本月';
        element('exportIcs').textContent = isWeek ? '匯出此週 ICS' : '匯出此月 ICS';
        element('goCurrent').disabled = !data.dates.includes(core.taipeiDate());
        if (isWeek) renderWeek();
        else renderCalendar();
    }

    function shiftWeek(delta) {
        const moved = core.addDays(selectedDate, delta * 7);
        selectedDate = moved < data.range.start ? data.range.start : moved > data.range.end ? data.range.end : moved;
        month = selectedDate.slice(0, 7);
        renderPersonal();
    }

    function exportIcs() {
        if (!employee) return;
        // Month view exports the shown month; week view exports the shown Monday-Sunday week.
        const from = view === 'week' ? core.weekStart(selectedDate) : `${month}-01`;
        const to = view === 'week' ? core.addDays(from, 6) : `${month}-31`;
        const shown = { shifts: data.shifts, records: data.records.filter(record => record.date >= from && record.date <= to) };
        const suffix = view === 'week' ? `${from}_${to}` : month;
        const url = URL.createObjectURL(new Blob([core.icsCalendar(shown, employee)], { type: 'text/calendar;charset=utf-8' }));
        const link = Object.assign(document.createElement('a'), { href: url, download: `noc-shift-${employee.empId}-${suffix}.ics` });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function updateStatus() {
        const offline = !navigator.onLine || fromCache;
        const outOfRange = !data.dates.includes(core.taipeiDate());
        const status = element('dataStatus');
        status.hidden = false;
        status.className = `status${offline || outOfRange ? ' warn' : ''}`;
        status.textContent = offline ? '無法連線，目前顯示已儲存的班表' : outOfRange ? '今日不在班表涵蓋期間' : '已連線，班表已同步';
    }

    // Reloads when a newer schedule was published; otherwise just refreshes the connection status.
    async function checkPublished() {
        try {
            const response = await fetch('./data/index.json', { cache: 'no-cache' });
            fromCache = response.headers.has('x-offline-cache');
            if (response.ok && !fromCache && (await response.json()).generatedAt !== data.sourceUpdatedAt) { location.reload(); return; }
        } catch (_) { fromCache = true; }
        updateStatus();
    }

    function selectEmployee(empId) {
        const normalized = core.normalizeEmpId(empId);
        const selected = employees.get(normalized);
        if (!selected) {
            notice('employeeError', '此工號不在本次班表資料中，請確認工號。');
            element('empId').setAttribute('aria-invalid', 'true');
            employee = null;
            element('personalSchedule').hidden = true;
            element('employeeForm').hidden = false;
            try { localStorage.removeItem('nnoc-static-empId'); } catch (_) { }
            return;
        }
        employee = selected;
        element('empId').value = normalized;
        element('empId').removeAttribute('aria-invalid');
        notice('employeeError', '');
        element('personalSchedule').hidden = false;
        element('employeeForm').hidden = true;
        try { localStorage.setItem('nnoc-static-empId', normalized); } catch (_) { }
        renderPersonal();
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

    function renderDaily() {
        const date = element('rosterDate').value;
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
        element('prevDay').disabled = !validDate || date <= data.range.start;
        element('nextDay').disabled = !validDate || date >= data.range.end;
        const records = core.dayRecords(data, date);
        const filter = element('shiftFilter');
        const restCount = records.filter(record => data.shifts[record.code].rest).length;
        filter.className = filter.selectedOptions[0]?.className || '';
        summary('dailySummary', [['出勤', records.length - restCount], ['休假', restCount]]);
        notice('dailyNotice', data.dates.includes(date) ? '' : '此日期不在已發布資料期間。');
        const visible = records.filter(record => !filter.value || core.shiftCategory(data.shifts[record.code]) === filter.value);
        renderRoster('dailyRoster', visible, records.length ? '沒有符合篩選的排班' : '此日期沒有排班資料');
    }

    for (const [id, label] of core.shiftCategories) {
        const option = textNode('option', label, core.shiftClass({ color: id }));
        option.value = id;
        element('shiftFilter').append(option);
    }

    element('coverage').textContent = `${data.range.start.replaceAll('-', '/')} — ${data.range.end.replaceAll('-', '/')} · ${data.employees.length} 人`;
    element('updatedAt').textContent = data.sourceUpdatedAt
        ? `班表資料產生時間：${new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.sourceUpdatedAt))}`
        : '網站未提供資料產生時間';
    updateStatus();
    element('rosterDate').value = core.taipeiDate();
    element('employeeForm').addEventListener('submit', event => { event.preventDefault(); selectEmployee(element('empId').value); });
    element('clearEmployee').addEventListener('click', () => {
        employee = null;
        element('empId').value = '';
        element('personalSchedule').hidden = true;
        element('employeeForm').hidden = false;
        notice('employeeError', '');
        element('empId').removeAttribute('aria-invalid');
        try { localStorage.removeItem('nnoc-static-empId'); } catch (_) { }
        element('empId').focus();
    });
    for (const [id, delta] of [['previousMonth', -1], ['nextMonth', 1]]) {
        element(id).addEventListener('click', () => {
            if (view === 'week') shiftWeek(delta);
            else { month = months[months.indexOf(month) + delta]; renderPersonal(); }
        });
    }
    document.querySelectorAll('[data-view]').forEach(button => {
        button.addEventListener('click', () => {
            view = button.dataset.view;
            try { localStorage.setItem('nnoc-static-view', view); } catch (_) { }
            renderPersonal();
        });
    });
    element('goCurrent').addEventListener('click', () => {
        selectedDate = core.taipeiDate();
        month = selectedDate.slice(0, 7);
        renderPersonal();
    });
    element('exportIcs').addEventListener('click', exportIcs);
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
    element('rosterDate').addEventListener('change', () => renderDaily());
    element('shiftFilter').addEventListener('change', () => renderDaily());
    element('goToday').addEventListener('click', () => { element('rosterDate').value = core.taipeiDate(); renderDaily(); });
    for (const [id, delta] of [['prevDay', -1], ['nextDay', 1]]) {
        element(id).addEventListener('click', () => {
            if (!element('rosterDate').value) return;
            element('rosterDate').value = core.addDays(element('rosterDate').value, delta);
            renderDaily();
        });
    }
    renderDaily();

    const urlEmpId = new URLSearchParams(location.search).get('empno');
    let remembered = null;
    try { remembered = localStorage.getItem('nnoc-static-empId'); } catch (_) { }
    const dialog = element('empDialog');
    // Browsers without <dialog> fall back to the inline form.
    function askEmployee() {
        notice('employeeError', '請輸入工號以檢視個人班表。');
        if (dialog.showModal) dialog.showModal();
        else element('empId').focus();
    }
    element('empDialogForm').addEventListener('submit', event => {
        event.preventDefault();
        const normalized = core.normalizeEmpId(element('empDialogId').value);
        const error = element('empDialogError');
        error.hidden = employees.has(normalized);
        if (!error.hidden) {
            element('empDialogId').setAttribute('aria-invalid', 'true');
            return;
        }
        dialog.close();
        selectEmployee(normalized);
    });
    element('empDialogSkip').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (!employee) element('empId').focus(); });
    if (urlEmpId?.trim()) {
        const normalized = core.normalizeEmpId(urlEmpId);
        element('empId').value = normalized;
        selectEmployee(normalized);
    } else if (remembered && employees.has(remembered)) {
        selectEmployee(remembered);
    } else {
        askEmployee();
    }

    setInterval(() => { if (activeTab === 'current') renderCurrent(); }, 30000);
    window.addEventListener('online', checkPublished);
    window.addEventListener('offline', updateStatus);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) return;
        if (activeTab === 'current') renderCurrent();
        // An installed app resumes without reloading, so pick up a newly published schedule here.
        checkPublished();
    });
})();
