/**
 * Ashara — admin board for model testers.
 * Every action is a Supabase RPC (supabase/model_admin.sql) that checks the admin
 * session token server-side; this page holds no secrets.
 */
(() => {
    const cfg = window.AsharaConfig;
    const TOKEN_KEY = 'ashara_admin_session_v1';
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmt = d => d ? new Date(d).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' }) : null;
    const testerUrl = `${location.origin}/tester`;

    let token = null;
    let testers = [];

    // ── RPC ───────────────────────────────────────────────────────────────
    class Unauthorized extends Error { }

    async function rpc(fn, params = {}) {
        const r = await fetch(`${cfg.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
            method: 'POST',
            headers: {
                apikey: cfg.SUPABASE_KEY,
                Authorization: `Bearer ${cfg.SUPABASE_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
        });
        const text = await r.text();
        const data = text ? JSON.parse(text) : null;
        if (!r.ok) {
            const msg = (data && data.message) || `HTTP ${r.status}`;
            if (msg.includes('unauthorized')) throw new Unauthorized(msg);
            if (r.status === 404) throw new Error('setup');
            throw new Error(msg);
        }
        return data;
    }

    async function guarded(fn) {
        try { return await fn(); }
        catch (e) {
            if (e instanceof Unauthorized) { logout('انتهت الجلسة — ادخل تاني.'); return null; }
            toast(e.message === 'setup' ? 'شغّل ملف supabase/model_admin.sql في Supabase الأول' : `خطأ: ${e.message}`, true);
            return null;
        }
    }

    // ── Session ───────────────────────────────────────────────────────────
    function setToken(t) {
        token = t;
        try { t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY); } catch { }
        $('login-view').hidden = !!t;
        $('admin-view').hidden = !t;
        if (t) loadTesters(); else setTimeout(() => $('admin-password').focus(), 50);
    }

    async function login(e) {
        e.preventDefault();
        const err = $('login-error'), btn = $('login-btn'), pw = $('admin-password').value;
        if (!pw) { err.textContent = 'اكتب الباسورد'; return; }
        err.textContent = '';
        btn.disabled = true;
        btn.querySelector('span').textContent = 'جاري التحقق...';
        try {
            const res = await rpc('admin_login', { p_password: pw });
            if (res.token) { $('admin-password').value = ''; setToken(res.token); return; }
            err.textContent = {
                wrong_password: 'الباسورد غلط',
                locked: 'محاولات غلط كتير — استنى 15 دقيقة',
                not_configured: 'لسه ما اتحددش باسورد أدمن — شغّل set_model_admin_password في Supabase',
            }[res.error] || res.error;
        } catch (ex) {
            err.textContent = ex.message === 'setup' ? 'شغّل ملف supabase/model_admin.sql في Supabase الأول'
                : ex.message === 'Failed to fetch' ? 'مفيش اتصال بالإنترنت' : ex.message;
        } finally {
            btn.disabled = false;
            btn.querySelector('span').textContent = 'دخول';
        }
    }

    async function logout(message) {
        if (token && !message) { try { await rpc('admin_logout', { p_token: token }); } catch { } }
        setToken(null);
        if (message) $('login-error').textContent = message;
    }

    // ── Testers ───────────────────────────────────────────────────────────
    async function loadTesters() {
        const rows = await guarded(() => rpc('admin_list_testers', { p_token: token }));
        if (!rows) return;
        testers = rows;
        renderStats();
        renderList();
    }

    function renderStats() {
        $('st-total').textContent = testers.length;
        $('st-active').textContent = testers.filter(t => t.is_active).length;
        $('st-used').textContent = testers.filter(t => t.logins > 0).length;
        const failed = testers.reduce((s, t) => s + Number(t.failed_24h || 0), 0);
        $('st-failed').textContent = failed;
        $('st-failed').className = 'v' + (failed ? ' red' : '');
    }

    function renderList() {
        const q = $('search').value.trim().toLowerCase();
        const list = testers.filter(t => !q || t.name.toLowerCase().includes(q));
        if (!testers.length) {
            $('testers').innerHTML = '<div class="empty"><i class="fa-regular fa-user"></i> لسه مفيش أعضاء — ضيف أول واحد من فوق.</div>';
            return;
        }
        if (!list.length) {
            $('testers').innerHTML = '<div class="empty">مفيش نتايج للبحث.</div>';
            return;
        }
        $('testers').innerHTML = list.map(t => {
            const n = esc(t.name);
            const last = fmt(t.last_login);
            return `<div class="tester-row${t.is_active ? '' : ' inactive'}" data-name="${n}">
                <div class="t-name">
                    <span class="avatar">${esc((t.name.trim()[0] || '?').toUpperCase())}</span>
                    <div style="min-width:0">
                        <div class="n" title="${n}">${n}</div>
                        ${t.is_active ? '<span class="pill on"><i class="fa-solid fa-circle-check"></i> مسموح</span>'
                    : '<span class="pill off"><i class="fa-solid fa-ban"></i> موقوف</span>'}
                        ${Number(t.failed_24h) ? `<span class="pill warn">${t.failed_24h} محاولة فاشلة</span>` : ''}
                    </div>
                </div>
                <div class="t-code">
                    <span class="code">${esc(t.access_code)}</span>
                    <button class="icon-btn" data-act="share" title="نسخ رسالة الدخول" aria-label="نسخ رسالة الدخول"><i class="fa-regular fa-copy"></i></button>
                </div>
                <div class="t-meta">
                    ${last ? `آخر دخول: ${last}` : 'لسه ما دخلش'}<br>
                    ${t.logins} مرة دخول · اتضاف ${fmt(t.created_at)}
                </div>
                <div class="t-actions">
                    <button class="icon-btn" data-act="toggle" title="${t.is_active ? 'إيقاف' : 'تفعيل'}" aria-label="${t.is_active ? 'إيقاف' : 'تفعيل'}">
                        <i class="fa-solid ${t.is_active ? 'fa-pause' : 'fa-play'}"></i></button>
                    <button class="icon-btn" data-act="regen" title="كود جديد" aria-label="كود جديد"><i class="fa-solid fa-arrows-rotate"></i></button>
                    <button class="icon-btn danger" data-act="delete" title="مسح" aria-label="مسح"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>`;
        }).join('');
    }

    function shareText(name, code) {
        return `أهلاً ${name} 👋\nتقدر تجرب موديل حروف لغة الإشارة (مشروع إشارة) من هنا:\n${testerUrl}\n\nالاسم: ${name}\nالكود: ${code}\n\nالكود شخصي، ما تبعتهوش لحد.`;
    }

    async function copy(text, msg = 'اتنسخت') {
        try { await navigator.clipboard.writeText(text); toast(msg); }
        catch { prompt('انسخ الرسالة:', text); }
    }

    async function onListClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const t = testers.find(x => x.name === btn.closest('.tester-row').dataset.name);
        if (!t) return;
        const act = btn.dataset.act;

        if (act === 'share') return copy(shareText(t.name, t.access_code), 'رسالة الدخول اتنسخت');
        if (act === 'toggle') {
            await guarded(() => rpc('admin_set_tester_active', { p_token: token, p_name: t.name, p_active: !t.is_active }));
            toast(t.is_active ? `اتوقف ${t.name}` : `اتفعّل ${t.name}`);
        }
        if (act === 'regen') {
            if (!confirm(`كود جديد لـ ${t.name}؟ الكود القديم هيبطل.`)) return;
            const code = await guarded(() => rpc('admin_regenerate_code', { p_token: token, p_name: t.name }));
            if (code) showNewCode(t.name, code);
        }
        if (act === 'delete') {
            if (!confirm(`مسح ${t.name} نهائياً؟ (سجل دخوله القديم هيفضل موجود)`)) return;
            await guarded(() => rpc('admin_delete_tester', { p_token: token, p_name: t.name }));
            toast(`اتمسح ${t.name}`);
        }
        loadTesters();
    }

    async function addTester(e) {
        e.preventDefault();
        const name = $('add-name').value.trim(), err = $('add-error');
        err.textContent = '';
        if (!name) { err.textContent = 'اكتب اسم العضو'; return; }
        $('add-btn').disabled = true;
        const res = await guarded(() => rpc('admin_add_tester', { p_token: token, p_name: name }));
        $('add-btn').disabled = false;
        if (!res) return;
        if (res.error) {
            err.textContent = res.error === 'exists' ? 'الاسم ده موجود — استخدم «كود جديد» من القائمة' : res.error;
            return;
        }
        $('add-name').value = '';
        showNewCode(res.name, res.code);
        loadTesters();
    }

    function showNewCode(name, code) {
        $('new-code').hidden = false;
        $('nc-name').textContent = name;
        $('nc-code').textContent = code;
        $('nc-copy').onclick = () => copy(shareText(name, code), 'رسالة الدخول اتنسخت');
        $('nc-wa').href = `https://wa.me/?text=${encodeURIComponent(shareText(name, code))}`;
        $('new-code').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // ── Change password ───────────────────────────────────────────────────
    async function changePassword(e) {
        e.preventDefault();
        const err = $('pw-error');
        err.textContent = '';
        const res = await guarded(() => rpc('admin_change_password', { p_token: token, p_old: $('pw-old').value, p_new: $('pw-new').value }));
        if (!res) return;
        if (res.error) {
            err.textContent = res.error === 'wrong_password' ? 'الباسورد الحالي غلط' : 'الباسورد الجديد لازم 8 حروف على الأقل';
            return;
        }
        $('pw-dialog').close();
        $('pw-old').value = $('pw-new').value = '';
        toast('الباسورد اتغير، وأي جهاز تاني اتعمله خروج');
    }

    // ── Toast ─────────────────────────────────────────────────────────────
    let toastTimer;
    function toast(message, isError) {
        const el = $('realtime-toast');
        el.innerHTML = `<i class="fa-solid ${isError ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i> ${esc(message)}`;
        el.style.background = isError ? 'var(--danger)' : '';
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
    }

    // ── Init ──────────────────────────────────────────────────────────────
    $('login-form').addEventListener('submit', login);
    $('logout-btn').addEventListener('click', () => logout());
    $('refresh-btn').addEventListener('click', loadTesters);
    $('add-form').addEventListener('submit', addTester);
    $('testers').addEventListener('click', onListClick);
    $('search').addEventListener('input', renderList);
    $('pw-btn').addEventListener('click', () => { $('pw-error').textContent = ''; $('pw-dialog').showModal(); });
    $('pw-cancel').addEventListener('click', () => $('pw-dialog').close());
    $('pw-form').addEventListener('submit', changePassword);

    let saved = null;
    try { saved = sessionStorage.getItem(TOKEN_KEY); } catch { }
    setToken(saved);
})();
