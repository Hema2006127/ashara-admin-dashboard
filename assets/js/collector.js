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
        this.contributor = localStorage.getItem('ashara_contributor_name') || 'عضو_المشروع';
        
        // MediaPipe & Camera state
        this.camera = null;
        this.hands = null;
        this.isCameraRunning = false;
        this.videoElement = null;
        this.canvasElement = null;
        this.canvasCtx = null;
        this.selectedCameraId = null;

        // Recording State
        this.isCountingDown = false;
        this.isRecording = false;
        this.currentRoundSamples = [];
        this.targetSamples = this.config.SAMPLES_PER_ROUND || 50;

        // Stability tracking
        this.recentWristPositions = [];
        this.isHandStable = false;

        // Contributor local counts
        this.contributorCounts = JSON.parse(localStorage.getItem('ashara_local_counts_' + this.contributor) || '{}');
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
        this._updateContributorStats();
        this._checkOfflineQueue();

        await this._initMediaPipe();
        await this.startCamera();
    }

    _setupDOMListeners() {
        const nameInput = document.getElementById('contributor-name-input');
        if (nameInput) {
            nameInput.value = this.contributor;
            nameInput.addEventListener('change', (e) => {
                this.contributor = e.target.value.trim() || 'عضو_المشروع';
                localStorage.setItem('ashara_contributor_name', this.contributor);
                this.contributorCounts = JSON.parse(localStorage.getItem('ashara_local_counts_' + this.contributor) || '{}');
                this._updateContributorStats();
                this._renderLettersBar();
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

    _updateSoundButtonUI(btn) {
        if (this.audio.isMuted()) {
            btn.innerHTML = '<i class=fa-solid fa-volume-xmark></i> الصوت مكتوم';
            btn.classList.add('btn-outline');
            btn.classList.remove('btn-primary');
        } else {
            btn.innerHTML = '<i class=fa-solid fa-volume-high></i> المؤثرات مفعلة';
            btn.classList.add('btn-primary');
            btn.classList.remove('btn-outline');
        }
    }

    _setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            // Ignore if active in text input
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

    async _initMediaPipe() {
        if (!window.Hands) {
            console.error(MediaPipe Hands script not loaded from CDN.);
            return;
        }

        this.hands = new window.Hands({
            locateFile: (file) => https://cdn.jsdelivr.net/npm/@mediapipe/hands/
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
            document.getElementById('hud-camera-status').innerHTML = '<i class=fa-solid fa-video></i> الكاميرا متصلة';
        } catch (err) {
            console.error(Camera access error:, err);
            document.getElementById('hud-camera-status').innerHTML = '<i class=fa-solid fa-video-slash></i> تعذر فتح الكاميرا';
            alert(يرجى السماح بصلاحية الوصول إلى الكاميرا من إعدادات المتصفح.);
        }
    }

    /**
     * معالجة نتائج فحص اليد من MediaPipe
     */
    _onHandResults(results) {
        if (!this.canvasCtx || !this.canvasElement) return;

        const w = this.canvasElement.width = this.videoElement.videoWidth || 640;
        const h = this.canvasElement.height = this.videoElement.videoHeight || 480;

        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, w, h);

        const hasHands = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

        // فحص عدد الأيدي وتحديث الـ HUD
        const handHud = document.getElementById('hud-hands-count');
        const stabilityHud = document.getElementById('hud-hand-stability');

        if (hasHands) {
            const count = results.multiHandLandmarks.length;
            const handedness = results.multiHandedness[0]?.label || 'Right';
            const handLabel = count === 1 ? (handedness === 'Left' ? 'اليد اليسرى' : 'اليد اليمنى') : 'اليدين معاً';
            if (handHud) handHud.innerHTML = <i class=fa-solid fa-hand></i>  مكتشفة;

            // Draw skeleton & landmarks
            for (let i = 0; i < results.multiHandLandmarks.length; i++) {
                const landmarks = results.multiHandLandmarks[i];
                const isLeft = results.multiHandedness[i]?.label === 'Left';
                this._drawCustomHandSkeleton(landmarks, w, h, isLeft);
            }

            // فحص الاستقرار عبر إحداثيات المعصم (Landmark 0)
            const wrist = results.multiHandLandmarks[0][0];
            this._checkHandStability(wrist);

            if (stabilityHud) {
                if (this.isHandStable) {
                    stabilityHud.className = 'hud-badge hud-stability stable';
                    stabilityHud.innerHTML = '<i class=fa-solid fa-circle-check></i> اليد مستقرة وجاهزة';
                } else {
                    stabilityHud.className = 'hud-badge hud-stability unstable';
                    stabilityHud.innerHTML = '<i class=fa-solid fa-triangle-exclamation></i> ثبت يدك أمام الكاميرا';
                }
            }

            // إذا كان التسجيل نشطاً، نستخرج الـ 126 نقطة
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
            if (handHud) handHud.innerHTML = '<i class=fa-solid fa-hand-dots></i> في انتظار اليد...';
            if (stabilityHud) {
                stabilityHud.className = 'hud-badge hud-stability';
                stabilityHud.innerHTML = '<i class=fa-regular fa-circle-pause></i> ضع يدك في الكادر';
            }
            this.isHandStable = false;
        }

        this.canvasCtx.restore();
    }

    /**
     * استخراج الـ 126 نقطة (63 لليسار + 63 لليمين) بنفس تركيبة collector.py
     */
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

    /**
     * رسم عظام ونقاط اليد بألوان عصرية وتأثير نيون
     */
    _drawCustomHandSkeleton(landmarks, w, h, isLeft) {
        const ctx = this.canvasCtx;
        const colorMain = isLeft ? '#06b6d4' : '#10b981'; // Cyan for left, Emerald for right
        const colorPoint = '#ffffff';

        // Connective hand bones (MediaPipe Hands connections)
        const connections = [
            [0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
            [0, 5], [5, 6], [6, 7], [7, 8],       // Index
            [5, 9], [9, 10], [10, 11], [11, 12],  // Middle
            [9, 13], [13, 14], [14, 15], [15, 16],// Ring
            [13, 17], [17, 18], [18, 19], [19, 20],// Pinky
            [0, 17]                               // Palm base
        ];

        // Draw bone lines
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

        // Draw landmark nodes
        ctx.shadowBlur = 4;
        for (let i = 0; i < landmarks.length; i++) {
            const pt = landmarks[i];
            const radius = (i === 4 || i === 8 || i === 12 || i === 16 || i === 20) ? 6 : 4; // Larger on fingertips
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

        // حساب التباين في الحركة
        let totalDist = 0;
        for (let i = 1; i < this.recentWristPositions.length; i++) {
            const dx = this.recentWristPositions[i].x - this.recentWristPositions[i - 1].x;
            const dy = this.recentWristPositions[i].y - this.recentWristPositions[i - 1].y;
            totalDist += Math.sqrt(dx * dx + dy * dy);
        }

        const avgSpeed = totalDist / this.recentWristPositions.length;
        this.isHandStable = avgSpeed < 0.035; // عتبة استقرار اليد المناسبة
    }

    toggleRecord() {
        if (this.isCountingDown) return;

        if (this.isRecording) {
            // Cancel current recording
            this.isRecording = false;
            this.currentRoundSamples = [];
            document.getElementById('recording-ring-box').style.display = 'none';
            document.getElementById('btn-start-record').innerHTML = '<i class=fa-solid fa-play></i> بدء تسجيل الجولة (مسافة)';
            document.getElementById('btn-start-record').className = 'btn btn-emerald btn-lg record-btn-main';
            return;
        }

        // Start Countdown then Record
        this.isCountingDown = true;
        const overlay = document.getElementById('countdown-overlay');
        const numElem = document.getElementById('countdown-number');
        overlay.classList.add('active');

        let count = 3;
        numElem.innerText = count;
        this.audio.playCountdownTick();

        const timer = setInterval(() => {
            count--;
            if (count > 0) {
                numElem.innerText = count;
                this.audio.playCountdownTick();
            } else if (count === 0) {
                numElem.innerText = ابدأ!;
                this.audio.playStartBeep();
            } else {
                clearInterval(timer);
                overlay.classList.remove('active');
                this.isCountingDown = false;
                this._startRecordingSession();
            }
        }, 800);
    }

    _startRecordingSession() {
        this.isRecording = true;
        this.currentRoundSamples = [];
        document.getElementById('recording-ring-box').style.display = 'flex';
        this._updateRecordProgress();

        const btn = document.getElementById('btn-start-record');
        btn.innerHTML = '<i class=fa-solid fa-stop></i> إيقاف التسجيل (مسافة)';
        btn.className = 'btn btn-danger btn-lg record-btn-main';
    }

    _updateRecordProgress() {
        const cur = this.currentRoundSamples.length;
        const total = this.targetSamples;
        const counter = document.getElementById('recording-counter');
        if (counter) counter.innerText = ${cur} /  عينة;
    }

    async _finishCurrentRound() {
        this.isRecording = false;
        document.getElementById('recording-ring-box').style.display = 'none';

        const btn = document.getElementById('btn-start-record');
        btn.innerHTML = '<i class=fa-solid fa-spinner fa-spin></i> جاري الرفع...';
        btn.disabled = true;

        this.audio.playSuccessChime();

        const letter = this.config.LETTERS[this.currentLetterIndex];
        const samplesToUpload = [...this.currentRoundSamples];
        this.currentRoundSamples = [];

        // Upload to Supabase
        const result = await this.db.uploadBatch(this.contributor, letter, samplesToUpload);

        btn.disabled = false;
        btn.innerHTML = '<i class=fa-solid fa-play></i> بدء تسجيل الجولة (مسافة)';
        btn.className = 'btn btn-emerald btn-lg record-btn-main';

        // Update local contributor counts
        const currentCount = this.contributorCounts[letter] || 0;
        this.contributorCounts[letter] = currentCount + samplesToUpload.length;
        localStorage.setItem('ashara_local_counts_' + this.contributor, JSON.stringify(this.contributorCounts));

        this._updateContributorStats();
        this._renderLettersBar();
        this._updateLetterCardUI();
        this._checkOfflineQueue();

        const toastMsg = result.offline
            ? تم حفظ 50 عينة محلياً لـ [] (سيتم رفعها تلقائياً)
            : تم رفع 50 عينة بنجاح لـ [] إلى Supabase! 🎉;

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

        document.getElementById('guide-char-name').innerText = info.name;
        document.getElementById('guide-char-overlay').innerText = info.char;
        document.getElementById('guide-angle-text').innerText = info.angle;
        document.getElementById('guide-hint-text').innerText = info.hint;
        
        const imgElem = document.getElementById('guide-reference-img');
        if (imgElem) {
            imgElem.src = info.image;
            imgElem.alt = info.name;
        }

        const count = this.contributorCounts[letter] || 0;
        const target = this.config.TARGET_PER_LETTER;
        const pct = Math.min(100, Math.round((count / target) * 100));

        document.getElementById('guide-samples-progress').innerText = ${count} /  عينة;
        document.getElementById('guide-progress-bar').style.width = ${pct}%;

        const statusTag = document.getElementById('guide-status-tag');
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

    _renderLettersBar() {
        const container = document.getElementById('letters-chips-scroll');
        if (!container) return;

        container.innerHTML = '';
        this.config.LETTERS.forEach((l, idx) => {
            const btn = document.createElement('div');
            const isActive = idx === this.currentLetterIndex;
            const count = this.contributorCounts[l] || 0;

            btn.className = letter-chip-btn ;
            btn.innerHTML = 
                <span class=letter-chip-char></span>
                <span class=letter-chip-count></span>
            ;

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
            if (c >= this.config.TARGET_PER_LETTER) completedLetters++;
        });

        const totalElem = document.getElementById('contributor-total-samples');
        if (totalElem) totalElem.innerText = ${total.toLocaleString()} عينة;

        const completedElem = document.getElementById('contributor-completed-letters');
        if (completedElem) completedElem.innerText = ${completedLetters} / 31 حرف;
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
            syncBtn.innerHTML = '<i class=fa-solid fa-spinner fa-spin></i> جاري المزامنة...';
        }

        const res = await this.db.syncPendingBatches();
        this._checkOfflineQueue();

        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.innerHTML = '<i class=fa-solid fa-cloud-arrow-up></i> مزامنة السحاب الآن';
        }

        this.showToast(تمت مزامنة  دفعة مع Supabase بنجاح!);
    }

    showToast(message) {
        let toast = document.getElementById('realtime-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'realtime-toast';
            document.body.appendChild(toast);
        }
        toast.innerHTML = <i class=fa-solid fa-bell></i> ;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3500);
    }
}

// Auto-boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.collectorApp = new AsharaCollectorEngine();
    window.collectorApp.init();
});
