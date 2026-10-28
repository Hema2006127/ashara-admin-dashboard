/**
 * Ashara Supabase Client & Data Synchronization Layer
 * إدارة الاتصال بقاعدة بيانات Supabase، والرفع الحي، والمزامنة بدون إنترنت
 */

class AsharaDBClient {
    constructor() {
        this.config = window.AsharaConfig;
        this.client = null;
        this.isOnline = navigator.onLine;
        this.realtimeChannel = null;
        this.pendingQueueKey = 'ashara_pending_sample_batches_v1';
        this._initClient();
        this._setupNetworkListeners();
    }

    _initClient() {
        if (window.supabase && this.config.SUPABASE_URL && this.config.SUPABASE_KEY) {
            this.client = window.supabase.createClient(
                this.config.SUPABASE_URL,
                this.config.SUPABASE_KEY
            );
        }
    }

    _setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.syncPendingBatches();
        });
        window.addEventListener('offline', () => {
            this.isOnline = false;
        });
    }

    /**
     * جلب سجلات العينات المرفوعة
     */
    async fetchLetterSamples(limit = 10000) {
        const url = ${this.config.SUPABASE_URL}/rest/v1/letter_samples?select=id,contributor,letter,sample_count,created_at&order=created_at.desc&limit=;
        const headers = {
            apikey: this.config.SUPABASE_KEY,
            Authorization: Bearer 
        };

        const res = await fetch(url, { headers });
        if (!res.ok) {
            throw new Error(خطأ في جلب بيانات Supabase: );
        }
        return await res.json();
    }

    /**
     * جلب أحدث إصدار للبرنامج
     */
    async fetchAppUpdates() {
        try {
            const url = ${this.config.SUPABASE_URL}/rest/v1/app_updates?is_active=eq.true&order=id.desc&limit=1;
            const headers = {
                apikey: this.config.SUPABASE_KEY,
                Authorization: Bearer 
            };
            const res = await fetch(url, { headers });
            if (res.ok) {
                const rows = await res.json();
                return rows && rows.length > 0 ? rows[0] : null;
            }
        } catch (e) {
            console.warn(تعذر جلب التحديثات:, e);
        }
        return null;
    }

    /**
     * رفع دفعة عينات (جولة = 50 عينة)
     * العينة عبارة عن مصفوفة إحداثيات 126 قيمة
     */
    async uploadBatch(contributor, letter, samples) {
        const payload = {
            contributor: contributor.trim() || 'anonymous',
            letter: letter.trim(),
            samples: samples,
            sample_count: samples.length,
            created_at: new Date().toISOString()
        };

        // إذا كان الجهاز غير متصل بالإنترنت، نحفظها محلياً فوراً
        if (!navigator.onLine) {
            this._saveToPendingQueue(payload);
            return { success: true, offline: true, message: تم الحفظ محلياً لعدم توفر إنترنت };
        }

        try {
            const url = ${this.config.SUPABASE_URL}/rest/v1/letter_samples;
            const headers = {
                apikey: this.config.SUPABASE_KEY,
                Authorization: Bearer ,
                Content-Type: application/json,
                Prefer: return=minimal
            };

            const response = await fetch(url, {
                method: POST,
                headers,
                body: JSON.stringify(payload)
            });

            if (response.ok || response.status === 201) {
                return { success: true, offline: false };
            } else {
                console.warn(Supabase POST error: . Fallback to local queue.);
                this._saveToPendingQueue(payload);
                return { success: true, offline: true, message: تعذر الاتصال بالسيرفر - تم الحفظ محلياً };
            }
        } catch (error) {
            console.warn(Network error during upload. Saving to local storage:, error);
            this._saveToPendingQueue(payload);
            return { success: true, offline: true, message: خطأ شبكة - تم الحفظ محلياً };
        }
    }

    /**
     * حفظ دفعة في قائمة الانتظار المحلية
     */
    _saveToPendingQueue(payload) {
        try {
            const queue = this.getPendingQueue();
            queue.push({
                ...payload,
                queuedAt: new Date().toISOString(),
                id: 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)
            });
            localStorage.setItem(this.pendingQueueKey, JSON.stringify(queue));
        } catch (e) {
            console.error(فشل الحفظ في localStorage:, e);
        }
    }

    /**
     * استرجاع قائمة الانتظار المحلية
     */
    getPendingQueue() {
        try {
            const raw = localStorage.getItem(this.pendingQueueKey);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    /**
     * مزامنة الدفعات المحفوظة محلياً عند عودة الاتصال
     */
    async syncPendingBatches(onProgress = null) {
        const queue = this.getPendingQueue();
        if (queue.length === 0) return { synced: 0, remaining: 0 };

        let syncedCount = 0;
        const remainingQueue = [];

        for (let i = 0; i < queue.length; i++) {
            const item = queue[i];
            try {
                const url = ${this.config.SUPABASE_URL}/rest/v1/letter_samples;
                const headers = {
                    apikey: this.config.SUPABASE_KEY,
                    Authorization: Bearer ,
                    Content-Type: application/json,
                    Prefer: return=minimal
                };

                const body = {
                    contributor: item.contributor,
                    letter: item.letter,
                    samples: item.samples,
                    sample_count: item.sample_count,
                    created_at: item.created_at || new Date().toISOString()
                };

                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body)
                });

                if (res.ok || res.status === 201) {
                    syncedCount++;
                } else {
                    remainingQueue.push(item);
                }
            } catch (e) {
                remainingQueue.push(item);
            }

            if (onProgress) {
                onProgress(i + 1, queue.length);
            }
        }

        localStorage.setItem(this.pendingQueueKey, JSON.stringify(remainingQueue));
        return { synced: syncedCount, remaining: remainingQueue.length };
    }

    /**
     * تصدير الدفعات المحلية كملف JSON للتحميل اليدوي
     */
    exportPendingAsJSON() {
        const queue = this.getPendingQueue();
        if (queue.length === 0) return false;

        const blob = new Blob([JSON.stringify(queue, null, 2)], { type: application/json });
        const url = URL.createObjectURL(blob);
        const a = document.createElement(a);
        a.href = url;
        a.download = shara_backup_samples_.json;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return true;
    }

    /**
     * تفعيل الاشتراك اللحظي Realtime
     */
    subscribeToNewSamples(onInsert) {
        if (!this.client) {
            this._initClient();
        }
        if (!this.client) return null;

        try {
            if (this.realtimeChannel) {
                this.client.removeChannel(this.realtimeChannel);
            }

            this.realtimeChannel = this.client
                .channel('realtime_letter_samples_feed')
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'letter_samples'
                }, (payload) => {
                    if (onInsert && payload && payload.new) {
                        onInsert(payload.new);
                    }
                })
                .subscribe((status) => {
                    console.log(Supabase Realtime Channel Status:, status);
                });

            return this.realtimeChannel;
        } catch (e) {
            console.warn(Realtime subscription failed:, e);
            return null;
        }
    }
}

window.AsharaDB = new AsharaDBClient();
