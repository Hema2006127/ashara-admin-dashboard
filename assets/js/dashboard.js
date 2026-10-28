/**
 * Ashara UI - Dashboard Analytics & Realtime Visualizations
 * جلب وتحليل بيانات العينات ورسم المخططات البيانية
 */

class AsharaDashboardEngine {
    constructor() {
        this.config = window.AsharaConfig;
        this.db = window.AsharaDB;
        this.audio = window.AsharaAudio;

        this.cachedRows = [];
        this.contributorsMap = {};
        this.selectedMember = null;
        this.memberFilterMode = 'all';

        this.contribChartInstance = null;
        this.lettersChartInstance = null;
    }

    async init() {
        this._setupDOMListeners();
        await this.loadDashboardData();
        this._setupRealtime();
        this._loadAppUpdates();
    }

    _setupDOMListeners() {
        const refreshBtn = document.getElementById('btn-refresh-data');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.loadDashboardData(true));
        }

        const exportBtn = document.getElementById('btn-export-csv');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportCSV());
        }

        const memberPicker = document.getElementById('member-picker');
        if (memberPicker) {
            memberPicker.addEventListener('change', (e) => this.changeMemberProfile(e.target.value));
        }

        // Filter chips
        const chips = document.querySelectorAll('.filter-chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const mode = chip.getAttribute('data-mode');
                this.setMemberLetterFilter(mode);
            });
        });
    }

    async loadDashboardData(isManual = false) {
        const liveText = document.getElementById('live-text');
        const liveDot = document.getElementById('live-dot');
        if (liveText) liveText.innerText = 'جاري التحديث...';

        try {
            const rows = await this.db.fetchLetterSamples();
            this.cachedRows = rows;
            this.renderDashboard(rows);

            if (liveText) liveText.innerText = 'متصل بـ Supabase (مباشر)';
            if (liveDot) liveDot.style.background = '#10b981';

            if (isManual) {
                this.showToast('تم تحديث البيانات من السيرفر بنجاح ✅');
            }
        } catch (err) {
            console.error('Failed to load dashboard data:', err);
            if (liveText) liveText.innerText = 'خطأ في الاتصال بالسيرفر';
            if (liveDot) liveDot.style.background = '#ef4444';
        }
    }

    renderDashboard(rows) {
        let totalSamples = 0;
        const contribMap = {};
        const letterMap = {};
        this.config.LETTERS.forEach(l => letterMap[l] = { count: 0, contributors: new Set() });

        rows.forEach(r => {
            const name = (r.contributor || 'anonymous').trim();
            const letter = (r.letter || '').trim();
            const count = parseInt(r.sample_count || 50, 10);

            totalSamples += count;

            // Contributors map
            if (!contribMap[name]) {
                contribMap[name] = { total: 0, letters: {}, lastActive: r.created_at };
            }
            contribMap[name].total += count;
            contribMap[name].letters[letter] = (contribMap[name].letters[letter] || 0) + count;
            if (!contribMap[name].lastActive || new Date(r.created_at) > new Date(contribMap[name].lastActive)) {
                contribMap[name].lastActive = r.created_at;
            }

            // Letters map
            if (letterMap[letter]) {
                letterMap[letter].count += count;
                letterMap[letter].contributors.add(name);
            }
        });

        this.contributorsMap = contribMap;

        // Metrics Calculation
        const targetTotal = this.config.LETTERS.length * this.config.TARGET_PER_LETTER;
        const percent = Math.min(100, ((totalSamples / targetTotal) * 100)).toFixed(1);
        const completedLetters = Object.values(letterMap).filter(v => v.count >= this.config.TARGET_PER_LETTER).length;
        const activeContribCount = Object.keys(contribMap).length;

        // Update DOM Stat Cards
        const totalElem = document.getElementById('val-total-samples');
        if (totalElem) totalElem.innerText = totalSamples.toLocaleString();

        const contribElem = document.getElementById('val-active-contributors');
        if (contribElem) contribElem.innerText = activeContribCount;

        const compElem = document.getElementById('val-completed-letters');
        if (compElem) compElem.innerText = `${completedLetters} / ${this.config.LETTERS.length}`;

        const rateElem = document.getElementById('val-completion-rate');
        if (rateElem) rateElem.innerText = `${percent}%`;

        // Progress bar
        const barFill = document.getElementById('progress-bar-fill');
        if (barFill) barFill.style.width = `${percent}%`;

        const percentLabel = document.getElementById('progress-percent-label');
        if (percentLabel) percentLabel.innerText = `${percent}%`;

        const metaCount = document.getElementById('progress-meta-count');
        if (metaCount) metaCount.innerText = `${totalSamples.toLocaleString()} من أصل ${targetTotal.toLocaleString()} عينة مطلوبة`;

        // Render Sub-components
        this.renderContributorsChart(contribMap);
        this.renderLettersChart(letterMap);
        this.populateMemberPicker(contribMap);
        this.renderMatrixSection(letterMap);
        this.renderActivityTable(rows);
    }

    renderContributorsChart(contribMap) {
        const sorted = Object.entries(contribMap).sort((a, b) => b[1].total - a[1].total);
        const labels = sorted.map(s => s[0]);
        const data = sorted.map(s => s[1].total);

        const canvas = document.getElementById('contributorsChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (this.contribChartInstance) this.contribChartInstance.destroy();

        this.contribChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'العينات المجمعة',
                    data,
                    backgroundColor: 'rgba(59, 130, 246, 0.75)',
                    borderColor: '#3b82f6',
                    borderWidth: 1,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8', font: { family: 'Tajawal' } },
                        grid: { display: false }
                    },
                    y: {
                        ticks: { color: '#94a3b8', font: { family: 'Tajawal' } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                }
            }
        });
    }

    renderLettersChart(letterMap) {
        const labels = this.config.LETTERS;
        const data = labels.map(l => letterMap[l]?.count || 0);
        const bgColors = data.map(val => {
            if (val >= this.config.TARGET_PER_LETTER) return 'rgba(16, 185, 129, 0.8)';
            if (val > 0) return 'rgba(245, 158, 11, 0.8)';
            return 'rgba(239, 68, 68, 0.6)';
        });

        const canvas = document.getElementById('lettersChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (this.lettersChartInstance) this.lettersChartInstance.destroy();

        this.lettersChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'عينات الحرف',
                    data,
                    backgroundColor: bgColors,
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    x: {
                        ticks: { color: '#94a3b8', font: { family: 'Cairo', weight: 'bold' } },
                        grid: { display: false }
                    },
                    y: {
                        ticks: { color: '#94a3b8', font: { family: 'Tajawal' } },
                        grid: { color: 'rgba(255,255,255,0.05)' }
                    }
                }
            }
        });
    }

    populateMemberPicker(contribMap) {
        const picker = document.getElementById('member-picker');
        if (!picker) return;

        picker.innerHTML = '';
        const sorted = Object.entries(contribMap).sort((a, b) => b[1].total - a[1].total);

        if (sorted.length === 0) {
            picker.innerHTML = '<option>لا يوجد مساهمون مسجلون بعد</option>';
            return;
        }

        sorted.forEach(([name, data], idx) => {
            const medal = idx === 0 ? "🥇 " : (idx === 1 ? "🥈 " : (idx === 2 ? "🥉 " : `#${idx + 1} `));
            const opt = document.createElement('option');
            opt.value = name;
            opt.innerText = `${medal}${name} (${data.total.toLocaleString()} عينة)`;
            picker.appendChild(opt);
        });

        if (!this.selectedMember || !contribMap[this.selectedMember]) {
            this.selectedMember = sorted[0][0];
        }
        picker.value = this.selectedMember;
        this.renderMemberProfile(this.selectedMember);
    }

    changeMemberProfile(name) {
        if (!name || !this.contributorsMap[name]) return;
        this.selectedMember = name;
        this.renderMemberProfile(name);
    }

    setMemberLetterFilter(mode) {
        this.memberFilterMode = mode;
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        const activeChip = document.querySelector(`.filter-chip[data-mode="${mode}"]`);
        if (activeChip) activeChip.classList.add('active');
        if (this.selectedMember) this.renderMemberProfile(this.selectedMember);
    }

    renderMemberProfile(name) {
        const data = this.contributorsMap[name];
        if (!data) return;

        const total = data.total;
        const letters = data.letters;
        const coveredLetters = Object.keys(letters).filter(l => letters[l] > 0).length;
        const pct = ((coveredLetters / this.config.LETTERS.length) * 100).toFixed(1);

        const avatarElem = document.getElementById('prof-avatar');
        if (avatarElem) avatarElem.innerText = name.charAt(0).toUpperCase();

        const nameElem = document.getElementById('prof-name');
        if (nameElem) nameElem.innerText = `المساهم: ${name}`;

        const lastActiveFormatted = data.lastActive ? new Date(data.lastActive).toLocaleString('ar-EG') : '-';
        const lastActiveElem = document.getElementById('prof-last-active');
        if (lastActiveElem) lastActiveElem.innerText = `آخر نشاط: ${lastActiveFormatted}`;

        const samplesCnt = document.getElementById('prof-samples-cnt');
        if (samplesCnt) samplesCnt.innerText = `${total.toLocaleString()} عينة`;

        const lettersCnt = document.getElementById('prof-letters-cnt');
        if (lettersCnt) lettersCnt.innerText = `${coveredLetters} / ${this.config.LETTERS.length} حرف`;

        const covPct = document.getElementById('prof-coverage-pct');
        if (covPct) covPct.innerText = `${pct}%`;

        const container = document.getElementById('member-matrix-grid');
        if (!container) return;
        container.innerHTML = '';

        this.config.LETTERS.forEach(letter => {
            const count = letters[letter] || 0;

            if (this.memberFilterMode === 'done' && count < this.config.TARGET_PER_LETTER) return;
            if (this.memberFilterMode === 'inprogress' && (count === 0 || count >= this.config.TARGET_PER_LETTER)) return;
            if (this.memberFilterMode === 'missing' && count > 0) return;

            let statusClass = 'status-empty';
            let statusText = 'لم يُسجل ❌';

            if (count >= this.config.TARGET_PER_LETTER) {
                statusClass = 'status-done';
                statusText = 'مكتمل ✅';
            } else if (count > 0) {
                statusClass = 'status-inprogress';
                statusText = 'قيد الجمع ⏳';
            }

            const card = document.createElement('div');
            card.className = 'letter-pill';
            card.innerHTML = `
                <div class="letter-char">${letter}</div>
                <div class="letter-samples">${count} عينة</div>
                <div class="letter-status-tag ${statusClass}">${statusText}</div>
            `;
            container.appendChild(card);
        });

        if (container.children.length === 0) {
            container.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: #94a3b8; padding: 20px;">لا توجد حروف تطابق هذا الفلتر لهذا العضو.</div>`;
        }
    }

    renderMatrixSection(letterMap) {
        const container = document.getElementById('matrix-grid');
        if (!container) return;

        container.innerHTML = '';
        this.config.LETTERS.forEach(letter => {
            const info = letterMap[letter] || { count: 0, contributors: new Set() };
            const count = info.count;
            const target = this.config.TARGET_PER_LETTER;
            const pct = Math.min(100, Math.round((count / target) * 100));

            let statusClass = 'status-empty';
            let statusLabel = '0%';
            if (count >= target) {
                statusClass = 'status-done';
                statusLabel = '100% مكتمل';
            } else if (count > 0) {
                statusClass = 'status-inprogress';
                statusLabel = `${pct}%`;
            }

            const card = document.createElement('div');
            card.className = 'matrix-card';
            card.innerHTML = `
                <div class="matrix-card-char">${letter}</div>
                <div class="matrix-card-name">${this.config.LETTER_NAMES[letter] || ''}</div>
                <div class="letter-samples" style="font-weight: 700; color: #fff;">${count.toLocaleString()} عينة</div>
                <div class="letter-status-tag ${statusClass}" style="margin-top: 6px;">${statusLabel}</div>
            `;
            container.appendChild(card);
        });
    }

    renderActivityTable(rows) {
        const tbody = document.getElementById('activity-table-body');
        if (!tbody) return;

        tbody.innerHTML = '';
        const latest = rows.slice(0, 100);

        latest.forEach(r => {
            const tr = document.createElement('tr');
            const dateStr = r.created_at ? new Date(r.created_at).toLocaleString('ar-EG') : '-';
            const letter = r.letter || '-';
            const letterName = this.config.LETTER_NAMES[letter] || letter;

            tr.innerHTML = `
                <td><span class="badge-contributor"><i class="fa-solid fa-user"></i> ${r.contributor || 'anonymous'}</span></td>
                <td><span class="badge-letter">${letter}</span> <span style="font-size: 0.8rem; color: #94a3b8;">(${letterName})</span></td>
                <td style="font-weight: 700;">+${(r.sample_count || 50)} عينة</td>
                <td style="color: #94a3b8; font-size: 0.82rem;">${dateStr}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    _setupRealtime() {
        this.db.subscribeToNewSamples((newRecord) => {
            this.audio.playSuccessChime();
            this.showToast(`📥 عينة جديدة رفعت الآن من: ${newRecord.contributor} لحرف [${newRecord.letter}] 🎉`);
            this.cachedRows.unshift(newRecord);
            this.renderDashboard(this.cachedRows);
        });
    }

    async _loadAppUpdates() {
        const update = await this.db.fetchAppUpdates();
        if (update) {
            const banner = document.getElementById('updates-banner');
            if (banner) {
                banner.style.display = 'flex';
                const versionElem = document.getElementById('updates-version-text');
                if (versionElem) versionElem.innerText = `برنامج SignCollector v${update.version} متوفر للتحميل`;

                const notesElem = document.getElementById('updates-notes');
                if (notesElem && update.release_notes) {
                    notesElem.innerText = update.release_notes;
                }

                const dlBtn = document.getElementById('updates-dl-btn');
                if (dlBtn && update.download_url) {
                    dlBtn.href = update.download_url;
                }
            }
        }
    }

    exportCSV() {
        if (!this.cachedRows || this.cachedRows.length === 0) {
            alert('لا توجد بيانات متاحة للتصدير حالياً.');
            return;
        }

        let csv = '\uFEFF'; // UTF-8 BOM
        csv += 'ID,المساهم,الحرف,عدد العينات,تاريخ التسجيل\n';

        this.cachedRows.forEach(r => {
            csv += `"${r.id || ''}","${r.contributor || ''}","${r.letter || ''}",${r.sample_count || 50},"${r.created_at || ''}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ashara_samples_report_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
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
        setTimeout(() => toast.classList.remove('show'), 4000);
    }
}

// Auto-boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardApp = new AsharaDashboardEngine();
    window.dashboardApp.init();
});
