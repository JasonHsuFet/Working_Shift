// Runs in <head> before first paint. A stored manual choice (light/dark) wins; "system" follows prefers-color-scheme live.
(function () {
    'use strict';
    const KEY = 'noc.theme';
    const labels = { system: '跟隨系統', light: '淺色', dark: '深色' };
    const next = { system: 'light', light: 'dark', dark: 'system' };
    const media = matchMedia('(prefers-color-scheme: dark)');
    let choice = 'system';
    try {
        // legacy: key before the noc.* naming; remove once old installs have migrated
        const old = localStorage.getItem('noc-static-theme');
        if (old) {
            if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, old);
            localStorage.removeItem('noc-static-theme');
        }
        const stored = localStorage.getItem(KEY);
        if (stored === 'light' || stored === 'dark') choice = stored;
    } catch (_) { }

    function apply() {
        const theme = choice === 'system' ? (media.matches ? 'dark' : 'light') : choice;
        document.documentElement.dataset.theme = theme;
        document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#212624' : '#ffffff';
        const button = document.getElementById('themeToggle');
        if (!button) return;
        button.title = `主題：${labels[choice]}`;
        button.setAttribute('aria-label', button.title);
        button.querySelectorAll('[data-theme-icon]').forEach(icon => icon.toggleAttribute('hidden', icon.dataset.themeIcon !== choice));
    }

    media.addEventListener('change', () => { if (choice === 'system') apply(); });
    apply();
    document.addEventListener('DOMContentLoaded', () => {
        apply();
        document.getElementById('themeToggle').addEventListener('click', () => {
            choice = next[choice];
            try {
                if (choice === 'system') localStorage.removeItem(KEY);
                else localStorage.setItem(KEY, choice);
            } catch (_) { }
            apply();
        });
    });
})();
