// Boot and shared page state: legacy key migration, service worker, the loaded schedule store, the router and the Alpine store every view reads.
import Alpine from './alpine.js';
import * as schedule from './schedule.js';
import { createStore } from './store.js';
import { createRouter } from './router.js';
import { element } from './dom.js';

export const EMP_ID_KEY = 'noc.empId';
export const VIEW_KEY = 'noc.view';

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

let loaded;
try {
    if (location.protocol === 'file:') throw new Error('請從 GitHub Pages 或本機 HTTP 網站開啟；直接開啟 HTML 無法下載班表');
    loaded = await createStore(schedule.taipeiDate());
} catch (error) {
    element('fatal').hidden = false;
    element('fatal').textContent = `班表載入失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}。請重新整理再試一次。`;
    element('employeeForm').hidden = true;
    main.setAttribute('aria-busy', 'false');
    throw error;
}
export const store = loaded;
export const { data, months, employees } = store;
main.setAttribute('aria-busy', 'false');
element('empId').disabled = false;
element('employeeForm').querySelector('button').disabled = false;

export const router = createRouter();

// Reactive page state. The schedule itself (thousands of records) stays a plain object; `version` goes up whenever
// more months are merged into it, and every getter that reads `data` also reads `version` so it recomputes then.
Alpine.store('app', {
    employee: null, // the person on the personal tab, also marked in the on-duty roster
    activeTab: 'personal',
    version: 0,
    fatal: '',
    offline: !navigator.onLine || store.fromCache,
    now: Date.now(), // moved on every 30 seconds and when the page comes back to the foreground
    get today() { return schedule.taipeiDate(new Date(this.now)); },
    empInput: '',
    empError: '',
    empInvalid: false,
    suggestions: []
});
export const state = Alpine.store('app');

export async function ensure(wanted) {
    try {
        await store.ensure(wanted);
        state.fatal = '';
        return true;
    } catch (error) {
        state.fatal = `載入班表失敗：${error.name === 'TimeoutError' ? '下載逾時' : error.message}`;
        return false;
    } finally {
        state.version++;
    }
}

export const hasDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date) && months.includes(date.slice(0, 7));
