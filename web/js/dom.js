export const element = id => document.getElementById(id);

const longDate = new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' });
export const dateLabel = date => longDate.format(new Date(`${date}T00:00:00+08:00`));

// Caches a getter's last result: Alpine re-runs a getter for every binding that reads it.
// `key` must cover every reactive value the result depends on.
export function memo() {
    let last = null;
    return (key, compute) => (last?.key === key ? last.value : (last = { key, value: compute() }).value);
}

// A horizontal swipe (touch, pen or mouse) calls previous/next. Drags that start in an input or dialog are ignored.
export function onSwipe(target, previous, next) {
    let start = null;
    target.addEventListener('pointerdown', event => {
        start = event.isPrimary && !event.target.closest('input, dialog') ? { id: event.pointerId, x: event.clientX, y: event.clientY } : null;
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
