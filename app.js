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
    element('empId').disabled = true;
    element('employeeForm').querySelector('button').disabled = true;
    document.querySelectorAll('[data-tab]').forEach(button => { button.disabled = true; });
    let fromCache = false;
    let data;
    let months = [];
    let baseMonth;
    const employees = new Map();
    const loadedMonths = new Map();
    const shiftDefinedIn = {};

    async function getJson(file) {
        const response = await fetch(`./data/${file}`, { cache: 'no-cache', signal: AbortSignal.timeout?.(30000) });
        if (!response.ok) throw new Error(`${file} 下載失敗（HTTP ${response.status}）`);
        if (response.headers.has('x-offline-cache')) fromCache = true;
        return response.json();
    }

    // Each month is fetched once and merged into `data`; a later month wins when two define the same shift code.
    function loadMonth(key) {
        if (!months.includes(key)) return Promise.resolve();
        if (!loadedMonths.has(key)) {
            loadedMonths.set(key, getJson(`${key}.json`).then(part => {
                for (const [code, shift] of Object.entries(part.shifts)) {
                    if (!(code in data.shifts) || key >= shiftDefinedIn[code]) {
                        data.shifts[code] = shift;
                        shiftDefinedIn[code] = key;
                    }
                }
                data.records.push(...part.records);
                part.employees.forEach(person => employees.set(person.empId, person));
                part.warnings.forEach(warning => { if (!data.warnings.includes(warning)) data.warnings.push(warning); });
            }, error => {
                loadedMonths.delete(key);
                throw error;
            }));
        }
        return loadedMonths.get(key);
    }

    // Loads the given months, plus the months next to them so streaks and next-rest lookups can cross a month boundary.
    async function ensure(wanted) {
        const keys = wanted.filter(key => months.includes(key));
        const near = new Set(keys.flatMap(key => [months[months.indexOf(key) - 1], months[months.indexOf(key) + 1]]));
        try {
            await Promise.all([...keys.map(loadMonth), ...[...near].filter(key => key && !keys.includes(key)).map(key => loadMonth(key).catch(() => { }))]);
            notice('fatal', '');
            return true;
        } catch (error) {
            notice('fatal', `載入班表失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}`);
            return false;
        }
    }

    try {
        if (location.protocol === 'file:') throw new Error('請從 GitHub Pages 或本機 HTTP 網站開啟；直接開啟 HTML 無法下載班表');
        if (!core) throw new Error('班表程式未完整載入，請確認所有 JavaScript 檔案已發布');
        const index = await getJson('index.json');
        months = [...index.months].sort();
        if (!months.length) throw new Error('沒有可用的班表月份');
        const [lastYear, lastMonth] = months.at(-1).split('-').map(Number);
        data = {
            range: { start: `${months[0]}-01`, end: `${months.at(-1)}-${String(new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate()).padStart(2, '0')}` },
            shifts: {},
            records: [],
            warnings: [],
            sourceUpdatedAt: index.generatedAt
        };
        baseMonth = months.includes(core.taipeiDate().slice(0, 7)) ? core.taipeiDate().slice(0, 7) : months.at(-1);
        await loadMonth(baseMonth);
        await ensure([baseMonth]);
    } catch (error) {
        element('fatal').hidden = false;
        element('fatal').textContent = `班表載入失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}。請重新整理再試一次。`;
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

    // <datalist> filters by substring, so the list is rebuilt to hold only IDs that start with the typed text.
    function suggestEmployees(event) {
        const typed = core.normalizeEmpId(event.target.value);
        const matches = typed ? [...employees.values()].filter(person => person.empId.startsWith(typed)).sort((left, right) => left.empId.localeCompare(right.empId, undefined, { numeric: true })).slice(0, 10) : [];
        element('empList').replaceChildren(...matches.map(person => {
            const option = document.createElement('option');
            option.value = person.empId;
            option.label = person.name;
            return option;
        }));
    }
    for (const id of ['empId', 'empDialogId']) element(id).addEventListener('input', suggestEmployees);
    let employee = null;
    let month = baseMonth;
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

    const hasDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && months.includes(date.slice(0, 7));

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

    // Personal view: show the hours actually worked, with the on-duty part when they differ.
    function workTimeLabel(shift) {
        return shift.fullStart ? `${shift.fullStart}–${shift.fullEnd}（值班 ${shift.start}–${shift.end}）` : timeLabel(shift);
    }

    function dateLabel(date) {
        return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00+08:00`));
    }

    const categoryLabel = Object.fromEntries(core.shiftCategories);
    const categoryOrder = core.shiftCategories.map(([id]) => id);

    // Morning/afternoon/night and rest are one group each; N-type shifts keep their own group. Each person keeps their shift code as a tag.
    const rosterKey = shift => { const category = core.shiftCategory(shift); return category === 'n' ? shift.group : category; };

    function renderRoster(id, records, emptyMessage) {
        const container = element(id);
        container.replaceChildren();
        if (!records.length) {
            container.append(textNode('p', emptyMessage, 'empty'));
            return;
        }
        const groups = new Map();
        for (const record of records) {
            const key = rosterKey(data.shifts[record.code]);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(record);
        }
        const ordered = [...groups].sort(([left, leftGroup], [right, rightGroup]) => {
            const leftShift = data.shifts[leftGroup[0].code];
            const rightShift = data.shifts[rightGroup[0].code];
            return categoryOrder.indexOf(core.shiftCategory(leftShift)) - categoryOrder.indexOf(core.shiftCategory(rightShift)) || (leftShift.start || '99').localeCompare(rightShift.start || '99') || left.localeCompare(right);
        });
        for (const [key, group] of ordered) {
            const shift = data.shifts[group[0].code];
            const section = textNode('section', '', 'roster-group');
            const heading = textNode('div', '', 'group-heading');
            const colorClass = core.shiftClass(shift);
            const times = [...new Set(group.map(record => timeLabel(data.shifts[record.code])))].join(' / ');
            heading.append(textNode('h3', categoryLabel[key] || `${key} · ${shift.label}`, colorClass), textNode('span', `${times} · ${group.length} 人`, colorClass));
            section.append(heading);
            const people = textNode('div', '', 'roster-people');
            people.setAttribute('role', 'list');
            for (const record of group.sort((left, right) => left.code.localeCompare(right.code) || employees.get(left.empId).name.localeCompare(employees.get(right.empId).name))) {
                const person = employees.get(record.empId);
                const row = textNode('div', '', `roster-item${record.empId === employee?.empId ? ' me' : ''}`);
                row.setAttribute('role', 'listitem');
                const name = textNode('strong', person.name);
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
        if (!record) {
            container.append(textNode('p', '此日期沒有排班資料', 'empty'));
            return;
        }
        const shift = data.shifts[record.code];
        const detail = textNode('div', '', 'shift-detail');
        const description = textNode('div', '', 'shift-text');
        const colorClass = core.shiftClass(shift);
        description.append(textNode('p', shift.label, colorClass), textNode('small', workTimeLabel(shift), colorClass));
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
        renderInsights(`${month}-01`, `${month}-31`, '本月');
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
                if (!hasDate(date)) return;
                selectedDate = date;
                month = date.slice(0, 7);
                showPersonal();
            });
            const day = textNode('div', '', 'week-day');
            day.append(textNode('strong', monthDay(date)), textNode('small', weekdayLabel(date)));
            const description = textNode('div', '', 'shift-text');
            description.append(textNode('p', shift ? shift.label : '無排班資料', colorClass), textNode('small', shift ? workTimeLabel(shift) : '—', colorClass));
            row.append(day, textNode('span', record ? record.code : '—', `shift-code ${colorClass}`), description);
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
        element('previousMonth').title = isWeek ? '上一週' : '上個月';
        element('nextMonth').title = isWeek ? '下一週' : '下個月';
        element('previousMonth').setAttribute('aria-label', element('previousMonth').title);
        element('nextMonth').setAttribute('aria-label', element('nextMonth').title);
        element('monthLabel').title = isWeek ? '回到本週' : '回到本月';
        element('goCurrent').setAttribute('aria-label', isWeek ? '回到本週' : '回到本月');
        element('goCurrent').disabled = !hasDate(core.taipeiDate());
        element('exportIcs').title = isWeek ? '匯出此週行事曆（.ics）' : '匯出此月行事曆（.ics）';
        if (isWeek) renderWeek();
        else renderCalendar();
    }

    // Loads the months the current view needs (and their neighbours) before drawing it.
    async function showPersonal() {
        if (!employee) return;
        syncSelectedDate();
        const start = core.weekStart(selectedDate);
        await ensure(view === 'week' ? [...new Set([start.slice(0, 7), core.addDays(start, 6).slice(0, 7)])] : [month]);
        renderPersonal();
    }

    // Counts for the shown range and same-shift colleagues relative to the selected day.
    function renderInsights(from, to, scope) {
        const mine = data.records.filter(record => record.empId === employee.empId);
        const counts = core.categoryCounts(mine.filter(record => record.date >= from && record.date <= to), data.shifts);
        element('statCounts').replaceChildren(textNode('em', scope), ...core.shiftCategories.map(([id, label]) => {
            const item = textNode('span', '');
            item.append(textNode('b', label[0], core.shiftClass({ color: id })), textNode('strong', String(counts[id])));
            return item;
        }));
        const record = mine.find(item => item.date === selectedDate);
        const shift = record && data.shifts[record.code];
        element('colleagues').hidden = !shift || shift.rest;
        if (element('colleagues').hidden) return;
        const others = data.records.filter(item => item.date === selectedDate && data.shifts[item.code].group === shift.group && item.empId !== employee.empId)
            .map(item => employees.get(item.empId)).sort((left, right) => left.name.localeCompare(right.name));
        element('colleaguesTitle').textContent = others.length ? `同班同事 ${others.length} 人` : '當天沒有其他同班同事';
        element('colleaguesList').replaceChildren(...others.map(person => {
            const chip = textNode('span', person.name);
            chip.title = person.empId;
            return chip;
        }));
    }

    async function shiftWeek(delta) {
        const moved = core.addDays(selectedDate, delta * 7);
        selectedDate = moved < data.range.start ? data.range.start : moved > data.range.end ? data.range.end : moved;
        month = selectedDate.slice(0, 7);
        await showPersonal();
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
        const outOfRange = !hasDate(core.taipeiDate());
        const status = element('dataStatus');
        status.hidden = false;
        status.className = `status${offline || outOfRange ? ' warn' : ''}`;
        status.textContent = offline ? '無法連線，目前顯示已儲存的班表' : outOfRange ? '今日不在班表涵蓋期間' : '已連線，班表已同步';
        element('liveDot').classList.toggle('warn', offline || outOfRange);
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
        showPersonal();
    }

    let currentRun = 0;
    async function renderCurrent() {
        const run = ++currentRun;
        const now = new Date();
        const today = core.taipeiDate(now);
        if (hasDate(today)) await ensure([today.slice(0, 7)]);
        if (run !== currentRun) return;
        element('currentTime').textContent = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(now);
        const records = core.currentRecords(data, now);
        const inRange = hasDate(today);
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

    let dailyRun = 0;
    async function renderDaily() {
        const date = element('rosterDate').value;
        const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
        element('prevDay').disabled = !validDate || date <= data.range.start;
        element('nextDay').disabled = !validDate || date >= data.range.end;
        const run = ++dailyRun;
        if (hasDate(date)) await ensure([date.slice(0, 7)]);
        if (run !== dailyRun) return;
        element('dailyDateLabel').textContent = validDate ? dateLabel(date) : '';
        const records = core.dayRecords(data, date);
        const restCount = records.filter(record => data.shifts[record.code].rest).length;
        summary('dailySummary', [['出勤', records.length - restCount], ['休假', restCount]]);
        notice('dailyNotice', hasDate(date) ? '' : '此日期不在已發布資料期間。');
        const visible = records.filter(record => !rosterFilter || core.shiftCategory(data.shifts[record.code]) === rosterFilter);
        renderRoster('dailyRoster', visible, records.length ? '沒有符合篩選的排班' : '此日期沒有排班資料');
    }

    let rosterFilter = '';
    const filterIcons = {
        all: '<path d="M4 6h16M4 12h16M4 18h16"/>',
        morning: '<path d="M12 2v8M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M8 6l4-4 4 4M16 18a4 4 0 0 0-8 0"/>',
        afternoon: '<path d="M12 10V2M4.93 10.93l1.41 1.41M2 18h2M20 18h2M19.07 10.93l-1.41 1.41M22 22H2M16 6l-4 4-4-4M16 18a4 4 0 0 0-8 0"/>',
        night: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
        n: '<rect width="20" height="14" x="2" y="7" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
        rest: '<path d="M10 2v2M14 2v2M6 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/>'
    };
    const filterBar = element('shiftFilter');
    for (const [id, label] of [['', '全部班別'], ...core.shiftCategories]) {
        const button = textNode('button', '', '');
        button.type = 'button';
        button.dataset.cat = id || 'all';
        button.title = label;
        button.setAttribute('aria-label', label);
        button.setAttribute('aria-pressed', String(id === rosterFilter));
        button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${filterIcons[id || 'all']}</svg>`;
        button.append(textNode('span', id ? label[0] : '全'));
        button.addEventListener('click', () => {
            rosterFilter = id;
            filterBar.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
            renderDaily();
        });
        filterBar.append(button);
    }

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
            try { localStorage.setItem('nnoc-static-view', view); } catch (_) { }
            showPersonal();
        });
    });
    function goCurrent() {
        if (!hasDate(core.taipeiDate())) return;
        selectedDate = core.taipeiDate();
        month = selectedDate.slice(0, 7);
        showPersonal();
    }
    element('monthLabel').addEventListener('click', goCurrent);
    element('goCurrent').addEventListener('click', goCurrent);
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
    element('goToday').addEventListener('click', () => { element('rosterDate').value = core.taipeiDate(); renderDaily(); });
    for (const [id, delta] of [['prevDay', -1], ['nextDay', 1]]) {
        element(id).addEventListener('click', () => {
            if (!element('rosterDate').value) return;
            element('rosterDate').value = core.addDays(element('rosterDate').value, delta);
            renderDaily();
        });
    }
    renderDaily();

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
    onSwipe(element('personalSchedule'), () => element('previousMonth').click(), () => element('nextMonth').click());
    onSwipe(element('daily'), () => element('prevDay').click(), () => element('nextDay').click());

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
