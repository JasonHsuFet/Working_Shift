// The imports register each tab's Alpine component; Alpine starts before the first route resolves.
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
    // This year's workbook, or the latest one while this year has no published month.
    excelHref: (() => {
        const thisYear = state.today.slice(0, 4);
        return `./data/All_${months.some(month => month.startsWith(thisYear)) ? thisYear : months.at(-1).slice(0, 4)}.xlsx`;
    })(),
    warnings: data.warnings.length ? `來源資料提醒：${data.warnings.join('；')}` : '',

    init() {
        // After the first render has removed [hidden]. Without popover support (Safari < 17) it stays an inline notice.
        this.$nextTick(() => {
            const warnings = this.$refs.warnings;
            if (!this.warnings || !warnings.showPopover) return;
            warnings.addEventListener('animationend', () => warnings.hidePopover());
            warnings.showPopover();
        });
    },

    get status() {
        void state.version; // recompute when more months load
        const outOfRange = !hasDate(state.today);
        const unwritten = !outOfRange && !schedule.isWritten(data, state.today);
        return {
            warn: state.offline || outOfRange || unwritten,
            text: state.offline ? '無法連線，目前顯示已儲存的班表' : outOfRange ? '今日不在班表涵蓋期間' : unwritten ? '今日尚未排班' : '已連線，班表已同步'
        };
    },

    // iOS home-screen apps open in-scope links inside the app with no way back, so share the URL to open it in a browser.
    openExcel(event) {
        if (navigator.standalone !== true || !navigator.share) return;
        event.preventDefault();
        navigator.share({ url: event.currentTarget.href }).catch(() => { });
    }
}));

const refreshStatus = () => { state.offline = !navigator.onLine || store.fromCache; };

async function checkPublished() {
    if (await store.isOutdated()) {
        location.reload();
        return;
    }
    // After midnight into a new month, its data is needed to tell unwritten days from scheduled ones.
    await ensure([state.today.slice(0, 7)]);
    refreshStatus();
}

Alpine.start();

router
    .on('/personal/:empId?', ({ data: { empId } }) => {
        state.activeTab = 'personal';
        routePersonal(empId);
    })
    // onDuty watches activeTab and loads its date.
    .on('/on-duty', () => { state.activeTab = 'on-duty'; })
    .notFound(() => router.navigate('/personal', { replace: true }))
    .resolve();

const tick = () => {
    state.now = Date.now();
    state.today = schedule.taipeiDate(new Date(state.now));
};
setInterval(tick, 30000);
window.addEventListener('online', checkPublished);
window.addEventListener('offline', refreshStatus);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    tick();
    // An installed app resumes without reloading, so check for a new schedule here.
    checkPublished();
});
