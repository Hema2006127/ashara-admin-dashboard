/**
 * Ashara — live letter-model tester.
 * MediaPipe Hands runs in the browser; only the 126 landmark numbers are sent to
 * /api/predict, where the model runs. The model file never reaches the browser.
 * Landmark extraction is identical to collector.js (same order: left 63 + right 63).
 */
(() => {
    const TOKEN_KEY = 'ashara_tester_session_v1';
    const MIN_INTERVAL_MS = 150;   // at most ~6 predictions per second
    const SMOOTH = 4;              // average the last N predictions
    const SURE = 0.6;

    const $ = id => document.getElementById(id);
    let session = null;
    let hands = null, camera = null;
    let inFlight = false, lastSent = 0;
    const history = [];

    // ── Session ────────────────────────────────────────────────────────────
    function loadSession() {
        try { session = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); } catch { session = null; }
    }
    function saveSession(s) {
        session = s;
        try { s ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify(s)) : sessionStorage.removeItem(TOKEN_KEY); } catch { }
    }

    function showView() {
        $('login-view').hidden = !!session;
        $('tester-view').hidden = !session;
        if (session) $('tester-name').innerHTML = `<i class="fa-solid fa-user"></i> ${escapeHtml(session.name)}`;
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function login(e) {
        e.preventDefault();
        const btn = $('login-btn');
        $('login-error').textContent = '';
        btn.disabled = true;
        try {
            const r = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: $('login-name').value, code: $('login-code').value }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || `خطأ ${r.status}`);
            saveSession({ token: data.token, name: data.name });
            $('login-code').value = '';
            showView();
        } catch (err) {
            $('login-error').textContent = err.message;
        } finally {
            btn.disabled = false;
        }
    }

    function logout(message) {
        stopCamera();
        saveSession(null);
        showView();
        if (message) $('login-error').textContent = message;
    }

    // ── Camera + MediaPipe ────────────────────────────────────────────────
    async function startCamera() {
        if (!window.Hands || !window.Camera) {
            alert('تعذر تحميل MediaPipe — تأكد من الإنترنت وأعد تحميل الصفحة.');
            return;
        }
        $('start-cam-btn').hidden = true;
        $('camera-hint').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري تشغيل الكاميرا...';

        hands = new window.Hands({ locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
        hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        hands.onResults(onResults);

        const video = $('tester-video');
        camera = new window.Camera(video, {
            onFrame: async () => { if (hands) await hands.send({ image: video }); },
            width: 640, height: 480,
        });
        try {
            await camera.start();
            $('camera-hint').innerHTML = '<i class="fa-solid fa-video"></i> الكاميرا شغالة';
        } catch (err) {
            console.error(err);
            $('camera-hint').innerHTML = '<i class="fa-solid fa-video-slash"></i> تعذر فتح الكاميرا';
            $('start-cam-btn').hidden = false;
            alert('اسمح للمتصفح باستخدام الكاميرا من إعدادات الموقع.');
        }
    }

    function stopCamera() {
        try { camera && camera.stop(); } catch { }
        camera = null;
        hands = null;
        $('start-cam-btn').hidden = false;
        $('camera-hint').innerHTML = '<i class="fa-solid fa-video"></i> اضغط «تشغيل الكاميرا»';
    }

    function extract126(results) {
        const left = new Array(63).fill(0), right = new Array(63).fill(0);
        results.multiHandLandmarks.forEach((lm, i) => {
            const flat = [];
            for (const p of lm) flat.push(p.x, p.y, p.z);
            const target = results.multiHandedness[i]?.label === 'Left' ? left : right;
            for (let j = 0; j < 63; j++) target[j] = flat[j];
        });
        return left.concat(right);
    }

    const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
        [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

    function draw(results) {
        const canvas = $('tester-canvas'), video = $('tester-video');
        const w = canvas.width = video.videoWidth || 640, h = canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        (results.multiHandLandmarks || []).forEach(lm => {
            ctx.strokeStyle = '#10b981'; ctx.lineWidth = 3;
            for (const [a, b] of BONES) {
                ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke();
            }
            ctx.fillStyle = '#ffffff';
            for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 4, 0, 2 * Math.PI); ctx.fill(); }
        });
    }

    function onResults(results) {
        draw(results);
        const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;
        if (!hasHand) {
            history.length = 0;
            render(null);
            return;
        }
        const now = performance.now();
        if (inFlight || now - lastSent < MIN_INTERVAL_MS || !session) return;
        lastSent = now;
        sendPrediction(extract126(results));
    }

    async function sendPrediction(landmarks) {
        inFlight = true;
        try {
            const r = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: session.token, landmarks }),
            });
            if (r.status === 401) return logout('انتهت الجلسة (4 ساعات) — سجّل دخول تاني.');
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || r.status);
            history.push(data.top);
            if (history.length > SMOOTH) history.shift();
            render(smoothed());
        } catch (err) {
            console.warn('predict failed', err);
            $('pred-status').textContent = 'مشكلة في الاتصال بالسيرفر...';
        } finally {
            inFlight = false;
        }
    }

    function smoothed() {
        const acc = {};
        for (const top of history) for (const { letter, p } of top) acc[letter] = (acc[letter] || 0) + p / history.length;
        return Object.entries(acc).map(([letter, p]) => ({ letter, p })).sort((a, b) => b.p - a.p).slice(0, 3);
    }

    // ── UI ────────────────────────────────────────────────────────────────
    function render(top) {
        const L = $('pred-letter'), C = $('pred-conf'), S = $('pred-status');
        if (!top || !top.length) {
            L.textContent = '—'; L.classList.remove('unsure');
            C.textContent = ''; S.textContent = 'ضع يدك في الكادر';
            $('top3').innerHTML = '';
            return;
        }
        const sure = top[0].p >= SURE;
        L.textContent = top[0].letter; L.classList.toggle('unsure', !sure);
        C.textContent = `${Math.round(top[0].p * 100)}%`; C.classList.toggle('unsure', !sure);
        S.textContent = sure ? '' : 'مش متأكد — ثبّت الإشارة أو غيّر الزاوية';
        $('top3').innerHTML = top.map(({ letter, p }) =>
            `<div class="top3-row"><span class="l">${escapeHtml(letter)}</span>` +
            `<span class="bar"><span style="width:${(p * 100).toFixed(1)}%"></span></span>` +
            `<span class="p">${Math.round(p * 100)}%</span></div>`).join('');
    }

    async function loadModelInfo() {
        try {
            const info = await (await fetch('assets/data/model-info.json', { cache: 'no-cache' })).json();
            const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
            $('model-meta').innerHTML = `${info.model} · ${info.num_classes} حرف<br>دقة Test ${pct(info.test_accuracy)} · Val ${pct(info.val_accuracy)}`;
        } catch { }
    }

    // ── Init ──────────────────────────────────────────────────────────────
    loadSession();
    showView();
    loadModelInfo();
    $('login-form').addEventListener('submit', login);
    $('logout-btn').addEventListener('click', () => logout());
    $('start-cam-btn').addEventListener('click', startCamera);
})();
