/**
 * Dashboard panel: letter-model accuracy (assets/data/model-info.json)
 * and the model-tester access log (Supabase table model_access_log).
 */
(() => {
    const $ = id => document.getElementById(id);
    const pct = v => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fmtDate = d => new Date(d).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });

    function device(ua) {
        ua = ua || '';
        const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows'
            : /Mac OS/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : '—';
        const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
            : /Safari\//.test(ua) ? 'Safari' : '';
        return br ? `${os} · ${br}` : os;
    }

    async function loadModelInfo() {
        try {
            const info = await (await fetch('assets/data/model-info.json', { cache: 'no-cache' })).json();
            $('model-test-acc').textContent = pct(info.test_accuracy);
            $('model-val-acc').textContent = pct(info.val_accuracy);
            $('model-classes').textContent = info.num_classes;
            $('model-trained').textContent = new Date(info.trained_at).toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' });

            $('model-data').textContent = info.training_data || '—';
            $('model-letters').innerHTML = (info.labels || []).map(l => `<span>${esc(l)}</span>`).join('');
        } catch (e) {
            console.warn('model-info.json not available', e);
        }
    }

    async function loadAccessLog() {
        const cfg = window.AsharaConfig;
        const body = $('access-log-body');
        try {
            const url = `${cfg.SUPABASE_URL}/rest/v1/model_access_log?select=tester_name,success,user_agent,created_at&order=created_at.desc&limit=200`;
            const r = await fetch(url, { headers: { apikey: cfg.SUPABASE_KEY, Authorization: `Bearer ${cfg.SUPABASE_KEY}` } });
            if (r.status === 404 || r.status === 400) throw new Error('setup');
            if (!r.ok) throw new Error(r.status);
            const rows = await r.json();
            renderSecurity(rows);
            body.innerHTML = rows.length ? rows.map(row => {
                const blocked = (row.user_agent || '').startsWith('[blocked]');
                const status = row.success
                    ? '<span class="status-tag ok"><i class="fa-solid fa-check"></i> دخول ناجح</span>'
                    : blocked
                        ? '<span class="status-tag blocked"><i class="fa-solid fa-ban"></i> مقفول مؤقتاً</span>'
                        : '<span class="status-tag fail"><i class="fa-solid fa-xmark"></i> محاولة فاشلة</span>';
                return `<tr><td>${esc(row.tester_name)}</td><td>${status}</td><td>${esc(device(row.user_agent))}</td><td>${fmtDate(row.created_at)}</td></tr>`;
            }).join('') : '<tr><td colspan="4" class="empty-cell">لسه محدش دخل يجرب الموديل.</td></tr>';
        } catch (e) {
            const msg = e.message === 'setup'
                ? 'جدول السجل مش موجود — شغّل ملف supabase/model_access.sql في Supabase.'
                : 'تعذر تحميل سجل الدخول.';
            body.innerHTML = `<tr><td colspan="4" class="empty-cell">${msg}</td></tr>`;
            $('security-summary').innerHTML = `<p class="muted">${msg}</p>`;
        }
    }

    function renderSecurity(rows) {
        const dayAgo = Date.now() - 24 * 3600e3;
        const recent = rows.filter(r => new Date(r.created_at).getTime() > dayAgo);
        const ok = recent.filter(r => r.success);
        const failed = recent.filter(r => !r.success);
        const people = new Set(ok.map(r => r.tester_name));
        const failedNames = [...new Set(failed.map(r => r.tester_name))];
        const alert = failed.length
            ? `<div class="security-alert"><i class="fa-solid fa-triangle-exclamation"></i> ${failed.length} محاولة فاشلة من: ${failedNames.map(esc).join('، ')}</div>`
            : '<div class="security-ok"><i class="fa-solid fa-circle-check"></i> مفيش محاولات دخول فاشلة</div>';
        $('security-summary').innerHTML =
            `<div class="security-stats">` +
            `<div><div class="sv">${ok.length}</div><div class="sl">دخول ناجح</div></div>` +
            `<div><div class="sv">${people.size}</div><div class="sl">شخص جرّب</div></div>` +
            `<div><div class="sv ${failed.length ? 'bad' : ''}">${failed.length}</div><div class="sl">محاولة فاشلة</div></div>` +
            `</div>${alert}` +
            `<p class="muted small">الدخول بالاسم + كود شخصي فقط. الموديل نفسه بيشتغل على السيرفر ومحدش بينزّله.</p>`;
    }

    document.addEventListener('DOMContentLoaded', () => {
        loadModelInfo();
        loadAccessLog();
        const refresh = $('btn-refresh-data');
        if (refresh) refresh.addEventListener('click', loadAccessLog);
        setInterval(loadAccessLog, 60e3);
    });
})();
