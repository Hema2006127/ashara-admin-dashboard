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
    const MATCH_HOLD = 3;          // consecutive confident matches to count a practice letter as correct

    const $ = id => document.getElementById(id);
    const LETTERS = (window.AsharaConfig && window.AsharaConfig.LETTER_INFO) || [];  // [{char, name, hint, image}]
    const byChar = Object.fromEntries(LETTERS.map(l => [l.char, l]));

    let session = null;
    let hands = null, camera = null;
    let inFlight = false, lastSent = 0;
    let target = null, matchStreak = 0;
    const history = [];

    const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
        if (session) {
            $('tester-name').textContent = session.name;
            $('user-avatar').textContent = (session.name.trim()[0] || '?').toUpperCase();
        } else {
            setTimeout(() => $('login-name').focus(), 50);
        }
    }

    async function login(e) {
        e.preventDefault();
        const name = $('login-name').value.trim(), code = $('login-code').value.trim();
        const err = $('login-error');
        if (!name || !code) { err.textContent = 'اكتب الاسم وكود الدخول'; return; }
        const btn = $('login-btn');
        err.textContent = '';
        btn.disabled = true;
        btn.querySelector('span').textContent = 'جاري التحقق...';
        try {
            const r = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, code }),
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(data.error || `خطأ ${r.status}`);
            saveSession({ token: data.token, name: data.name });
            $('login-code').value = '';
            showView();
        } catch (ex) {
            err.textContent = ex.message === 'Failed to fetch' ? 'مفيش اتصال بالإنترنت' : ex.message;
        } finally {
            btn.disabled = false;
            btn.querySelector('span').textContent = 'دخول';
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
        const btn = $('start-cam-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري التشغيل...';

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
            $('camera-empty').hidden = true;
            $('hud').hidden = false;
        } catch (err) {
            console.error(err);
            camera = null; hands = null;
            alert('اسمح للمتصفح باستخدام الكاميرا من إعدادات الموقع (علامة القفل جنب اللينك).');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-play"></i> تشغيل الكاميرا';
        }
    }

    function stopCamera() {
        try { camera && camera.stop(); } catch { }
        const v = $('tester-video');
        if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
        camera = null; hands = null;
        $('camera-empty').hidden = false;
        $('hud').hidden = true;
        const c = $('tester-canvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
        history.length = 0;
        render(null);
    }

    function extract126(results) {
        const left = new Array(63).fill(0), right = new Array(63).fill(0);
        results.multiHandLandmarks.forEach((lm, i) => {
            const flat = [];
            for (const p of lm) flat.push(p.x, p.y, p.z);
            const dst = results.multiHandedness[i]?.label === 'Left' ? left : right;
            for (let j = 0; j < 63; j++) dst[j] = flat[j];
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
            ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
            for (const [a, b] of BONES) {
                ctx.beginPath(); ctx.moveTo(lm[a].x * w, lm[a].y * h); ctx.lineTo(lm[b].x * w, lm[b].y * h); ctx.stroke();
            }
            ctx.fillStyle = '#ffffff';
            for (const p of lm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 3.5, 0, 2 * Math.PI); ctx.fill(); }
        });
    }

    function setHud(hasHand) {
        const el = $('hud-hand');
        el.className = 'hud-chip ' + (hasHand ? 'ok' : 'wait');
        el.innerHTML = hasHand ? '<i class="fa-solid fa-hand"></i> الإيد ظاهرة' : '<i class="fa-regular fa-hand"></i> مستني الإيد';
    }

    function onResults(results) {
        draw(results);
        const hasHand = !!(results.multiHandLandmarks && results.multiHandLandmarks.length);
        setHud(hasHand);
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
        const t0 = performance.now();
        try {
            const r = await fetch('/api/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: session.token, landmarks }),
            });
            if (r.status === 401) return logout('انتهت الجلسة (4 ساعات) — سجّل دخول تاني.');
            const data = await r.json();
            if (!r.ok) throw new Error(data.error || r.status);
            $('hud-latency').innerHTML = `<i class="fa-solid fa-bolt"></i> ${Math.round(performance.now() - t0)} ms`;
            history.push(data.top);
            if (history.length > SMOOTH) history.shift();
            render(smoothed());
        } catch (err) {
            console.warn('predict failed', err);
            const s = $('pred-status');
            s.textContent = 'مشكلة في الاتصال بالسيرفر...';
            s.classList.add('warn');
        } finally {
            inFlight = false;
        }
    }

    function smoothed() {
        const acc = {};
        for (const top of history) for (const { letter, p } of top) acc[letter] = (acc[letter] || 0) + p / history.length;
        return Object.entries(acc).map(([letter, p]) => ({ letter, p })).sort((a, b) => b.p - a.p).slice(0, 3);
    }

    // ── Rendering ─────────────────────────────────────────────────────────
    let liveLetter = null;

    function render(top) {
        const L = $('pred-letter'), C = $('pred-conf'), S = $('pred-status'), ring = $('ring');
        if (!top || !top.length) {
            L.innerHTML = '<i class="fa-solid fa-hand"></i>';
            L.classList.add('is-empty');
            ring.style.setProperty('--p', 0);
            ring.classList.remove('unsure');
            $('pred-name').textContent = 'مستني إشارة';
            C.textContent = '';
            S.textContent = camera ? 'حط إيدك قدام الكاميرا' : 'شغّل الكاميرا عشان تبدأ';
            S.classList.remove('warn');
            $('top3').innerHTML = '<div class="top3-empty">هتظهر هنا أول ما الموديل يشوف إيد</div>';
            $('ref-card').hidden = true;
            $('cam-pred').hidden = true;
            setLive(null);
            updateTarget(null);
            return;
        }
        const best = top[0], sure = best.p >= SURE, info = byChar[best.letter];
        L.textContent = best.letter;
        L.classList.remove('is-empty');
        ring.style.setProperty('--p', Math.round(best.p * 100));
        ring.classList.toggle('unsure', !sure);
        $('pred-name').textContent = info ? info.name : best.letter;
        C.textContent = `${Math.round(best.p * 100)}%`;
        C.classList.toggle('unsure', !sure);
        S.textContent = sure ? 'الموديل متأكد' : 'مش متأكد — ثبّت الإشارة أو غيّر الزاوية';
        S.classList.toggle('warn', !sure);
        $('cam-pred').hidden = !camera;
        $('cam-pred').classList.toggle('unsure', !sure);
        $('cam-pred-letter').textContent = best.letter;
        $('cam-pred-conf').textContent = `${Math.round(best.p * 100)}%`;

        $('top3').innerHTML = top.map(({ letter, p }) =>
            `<div class="top3-row"><span class="l">${esc(letter)}</span>` +
            `<span class="bar"><span style="width:${(p * 100).toFixed(1)}%"></span></span>` +
            `<span class="p">${Math.round(p * 100)}%</span></div>`).join('');

        if (info && info.image) {
            $('ref-card').hidden = false;
            $('ref-img').src = info.image;
            $('ref-img').alt = `الإشارة الصحيحة لـ ${info.char}`;
            $('ref-title').textContent = `الإشارة الصحيحة لـ ${info.char}`;
            $('ref-hint').textContent = info.hint || '';
        }
        setLive(sure ? best.letter : null);
        updateTarget(best, sure);
    }

    function setLive(letter) {
        if (letter === liveLetter) return;
        document.querySelectorAll('.letter-btn.is-live').forEach(b => b.classList.remove('is-live'));
        liveLetter = letter;
        if (letter) {
            const btn = document.querySelector(`.letter-btn[data-char="${CSS.escape(letter)}"]`);
            if (btn) btn.classList.add('is-live');
        }
    }

    // ── Practice mode ─────────────────────────────────────────────────────
    function buildLettersGrid() {
        $('letters-grid').innerHTML = LETTERS.map(l =>
            `<button class="letter-btn" data-char="${esc(l.char)}" title="${esc(l.name)}">${esc(l.char)}</button>`).join('');
        $('letters-grid').addEventListener('click', e => {
            const b = e.target.closest('.letter-btn');
            if (b) setTarget(b.dataset.char === target ? null : b.dataset.char);
        });
        $('target-clear').addEventListener('click', () => setTarget(null));
    }

    function setTarget(char) {
        target = char;
        matchStreak = 0;
        document.querySelectorAll('.letter-btn.is-target').forEach(b => b.classList.remove('is-target'));
        const box = $('target-box');
        if (!char) { box.hidden = true; return; }
        const info = byChar[char] || { char };
        document.querySelector(`.letter-btn[data-char="${CSS.escape(char)}"]`)?.classList.add('is-target');
        box.hidden = false;
        box.classList.remove('matched');
        $('target-letter').textContent = char;
        $('target-img').src = info.image || '';
        $('target-img').alt = `إشارة ${char}`;
        $('target-result').className = 'target-result no';
        $('target-result').textContent = 'اعمل الإشارة...';
    }

    function updateTarget(best, sure) {
        if (!target) return;
        const res = $('target-result'), box = $('target-box');
        if (best && sure && best.letter === target) matchStreak++;
        else if (!best || (sure && best.letter !== target)) matchStreak = 0;
        if (matchStreak >= MATCH_HOLD) {
            box.classList.add('matched');
            res.className = 'target-result ok';
            res.innerHTML = '<i class="fa-solid fa-circle-check"></i> صح!';
        } else {
            box.classList.remove('matched');
            res.className = 'target-result no';
            res.textContent = best ? (best.letter === target ? 'ثبّت...' : `شايفها ${best.letter}`) : 'اعمل الإشارة...';
        }
    }

    async function loadModelInfo() {
        try {
            const info = await (await fetch('assets/data/model-info.json', { cache: 'no-cache' })).json();
            const pct = v => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
            $('model-meta').textContent = `الموديل بيتعرف على ${info.num_classes} حرف · دقته في الاختبار ${pct(info.test_accuracy)}`;
        } catch { }
    }

    // ── Init ──────────────────────────────────────────────────────────────
    loadSession();
    showView();
    buildLettersGrid();
    loadModelInfo();
    render(null);
    $('login-form').addEventListener('submit', login);
    $('logout-btn').addEventListener('click', () => logout());
    $('start-cam-btn').addEventListener('click', startCamera);
})();
