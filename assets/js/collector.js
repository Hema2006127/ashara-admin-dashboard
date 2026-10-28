/**
 * Ashara Sign Collector - Web MediaPipe Hand Tracking & Landmark Extraction Engine
 * محرك تتبع حركة اليد واستخراج الـ 126 نقطة المطابقة لموديل الذكاء الاصطناعي
 */

class AsharaCollectorEngine {
    constructor() {
        this.config = window.AsharaConfig;
        this.db = window.AsharaDB;
        this.audio = window.AsharaAudio;

        this.currentLetterIndex = 0;
        this.contributor = (localStorage.getItem('ashara_contributor_name') || '').trim();

        // MediaPipe & Camera state
        this.camera = null;
        this.hands = null;
        this.isCameraRunning = false;
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;

        // Recording State
        this.isCountingDown = false;
        this.isRecording = false;
        this.currentRoundSamples = [];
        this.targetSamples = this.config.SAMPLES_PER_ROUND || 50;

        // Stability tracking
        this.recentWristPositions = [];
        this.isHandStable = false;

        // Contributor local counts
        this.contributorCounts = {};
        this.config.LETTERS.forEach(l => this.contributorCounts[l] = 0);
    }

    async init() {
        this.videoElement = document.getElementById('webcam-feed');
        this.canvasElement = document.getElementById('landmark-canvas');
        if (!this.canvasElement || !this.videoElement) return;

        this.canvasCtx = this.canvasElement.getContext('2d');

        this._setupDOMListeners();
        this._setupKeyboardShortcuts();
        this._renderLettersBar();
        this.setLetter(0);

        // Check if contributor name is set, otherwise prompt immediately
        if (!this.contributor) {
            this.showNamePromptModal();
        } else {
            const nameInput = document.getElementById('contributor-name-input');
            if (nameInput) nameInput.value = this.contributor;
            await this.loadContributorData(this.contributor);
        }

        this._checkOfflineQueue();
        await this._initMediaPipe();
        await this.startCamera();
    }

