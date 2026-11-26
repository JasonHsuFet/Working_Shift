// Small DOM helpers shared by the views.
export const element = id => document.getElementById(id);

export function textNode(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
}

export function notice(id, message) {
    element(id).textContent = message;
    element(id).hidden = !message;
}

export function dateLabel(date) {
    return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(`${date}T00:00:00+08:00`));
}

// A horizontal swipe (touch, pen or mouse drag) does what the previous/next buttons do.
export function onSwipe(target, previous, next) {
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
