/**
 * Ashara Audio Synthesizer (Web Audio API)
 * مؤثرات صوتية تفاعلية لعمليات التسجيل والعد التنازلي واكتمال الجولات
 */

class AsharaAudio {
    constructor() {
        this.ctx = null;
        this.muted = localStorage.getItem('ashara_audio_muted') === 'true';
    }

    _initCtx() {
        if (!this.ctx) {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
                this.ctx = new AudioCtx();
            }
        }
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
    }

    toggleMute() {
        this.muted = !this.muted;
        localStorage.setItem('ashara_audio_muted', this.muted);
        return this.muted;
    }

    isMuted() {
        return this.muted;
    }

    playTone(freq, type = 'sine', duration = 0.1, gainVal = 0.1) {
        if (this.muted) return;
        try {
            this._initCtx();
            if (!this.ctx) return;

            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();

            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

            gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

            osc.connect(gain);
            gain.connect(this.ctx.destination);

            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            console.warn(Audio playback error:, e);
        }
    }

    // صوت تكة العد التنازلي
    playCountdownTick() {
        this.playTone(440, 'triangle', 0.08, 0.15); // A4
    }

    // صوت انطلاق التسجيل
    playStartBeep() {
        this.playTone(880, 'sine', 0.2, 0.2); // A5
    }

    // صوت تكة خفيفة مع أخذ العينة
    playSampleTick() {
        this.playTone(587.33, 'sine', 0.03, 0.04); // D5
    }

    // نغمة اكتمال الجولة بنجاح
    playSuccessChime() {
        if (this.muted) return;
        try {
            this._initCtx();
            if (!this.ctx) return;
            const now = this.ctx.currentTime;
            
            const playNote = (freq, startOffset, dur) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(freq, now + startOffset);
                gain.gain.setValueAtTime(0.18, now + startOffset);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + startOffset + dur);
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                osc.start(now + startOffset);
                osc.stop(now + startOffset + dur);
            };

            playNote(523.25, 0.0, 0.25); // C5
            playNote(659.25, 0.12, 0.25); // E5
            playNote(783.99, 0.24, 0.25); // G5
            playNote(1046.50, 0.36, 0.50); // C6
        } catch (e) {
            console.warn(Audio success playback error:, e);
        }
    }

    // نغمة خطأ أو تعذر الاتصال
    playErrorTone() {
        this.playTone(220, 'sawtooth', 0.3, 0.15);
    }
}

window.AsharaAudio = new AsharaAudio();