    _setupDOMListeners() {
        const nameInput = document.getElementById('contributor-name-input');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                const val = e.target.value.trim();
                nameInput.classList.remove('error');
                if (val) {
                    this.contributor = val;
                    localStorage.setItem('ashara_contributor_name', val);
                    this.loadContributorData(val);
                } else {
                    this.contributor = '';
                    localStorage.removeItem('ashara_contributor_name');
                    this._updateContributorStats();
                }
            });
        }

        // Modal Name Prompt Listeners
        const modalBtn = document.getElementById('btn-save-modal-name');
        const modalInput = document.getElementById('modal-name-input');
        const modalErr = document.getElementById('modal-name-error');

        if (modalBtn && modalInput) {
            modalBtn.addEventListener('click', () => {
                const val = modalInput.value.trim();
                if (!val) {
                    if (modalErr) modalErr.style.display = 'block';
                    modalInput.focus();
                    return;
                }
                this.contributor = val;
                localStorage.setItem('ashara_contributor_name', val);
                if (nameInput) nameInput.value = val;
                this.hideNamePromptModal();
                this.loadContributorData(val);
                this.showToast(`أهلاً بك يا ${val}! يمكنك الآن بدء تسجيل العينات 🎉`);
            });

            modalInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    modalBtn.click();
                }
            });

            modalInput.addEventListener('input', () => {
                if (modalErr) modalErr.style.display = 'none';
            });
        }

        const startBtn = document.getElementById('btn-start-record');
        if (startBtn) {
            startBtn.addEventListener('click', () => this.toggleRecord());
        }

        const prevBtn = document.getElementById('btn-prev-letter');
        if (prevBtn) {
            prevBtn.addEventListener('click', () => this.prevLetter());
        }

        const nextBtn = document.getElementById('btn-next-letter');
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.nextLetter());
        }

        const muteBtn = document.getElementById('btn-toggle-sound');
        if (muteBtn) {
            this._updateSoundButtonUI(muteBtn);
            muteBtn.addEventListener('click', () => {
                const isMuted = this.audio.toggleMute();
                this._updateSoundButtonUI(muteBtn);
            });
        }

        const syncBtn = document.getElementById('btn-sync-offline');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.syncOfflineBatches());
        }

        const exportBtn = document.getElementById('btn-export-offline');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.db.exportPendingAsJSON());
        }
    }

    showNamePromptModal() {
        const modal = document.getElementById('contributor-name-modal');
        const input = document.getElementById('modal-name-input');
        if (modal) {
            modal.classList.add('show');
            if (input) {
                input.value = this.contributor || '';
                setTimeout(() => input.focus(), 200);
            }
        }
    }

    hideNamePromptModal() {
        const modal = document.getElementById('contributor-name-modal');
        if (modal) modal.classList.remove('show');
    }

    _updateSoundButtonUI(btn) {
        if (this.audio.isMuted()) {
            btn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i> الصوت مكتوم';
            btn.classList.add('btn-outline');
            btn.classList.remove('btn-primary');
        } else {
            btn.innerHTML = '<i class="fa-solid fa-volume-high"></i> المؤثرات مفعلة';
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-outline');
        }
    }

    _setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            if (e.code === 'Space') {
                e.preventDefault();
                this.toggleRecord();
            } else if (e.code === 'KeyN' || e.code === 'KeyQ' || e.code === 'ArrowLeft') {
                this.nextLetter();
            } else if (e.code === 'KeyP' || e.code === 'ArrowRight') {
                this.prevLetter();
            }
        });
    }

    /**
     * جلب سجل العينات التاريخية لهذا المساهم من Supabase لحساب الحروف المكتملة بدقة
     */
    async loadContributorData(contributorName) {
        if (!contributorName || !contributorName.trim()) {
            this.contributorCounts = {};
            this.config.LETTERS.forEach(l => this.contributorCounts[l] = 0);
            this._updateContributorStats();
            this._renderLettersBar();
            this._updateLetterCardUI();
            return;
        }

        const name = contributorName.trim();
        const counts = {};
        this.config.LETTERS.forEach(l => counts[l] = 0);

        try {
            const url = `${this.config.SUPABASE_URL}/rest/v1/letter_samples?select=letter,sample_count&contributor=eq.${encodeURIComponent(name)}`;
            const headers = {
                "apikey": this.config.SUPABASE_KEY,
                "Authorization": `Bearer ${this.config.SUPABASE_KEY}`
            };

            const res = await fetch(url, { headers });
            if (res.ok) {
                const rows = await res.json();
                rows.forEach(r => {
                    const l = (r.letter || '').trim();
                    const c = parseInt(r.sample_count || 50, 10);
                    if (counts[l] !== undefined) {
                        counts[l] += c;
                    } else {
                        counts[l] = c;
                    }
                });
            }
        } catch (e) {
            console.warn("Could not query contributor stats from Supabase:", e);
            // Fallback to local cache if offline
            const localCache = JSON.parse(localStorage.getItem('ashara_local_counts_' + name) || '{}');
            Object.keys(localCache).forEach(k => counts[k] = (counts[k] || 0) + localCache[k]);
        }

        // Include any unsynced offline queue items for this user
        const queue = this.db.getPendingQueue();
        queue.forEach(item => {
            if (item.contributor === name) {
                const l = (item.letter || '').trim();
                const c = parseInt(item.sample_count || 50, 10);
                if (counts[l] !== undefined) {
                    counts[l] += c;
                } else {
                    counts[l] = c;
                }
            }
        });

        this.contributorCounts = counts;
        localStorage.setItem('ashara_local_counts_' + name, JSON.stringify(counts));

        this._updateContributorStats();
        this._renderLettersBar();
        this._updateLetterCardUI();
    }

    async _initMediaPipe() {
        if (!window.Hands) {
            console.error("MediaPipe Hands script not loaded from CDN.");
            return;
        }

        this.hands = new window.Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        this.hands.setOptions({
            maxNumHands: 2,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults((results) => this._onHandResults(results));
    }

    async startCamera() {
        if (!window.Camera || !this.videoElement || !this.hands) return;

        try {
            this.camera = new window.Camera(this.videoElement, {
                onFrame: async () => {
                    if (this.videoElement && this.hands) {
                        await this.hands.send({ image: this.videoElement });
                    }
                },
                width: 640,
                height: 480
            });

            await this.camera.start();
            this.isCameraRunning = true;
            const statusElem = document.getElementById('hud-camera-status');
            if (statusElem) statusElem.innerHTML = '<i class="fa-solid fa-video"></i> الكاميرا متصلة';
        } catch (err) {
            console.error("Camera access error:", err);
            const statusElem = document.getElementById('hud-camera-status');
            if (statusElem) statusElem.innerHTML = '<i class="fa-solid fa-video-slash"></i> تعذر فتح الكاميرا';
            alert("يرجى السماح بصلاحية الوصول إلى الكاميرا من إعدادات المتصفح.");
        }
    }

    _onHandResults(results) {
        if (!this.canvasCtx || !this.canvasElement) return;

        const w = this.canvasElement.width = this.videoElement.videoWidth || 640;
        const h = this.canvasElement.height = this.videoElement.videoHeight || 480;

        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, w, h);

        const hasHands = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

        const handHud = document.getElementById('hud-hands-count');
        const stabilityHud = document.getElementById('hud-hand-stability');

        if (hasHands) {
            const count = results.multiHandLandmarks.length;
            const handedness = results.multiHandedness[0]?.label || 'Right';
            const handLabel = count === 1 ? (handedness === 'Left' ? 'اليد اليسرى' : 'اليد اليمنى') : 'اليدين معاً';
            if (handHud) handHud.innerHTML = `<i class="fa-solid fa-hand"></i> ${handLabel} مكتشفة`;

            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const isLeft = results.multiHandedness[i]?.label === 'Left';
                this._drawCustomHandSkeleton(landmarks, w, h, isLeft);
            }

            const wrist = results.multiHandLandmarks[0][0];
            this._checkHandStability(wrist);

            if (stabilityHud) {
                if (this.isHandStable) {
                    stabilityHud.className = 'hud-badge hud-stability stable';
                    stabilityHud.innerHTML = '<i class="fa-solid fa-circle-check"></i> اليد مستقرة وجاهزة';
                } else {
                    stabilityHud.className = 'hud-badge hud-stability unstable';
                    stabilityHud.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> ثبت يدك أمام الكاميرا';
                }
            }

            if (this.isRecording) {
                const sample126 = this._extract126Landmarks(results);
                this.currentRoundSamples.push(sample126);
                this.audio.playSampleTick();
                this._updateRecordProgress();

                if (this.currentRoundSamples.length >= this.targetSamples) {
                    this._finishCurrentRound();
                }
            }
        } else {
            if (handHud) handHud.innerHTML = '<i class="fa-solid fa-hand-dots"></i> في انتظار اليد...';
            if (stabilityHud) {
                stabilityHud.className = 'hud-badge hud-stability';
                stabilityHud.innerHTML = '<i class="fa-regular fa-circle-pause"></i> ضع يدك في الكادر';
            }
            this.isHandStable = false;
        }

        this.canvasCtx.restore();
    }

    _extract126Landmarks(results) {
        const left = new Array(63).fill(0.0);
        const right = new Array(63).fill(0.0);

        if (results.multiHandLandmarks && results.multiHandedness) {
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const label = results.multiHandedness[i]?.label || 'Right';

                const flat = [];
                for (const p of landmarks) {
                    flat.push(p.x, p.y, p.z);
                }

                if (label === 'Left') {
                    for (let j = 0; j < 63; j++) left[j] = flat[j];
                } else {
                    for (let j = 0; j < 63; j++) right[j] = flat[j];
                }
            }
        }

        return left.concat(right);
    }

    _drawCustomHandSkeleton(landmarks, w, h, isLeft) {
        const ctx = this.canvasCtx;
        const colorMain = isLeft ? '#06b6d4' : '#10b981';
        const colorPoint = '#ffffff';

        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8],       // Index
            [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
            [9, 13], [13, 14], [14, 15], [15, 16],// Ring
            [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
            [0, 17]                               // Palm base
        ];

        ctx.strokeStyle = colorMain;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.shadowColor = colorMain;
        ctx.shadowBlur = 8;

        for (const [p1, p2] of connections) {
            const pt1 = landmarks[p1];
            const pt2 = landmarks[p2];
            ctx.beginPath();
            ctx.moveTo(pt1.x * w, pt1.y * h);
            ctx.lineTo(pt2.x * w, pt2.y * h);
            ctx.stroke();
        }

        ctx.shadowBlur = 4;
        for (let i = 0; i < landmarks.length; i++) {
            const pt = landmarks[i];
            const radius = (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) ? 6 : 4;
            ctx.fillStyle = (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) ? colorMain : colorPoint;
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, radius, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    _checkHandStability(wrist) {
        this.recentWristPositions.push({ x: wrist.x, y: wrist.y, t: Date.now() });
        if (this.recentWristPositions.length > 10) {
            this.recentWristPositions.shift();
        }

        if (this.recentWristPositions.length < 5) {
            this.isHandStable = false;
            return;
        }

        let totalDist = 0;
        for (let i = 1; i < this.recentWristPositions.length; i++) {
            const dx = this.recentWristPositions[i].x - this.recentWristPositions[i - 1].x;
            const dy = this.recentWristPositions[i].y - this.recentWristPositions[i - 1].y;
            totalDist += Math.sqrt(dx * dx + dy * dy);
        }

        const avgSpeed = totalDist / this.recentWristPositions.length;
        this.isHandStable = avgSpeed < 0.035;
    }

    toggleRecord() {
        if (this.isCountingDown) return;

        // التحقق الإجباري من إدخال اسم المساهم
        if (!this.contributor || !this.contributor.trim()) {
            this.showNamePromptModal();
            this.showToast('⚠️ يرجى كتابة اسم المساهم أولاً لحفظ العينات باسمك!');
            const topInput = document.getElementById('contributor-name-input');
            if (topInput) {
                topInput.classList.add('error');
                topInput.focus();
            }
            return;
        }

        if (this.isRecording) {
            this.isRecording = false;
            this.currentRoundSamples = [];
            const ringBox = document.getElementById('recording-ring-box');
            if (ringBox) ringBox.style.display = 'none';

            const startBtn = document.getElementById('btn-start-record');
            if (startBtn) {
                startBtn.innerHTML = '<i class="fa-solid fa-play"></i> بدء تسجيل الجولة (مسافة)';
                startBtn.className = 'btn btn-emerald btn-lg record-btn-main';
            }
            return;
        }

        // Start Countdown then Record
        this.isCountingDown = true;
        const overlay = document.getElementById('countdown-overlay');
        const numElem = document.getElementById('countdown-number');
        if (overlay) overlay.classList.add('active');

        let count = 3;
        if (numElem) numElem.innerText = count;
        this.audio.playCountdownTick();

        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                if (numElem) numElem.innerText = count;
                this.audio.playCountdownTick();
            } else if (count === 0) {
                if (numElem) numElem.innerText = "ابدأ!";
                this.audio.playStartBeep();
            } else {
                clearInterval(timer);
                if (overlay) overlay.classList.remove('active');
                this.isCountingDown = false;
                this._startRecordingSession();
            }
        }, 800);
    }

    _startRecordingSession() {
        this.isRecording = true;
        this.currentRoundSamples = [];
        const ringBox = document.getElementById('recording-ring-box');
        if (ringBox) ringBox.style.display = 'flex';
        this._updateRecordProgress();

        const btn = document.getElementById('btn-start-record');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-stop"></i> إيقاف التسجيل (مسافة)';
            btn.className = 'btn btn-danger btn-lg record-btn-main';
        }
    }

    _updateRecordProgress() {
        const cur = this.currentRoundSamples.length;
        const total = this.targetSamples;
        const counter = document.getElementById('recording-counter');
        if (counter) counter.innerText = `${cur} / ${total} عينة`;
    }

    async _finishCurrentRound() {
        this.isRecording = false;
        const ringBox = document.getElementById('recording-ring-box');
        if (ringBox) ringBox.style.display = 'none';

        const btn = document.getElementById('btn-start-record');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الرفع...';
            btn.disabled = true;
        }

        this.audio.playSuccessChime();

        const letter = this.config.LETTERS[this.currentLetterIndex];
        const samplesToUpload = [...this.currentRoundSamples];
        this.currentRoundSamples = [];

        // Upload to Supabase
        const result = await this.db.uploadBatch(this.contributor, letter, samplesToUpload);

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-play"></i> بدء تسجيل الجولة (مسافة)';
            btn.className = 'btn btn-emerald btn-lg record-btn-main';
        }

        // Update local contributor counts immediately
        const currentCount = this.contributorCounts[letter] || 0;
        this.contributorCounts[letter] = currentCount + samplesToUpload.length;
        localStorage.setItem('ashara_local_counts_' + this.contributor, JSON.stringify(this.contributorCounts));

        // Recompute and update UI
        this._updateContributorStats();
        this._renderLettersBar();
        this._updateLetterCardUI();
        this._checkOfflineQueue();

        const toastMsg = result.offline
            ? `تم حفظ 50 عينة محلياً لـ [${letter}] (سيتم رفعها تلقائياً)`
            : `تم رفع 50 عينة بنجاح لـ [${letter}] إلى Supabase! 🎉`;

        this.showToast(toastMsg);
    }

    setLetter(index) {
        if (index < 0 || index >= this.config.LETTERS.length) return;
        this.currentLetterIndex = index;
        this._updateLetterCardUI();
        this._renderLettersBar();
    }

    nextLetter() {
        const next = (this.currentLetterIndex + 1) % this.config.LETTERS.length;
        this.setLetter(next);
    }

    prevLetter() {
        const prev = (this.currentLetterIndex - 1 + this.config.LETTERS.length) % this.config.LETTERS.length;
        this.setLetter(prev);
    }

    _updateLetterCardUI() {
        const info = this.config.LETTER_INFO[this.currentLetterIndex];
        const letter = this.config.LETTERS[this.currentLetterIndex];

        const charName = document.getElementById('guide-char-name');
        if (charName) charName.innerText = info.name;

        const charOverlay = document.getElementById('guide-char-overlay');
        if (charOverlay) charOverlay.innerText = info.char;

        const angleText = document.getElementById('guide-angle-text');
        if (angleText) angleText.innerText = info.angle;

        const hintText = document.getElementById('guide-hint-text');
        if (hintText) hintText.innerText = info.hint;

        const imgElem = document.getElementById('guide-reference-img');
        if (imgElem) {
            imgElem.src = info.image;
            imgElem.alt = info.name;
        }

        const count = this.contributorCounts[letter] || 0;
        const target = this.config.TARGET_PER_LETTER;
        const pct = Math.min(100, Math.round((count / target) * 100));

        const samplesProgress = document.getElementById('guide-samples-progress');
        if (samplesProgress) samplesProgress.innerText = `${count} / ${target} عينة`;

        const progressBar = document.getElementById('guide-progress-bar');
        if (progressBar) progressBar.style.width = `${pct}%`;

        const statusTag = document.getElementById('guide-status-tag');
        if (statusTag) {
            if (count >= target) {
                statusTag.className = 'guide-badge status-done';
                statusTag.innerText = 'مكتمل ✅';
            } else if (count > 0) {
                statusTag.className = 'guide-badge status-inprogress';
                statusTag.innerText = 'قيد الجمع ⏳';
            } else {
                statusTag.className = 'guide-badge status-empty';
                statusTag.innerText = 'لم يبدأ ❌';
            }
        }
    }

    _renderLettersBar() {
        const container = document.getElementById('letters-chips-scroll');
        if (!container) return;

        container.innerHTML = '';
        this.config.LETTERS.forEach((l, idx) => {
            const btn = document.createElement('div');
            const isActive = idx === this.currentLetterIndex;
            const count = this.contributorCounts[l] || 0;

            btn.className = `letter-chip-btn ${isActive ? 'active' : ''}`;
            btn.innerHTML = `
                <span class="letter-chip-char">${l}</span>
                <span class="letter-chip-count">${count}</span>
            `;

            btn.addEventListener('click', () => this.setLetter(idx));
            container.appendChild(btn);
        });
    }

    _updateContributorStats() {
        let total = 0;
        let completedLetters = 0;

        this.config.LETTERS.forEach(l => {
            const c = this.contributorCounts[l] || 0;
            total += c;
            if (c >= this.config.TARGET_PER_LETTER) {
                completedLetters++;
            }
        });

        const totalElem = document.getElementById('contributor-total-samples');
        if (totalElem) totalElem.innerText = `${total.toLocaleString()} عينة`;

        const completedElem = document.getElementById('contributor-completed-letters');
        if (completedElem) {
            completedElem.innerHTML = `<span dir="ltr">${completedLetters} / 31</span> حرف مكتمل`;
        }
    }

    _checkOfflineQueue() {
        const queue = this.db.getPendingQueue();
        const banner = document.getElementById('offline-sync-card');
        const countElem = document.getElementById('offline-pending-count');
        if (!banner) return;

        if (queue.length > 0) {
            banner.classList.add('show');
            if (countElem) countElem.innerText = queue.length;
        } else {
            banner.classList.remove('show');
        }
    }

    async syncOfflineBatches() {
        const syncBtn = document.getElementById('btn-sync-offline');
        if (syncBtn) {
            syncBtn.disabled = true;
            syncBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري المزامنة...';
        }

        const res = await this.db.syncPendingBatches();
        this._checkOfflineQueue();

        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> مزامنة السحاب الآن';
        }

        this.showToast(`تمت مزامنة ${res.synced} دفعة مع Supabase بنجاح!`);
    }

    showToast(message) {
        let toast = document.getElementById('realtime-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'realtime-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = `<i class="fa-solid fa-bell"></i> ${message}`;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }
}

// Auto-boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.collectorApp = new AsharaCollectorEngine();
    window.collectorApp.init();
});
