// Page shell (x-data="page" on <body>): header link, source warnings, connection status, tabs, timers and routes.
// Each tab is its own Alpine component; they are registered by the imports below, then Alpine starts and the route resolves.
import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { store, data, months, state, router, ensure, hasDate } from './context.js';
import { routePersonal } from './employee.js';
import './personal.js';
import './on-duty.js';

// legacy: ?empno=/?theme= from old links and home-screen icons; remove when no longer used
if (location.search) {
    const legacyEmpId = new URLSearchParams(location.search).get('empno')?.trim();
    history.replaceState(null, '', location.pathname + (legacyEmpId ? `#/personal/${encodeURIComponent(legacyEmpId)}` : location.hash));
}

Alpine.data('page', () => ({
    // Every year with a published month has its workbook in data/; fall back to the latest one when this year has none yet.
    excelHref: (() => {
        const thisYear = state.today.slice(0, 4);
        return `./data/All_${months.some(month => month.startsWith(thisYear)) ? thisYear : months.at(-1).slice(0, 4)}.xlsx`;
    })(),
    warnings: data.warnings.length ? `來源資料提醒：${data.warnings.join('；')}` : '',

    init() {
        // After the first render, so the notice is no longer [hidden]. Browsers without popover (Safari < 17) keep it as the inline notice.
        this.$nextTick(() => {
            const warnings = this.$refs.warnings;
            if (!this.warnings || !warnings.showPopover) return;
            warnings.addEventListener('animationend', () => warnings.hidePopover());
            warnings.showPopover();
        });
    },

    get status() {
        void state.version; // today's month may load later (e.g. after midnight into a new month)
        const outOfRange = !hasDate(state.today);
        const unwritten = !outOfRange && !schedule.isWritten(data, state.today);
        return {
            warn: state.offline || outOfRange || unwritten,
            text: state.offline ? '無法連線，目前顯示已儲存的班表' : outOfRange ? '今日不在班表涵蓋期間' : unwritten ? '今日尚未排班' : '已連線，班表已同步'
        };
    },

    // iOS home-screen apps keep in-scope links inside the app with no way back; share the URL so a browser opens it. Other platforms use the plain link.
    openExcel(event) {
        if (navigator.standalone !== true || !navigator.share) return;
        event.preventDefault();
        navigator.share({ url: event.currentTarget.href }).catch(() => { });
    }
}));

const refreshStatus = () => { state.offline = !navigator.onLine || store.fromCache; };

// Reloads when a newer schedule was published; otherwise just refreshes the connection status.
async function checkPublished() {
    if (await store.isOutdated()) {
        location.reload();
        return;
    }
    // After midnight into a new month, today's month may not be loaded yet; it is needed to tell unwritten from scheduled.
    await ensure([state.today.slice(0, 7)]);
    refreshStatus();
}

Alpine.start();

router
    .on('/personal/:empId?', ({ data: { empId } }) => {
        state.activeTab = 'personal';
        routePersonal(empId);
    })
    // The on-duty component shows its date when activeTab turns to 'on-duty'.
    .on('/on-duty', () => { state.activeTab = 'on-duty'; })
    .notFound(() => router.navigate('/personal', { replace: true }))
    .resolve();

// The clock drives today's live roster and every "today" mark; the on-duty date follows it across midnight.
const tick = () => { state.now = Date.now(); };
setInterval(tick, 30000);
window.addEventListener('online', checkPublished);
window.addEventListener('offline', refreshStatus);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    tick();
    // An installed app resumes without reloading, so pick up a newly published schedule here.
    checkPublished();
});
