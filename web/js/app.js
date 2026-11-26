// Page shell: header link, source warnings, connection status, tabs and routes. Each tab lives in its own module.
import * as schedule from './schedule.js';
import { store, data, months, state, router, ensure, hasDate } from './context.js';
import { element } from './dom.js';
import { routePersonal } from './employee.js';
import { showOnDuty, refreshLive } from './on-duty.js';

const excelLink = element('annualScheduleDownload');
// Every year with a published month has its workbook in data/; fall back to the latest one when this year has none yet.
const thisYear = schedule.taipeiDate().slice(0, 4);
excelLink.href = `./data/All_${months.some(month => month.startsWith(thisYear)) ? thisYear : months.at(-1).slice(0, 4)}.xlsx`;
// iOS home-screen apps keep in-scope links inside the app with no way back; share the URL so a browser opens it. Other platforms use the plain link.
excelLink.addEventListener('click', event => {
    if (navigator.standalone !== true || !navigator.share) return;
    event.preventDefault();
    navigator.share({ url: excelLink.href }).catch(() => { });
});

// legacy: ?empno=/?theme= from old links and home-screen icons; remove when no longer used
if (location.search) {
    const legacyEmpId = new URLSearchParams(location.search).get('empno')?.trim();
    history.replaceState(null, '', location.pathname + (legacyEmpId ? `#/personal/${encodeURIComponent(legacyEmpId)}` : location.hash));
}

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

function updateStatus() {
    const offline = !navigator.onLine || store.fromCache;
    const today = schedule.taipeiDate();
    const outOfRange = !hasDate(today);
    const unwritten = !outOfRange && !schedule.isWritten(data, today);
    const status = element('dataStatus');
    status.hidden = false;
    status.className = `status${offline || outOfRange || unwritten ? ' warn' : ''}`;
    status.textContent = offline ? '無法連線，目前顯示已儲存的班表' : outOfRange ? '今日不在班表涵蓋期間' : unwritten ? '今日尚未排班' : '已連線，班表已同步';
    element('liveDot').classList.toggle('warn', offline || outOfRange || unwritten);
    element('todayPeriod').disabled = outOfRange;
}

// Reloads when a newer schedule was published; otherwise just refreshes the connection status.
async function checkPublished() {
    if (await store.isOutdated()) {
        location.reload();
        return;
    }
    // After midnight into a new month, today's month may not be loaded yet; it is needed to tell unwritten from scheduled.
    await ensure([schedule.taipeiDate().slice(0, 7)]);
    updateStatus();
}

function showTab(tab) {
    state.activeTab = tab;
    for (const id of ['personal', 'on-duty']) element(id).hidden = id !== tab;
    document.querySelectorAll('[data-tab]').forEach(link => {
        if (link.dataset.tab === tab) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
}

updateStatus();
router
    .on('/personal/:empId?', ({ data: { empId } }) => {
        showTab('personal');
        routePersonal(empId);
    })
    .on('/on-duty', () => {
        showTab('on-duty');
        showOnDuty();
    })
    .notFound(() => router.navigate('/personal', { replace: true }))
    .resolve();

setInterval(refreshLive, 30000);
window.addEventListener('online', checkPublished);
window.addEventListener('offline', updateStatus);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    refreshLive();
    // An installed app resumes without reloading, so pick up a newly published schedule here.
    checkPublished();
});
