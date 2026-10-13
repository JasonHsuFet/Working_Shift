// Published schedule: downloads months on demand and merges them into one data set.
const TIMEOUT = 30000;

// Loads data/index.json and the current month (or the latest one when today is not published).
export async function createStore(today) {
    const loadedMonths = new Map();
    const shiftDefinedIn = {};
    const store = { months: [], employees: new Map(), data: null, baseMonth: '', fromCache: false, ensure, isOutdated };

    async function getJson(file) {
        const response = await fetch(`./data/${file}`, { cache: 'no-cache', signal: AbortSignal.timeout?.(TIMEOUT) });
        if (!response.ok) throw new Error(`${file} 下載失敗（HTTP ${response.status}）`);
        if (response.headers.has('x-offline-cache')) store.fromCache = true;
        return response.json();
    }

    // Each month is fetched once and merged into `data`; a later month wins when two define the same shift code.
    function loadMonth(key) {
        if (!store.months.includes(key)) return Promise.resolve();
        if (!loadedMonths.has(key)) {
            loadedMonths.set(key, getJson(`${key}.json`).then(part => {
                for (const [code, shift] of Object.entries(part.shifts)) {
                    if (!(code in store.data.shifts) || key >= shiftDefinedIn[code]) {
                        store.data.shifts[code] = shift;
                        shiftDefinedIn[code] = key;
                    }
                }
                store.data.records.push(...part.records);
                part.employees.forEach(person => store.employees.set(person.empId, person));
                part.warnings.forEach(warning => { if (!store.data.warnings.includes(warning)) store.data.warnings.push(warning); });
            }, error => {
                loadedMonths.delete(key);
                throw error;
            }));
        }
        return loadedMonths.get(key);
    }

    // Loads the given months, plus the months next to them so lookups can cross a month boundary. Throws when a wanted month fails.
    async function ensure(wanted) {
        const { months } = store;
        const keys = wanted.filter(key => months.includes(key));
        const near = new Set(keys.flatMap(key => [months[months.indexOf(key) - 1], months[months.indexOf(key) + 1]]));
        await Promise.all([...keys.map(loadMonth), ...[...near].filter(key => key && !keys.includes(key)).map(key => loadMonth(key).catch(() => { }))]);
    }

    // True when a newer schedule was published; also refreshes `fromCache`.
    async function isOutdated() {
        try {
            const response = await fetch('./data/index.json', { cache: 'no-cache' });
            store.fromCache = response.headers.has('x-offline-cache');
            return response.ok && !store.fromCache && (await response.json()).generatedAt !== store.data.sourceUpdatedAt;
        } catch (_) {
            store.fromCache = true;
            return false;
        }
    }

    const index = await getJson('index.json');
    store.months = [...index.months].sort();
    if (!store.months.length) throw new Error('沒有可用的班表月份');
    const { months } = store;
    const [lastYear, lastMonth] = months.at(-1).split('-').map(Number);
    store.data = {
        range: { start: `${months[0]}-01`, end: `${months.at(-1)}-${String(new Date(Date.UTC(lastYear, lastMonth, 0)).getUTCDate()).padStart(2, '0')}` },
        shifts: {},
        records: [],
        warnings: [],
        sourceUpdatedAt: index.generatedAt
    };
    store.baseMonth = months.includes(today.slice(0, 7)) ? today.slice(0, 7) : months.at(-1);
    await loadMonth(store.baseMonth);
    await ensure([store.baseMonth]);
    return store;
}
