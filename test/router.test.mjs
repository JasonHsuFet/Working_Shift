import assert from 'node:assert/strict';

// Browser stand-ins: the router only touches location.hash, history.replaceState and hashchange.
const listeners = [];
globalThis.window = { addEventListener: (type, listener) => listeners.push(listener) };
let hash = '';
globalThis.location = { get hash() { return hash; }, set hash(value) { hash = !value || value.startsWith('#') ? value : `#${value}`; } };
globalThis.history = { replaceState: (state, title, url) => { location.hash = url; } };
const { createRouter } = await import('../web/js/router.js');

const hits = [];
const router = createRouter()
    .on('/personal/:empId?', ({ data }) => hits.push(['personal', data.empId]))
    .on('/on-duty', () => hits.push(['on-duty']))
    .notFound(() => hits.push(['notFound']));
const visit = hash => { location.hash = hash; router.resolve(); return hits.at(-1); };

assert.deepEqual(visit('#/personal'), ['personal', undefined]);
assert.deepEqual(visit('#/personal/T123'), ['personal', 'T123']);
assert.deepEqual(visit('#/personal/%E0'), ['notFound']);
assert.deepEqual(visit('#/personal/1/2'), ['notFound']);
assert.deepEqual(visit('#/on-duty'), ['on-duty']);

// replace resolves at once, and so does navigating to the current hash (no hashchange fires); a new hash waits for hashchange.
router.navigate('/personal/9', { replace: true });
assert.deepEqual(hits.at(-1), ['personal', '9']);
hits.length = 0;
router.navigate('/personal/9');
assert.deepEqual(hits, [['personal', '9']]);
router.navigate('/on-duty');
assert.equal(hits.length, 1);
listeners.forEach(listener => listener());
assert.deepEqual(hits.at(-1), ['on-duty']);
