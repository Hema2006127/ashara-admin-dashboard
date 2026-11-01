/**
 * Ashara — light/dark theme. Loaded in <head> so the saved theme applies before paint.
 * No saved choice → follows the device setting (prefers-color-scheme).
 */
(() => {
    const KEY = 'ashara_theme';
    const root = document.documentElement;
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { }
    if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;

    const current = () => root.dataset.theme
        || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    function paint(btn) {
        const dark = current() === 'dark';
        btn.innerHTML = dark ? '<i class="fa-solid fa-sun"></i> الوضع الفاتح' : '<i class="fa-solid fa-moon"></i> الوضع الغامق';
        btn.setAttribute('aria-label', dark ? 'تبديل للوضع الفاتح' : 'تبديل للوضع الغامق');
    }

    function toggle() {
        const next = current() === 'dark' ? 'light' : 'dark';
        root.dataset.theme = next;
        try { localStorage.setItem(KEY, next); } catch { }
        document.querySelectorAll('.theme-toggle').forEach(paint);
        window.dispatchEvent(new CustomEvent('ashara:theme', { detail: next }));
    }

    document.addEventListener('DOMContentLoaded', () => {
        const footer = document.querySelector('.sidebar-footer');
        if (!footer) return;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'theme-toggle';
        btn.addEventListener('click', toggle);
        footer.prepend(btn);
        paint(btn);
    });

    window.AsharaTheme = { current };
})();
