// =========================================================
// 1. IMPORTS & CONFIGURATION
// =========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { 
    getFirestore, 
    collection, 
    getDocs, 
    doc, 
    getDoc, 
    updateDoc, 
    deleteDoc, 
    addDoc, 
    setDoc, 
    query, 
    where, 
    orderBy, 
    limit, 
    serverTimestamp, 
    writeBatch, 
    startAfter, 
    deleteField, 
    Timestamp 
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// استيراد البيانات الثابتة من ملف data.js
import { topics, badgesMap, badgesData, NOOR_JSON_FILES, NOOR_GITHUB_BASE } from './data.js';
import { initAdminMessaging } from './messaging.js';

// تعريف كائن Timestamp ليكون متاحاً عالمياً
window.Timestamp = Timestamp; 

// إعدادات Firebase
const firebaseConfig = { 
    apiKey: "AIzaSyC6FoHbL8CDTPX1MNaNWyDIA-6xheX0t4s", 
    authDomain: "ahl-albayet.firebaseapp.com", 
    projectId: "ahl-albayet", 
    storageBucket: "ahl-albayet.firebasestorage.app", 
    messagingSenderId: "347315641241", 
    appId: "1:347315641241:web:c9ed240a00e5d2c5031108" 
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let isAuthReady = false;
let currentUserEditId = null;

// ✅ كاش عدادات المعرفة (system/counts)
let systemCountsCache = null;
let systemCountsLoading = null;

// ✅ مرجع بيانات الحظر الأصلية للمستخدم أثناء التعديل
let currentUserEditOriginal = null;
let lastVisible = null; 
let allQuestionsCache = [];
let isCacheLoaded = false;
let isFetchingQs = false;

// =========================================================
// 2. GLOBAL UI/UTILITY HELPERS
// =========================================================

const el = (id) => document.getElementById(id);

// =========================
// ✅ Helpers (Date/Firestore)
// =========================

const tsToMillis = (v) => {
    if (!v) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') {
        const ns = typeof v.nanoseconds === 'number' ? v.nanoseconds : 0;
        return v.seconds * 1000 + Math.floor(ns / 1e6);
    }
    return null;
};

const formatArDateTime = (ms) => {
    try {
        return new Date(ms).toLocaleString('ar-IQ', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch {
        return '--';
    }
};

async function getSystemCounts(force = false) {
    if (systemCountsCache && !force) return systemCountsCache;
    if (systemCountsLoading && !force) return systemCountsLoading;

    systemCountsLoading = (async () => {
        try {
            const snap = await getDoc(doc(db, 'system', 'counts'));
            systemCountsCache = snap.exists() ? (snap.data() || {}) : {};
        } catch {
            systemCountsCache = {};
        } finally {
            systemCountsLoading = null;
        }
        return systemCountsCache;
    })();

    return systemCountsLoading;
}
const show = (id) => el(id)?.classList.remove('hidden');
const hide = (id) => el(id)?.classList.add('hidden');

/**
 * دالة إظهار الإشعارات (Toast)
 * @param {string} msg - رسالة الإشعار
 * @param {string} icon - أيقونة Material Symbols
 */
const toast = (msg, icon = 'check_circle') => { 
    const t = el('toast'); 
    const tMsg = el('toast-msg');
    const tIcon = el('toast-icon');

    if (!t || !tMsg || !tIcon) return;

    tMsg.innerText = msg; 
    tIcon.innerText = icon; 
    
    t.classList.remove('hidden', 'translate-y-5', 'opacity-0'); 
    t.classList.add('flex', 'opacity-100'); 
    
    setTimeout(() => { 
        t.classList.remove('opacity-100'); 
        t.classList.add('opacity-0', 'translate-y-5'); 
        setTimeout(() => { 
            t.classList.add('hidden'); 
            t.classList.remove('flex'); 
        }, 300); 
    }, 3000); 
};

// =========================================================
// 3. NAVIGATION & UI HANDLERS
// =========================================================

/**
 * فتح وإغلاق القائمة الجانبية (للموبايل)
 */
window.toggleAdminMenu = (showMenu) => {
    const sidebar = el('admin-sidebar');
    const overlay = el('side-menu-overlay');
    if (!sidebar || !overlay) return;

    if (showMenu) {
        sidebar.style.right = '0';
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    } else {
        sidebar.style.right = '-300px';
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
};

// تعيين معالجات الأحداث للقائمة
el('mobile-menu-btn').onclick = () => window.toggleAdminMenu(true);
el('side-menu-overlay').onclick = () => window.toggleAdminMenu(false);

window.triggerTab = (tabId) => {
    document.querySelectorAll('.nav-item').forEach(b => { 
        b.classList.remove('active'); 
        if(b.dataset.tab === tabId) b.classList.add('active'); 
    });

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    show(tabId);

    if(tabId === 'view-users') loadUsers();
    if(tabId === 'view-reports') loadReports();
    if(tabId === 'view-manage') { 
        el('qs-search-input').value=''; 
        loadQuestions(false); 
    }
    if(tabId === 'view-dashboard') loadStats();
    if(tabId === 'view-ai-settings') loadAISettings();
    
        if(tabId === 'view-messages') window.adminMessagingOpen?.();
window.toggleAdminMenu(false);
    el('main-view-area')?.scrollTo(0, 0);
};

// ربط أحداث التنقل
document.querySelectorAll('.nav-item').forEach(btn => {
    btn.onclick = () => window.triggerTab(btn.dataset.tab);
});

document.querySelectorAll('.glass[data-target]').forEach(card => {
    card.onclick = () => window.triggerTab(card.dataset.target);
});

/**
 * تهيئة قوائم التصنيفات والمواضيع
 */
const initDrops = (cId, tId, onChangeCallback = null) => {
    const c = el(cId), t = el(tId);
    if (!c || !t) return;
    
    c.innerHTML = '<option value="">-- اختر التصنيف --</option>'; 
    Object.keys(topics).forEach(k => c.add(new Option(k, k)));
    
    const updateTopics = () => {
        t.innerHTML = '<option value="">-- اختر الموضوع --</option>'; 
        if(topics[c.value]) { 
            t.disabled = false; 
            topics[c.value].forEach(sub => t.add(new Option(sub, sub))); 
        } else {
            t.disabled = true;
        }
        if(onChangeCallback) onChangeCallback();
    };

    c.onchange = updateTopics;
    t.onchange = onChangeCallback || (() => {});
};

// =========================================================
// 4. DASHBOARD & CHARTS LOGIC
// =========================================================
let myChart = null; 
let myActivityChart = null; 
let cachedQuestionsData = []; 

async function loadStats() {
    try {
        // أ) جلب الأسئلة وحساب المعتمد/غير المعتمد
        const qSnap = await getDocs(query(collection(db, "questions")));
        let approvedCount = 0;
        cachedQuestionsData = []; 
        
        qSnap.forEach(doc => {
            const d = doc.data();
            cachedQuestionsData.push(d); 
            if(d.isReviewed === true) approvedCount++;
        });
        
        const totalQuestions = qSnap.size;
        const pendingCount = totalQuestions - approvedCount;

        if(el('dash-total-q')) el('dash-total-q').innerText = totalQuestions;
        if(el('dash-approved-q')) el('dash-approved-q').innerText = approvedCount;
        if(el('dash-pending-q')) el('dash-pending-q').innerText = pendingCount;

        // ب) جلب المستخدمين وحساب النشاط اليومي
        const uSnap = await getDocs(query(collection(db, "users"))); 
        if(el('dash-users-count')) el('dash-users-count').innerText = uSnap.size;

        const activityMap = {};
        const last14Days = [];
        const today = new Date();

        for (let i = 13; i >= 0; i--) {
            const d = new Date();
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            last14Days.push(dateStr);
            activityMap[dateStr] = 0;
        }

        uSnap.forEach(doc => {
            const u = doc.data();
            if (u.stats && Array.isArray(u.stats.lastPlayedDates)) {
                u.stats.lastPlayedDates.forEach(date => {
                    if (activityMap.hasOwnProperty(date)) {
                        activityMap[date]++;
                    }
                });
            }
        });

        const activityData = last14Days.map(date => activityMap[date]);
        renderActivityChart(last14Days, activityData);

        // ج) باقي العدادات
        const rSnap = await getDocs(query(collection(db, "reports"))); 
        if(el('dash-reports-count')) el('dash-reports-count').innerText = rSnap.size;
        if(el('dash-topics-count')) el('dash-topics-count').innerText = Object.keys(topics).length;
        
        // د) تحديث الرسم الدائري
        const chartFilter = el('chart-filter');
        if(chartFilter) {
            chartFilter.innerHTML = '<option value="main">حسب التصنيف الرئيسي</option>';
            Object.keys(topics).forEach(k => chartFilter.add(new Option(k, k)));
            chartFilter.onchange = (e) => renderChart(e.target.value);
            renderChart('main');
        }
    } catch (error) {
        console.error("Error loading stats:", error);
        toast("خطأ في تحميل الإحصائيات", "error");
    }
}

function renderActivityChart(labels, data) {
    const canvas = el('activityChart');
    if (!canvas) return;
    if (myActivityChart) myActivityChart.destroy();

    const ctx = canvas.getContext('2d');
    const shortLabels = labels.map(l => l.substring(5)); 

    myActivityChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: shortLabels,
            datasets: [{
                label: 'لاعبون نشطون',
                data: data,
                borderColor: '#3b82f6',
                backgroundColor: (context) => {
                    const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, 200);
                    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.5)');
                    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');
                    return gradient;
                },
                borderWidth: 3,
                pointBackgroundColor: '#fbbf24',
                pointBorderColor: '#fff',
                pointRadius: 4,
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } }
            }
        }
    });
}

function renderChart(mode) { 
    if (!el('questionsChart')) return;
    
    const counts = {};
    cachedQuestionsData.forEach(q => {
        const t = q.topic || "غير مصنف";
        if (mode === 'main') { 
            let category = "غير مصنف"; 
            for(const [cat, subs] of Object.entries(topics)) { 
                if(subs.includes(t)) { category = cat; break; } 
            } 
            counts[category] = (counts[category] || 0) + 1; 
        } else { 
            if (topics[mode] && topics[mode].includes(t)) counts[t] = (counts[t] || 0) + 1; 
        }
    });

    const colors = ['#d97706', '#2563eb', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#06b6d4'];
    
    if(myChart) myChart.destroy();
    
    myChart = new Chart(el('questionsChart').getContext('2d'), { 
        type: 'doughnut', 
        data: { 
            labels: Object.keys(counts), 
            datasets: [{ 
                data: Object.values(counts), 
                backgroundColor: colors.slice(0, Object.keys(counts).length), 
                borderWidth: 0 
            }] 
        }, 
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                legend: { position: 'right', labels: { color: '#cbd5e1', font: { family: 'Amiri' } } } 
            } 
        } 
    });
}

// =========================================================
// 5. USER MANAGEMENT
// =========================================================

async function loadUsers() {
    const grid = el('users-grid'); 
    if (!grid) return;
    
    grid.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-10";
    grid.innerHTML = '<div class="col-span-full text-center py-12"><span class="material-symbols-rounded spinner text-amber-500 text-4xl">sync</span></div>';
    
    const term = el('user-search').value.toLowerCase();
    
    try {
        const snap = await getDocs(query(collection(db, "users"), orderBy("stats.totalCorrect", "desc"), limit(50)));
        
        grid.innerHTML = '';
        const docs = snap.docs;

        docs.forEach((d, index) => {
            const u = d.data();
            if(term && !u.username?.toLowerCase().includes(term) && !d.id.includes(term)) return;
            
            const displayName = u.username || 'ضيف';
            const stats = u.stats || {};
            const totalCorrect = stats.totalCorrect || 0;

            // عرض الأوسمة
            let badgesHtml = '';
            if (u.badges && Array.isArray(u.badges) && u.badges.length > 0) {
                badgesHtml = '<div class="flex flex-wrap gap-1 mt-3">';
                u.badges.slice(0, 4).forEach(bId => {
                    const baseId = bId.split('_lvl')[0];
                    const badgeInfo = badgesMap[baseId];
                    const badgeName = badgeInfo ? badgeInfo.name : baseId; 
                    const lvlMatch = bId.match(/lvl(\d+)/);
                    const lvl = lvlMatch ? lvlMatch[1] : '';
                    
                    let style = "bg-slate-700/50 text-slate-300 border-slate-600";
                    if(lvl == '3') style = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                    if(lvl == '4') style = "bg-cyan-500/10 text-cyan-400 border-cyan-500/20";
                    if(lvl == '5') style = "bg-red-500/10 text-red-400 border-red-500/20";

                    badgesHtml += `<span class="${style} border text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1">${badgeName} <span class="text-[8px] opacity-60">${lvl?'v'+lvl:''}</span></span>`;
                });
                if(u.badges.length > 4) badgesHtml += `<span class="text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">+${u.badges.length - 4}</span>`;
                badgesHtml += '</div>';
            } else {
                badgesHtml = '<div class="text-[10px] text-slate-600 mt-3 flex items-center gap-1 opacity-50"><span class="material-symbols-rounded text-sm">hotel_class</span> لا توجد أوسمة</div>';
            }
            
            const div = document.createElement('div');
            div.className = `relative group glass rounded-2xl overflow-hidden border border-slate-700/50 hover:border-amber-500/30 transition-all duration-300 hover:-translate-y-1 ${u.isBanned ? 'grayscale opacity-75' : ''}`;
            
            let av = `<span class="material-symbols-rounded text-3xl text-slate-500">person</span>`;
            if(u.customAvatar) av = `<img src="${u.customAvatar}" class="w-full h-full object-cover transition duration-500 group-hover:scale-110">`;
            
            let bannerColor = "from-slate-800 to-slate-900"; 
            let rankIcon = `<span class="text-slate-600 font-mono text-xs">#${index + 1}</span>`;
            
            if(index === 0) { bannerColor = "from-amber-600/20 to-amber-900/40"; rankIcon = "🥇"; }
            else if(index === 1) { bannerColor = "from-slate-400/20 to-slate-600/40"; rankIcon = "🥈"; }
            else if(index === 2) { bannerColor = "from-orange-700/20 to-orange-900/40"; rankIcon = "🥉"; }
            if(u.isBanned) bannerColor = "from-red-900/50 to-red-950/80";

            div.innerHTML = `
                <div class="h-20 bg-gradient-to-r ${bannerColor} relative">
                    <div class="absolute top-2 right-3 text-lg drop-shadow-md">${rankIcon}</div>
                    ${u.isBanned ? '<div class="absolute top-2 left-2 bg-red-600/90 text-white text-[9px] px-2 py-0.5 rounded shadow-sm font-bold">محظور 🚫</div>' : ''}
                </div>
                
                <div class="px-5 pb-4 -mt-10 relative">
                    <div class="flex justify-between items-end">
                        <div class="w-20 h-20 rounded-2xl bg-slate-800 border-4 border-[#1e293b] shadow-xl flex items-center justify-center overflow-hidden relative group-hover:shadow-amber-500/10 transition-shadow">
                            ${av}
                        </div>
                        <button class="btn-edit-user bg-slate-800 hover:bg-blue-600 text-slate-400 hover:text-white w-10 h-10 rounded-xl border border-slate-700 hover:border-blue-500 transition shadow-lg flex items-center justify-center mb-1">
                            <span class="material-symbols-rounded text-lg">edit_note</span>
                        </button>
                    </div>
                    
                    <div class="mt-3">
                        <h3 class="text-white font-bold text-lg truncate leading-tight">${displayName}</h3>
                        <div class="flex items-center gap-2 mt-1">
                            <p class="text-[10px] text-slate-500 font-mono select-all bg-slate-900/50 px-1.5 rounded border border-slate-800 truncate max-w-[120px]">${d.id}</p>
                        </div>
                    </div>

                    <div class="grid grid-cols-3 gap-1 mt-4 bg-slate-900/40 p-2 rounded-xl border border-slate-700/30">
                        <div class="text-center relative">
                            <div class="absolute -top-1 right-0 w-full h-0.5 bg-green-500/50 rounded-full shadow-[0_0_10px_rgba(34,197,94,0.5)]"></div>
                            <div class="text-[9px] text-green-400 mb-0.5 flex items-center justify-center gap-1 font-bold">✅ صحيحة</div>
                            <div class="text-white font-bold font-mono text-sm">${totalCorrect}</div>
                        </div>
                        <div class="text-center border-r border-slate-700/30">
                            <div class="text-[9px] text-slate-400 mb-0.5">النقاط</div>
                            <div class="text-amber-500 font-bold font-mono text-sm">${u.highScore?.toLocaleString() || 0}</div>
                        </div>
                        <div class="text-center border-r border-slate-700/30">
                            <div class="text-[9px] text-slate-400 mb-0.5">لعب</div>
                            <div class="text-blue-400 font-bold font-mono text-sm">${stats.quizzesPlayed || 0}</div>
                        </div>
                    </div>

                    ${badgesHtml}
                </div>
            `;
            
            div.querySelector('.btn-edit-user').onclick = () => openEditUserModal(d.id, u, stats);
            grid.appendChild(div);
        });
    } catch(e) { 
        console.error(e); 
        if(e.message.includes("index")) {
            grid.innerHTML = `<div class="col-span-full text-center text-red-400 p-4 border border-red-500/30 bg-red-900/10 rounded-xl">⚠️ يتطلب هذا الترتيب فهرساً (Index) في Firebase.<br><a href="${e.message.match(/https?:\/\/[^\s]+/)[0]}" target="_blank" class="underline font-bold">اضغط هنا لإنشائه تلقائياً</a></div>`;
        } else {
            grid.innerHTML = `<div class="text-red-400 p-4">خطأ: ${e.message}</div>`; 
        }
    }
}

function openEditUserModal(userId, u, stats) {
    currentUserEditId = userId;
    currentUserEditOriginal = {
        isBanned: !!u.isBanned,
        banUntil: u.banUntil || null,
        banStart: u.banStart || null,
        banReason: u.banReason || '',
        banDays: typeof u.banDays === 'number' ? u.banDays : null
    };
    
    // 1. تعبئة البيانات الأساسية
    el('edit-name').value = u.username || ''; 
    el('edit-score').value = u.highScore || 0; 
    el('edit-banned').checked = u.isBanned || false; 
    el('edit-pass').value = u.password || '';

    // ✅ تفاصيل الحظر (السبب + المدة)
    if (el('edit-ban-reason')) el('edit-ban-reason').value = u.banReason || '';
    if (el('edit-ban-days')) {
        const untilMs = tsToMillis(u.banUntil);
        const daysLeft = untilMs ? Math.max(0, Math.ceil((untilMs - Date.now()) / 86400000)) : 0;
        const inferredDays = typeof u.banDays === 'number' ? u.banDays : daysLeft;
        el('edit-ban-days').value = inferredDays || 0;
    }
    updateBanPreviewUI();
    
    // 2. تعبئة الإحصائيات
    el('edit-quizzes-played').value = stats.quizzesPlayed || 0;
    el('edit-total-correct').value = stats.totalCorrect || 0;
    el('edit-weekly-score').value = u.weeklyStats?.correct || 0;
    el('edit-monthly-score').value = u.monthlyStats?.correct || 0;

    // 3. إدارة الأوسمة
    renderBadgesManager(u.badges || []);

    // 3.1 ✅ عرض تفاصيل الملف الشخصي
    window.__currentUserInEditModal = u;
    renderUserProfileDetails(u);
    
    // 4. تعبئة الصورة الشخصية
    const prev = el('edit-avatar-preview'); 
    prev.innerHTML = '';
    if(u.customAvatar) { 
        prev.innerHTML = `<img src="${u.customAvatar}" class="w-full h-full object-cover">`; 
        prev.classList.remove('text-5xl', 'text-slate-400');
        show('btn-del-avatar'); 
    } else { 
        prev.innerHTML = `<span class="material-symbols-rounded">person</span>`; 
        prev.classList.add('text-5xl', 'text-slate-400');
        hide('btn-del-avatar'); 
    }
    
    // إظهار صفحة ملف اللاعب (بدلاً من نافذة منبثقة)
    window.__lastTabBeforeUserEdit = document.querySelector('.nav-item.active')?.dataset.tab || 'view-users';

    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    show('user-edit-modal');

    // إبقاء التبويب السابق فعالاً (لا نريد إزالة التحديد من القائمة الجانبية)
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (!window.__lastTabBeforeUserEdit) return;
        btn.classList.toggle('active', btn.dataset.tab === window.__lastTabBeforeUserEdit);
    });

    // عرض رقم المستخدم في العنوان
    const idLabel = el('edit-user-id-label');
    if (idLabel) idLabel.textContent = userId;

    el('main-view-area')?.scrollTo(0, 0);
    window.toggleAdminMenu(false);
}

function updateBanPreviewUI() {
    const isBanned = !!el('edit-banned')?.checked;
    const box = el('ban-details-box');
    if (box) box.classList.toggle('opacity-50', !isBanned);

    if (el('edit-ban-reason')) el('edit-ban-reason').disabled = !isBanned;
    if (el('edit-ban-days')) el('edit-ban-days').disabled = !isBanned;

    const untilEl = el('edit-ban-until');
    if (!untilEl) return;

    if (!isBanned) {
        untilEl.innerText = '--';
        return;
    }

    const days = parseInt(el('edit-ban-days')?.value) || 0;
    if (days <= 0) {
        untilEl.innerText = 'دائم (غير محدد)';
        return;
    }
    const untilMs = Date.now() + days * 86400000;
    untilEl.innerText = formatArDateTime(untilMs);
}

// =========================
// ✅ عرض شامل لملف المستخدم
// =========================

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderTopicProgressList(filterText = '') {
    const listEl = el('topic-progress-list');
    const countEl = el('topic-progress-count');
    if (!listEl) return;

    const items = window.__topicProgressItems || [];
    const f = (filterText || '').trim().toLowerCase();
    let filtered = f
        ? items.filter(it => (it.topic || '').toLowerCase().includes(f))
        : [...items];

    // ✅ ترتيب ديناميكي حسب خيار المستخدم
    const sortMode = el('topic-progress-sort')?.value || 'best';
    filtered.sort((a, b) => {
        if (sortMode === 'alpha') {
            return String(a.topic || '').localeCompare(String(b.topic || ''), 'ar');
        }
        if (sortMode === 'correct') {
            return (Number(b.correct) || 0) - (Number(a.correct) || 0);
        }
        // best: أعلى نسبة (مع إعطاء أولوية لمن لديه إجمالي معروف)
        const aHas = a.total > 0 ? 1 : 0;
        const bHas = b.total > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        const aPct = a.total > 0 ? (a.correct / a.total) : (a.correct || 0);
        const bPct = b.total > 0 ? (b.correct / b.total) : (b.correct || 0);
        return bPct - aPct;
    });

    if (countEl) countEl.innerText = filtered.length;

    listEl.innerHTML = '';
    if (filtered.length === 0) {
        listEl.innerHTML = '<div class="text-xs text-slate-600 text-center py-6">لا توجد بيانات</div>';
        return;
    }

    // عدد العناصر قد يكون كبيراً، نعرض أول 500 لمنع ثقل الواجهة
    filtered.slice(0, 500).forEach((it) => {
        const totalTxt = it.total > 0 ? it.total : '--';
        const pctRaw = it.total > 0 ? (it.correct / it.total) * 100 : null;
        const pct = pctRaw === null ? null : Math.max(0, Math.min(100, Math.round(pctRaw)));
        const width = pct === null ? 0 : Math.max(2, pct);

        const row = document.createElement('div');
        row.className = 'topic-row';
        row.innerHTML = `
            <div class="topic-row-top">
                <div class="topic-row-title" title="${escapeHtml(it.topic)}">${escapeHtml(it.topic)}</div>
                <div class="topic-row-mono">${Number(it.correct) || 0}/${escapeHtml(totalTxt)}</div>
            </div>
            <div class="topic-row-sub">
                <div class="topic-row-bar"><div style="width:${width}%"></div></div>
                <div class="topic-row-pct">${pct === null ? '' : `${pct}%`}</div>
            </div>
        `;
        listEl.appendChild(row);
    });

    if (filtered.length > 500) {
        const more = document.createElement('div');
        more.className = 'text-[10px] text-slate-500 text-center py-2';
        more.innerText = `تم عرض 500 من أصل ${filtered.length}`;
        listEl.appendChild(more);
    }
}

async function renderUserProfileDetails(u) {
    // 1) الملفات المختومة
    const sealedObj = u.sealedTopics || {};
    const sealedKeys = Object.keys(sealedObj);
    const sealedCountEl = el('user-sealed-topics-count');
    if (sealedCountEl) sealedCountEl.innerText = sealedKeys.length;

    const sealedListEl = el('user-sealed-topics');
    if (sealedListEl) {
        sealedListEl.innerHTML = '';
        if (sealedKeys.length === 0) {
            sealedListEl.innerHTML = '<div class="text-xs text-slate-600 text-center py-6">لا توجد ملفات مختومة</div>';
        } else {
            sealedKeys
                .sort((a, b) => a.localeCompare(b, 'ar'))
                .forEach((topic) => {
                    const ms = tsToMillis(sealedObj[topic]);
                    const d = ms ? formatArDateTime(ms) : '--';
                    const chip = document.createElement('div');
                    chip.className = 'sealed-row';
                    chip.innerHTML = `
                        <div class="sealed-row-title" title="${escapeHtml(topic)}">${escapeHtml(topic)}</div>
                        <div class="sealed-row-sub">خُتم في: ${escapeHtml(d)}</div>
                    `;
                    sealedListEl.appendChild(chip);
                });
        }
    }

    // 2) المعرفة حسب الموضوع
    const counts = await getSystemCounts();
    const correctMap = u.stats?.topicCorrect || {};

    const allTopics = new Set([...Object.keys(counts || {}), ...Object.keys(correctMap || {})]);
    const items = [...allTopics].map((t) => ({
        topic: t,
        correct: Number(correctMap?.[t] || 0),
        total: Number(counts?.[t] || 0)
    }));

    // ترتيب: أولاً من لديه إجمالي معروف، ثم أعلى نسبة/صحيح
    items.sort((a, b) => {
        const aHas = a.total > 0 ? 1 : 0;
        const bHas = b.total > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        const aPct = a.total > 0 ? a.correct / a.total : a.correct;
        const bPct = b.total > 0 ? b.correct / b.total : b.correct;
        return bPct - aPct;
    });

    window.__topicProgressItems = items;
    const searchText = el('topic-progress-search')?.value || '';
    renderTopicProgressList(searchText);
}

function renderBadgesManager(currentBadges) {
    const container = el('active-badges-container');
    const selectList = el('badge-select-list');
    const btnAdd = el('btn-add-badge-ui');
    
    if (!container || !selectList || !btnAdd) return;
    
    // أ) تعبئة القائمة المنسدلة (مرة واحدة)
    if (selectList.options.length <= 1) {
        Object.entries(badgesMap).forEach(([key, val]) => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.innerText = val.name || key;
            selectList.appendChild(opt);
        });
    }

    // ب) دالة رسم الشارات (Chips)
    window.tempBadgesList = [...currentBadges];
    
    const redraw = () => {
        container.innerHTML = '';
        el('badges-count').innerText = `${window.tempBadgesList.length} أوسمة`;
        
        if (window.tempBadgesList.length === 0) {
            container.innerHTML = '<span class="text-xs text-slate-600 w-full text-center py-2">لا توجد أوسمة حالياً</span>';
            return;
        }

        window.tempBadgesList.forEach((fullId, idx) => {
            const baseId = fullId.split('_lvl')[0];
            const lvlMatch = fullId.match(/lvl(\d+)/);
            const lvl = lvlMatch ? lvlMatch[1] : '1';
            const badgeName = badgesMap[baseId]?.name || baseId;

            let colorClass = "bg-slate-700 text-slate-200 border-slate-600";
            if(lvl == '3') colorClass = "bg-amber-900/40 text-amber-400 border-amber-500/30";
            if(lvl == '4') colorClass = "bg-cyan-900/40 text-cyan-400 border-cyan-500/30";
            if(lvl == '5') colorClass = "bg-red-900/40 text-red-400 border-red-500/30";

            const chip = document.createElement('div');
            chip.className = `flex items-center gap-2 px-2 py-1 rounded text-xs border ${colorClass} transition hover:scale-105`;
            chip.innerHTML = `
                <span>${badgeName}</span>
                <span class="text-[9px] opacity-70 bg-black/20 px-1 rounded">Lv.${lvl}</span>
                <button type="button" class="hover:text-white text-inherit opacity-60 hover:opacity-100 transition" onclick="removeBadge(${idx})">
                    <span class="material-symbols-rounded text-sm font-bold">close</span>
                </button>
            `;
            container.appendChild(chip);
        });
    };

    // ج) تفعيل زر الإضافة
    btnAdd.onclick = () => {
        const selectedBase = selectList.value;
        const selectedLvl = el('badge-level-select').value;
        
        if (!selectedBase) {
            toast("يرجى اختيار وسام", "warning");
            return;
        }
        
        const newBadgeId = `${selectedBase}_lvl${selectedLvl}`;
        
        if (window.tempBadgesList.includes(newBadgeId)) {
            toast("هذا الوسام مضاف بالفعل", "info");
            return;
        }
        
        window.tempBadgesList = window.tempBadgesList.filter(b => !b.startsWith(selectedBase + '_lvl'));
        window.tempBadgesList.push(newBadgeId);
        redraw();
    };

    window.removeBadge = (index) => {
        window.tempBadgesList.splice(index, 1);
        redraw();
    };

    redraw();
}

// أحداث إدارة المستخدمين
el('btn-refresh-users').onclick = loadUsers; 
el('user-search').oninput = loadUsers;

// ✅ تفاعل حقول الحظر داخل نافذة التعديل
if (el('edit-banned')) el('edit-banned').onchange = updateBanPreviewUI;
if (el('edit-ban-days')) el('edit-ban-days').oninput = updateBanPreviewUI;

// ✅ بحث/تحديث تفاصيل الملف الشخصي داخل نافذة التعديل
if (el('topic-progress-search')) {
    el('topic-progress-search').oninput = () => {
        renderTopicProgressList(el('topic-progress-search').value);
    };
}
if (el('topic-progress-sort')) {
    el('topic-progress-sort').onchange = () => {
        renderTopicProgressList(el('topic-progress-search')?.value || '');
    };
}
if (el('btn-refresh-user-details')) {
    el('btn-refresh-user-details').onclick = async () => {
        if (!currentUserEditId) return;
        try {
            const snap = await getDoc(doc(db, 'users', currentUserEditId));
            if (!snap.exists()) return;
            const u = snap.data();
            window.__currentUserInEditModal = u;
            await renderUserProfileDetails(u);
            toast('تم تحديث تفاصيل الملف', 'sync');
        } catch (e) {
            console.error(e);
            toast('فشل تحديث تفاصيل الملف', 'error');
        }
    };
}

el('btn-save-user').onclick = async () => {
    const btn = el('btn-save-user');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span> جاري التحديث...`;
    btn.disabled = true;

    try {
        if (!currentUserEditId) throw new Error("لم يتم تحديد المستخدم");

        const today = new Date();
        const day = today.getDay(); 
        const diff = (day + 2) % 7; 
        const lastFriday = new Date(today);
        lastFriday.setDate(today.getDate() - diff);
        const currentWeekKey = lastFriday.toISOString().split('T')[0];
        const currentMonthKey = today.toISOString().slice(0, 7); 

        const isBanned = !!el('edit-banned').checked;

        const updates = { 
            username: el('edit-name').value, 
            highScore: parseInt(el('edit-score').value) || 0, 
            isBanned: isBanned,
            "stats.quizzesPlayed": parseInt(el('edit-quizzes-played').value) || 0,
            "stats.totalCorrect": parseInt(el('edit-total-correct').value) || 0,
            "weeklyStats.correct": parseInt(el('edit-weekly-score').value) || 0,
            "weeklyStats.key": currentWeekKey, 
            "monthlyStats.correct": parseInt(el('edit-monthly-score').value) || 0,
            "monthlyStats.key": currentMonthKey,
            badges: window.tempBadgesList || []
        };

        // ✅ تطبيق الحظر بشكل فعلي (سبب + مدة)
        if (isBanned) {
            const reason = (el('edit-ban-reason')?.value || '').trim() || 'غير محدد';
            const days = parseInt(el('edit-ban-days')?.value) || 0;

            updates.banReason = reason;
            updates.banDays = days;

            if (days > 0) {
                updates.banUntil = Timestamp.fromMillis(Date.now() + days * 86400000);
            } else {
                updates.banUntil = deleteField();
            }

            // إذا تم حظر المستخدم الآن لأول مرة (أو إعادة حظره)
            if (!currentUserEditOriginal?.isBanned) {
                updates.banStart = serverTimestamp();
            }
        } else {
            updates.banReason = deleteField();
            updates.banUntil = deleteField();
            updates.banStart = deleteField();
            updates.banDays = deleteField();
        }

        if(el('edit-pass').value.trim() !== "") updates.password = el('edit-pass').value;
        
        if(window.newAvatarBase64 !== undefined) {
            updates.customAvatar = window.newAvatarBase64 === '' ? deleteField() : window.newAvatarBase64;
        }
        
        await updateDoc(doc(db, "users", currentUserEditId), updates);
        
        toast("تم تحديث بيانات المستخدم والإحصائيات ✅");
        window.newAvatarBase64 = undefined;
        closeModal('user-edit-modal');
} catch (error) {
        console.error(error);
        alert("فشل الحفظ: " + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

el('btn-delete-user-permanent').onclick = async () => {
    if (!currentUserEditId) return;
    if (!confirm("⚠️ تحذير خطير!\n\nهل أنت متأكد تماماً من رغبتك في حذف هذا اللاعب نهائياً؟")) return;
    
    const confirmationName = prompt("للتأكيد النهائي، اكتب كلمة (حذف):");
    if (confirmationName !== "حذف") {
        alert("لم يتم الحذف.");
        return;
    }

    const btn = el('btn-delete-user-permanent');
    const originalText = btn.innerHTML;
    btn.innerHTML = "جاري الحذف...";
    btn.disabled = true;

    try {
        await deleteDoc(doc(db, "users", currentUserEditId));
        toast("تم حذف المستخدم نهائياً 🗑️", "delete");
        closeModal('user-edit-modal');
} catch (e) {
        alert("خطأ: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

el('upload-new-avatar').onchange=(e)=>{
const file=e.target.files[0];
if(!file)return;
const reader=new FileReader();
reader.onload=(ev)=>{
const img=new Image();
img.src=ev.target.result;
img.onload=()=>{
const canvas=document.createElement('canvas');
const ctx=canvas.getContext('2d');
const MAX_W=300;
const scale=MAX_W/img.width;
canvas.width=MAX_W;
canvas.height=img.height*scale;
ctx.drawImage(img,0,0,canvas.width,canvas.height);
const compressed=canvas.toDataURL('image/jpeg',0.7);
window.newAvatarBase64=compressed;
el('edit-avatar-preview').innerHTML=`<img src="${compressed}" class="w-full h-full object-cover">`;
show('btn-del-avatar');
};
};
reader.readAsDataURL(file);
};
el('btn-del-avatar').onclick = () => {
    window.newAvatarBase64 = ''; 
    el('edit-avatar-preview').innerHTML = `<span class="material-symbols-rounded text-slate-500 text-4xl">person</span>`;
    hide('btn-del-avatar');
};

// =========================================================
// 6. REPORTS LOGIC
// =========================================================

async function loadReports() {
    const grid = el('reports-grid'); 
    if (!grid) return;
    
    grid.innerHTML = '<div class="col-span-1 lg:col-span-2 text-center text-slate-500 py-8"><span class="material-symbols-rounded spinner text-3xl">sync</span></div>';
    
    try {
        const snap = await getDocs(query(collection(db, "reports"), orderBy("timestamp", "desc")));
        grid.innerHTML = '';
        
        if(snap.empty) { 
            grid.innerHTML = '<div class="col-span-1 lg:col-span-2 text-center text-slate-500 py-8 border border-dashed border-slate-700 rounded-xl">لا توجد بلاغات جديدة 🎉</div>'; 
            return; 
        }
        
        snap.forEach(docSnap => {
            const r = docSnap.data(); 
            const date = r.timestamp ? new Date(r.timestamp.toDate()).toLocaleDateString('ar-EG') : 'غير محدد';
            
            const div = document.createElement('div'); 
            div.className = 'glass p-4 border-l-4 border-l-red-500 relative fade-in rounded-xl';
            div.innerHTML = `
                <div class="flex justify-between items-start mb-3">
                    <div>
                        <span class="text-[10px] text-slate-400 uppercase">بلاغ من: ${r.reportedByUsername || 'مجهول'}</span>
                        <div class="text-red-400 font-bold text-sm mt-1 flex items-center gap-1"><span class="material-symbols-rounded text-sm">calendar_today</span> ${date}</div>
                    </div>
                    <span class="bg-slate-800 text-slate-400 text-[10px] px-2 py-1 rounded font-mono">${docSnap.id.substring(0,6)}</span>
                </div>
                <div class="bg-slate-900/50 p-3 rounded mb-3 border border-slate-700/50">
                    <div class="text-xs text-slate-500 mb-1">السؤال:</div>
                    <p class="text-white text-sm font-bold leading-relaxed">"${r.questionText}"</p>
                    <div class="text-xs text-amber-500 mt-1">الموضوع: ${r.topic}</div>
                </div>
                <div class="grid grid-cols-3 gap-2">
                    <button class="bg-blue-600 hover:bg-blue-700 text-white py-2 rounded text-xs font-bold btn-fix shadow">فحص وتعديل</button>
                    <button class="bg-slate-700 hover:bg-slate-600 text-slate-300 py-2 rounded text-xs font-bold btn-dismiss shadow">تجاهل وحذف</button>
                    <button class="bg-red-900/50 hover:bg-red-900 text-red-400 border border-red-800 py-2 rounded text-xs font-bold btn-nuke-q shadow">حذف السؤال!</button>
                </div>
            `;
            
            div.querySelector('.btn-dismiss').onclick = async () => { 
                if(confirm("حذف البلاغ فقط؟")) { 
                    await deleteDoc(doc(db, "reports", docSnap.id)); 
                    bulkSelectedQIds.delete(d.id);
                    updateBulkActionsBar();
                    div.remove(); 
                    toast("تم حذف البلاغ"); 
                } 
            };
            
            div.querySelector('.btn-nuke-q').onclick = async () => { 
                if(confirm("حذف السؤال والبلاغ نهائياً؟")) { 
                    try { 
                        if(r.questionId && r.questionId !== 'N/A') {
                            await deleteDoc(doc(db, "questions", r.questionId));
                        }
                        await deleteDoc(doc(db, "reports", docSnap.id)); 
                        div.remove(); 
                        toast("تم حذف السؤال والبلاغ", "delete"); 
                    } catch(e) { 
                        alert(e.message); 
                    } 
                } 
            };
            
            div.querySelector('.btn-fix').onclick = async () => { 
                if(!r.questionId || r.questionId === 'N/A') {
                    alert("لا يوجد معرف للسؤال");
                    return;
                }
                
                const btn = div.querySelector('.btn-fix'); 
                btn.innerText = "جاري الجلب..."; 
                
                try { 
                    const qDoc = await getDoc(doc(db, "questions", r.questionId)); 
                    if(qDoc.exists()) { 
                        openEditQModal(r.questionId, qDoc.data()); 
                    } else { 
                        alert("السؤال محذوف مسبقاً."); 
                    } 
                } catch(e) { 
                    alert("خطأ: " + e.message); 
                } 
                
                btn.innerText = "فحص وتعديل"; 
            };
            
            grid.appendChild(div);
        });
    } catch(e) { 
        console.error(e); 
        toast("خطأ في تحميل البلاغات", "error");
    }
}

el('btn-refresh-reports').onclick = loadReports;

// =========================================================
// 7. CONTENT MANAGEMENT
// =========================================================

const checkBtn = () => {
    const expCat = el('export-cat');
    const btnExp = el('btn-export-filtered');
    if(btnExp) btnExp.disabled = !expCat || !expCat.value;

    const delTopic = el('delete-topic');
    const btnDel = el('btn-delete-filtered');
    if(btnDel) btnDel.disabled = !delTopic || !delTopic.value;
};

// تهيئة جميع القوائم المنسدلة
initDrops('upload-cat', 'upload-topic'); 
initDrops('man-cat', 'man-topic'); 
initDrops('paste-cat', 'paste-topic'); 
initDrops('edit-q-cat', 'edit-q-topic'); 
initDrops('export-cat', 'export-topic', checkBtn);
initDrops('delete-cat', 'delete-topic', checkBtn);

el('export-diff').onchange = checkBtn;
el('delete-diff').onchange = checkBtn;

el('btn-man-save').onclick = async () => {
    const q = el('man-q').value, topic = el('man-topic').value;
    if(!q || !topic) {
        toast("بيانات ناقصة (السؤال والموضوع)", "warning");
        return;
    }
    
    const ansIdx = Array.from(document.getElementsByName('correct_ans_selector')).findIndex(r => r.checked);
    
    try {
        await addDoc(collection(db, "questions"), { 
            question: q, 
            options: [el('man-o1').value, el('man-o2').value, el('man-o3').value, el('man-o4').value], 
            correctAnswer: ansIdx, 
            explanation: el('man-exp').value, 
            topic: topic, 
            difficulty: el('man-diff').value, 
            isReviewed: false, 
            createdAt: serverTimestamp() 
        });
        
        toast("تمت الإضافة بنجاح"); 
        el('man-q').value='';
        el('man-o1').value='';
        el('man-o2').value='';
        el('man-o3').value='';
        el('man-o4').value='';
        el('man-exp').value='';
    } catch (error) {
        console.error(error);
        toast("خطأ في إضافة السؤال", "error");
    }
};

el('btn-upload-file').onclick = () => {
    const btn = el('btn-upload-file'); 
    const f = el('json-file-input').files[0];
    const t = el('upload-topic').value;
    
    if(!f || !t) {
        toast("اختر ملف وموضوع", "warning");
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-rounded spinner text-sm">sync</span> جاري الرفع...`;
    btn.disabled = true;

    const r = new FileReader(); 
    r.onload = async (e) => { 
        try { 
            const d = JSON.parse(e.target.result); 
            if (!Array.isArray(d)) throw new Error("الملف لا يحتوي على مصفوفة JSON صالحة.");
            
            let c = 0; 
            const batch = writeBatch(db);
            
            for(let q of d) { 
                if(q.question) { 
                    const newDocRef = doc(collection(db, "questions"));
                    batch.set(newDocRef, {
                        ...q, 
                        topic: t, 
                        difficulty: q.difficulty || 'متوسط',
                        isReviewed: q.isReviewed || false, 
                        createdAt: serverTimestamp()
                    }); 
                    c++; 
                } 
            } 

            if (c > 0) await batch.commit();
            
            toast(`تم رفع ${c} سؤال بنجاح ✅`); 
            isCacheLoaded = false;
            loadStats(); 
            el('json-file-input').value = ''; 

        } catch(x){ 
            alert("خطأ في تحليل ملف JSON: " + x.message); 
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }; 
    r.readAsText(f);
};

el('btn-paste-upload').onclick = async () => {
    const btn = el('btn-paste-upload'); 
    const txt = el('json-paste-area').value;
    const t = el('paste-topic').value;
    
    if(!txt || !t) {
        toast("أدخل النص واختر الموضوع", "warning");
        return;
    }
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-rounded spinner text-sm">sync</span> جاري المعالجة...`;
    btn.disabled = true;
    
    try { 
        const d = JSON.parse(txt); 
        if (!Array.isArray(d)) throw new Error("الملف لا يحتوي على مصفوفة JSON صالحة.");
        
        let c = 0; 
        const batch = writeBatch(db); 
        
        for(let q of d) { 
            if(q.question) { 
                const newDocRef = doc(collection(db, "questions"));
                batch.set(newDocRef, {
                    ...q, 
                    topic: t, 
                    difficulty: q.difficulty || 'متوسط',
                    isReviewed: q.isReviewed || false, 
                    createdAt: serverTimestamp()
                }); 
                c++; 
            } 
        } 
        
        if (c > 0) {
            await batch.commit();
        }
        
        toast(`تمت إضافة ${c} سؤال بنجاح ✅`); 
        el('json-paste-area').value=''; 
        isCacheLoaded = false; 
        loadStats(); 

    } catch(x){ 
        console.error(x);
        alert("خطأ في تحليل كود JSON: " + x.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// =========================================================
// 8. QUESTION MANAGEMENT
// =========================================================

async function fetchAllForSearch() {
     const loader = el('q-loader');
     if(loader) loader.innerHTML = '<span class="material-symbols-rounded spinner text-3xl">cloud_download</span><p class="text-xs mt-2">جاري تحميل الأرشيف الكامل للبحث...</p>';
     
     try {
        const qSnap = await getDocs(query(collection(db, "questions"), orderBy("createdAt", "desc")));
        allQuestionsCache = [];
        qSnap.forEach(doc => allQuestionsCache.push({ id: doc.id, ...doc.data() }));
        isCacheLoaded = true;
        return true;
     } catch(e) { 
         console.error(e); 
         return false; 
     }
}

let searchTimeout;

// ✅ تحديد/إجراءات جماعية في بنك الأسئلة
let bulkSelectedQIds = new Set();

function updateBulkActionsBar() {
    const bar = el('bulk-actions-bar');
    const countEl = el('bulk-selected-count');
    const selectAllEl = el('bulk-select-all');

    const grid = el('questions-grid');
    const visibleCheckboxes = grid ? Array.from(grid.querySelectorAll('.bulk-q-checkbox')) : [];

    const count = bulkSelectedQIds.size;
    if (countEl) countEl.textContent = String(count);

    if (bar) bar.classList.toggle('hidden', count === 0);

    if (selectAllEl) {
        if (visibleCheckboxes.length === 0) {
            selectAllEl.checked = false;
            selectAllEl.indeterminate = false;
        } else {
            const checkedCount = visibleCheckboxes.filter(cb => cb.checked).length;
            selectAllEl.checked = checkedCount > 0 && checkedCount === visibleCheckboxes.length;
            selectAllEl.indeterminate = checkedCount > 0 && checkedCount < visibleCheckboxes.length;
        }
    }
}

function clearBulkSelection() {
    bulkSelectedQIds.clear();
    // sync UI
    document.querySelectorAll('.bulk-q-checkbox').forEach(cb => cb.checked = false);
    updateBulkActionsBar();
}

async function bulkApproveSelected() {
    if (bulkSelectedQIds.size === 0) return;
    const ok = confirm(`اعتماد ${bulkSelectedQIds.size} سؤال/أسئلة؟`);
    if (!ok) return;

    const batch = writeBatch(db);
    bulkSelectedQIds.forEach((qid) => {
        batch.update(doc(db, 'questions', qid), { isReviewed: true });
    });

    await batch.commit();
    toast(`تم اعتماد ${bulkSelectedQIds.size} سؤال/أسئلة`);
    clearBulkSelection();
    loadQuestions(); // إعادة تحميل لإظهار الحالة
}

async function bulkDeleteSelected() {
    if (bulkSelectedQIds.size === 0) return;
    const ok = confirm(`حذف ${bulkSelectedQIds.size} سؤال/أسئلة نهائياً؟ لا يمكن التراجع.`);
    if (!ok) return;

    const batch = writeBatch(db);
    bulkSelectedQIds.forEach((qid) => {
        batch.delete(doc(db, 'questions', qid));
    });

    await batch.commit();
    toast(`تم حذف ${bulkSelectedQIds.size} سؤال/أسئلة`);
    clearBulkSelection();
    loadQuestions();
}

function setupQuestionBulkActions() {
    const selectAllEl = el('bulk-select-all');
    if (selectAllEl) {
        selectAllEl.addEventListener('change', () => {
            const grid = el('questions-grid');
            const visibleCheckboxes = grid ? Array.from(grid.querySelectorAll('.bulk-q-checkbox')) : [];
            visibleCheckboxes.forEach(cb => {
                cb.checked = selectAllEl.checked;
                const qid = cb.dataset.qid;
                if (!qid) return;
                if (cb.checked) bulkSelectedQIds.add(qid);
                else bulkSelectedQIds.delete(qid);
            });
            updateBulkActionsBar();
        });
    }

    const btnApprove = el('btn-bulk-approve');
    if (btnApprove) btnApprove.addEventListener('click', bulkApproveSelected);

    const btnDelete = el('btn-bulk-delete');
    if (btnDelete) btnDelete.addEventListener('click', bulkDeleteSelected);

    const btnClear = el('btn-bulk-clear');
    if (btnClear) btnClear.addEventListener('click', clearBulkSelection);
}
el('qs-search-input').oninput=function(){
clearTimeout(searchTimeout);
const self=this;
const grid=el('questions-grid');
const loadBtn=el('btn-load-more');
if(grid&&self.value.trim()!==""){grid.style.opacity='0.5';}
searchTimeout=setTimeout(async()=>{
const term=self.value.trim().toLowerCase();
if(term===""){
grid.style.opacity='1';
loadQuestions(false);
return;
}
if(!isCacheLoaded){
grid.innerHTML='<div id="q-loader" class="text-center py-12 text-slate-500"><span class="material-symbols-rounded spinner text-3xl">sync</span></div>';
await fetchAllForSearch();
}
const results=allQuestionsCache.filter(q=>{
const qText=(q.question||"").toLowerCase();
const expText=(q.explanation||"").toLowerCase();
const optText=(q.options||[]).join(" ").toLowerCase();
return qText.includes(term)||expText.includes(term)||optText.includes(term)||q.id.toLowerCase().includes(term);
});
grid.innerHTML='';
clearBulkSelection();
grid.style.opacity='1';
loadBtn.classList.add('hidden');
el('qs-counter').innerText=results.length;
if(results.length===0){
grid.innerHTML='<div class="text-center py-8 text-slate-500 bg-slate-800/20 rounded border border-slate-700/50">لا توجد نتائج مطابقة</div>';
return;
}
results.slice(0,100).forEach(d=>renderQuestionCard(d,grid));
updateBulkActionsBar();
if(results.length>100){
grid.innerHTML+=`<div class="text-center text-xs text-slate-500 py-2 border-t border-slate-700/30 mt-2">تم عرض 100 نتيجة من أصل ${results.length}</div>`;
}
},500);
};

el('btn-load-more').onclick = () => loadQuestions(true);
el('btn-refresh-qs').onclick = () => loadQuestions(false);
setupQuestionBulkActions();

async function loadQuestions(loadMore = false) {
    if (el('qs-search-input').value.trim() !== "") return;
    if (isFetchingQs) return;

    const grid = el('questions-grid');
    const loadBtn = el('btn-load-more');
    const statusVal = el('manage-status-filter').value;
    const topicVal = el('manage-topic-filter').value;

    const DISPLAY_LIMIT = 100;
    const FETCH_BATCH = (statusVal === 'unreviewed') ? 300 : 100;

    if (!loadMore) {
        grid.innerHTML = '';
        lastVisible = null;
        clearBulkSelection();
        el('qs-counter').innerText = '0';
        loadBtn.classList.add('hidden');
        grid.innerHTML = '<div id="q-loader" class="text-center py-12 text-slate-500"><span class="material-symbols-rounded spinner text-3xl">sync</span><p class="text-xs mt-2">جاري جلب البيانات...</p></div>';
    } else {
        loadBtn.innerHTML = '<span class="material-symbols-rounded spinner text-sm">sync</span> جاري التحميل...';
    }

    isFetchingQs = true;

    try {
        // بناء القيود الأساسية (بدون isReviewed) — لأن بعض الأسئلة القديمة قد لا تحتوي الحقل
        let baseConstraints = [];
        let needClientFilterUnreviewed = false;

        if (statusVal === 'unreviewed') {
            needClientFilterUnreviewed = true; // سنعتبر أي سؤال ليس isReviewed === true على أنه غير مُراجع
        } else if (statusVal === 'uncategorized') {
            baseConstraints.push(where("topic", "==", "غير مصنف"));
        }

        if (topicVal) {
            baseConstraints.push(where("topic", "==", topicVal));
        }

        baseConstraints.push(orderBy("createdAt", "desc"));

        let collected = [];
        let cursor = (loadMore && lastVisible) ? lastVisible : null;
        let hasMore = false;
        let loops = 0;

        while (collected.length < DISPLAY_LIMIT) {
            let constraints = [...baseConstraints];
            if (cursor) constraints.push(startAfter(cursor));
            constraints.push(limit(FETCH_BATCH));

            const q = query(collection(db, "questions"), ...constraints);
            const snapshot = await getDocs(q);

            const loader = el('q-loader');
            if (loader) loader.remove();

            if (snapshot.empty) {
                hasMore = false;
                break;
            }

            cursor = snapshot.docs[snapshot.docs.length - 1];
            hasMore = snapshot.docs.length === FETCH_BATCH;

            let batch = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
            if (needClientFilterUnreviewed) {
                batch = batch.filter(d => d.isReviewed !== true);
            }

            collected.push(...batch);

            // في حالة غير (غير مُراجع) نكتفي بصفحة واحدة فقط
            if (!needClientFilterUnreviewed) break;

            // حماية من حلقات طويلة
            loops++;
            if (!hasMore || loops > 10) break;
        }

        const toRender = collected.slice(0, DISPLAY_LIMIT);

        if (toRender.length === 0) {
            if (!loadMore) {
                grid.innerHTML = '<div class="text-center py-8 text-slate-500 bg-slate-800/20 rounded border border-slate-700/50">لا توجد نتائج</div>';
            }
            loadBtn.classList.add('hidden');
        } else {
            // تحديث المؤشر للمزيد
            lastVisible = cursor;

            toRender.forEach(d => renderQuestionCard(d, grid));
            el('qs-counter').innerText = document.querySelectorAll('#questions-grid .admin-item').length;

            // زر المزيد
            if (hasMore) {
                loadBtn.classList.remove('hidden');
                loadBtn.innerHTML = 'تحميل المزيد (100+)';
            } else {
                loadBtn.classList.add('hidden');
            }
        }
    } catch (e) {
        console.error(e);
        toast("خطأ في تحميل الأسئلة: " + e.message, "error");
        loadBtn.classList.add('hidden');
    }

    isFetchingQs = false;
}

window.openEditQModal = (id, data) => {
    window.currQId = id; 
    window.currQStatus = data.isReviewed || false;
    
    el('edit-q-text').value = data.question; 
    el('edit-o1').value = data.options[0] || ''; 
    el('edit-o2').value = data.options[1] || ''; 
    el('edit-o3').value = data.options[2] || ''; 
    el('edit-o4').value = data.options[3] || ''; 
    el('edit-q-exp').value = data.explanation || ""; 
    el('edit-q-diff').value = data.difficulty || "متوسط";
    
    const radioButtons = document.getElementsByName('edit_ans_selector');
    if(radioButtons[data.correctAnswer]) {
        radioButtons[data.correctAnswer].checked = true;
    }

    let catFound = ""; 
    for(let c in topics) {
        if(topics[c].includes(data.topic)) { 
            catFound = c; 
            break; 
        } 
    } 
    
    if(catFound) { 
        el('edit-q-cat').value = catFound; 
        el('edit-q-cat').dispatchEvent(new Event('change')); 
        el('edit-q-topic').value = data.topic; 
    }

    const revBtn = el('btn-modal-toggle-review'); 
    if(window.currQStatus) { 
        revBtn.innerText = "✅ معتمد (اضغط للإلغاء)"; 
        revBtn.className = "flex-1 border border-green-500 bg-green-900/20 text-green-400 rounded-lg transition font-bold"; 
    } else { 
        revBtn.innerText = "⏳ قيد المراجعة (اضغط للاعتماد)"; 
        revBtn.className = "flex-1 border border-amber-500 bg-amber-900/20 text-amber-400 rounded-lg transition font-bold"; 
    }
    
    el('question-edit-modal').classList.add('active', 'flex');
    el('question-edit-modal').classList.remove('hidden');
};

el('btn-modal-toggle-review').onclick = async () => {
    if (!window.currQId) return;
    
    const newStatus = !window.currQStatus;
    
    try {
        await updateDoc(doc(db, "questions", window.currQId), { isReviewed: newStatus });
        window.currQStatus = newStatus;
        
        el('question-edit-modal').classList.remove('active', 'flex'); 
        el('question-edit-modal').classList.add('hidden');
        
        toast(newStatus ? "تم الاعتماد" : "تم إلغاء الاعتماد");
        loadQuestions(false);
    } catch (error) {
        console.error(error);
        toast("خطأ في تغيير حالة المراجعة", "error");
    }
};

el('btn-save-edit-q').onclick = async () => {
    const btn = el('btn-save-edit-q');
    if (!btn || !window.currQId) return;
    
    const originalText = btn.innerText;
    btn.innerText = "جاري الحفظ...";
    btn.disabled = true;

    try {
        const ansIdx = Array.from(document.getElementsByName('edit_ans_selector')).findIndex(r => r.checked);
        
        if(ansIdx === -1) throw new Error("يرجى تحديد الإجابة الصحيحة");
        if(!el('edit-q-text').value) throw new Error("نص السؤال فارغ");

        await updateDoc(doc(db, "questions", window.currQId), { 
            question: el('edit-q-text').value, 
            options: [el('edit-o1').value, el('edit-o2').value, el('edit-o3').value, el('edit-o4').value], 
            correctAnswer: ansIdx, 
            explanation: el('edit-q-exp').value, 
            topic: el('edit-q-topic').value, 
            difficulty: el('edit-q-diff').value 
        }); 

        toast("تم تعديل السؤال بنجاح ✅"); 
        el('question-edit-modal').classList.remove('active', 'flex'); 
        el('question-edit-modal').classList.add('hidden');
        loadQuestions(false); 

    } catch (e) {
        console.error(e);
        alert("حدث خطأ أثناء حفظ السؤال:\n" + e.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

function renderQuestionCard(d, container) {
    const div = document.createElement('div');
    div.id = `q-row-${d.id}`;
    const isReviewed = d.isReviewed === true;
    const borderClass = isReviewed ? 'border-slate-700/50' : 'border-amber-500/50 border-dashed';
    const bgClass = isReviewed ? 'bg-slate-800/40' : 'bg-amber-900/10';
    
    div.className = `admin-item ${bgClass} ${borderClass} fade-in relative transition-all duration-300 group p-0 overflow-visible`;

    const correctIdx = d.correctAnswer !== undefined ? d.correctAnswer : -1;

    let optionsHtml = '<div class="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">';
    d.options.forEach((opt, i) => {
        const isCorrect = i === correctIdx;
        const activeClass = isCorrect ? 'border-green-500/50 bg-green-900/10' : 'border-slate-700/50 bg-slate-900/30';
        optionsHtml += `
            <div class="flex items-center gap-2 p-1.5 rounded border ${activeClass} transition-colors focus-within:border-blue-500">
                <input type="radio" name="rad-${d.id}" value="${i}" ${isCorrect ? 'checked' : ''} class="accent-green-500 w-4 h-4 cursor-pointer shrink-0">
                <input type="text" id="inline-opt-${d.id}-${i}" class="bg-transparent text-xs text-slate-300 w-full outline-none focus:text-white font-mono" value="${opt || ''}" placeholder="الخيار ${i+1}">
            </div>
        `;
    });
    optionsHtml += '</div>';

    const statusBadge = isReviewed 
        ? `<span class="text-[10px] text-green-400 bg-green-900/20 px-2 py-0.5 rounded-full border border-green-500/30 flex items-center gap-1"><span class="material-symbols-rounded text-sm">verified</span> معتمد</span>`
        : `<span class="text-[10px] text-amber-500 bg-amber-900/20 px-2 py-0.5 rounded-full border border-amber-500/30 flex items-center gap-1"><span class="material-symbols-rounded text-sm">hourglass_empty</span> مراجعة</span>`;

    div.innerHTML = `
        <div class="flex justify-between items-center bg-slate-900/30 p-2 border-b border-slate-700/50 rounded-t-xl">
            <div class="flex items-center gap-2">
                <label class="flex items-center gap-2 bg-slate-800/40 border border-slate-700/40 rounded-lg px-2 py-1">
                    <input type="checkbox" class="bulk-q-checkbox w-4 h-4 accent-amber-500" data-qid="${d.id}">
                    <span class="text-[10px] text-slate-300 font-bold hidden sm:inline">تحديد</span>
                </label>
                ${statusBadge}
                <span class="text-[10px] text-slate-500 bg-slate-900 px-2 py-0.5 rounded border border-slate-700">${d.topic}</span>
                <span class="text-[10px] text-slate-600 font-mono hidden md:inline">${d.id}</span>
            </div>
            <button class="text-slate-500 hover:text-white transition btn-advanced-edit" title="تعديل التصنيف والمتقدم">
                <span class="material-symbols-rounded text-lg">settings</span>
            </button>
        </div>

        <div class="p-3">
            <div class="mb-3">
                <input type="text" id="inline-q-${d.id}" class="w-full bg-transparent text-white font-bold text-sm border-b border-slate-700 focus:border-amber-500 outline-none pb-1 transition-colors" value="${d.question}" placeholder="نص السؤال...">
            </div>
            ${optionsHtml}
            <div class="relative">
                <span class="absolute right-2 top-2 text-[10px] text-slate-500 select-none">💡 إثراء</span>
                <textarea id="inline-exp-${d.id}" class="w-full bg-slate-900/50 text-xs text-blue-200 border border-slate-700/50 rounded p-2 pt-6 outline-none focus:border-blue-500 min-h-[60px] resize-y" placeholder="معلومة إثرائية تظهر بعد الإجابة...">${d.explanation || ''}</textarea>
            </div>
        </div>

        <div class="flex flex-wrap gap-2 justify-end border-t border-slate-700/50 p-2 bg-slate-900/20 rounded-b-xl">
            <button class="text-xs text-indigo-400 hover:bg-indigo-900/20 px-3 py-1.5 rounded transition flex items-center gap-1 btn-ai-check border border-indigo-500/20">
                <span id="ai-icon-${d.id}" class="material-symbols-rounded text-sm">smart_toy</span> 
                <span id="ai-text-${d.id}">فحص AI</span>
            </button>
            
            <div class="w-[1px] h-6 bg-slate-700 mx-1"></div> 

            <button class="text-xs ${isReviewed ? 'text-slate-400' : 'text-green-400'} hover:bg-slate-700 px-3 py-1.5 rounded transition flex items-center gap-1 btn-toggle-review opacity-70 hover:opacity-100">
                <span class="material-symbols-rounded text-sm">${isReviewed ? 'unpublished' : 'check_circle'}</span> ${isReviewed ? 'إلغاء' : 'اعتماد'}
            </button>
            <button class="text-xs text-red-400 hover:bg-red-900/20 px-3 py-1.5 rounded transition flex items-center gap-1 btn-del-q opacity-70 hover:opacity-100"><span class="material-symbols-rounded text-sm">delete</span> حذف</button>
            
            <button class="text-xs text-white bg-blue-600 hover:bg-blue-500 px-4 py-1.5 rounded shadow-lg transition flex items-center gap-1 btn-quick-save font-bold mr-auto md:mr-0">
                <span class="material-symbols-rounded text-sm">save</span> حفظ
            </button>
        </div>
    `;

    // ربط تحديد السؤال (جماعي)
    const bulkCb = div.querySelector('.bulk-q-checkbox');
    if (bulkCb) {
        bulkCb.checked = bulkSelectedQIds.has(d.id);
        bulkCb.addEventListener('change', () => {
            const qid = bulkCb.dataset.qid;
            if (!qid) return;
            if (bulkCb.checked) bulkSelectedQIds.add(qid);
            else bulkSelectedQIds.delete(qid);
            updateBulkActionsBar();
        });
    }
    updateBulkActionsBar();

    div.querySelector('.btn-quick-save').onclick = async () => {
        const btn = div.querySelector('.btn-quick-save');
        const originalText = '<span class="material-symbols-rounded text-sm">save</span> حفظ';
        
        const qInput = document.getElementById(`inline-q-${d.id}`);
        const expInput = document.getElementById(`inline-exp-${d.id}`);
        const optInputs = [
            document.getElementById(`inline-opt-${d.id}-0`),
            document.getElementById(`inline-opt-${d.id}-1`),
            document.getElementById(`inline-opt-${d.id}-2`),
            document.getElementById(`inline-opt-${d.id}-3`)
        ];
        
        const checkedRadio = div.querySelector(`input[name="rad-${d.id}"]:checked`);
        
        const newQ = qInput ? qInput.value.trim() : d.question;
        const newExp = expInput ? expInput.value.trim() : "";
        const newOptions = optInputs.map(input => input ? input.value.trim() : "");
        const newCorrect = checkedRadio ? parseInt(checkedRadio.value) : (d.correctAnswer || 0);

        if(!newQ || !newOptions[0] || !newOptions[1]) {
            toast("يرجى ملء السؤال والخيارات الأساسية", "warning");
            return;
        }

        btn.innerHTML = '<span class="material-symbols-rounded spinner text-sm">sync</span>';
        btn.disabled = true;

        try {
            await updateDoc(doc(db, "questions", d.id), {
                question: newQ,
                options: newOptions,
                correctAnswer: newCorrect,
                explanation: newExp
            });

            d.question = newQ;
            d.options = newOptions;
            d.correctAnswer = newCorrect;
            d.explanation = newExp;

            toast("تم حفظ التعديلات في قاعدة البيانات ✅", "save");
            div.classList.add('ring-2', 'ring-blue-500');
            setTimeout(() => div.classList.remove('ring-2', 'ring-blue-500'), 1000);

        } catch(e) {
            console.error("Save Error:", e);
            toast("فشل الحفظ: " + e.message, "error");
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    };

    div.querySelector('.btn-ai-check').onclick = () => checkQuestionWithAI(d);

    div.querySelector('.btn-del-q').onclick = async () => { 
        if(confirm("حذف السؤال نهائياً؟")) { 
            await deleteDoc(doc(db,"questions",d.id)); 
            bulkSelectedQIds.delete(d.id);
            updateBulkActionsBar();
            div.remove(); 
            toast("تم الحذف","delete"); 
        } 
    };
    
    div.querySelector('.btn-toggle-review').onclick = async () => {
        const btn = div.querySelector('.btn-toggle-review');
        btn.innerHTML = '...'; 
        
        const newStatus = !d.isReviewed;
        
        try {
            await updateDoc(doc(db, "questions", d.id), { isReviewed: newStatus });
            d.isReviewed = newStatus;
            
            const currentFilter = document.getElementById('manage-status-filter').value;
            
            if (currentFilter === 'unreviewed' && newStatus === true) {
                div.style.transition = "all 0.5s ease";
                div.style.opacity = '0';
                div.style.transform = 'translateX(-50px)';
                setTimeout(() => {
                    div.remove();
                    const countEl = document.getElementById('qs-counter');
                    if(countEl) countEl.innerText = document.querySelectorAll('#questions-grid .admin-item').length;
                    toast("تم الاعتماد وإزالة السؤال من القائمة 🚀");
                }, 500);
            } else {
                const newDiv = renderQuestionCard(d, container);
                const oldDiv = document.getElementById(`q-row-${d.id}`);
                if(oldDiv && newDiv !== oldDiv) oldDiv.replaceWith(newDiv);
                toast(newStatus ? "تم الاعتماد" : "تم إلغاء الاعتماد");
            }
        } catch (error) {
            console.error(error);
            toast("خطأ في تغيير حالة المراجعة", "error");
        }
    };

    div.querySelector('.btn-advanced-edit').onclick = () => window.openEditQModal(d.id, d);

    container.appendChild(div);
    return div;
}

// =========================================================
// 9. AI SETTINGS & ANALYSIS
// =========================================================

function loadAISettings() {
    const key = localStorage.getItem('gemini_api_key');
    const model = localStorage.getItem('gemini_model');
    const prompt = localStorage.getItem('gemini_custom_prompt');

    if(el('ai-api-key')) el('ai-api-key').value = key || '';
    if(el('ai-model-name')) el('ai-model-name').value = model || 'gemini-1.5-flash';
    if(el('ai-custom-prompt')) el('ai-custom-prompt').value = prompt || '';
}

function setupAI() {
    const saveBtn = el('btn-save-ai-settings');
    
    if (!saveBtn) {
        console.error("Save AI Button not found in DOM!");
        return;
    }

    saveBtn.onclick = () => {
        const key = el('ai-api-key')?.value.trim();
        const model = el('ai-model-name')?.value.trim();
        const prompt = el('ai-custom-prompt')?.value.trim();

        if(!key) {
            toast("يرجى إدخال مفتاح API", "warning");
            return;
        }

        try {
            localStorage.setItem('gemini_api_key', key);
            localStorage.setItem('gemini_model', model || 'gemini-1.5-flash');
            localStorage.setItem('gemini_custom_prompt', prompt || '');
            
            toast("تم حفظ إعدادات AI بنجاح ✅");
        } catch (e) {
            console.error("Storage Error:", e);
            alert("تعذر الحفظ في المتصفح: " + e.message);
        }
    };
}

async function checkQuestionWithAI(questionData) {
    if (!window.GoogleGenerativeAI) {
        toast("مكتبة الذكاء الاصطناعي غير محملة!", "error");
        return;
    }

    const apiKey = localStorage.getItem('gemini_api_key');
    const modelName = localStorage.getItem('gemini_model') || "gemini-1.5-flash";
    const customInstructions = localStorage.getItem('gemini_custom_prompt') || "";

    if (!apiKey) {
        toast("يرجى ضبط مفتاح API من إعدادات AI أولاً", "settings");
        triggerTab('view-ai-settings');
        return;
    }

    const btnIcon = document.getElementById(`ai-icon-${questionData.id}`);
    const btnText = document.getElementById(`ai-text-${questionData.id}`);
    
    if(btnIcon) btnIcon.innerText = "hourglass_top";
    if(btnText) btnText.innerText = "جاري التحليل...";

    try {
        const genAI = new window.GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: modelName });

        const prompt = `
            بصفتك باحثاً ومحققاً لغوياً في التراث الإسلامي الشيعي وخبير انشاء مسابقات دينية.
            
            المهمة: تدقيق وتحسين سؤال لمسابقة ثقافية دينية.
            
            الضوابط الصارمة:
            1. المصادر: الاعتماد على المصادر الشيعية المعتبرة.
            2. الأسلوب: لغة عربية فصحى، رصينة، ومؤدبة.
            ${customInstructions ? `3. تعليمات إضافية هامة: ${customInstructions}` : ''}

            --- بيانات السؤال الحالية ---
            - نص السؤال: "${questionData.question}"
            - الخيارات: [${questionData.options.join(' - ')}]
            - الإجابة الصحيحة الحالية: "${questionData.options[questionData.correctAnswer]}"
            - الشرح الحالي: "${questionData.explanation || ''}"
            ---------------------

            المطلوب منك إخراج ناتج بصيغة JSON فقط (بدون أي نصوص markdown) يحتوي على:
            {
                "status": "سليم" | "ركيك" | "يحتوي خطأ" | "مبهم",
                "correction": "نص السؤال المحسن",
                "suggested_explanation": "شرح إثرائي دقيق وجذاب",
                "feedback": "سبب التعديل والنصيحة",
                "suggested_options": ["خيار خاطئ 1", "خيار خاطئ 2", "خيار خاطئ 3"]
            }
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        const cleanJson = text.replace(/```json|```/g, '').trim();
        const analysis = JSON.parse(cleanJson);

        showAIResultModal(analysis, questionData);

    } catch (error) {
        console.error("AI Error:", error);
        if (error.message.includes('404')) {
            toast("موديل الذكاء الاصطناعي غير صحيح", "error");
        } else if (error.message.includes('400') || error.message.includes('Key')) {
            toast("مفتاح API غير صالح", "error");
        } else {
            toast("خطأ: " + error.message.substring(0, 30), "error");
        }
    } finally {
        if(btnIcon) btnIcon.innerText = "smart_toy";
        if(btnText) btnText.innerText = "فحص AI";
    }
}

function showAIResultModal(analysis, qData) { 
    const modal = document.getElementById('ai-modal');
    const statusBadge = document.getElementById('ai-status-badge');
    const feedbackText = document.getElementById('ai-feedback-text');
    const suggestQ = document.getElementById('ai-suggested-q');
    const suggestExp = document.getElementById('ai-suggested-exp');
    const applyBtn = document.getElementById('btn-apply-ai-fix');
    const correctionSection = document.getElementById('ai-correction-section');
    
    if (!modal || !statusBadge || !feedbackText || !suggestQ || !suggestExp || !applyBtn || !correctionSection) {
        console.error("AI modal elements not found");
        return;
    }

    // 1. تعبئة البيانات
    feedbackText.innerText = analysis.feedback;
    suggestQ.value = analysis.correction || qData.question;
    suggestExp.value = analysis.suggested_explanation || qData.explanation || "";

    // 2. معالجة الخيارات المقترحة
    const optionsList = document.getElementById('ai-options-list');
    const btnUseOptions = document.getElementById('btn-use-options');
    
    if (analysis.suggested_options && analysis.suggested_options.length > 0) {
        const optionsSection = document.getElementById('ai-options-section');
        if (optionsSection) {
            optionsSection.classList.remove('hidden');
            if (optionsList) {
                optionsList.innerHTML = analysis.suggested_options.map(opt => 
                    `<div class="bg-slate-800 p-2 rounded border border-slate-700 text-center truncate" title="${opt}">${opt}</div>`
                ).join('');
            }
            
            if (btnUseOptions) {
                btnUseOptions.onclick = () => {
                    const currentCorrect = qData.options[qData.correctAnswer];
                    const inputCorrect = document.getElementById(`inline-opt-${qData.id}-${qData.correctAnswer}`);
                    if(inputCorrect) inputCorrect.value = currentCorrect;

                    let distractorIndex = 0;
                    for(let i=0; i<4; i++) {
                        if(i !== qData.correctAnswer && analysis.suggested_options[distractorIndex]) {
                            const inputWrong = document.getElementById(`inline-opt-${qData.id}-${i}`);
                            if(inputWrong) {
                                inputWrong.value = analysis.suggested_options[distractorIndex];
                                inputWrong.parentElement.classList.add('ring-2', 'ring-purple-500/50');
                                setTimeout(()=> inputWrong.parentElement.classList.remove('ring-2', 'ring-purple-500/50'), 1000);
                            }
                            distractorIndex++;
                        }
                    }
                    toast("تم تعبئة الخيارات (اضغط حفظ لتثبيتها)", "check_circle");
                };
            }
        }
    }

    // 3. ضبط الحالة والألوان
    if (analysis.status.includes("سليم") || analysis.status.includes("Sound")) {
        statusBadge.className = "px-4 py-1 rounded-full text-sm font-bold border flex items-center gap-2 bg-green-900/20 text-green-400 border-green-500/50";
        statusBadge.innerHTML = `<span class="material-symbols-rounded text-base">check_circle</span> تقييم السؤال: ${analysis.status}`;
    } else {
        statusBadge.className = "px-4 py-1 rounded-full text-sm font-bold border flex items-center gap-2 bg-amber-900/20 text-amber-500 border-amber-500/50";
        statusBadge.innerHTML = `<span class="material-symbols-rounded text-base">warning</span> ملاحظة: ${analysis.status}`;
    }

    correctionSection.classList.remove('hidden');
    const correctionLabel = correctionSection.querySelector('h4');
    if(correctionLabel) correctionLabel.innerHTML = '✨ الصياغة البلاغية المقترحة:';

    // 4. برمجة زر التطبيق
    applyBtn.onclick = async () => {
        const originalText = applyBtn.innerHTML;
        applyBtn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span> جاري الحفظ...`;
        applyBtn.disabled = true;

        try {
            const newQ = suggestQ.value;
            const newExp = suggestExp.value;

            await updateDoc(doc(db, "questions", qData.id), { 
                question: newQ,
                explanation: newExp
            });

            const qInput = document.getElementById(`inline-q-${qData.id}`);
            const expInput = document.getElementById(`inline-exp-${qData.id}`);

            if (qInput) {
                qInput.value = newQ;
                qInput.parentElement.classList.add('ring-2', 'ring-green-500/50');
                setTimeout(()=>qInput.parentElement.classList.remove('ring-2', 'ring-green-500/50'), 1500);
            }
            if (expInput) {
                expInput.value = newExp;
                expInput.classList.add('border-green-500');
            }

            modal.classList.remove('active', 'flex');
            modal.classList.add('hidden');
            
            toast("تم تطبيق التعديلات وحفظها في قاعدة البيانات ✅", "save");

        } catch (e) {
            console.error(e);
            toast("حدث خطأ أثناء الحفظ التلقائي", "error");
        } finally {
            applyBtn.innerHTML = originalText;
            applyBtn.disabled = false;
        }
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex', 'active');
    setTimeout(() => {
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) modalContent.classList.remove('scale-95');
    }, 10);
}

// =========================================================
// 10. SYSTEM & MIGRATION LOGIC
// =========================================================

// ==========================================
// ✅ تحديث عدادات المعرفة (system/counts)
// ==========================================

async function computeCountsFromNoorFiles() {
    const counts = {};
    let okFiles = 0;

    // نحاول أولاً الملفات الأساسية (بدون dataNooR.json لتجنب أي تكرار محتمل)
    const primaryFiles = (NOOR_JSON_FILES || []).filter(f => f && f !== 'dataNooR.json');
    const fallbackFiles = [...new Set([...(NOOR_JSON_FILES || [])])];

    const tryFetch = async (files) => {
        const localCounts = {};
        okFiles = 0;
        for (const file of files) {
            const url = `${NOOR_GITHUB_BASE}${file}?v=${Date.now()}`;
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) continue;
            const data = await res.json();
            if (!Array.isArray(data)) continue;
            okFiles++;
            for (const q of data) {
                const topic = q?.topic;
                if (!topic) continue;
                localCounts[topic] = (localCounts[topic] || 0) + 1;
            }
        }
        return localCounts;
    };

    let localCounts = await tryFetch(primaryFiles);
    if (okFiles === 0) {
        // fallback
        localCounts = await tryFetch(fallbackFiles);
    }

    Object.assign(counts, localCounts);
    if (Object.keys(counts).length === 0) {
        throw new Error('تعذر جلب ملفات Noor من GitHub لحساب العدادات.');
    }
    return counts;
}

async function updateSystemKnowledgeCounts() {
    const statusEl = el('counts-update-status');
    const btn = el('btn-update-knowledge-counts');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span> جاري التحديث...`;
    }
    if (statusEl) statusEl.innerText = 'جاري حساب عدد الأسئلة لكل موضوع...';

    try {
        const counts = await computeCountsFromNoorFiles();
        await setDoc(doc(db, 'system', 'counts'), counts, { merge: false });
        systemCountsCache = counts;
        toast('تم تحديث عدادات المعرفة ✅', 'query_stats');
        if (statusEl) statusEl.innerText = `تم تحديث ${Object.keys(counts).length} موضوع.`;
    } catch (e) {
        console.error(e);
        toast('فشل تحديث عدادات المعرفة', 'error');
        if (statusEl) statusEl.innerText = `خطأ: ${e.message}`;
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span class="material-symbols-rounded">query_stats</span> تحديث العدادات الآن`;
        }
    }
}

if (el('btn-update-knowledge-counts')) {
    el('btn-update-knowledge-counts').onclick = updateSystemKnowledgeCounts;
}
// ==========================================
// PREVIEW NEWS FUNCTIONALITY
// ==========================================

el('btn-preview-news').onclick = () => {
    const message = el('news-message-input').value;
    const previewContainer = el('news-preview-content');
    const modal = el('preview-news-modal');
    if (!message.trim()) {
        toast("الرجاء كتابة نص للمعاينة", "warning");
        return;
    }
    previewContainer.innerHTML = message;
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.add('active', 'flex');
        modal.classList.remove('opacity-0');
        modal.querySelector('.modal-content').classList.remove('scale-95');
    }, 10);
};

async function loadWhatsNewSettings() {
    try {
        const docSnap = await getDoc(doc(db, "system", "whats_new"));
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (el('news-message-input')) el('news-message-input').value = data.message || '';
            if (el('news-active-toggle')) el('news-active-toggle').checked = data.isActive || false;
        }
    } catch (e) { 
        console.error("Error loading news settings:", e); 
    }
}

el('btn-save-news').onclick = async () => {
    const btn = el('btn-save-news');
    if (!btn) return;
    
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span> جاري الحفظ...`;
    btn.disabled = true;

    const message = el('news-message-input').value;
    const isActive = el('news-active-toggle').checked;

    try {
        await setDoc(doc(db, "system", "whats_new"), {
            message: message,
            isActive: isActive,
            updatedAt: serverTimestamp()
        }, { merge: true });

        const msgEl = el('news-status-msg');
        if (msgEl) {
            msgEl.style.opacity = '1';
            msgEl.className = isActive ? "text-xs font-bold self-center text-green-400" : "text-xs font-bold self-center text-slate-400";
            msgEl.innerText = isActive ? "تم النشر والتفعيل ✅" : "تم الحفظ (معطل) ⏸️";
            
            setTimeout(() => { msgEl.style.opacity = '0'; }, 3000);
        }

    } catch (e) {
        console.error(e);
        alert("حدث خطأ أثناء الحفظ: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

el('btn-export-filtered').onclick = async () => {
    const cat = el('export-cat').value, t = el('export-topic').value, diff = el('export-diff').value;
    const btn = el('btn-export-filtered');
    
    if (!btn) return;
    
    btn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span>`; 
    btn.disabled = true;
    
    try {
        const targets = t ? [t] : (topics[cat] || []);
        const data = [];
        
        await Promise.all(targets.map(async sub => {
            const c = [where("topic","==",sub)];
            if(diff) c.push(where("difficulty","==",diff));
            const s = await getDocs(query(collection(db,"questions"), ...c));
            s.forEach(d => { 
                let x = d.data(); 
                delete x.createdAt; 
                data.push(x); 
            });
        }));

        if(data.length === 0) throw new Error("لا توجد بيانات لتصديرها");
        
        const a = document.createElement('a'); 
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); 
        
        // Custom filename mapping based on category
        const fileNameMap = {
            "المعصومون (عليهم السلام)": "infallibles_all.json",
            "الأنبياء والرسل": "prophets.json",
            "شخصيات (أصحاب وعلماء ونساء)": "personalities.json",
            "القرآن ونهج البلاغة": "quran_nahj.json",
            "عقائد وفقه": "aqida_fiqh.json",
            "الثقافة المهدوية": "mahdi_culture.json",
            "تاريخ ومعارك": "history_battles.json",
            "أدعية وزيارات": "dua_ziyarat.json",
            "معلومات عامة": "general_info.json"
        };

        if (!t && !diff && fileNameMap[cat]) {
            a.download = fileNameMap[cat];
        } else {
            a.download = `Export_${t || cat}_${diff||'All'}.json`; 
        }

        a.click();
    } catch(e) { 
        alert(e.message); 
    } finally {
        btn.innerHTML = "تصدير JSON"; 
        btn.disabled = false;
    }
};

el('btn-delete-filtered').onclick=async()=>{
const t=el('delete-topic').value;
const diff=el('delete-diff').value;
if(!t)return;
if(!confirm(`تحذير: هل أنت متأكد من حذف أسئلة موضوع (${t}) ${diff?'بصعوبة '+diff:'بكل الصعوبات'}؟`))return;
const btn=el('btn-delete-filtered');
if(!btn)return;
const originalText=btn.innerText;
btn.innerText="جاري الحذف...";
btn.disabled=true;
try{
const constr=[where("topic","==",t)];
if(diff)constr.push(where("difficulty","==",diff));
const snap=await getDocs(query(collection(db,"questions"),...constr));
if(snap.empty){
toast("لا توجد أسئلة مطابقة للحذف","info");
}else{
const totalDocs=snap.docs.length;
const CHUNK_SIZE=400;
for(let i=0;i<totalDocs;i+=CHUNK_SIZE){
const chunk=snap.docs.slice(i,i+CHUNK_SIZE);
const batch=writeBatch(db);
chunk.forEach(doc=>batch.delete(doc.ref));
await batch.commit();
btn.innerText=`تم حذف ${Math.min(i+CHUNK_SIZE,totalDocs)} من ${totalDocs}...`;
}
toast(`تم حذف ${totalDocs} سؤال بنجاح 🗑️`,"delete");
loadStats();
isCacheLoaded=false;
}
}catch(e){
console.error(e);
alert("خطأ أثناء الحذف: "+e.message);
}finally{
btn.innerText=originalText;
btn.disabled=false;
}
};
el('btn-nuke').onclick=async()=>{
const confirmMsg="تحذير: هذا سيحذف جميع الأسئلة في قاعدة البيانات نهائياً!\n\nللتأكيد، اكتب العبارة التالية بدقة:\nحذف الكل";
const userInput=prompt(confirmMsg);
if(userInput!=="حذف الكل"){
if(userInput!==null)alert("العبارة غير صحيحة. تم إلغاء العملية.");
return;
}
const btn=el('btn-nuke');
if(!btn)return;
const originalText=btn.innerText;
btn.innerText="جاري التدمير...";
btn.disabled=true;
try{
const snap=await getDocs(collection(db,"questions"));
if(snap.empty){
alert("قاعدة البيانات فارغة بالفعل.");
}else{
const totalDocs=snap.docs.length;
const CHUNK_SIZE=400;
let deletedCount=0;
for(let i=0;i<totalDocs;i+=CHUNK_SIZE){
const chunk=snap.docs.slice(i,i+CHUNK_SIZE);
const batch=writeBatch(db);
chunk.forEach(doc=>batch.delete(doc.ref));
await batch.commit();
deletedCount+=chunk.length;
btn.innerText=`تم حذف ${deletedCount} من ${totalDocs}...`;
}
toast(`تم تصفير النظام وحذف ${totalDocs} سؤال.`,"delete");
loadStats();
isCacheLoaded=false;
}
}catch(e){
console.error(e);
alert("حدث خطأ أثناء الحذف: "+e.message);
}finally{
btn.innerText=originalText;
btn.disabled=false;
}
};

// ------------------------------------
// MIGRATION ENGINE (Import/Export with IDs)
// ------------------------------------

function restoreTimestamps(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    
    if (obj.hasOwnProperty('seconds') && obj.hasOwnProperty('nanoseconds') && Object.keys(obj).length === 2) {
        return new window.Timestamp(obj.seconds, obj.nanoseconds);
    }

    if (Array.isArray(obj)) {
        return obj.map(item => restoreTimestamps(item));
    }

    const newObj = {};
    for (const key in obj) {
        newObj[key] = restoreTimestamps(obj[key]);
    }
    return newObj;
}

async function exportCollection(colName, filename, btnId) {
    const btn = el(btnId);
    if (!btn) return;
    
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span> جاري التصدير...`;
    btn.disabled = true;

    try {
        const snap = await getDocs(collection(db, colName));
        const data = [];
        snap.forEach(d => {
            data.push({ _docId: d.id, ...d.data() });
        });

        if (data.length === 0) {
            throw new Error("لا توجد بيانات لتصديرها.");
        }
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_(${data.length})_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        
        toast(`تم تصدير ${data.length} مستند بنجاح ✅`, "download");
    } catch (e) {
        console.error(e);
        alert("خطأ في التصدير: " + e.message);
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

async function importCollection(colName, fileInputId, progressId) {
    const input = el(fileInputId);
    const file = input.files[0];
    if (!file) return;

    const progressEl = el(progressId);
    if (!progressEl) return;
    
    progressEl.innerText = "جاري قراءة الملف...";
    progressEl.className = "text-xs text-center mt-2 text-amber-500 font-bold";

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            let data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) throw new Error("الملف لا يحتوي على مصفوفة بيانات صالحة");

            progressEl.innerText = `تم العثور على ${data.length} عنصر. جاري الرفع... (قد يستغرق وقتاً)`;
            
            let successCount = 0;
            let errorCount = 0;
            const BATCH_SIZE = 10;
            let batch = writeBatch(db);

            for (let i = 0; i < data.length; i++) {
                let item = data[i];
                const docId = item._docId; 
                
                if (!docId) { 
                    console.warn("عنصر بدون ID:", item); 
                    errorCount++; 
                    continue; 
                }

                delete item._docId;
                item = restoreTimestamps(item);

                batch.set(doc(db, colName, docId), item);
                
                if ((i + 1) % BATCH_SIZE === 0 || i === data.length - 1) {
                    await batch.commit();
                    batch = writeBatch(db); 
                    progressEl.innerText = `جاري المعالجة: ${i + 1} / ${data.length}`;
                }
                successCount++;
            }

            progressEl.innerText = `✅ تم! نجح: ${successCount} | فشل: ${errorCount}`;
            progressEl.className = "text-xs text-center mt-2 text-green-400 font-bold";
            toast(`تم استيراد ${successCount} مستند بنجاح`);
            
            if(colName === 'questions') { 
                loadStats(); 
                isCacheLoaded = false; 
            }
            if(colName === 'users') loadUsers();
            
            input.value = '';

        } catch (err) {
            console.error(err);
            alert("فشل الاستيراد! الملف تالف أو غير متوافق.\n" + err.message);
            progressEl.innerText = "❌ حدث خطأ";
            progressEl.className = "text-xs text-center mt-2 text-red-500 font-bold";
        }
    };
    reader.readAsText(file);
}

// --- ربط أزرار الترحيل ---
el('btn-export-users-json').onclick = () => exportCollection('users', 'Users_Backup', 'btn-export-users-json');
el('file-import-users').onchange = () => importCollection('users', 'file-import-users', 'progress-users');

el('btn-export-questions-json').onclick = () => exportCollection('questions', 'Questions_Backup', 'btn-export-questions-json');
el('file-import-questions').onchange = () => importCollection('questions', 'file-import-questions', 'progress-questions');

el('btn-export-others-json').onclick = async () => {
     const btn = el('btn-export-others-json');
     if (!btn) return;
     
     const originalText = btn.innerHTML;
     btn.disabled = true; 
     btn.innerHTML = '<span class="material-symbols-rounded spinner">sync</span> جاري التصدير...';
     
     try {
         const reports = []; 
         const reportsSnap = await getDocs(collection(db, "reports"));
         reportsSnap.forEach(d => reports.push({_docId: d.id, ...d.data(), _collection: 'reports'}));
         
         const system = []; 
         const systemSnap = await getDocs(collection(db, "system"));
         systemSnap.forEach(d => system.push({_docId: d.id, ...d.data(), _collection: 'system'}));
         
         const combined = [...reports, ...system];
         
         if (combined.length === 0) {
             toast("لا توجد بيانات أخرى لتصديرها.", "info");
             return;
         }
         
         const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/json' });
         const a = document.createElement('a'); 
         a.href = URL.createObjectURL(blob); 
         a.download = `Others_Backup_${combined.length}.json`;
         document.body.appendChild(a); 
         a.click(); 
         document.body.removeChild(a);
         
         toast(`تم تصدير ${combined.length} عنصر بنجاح ✅`);
     } catch(e) { 
         alert(e.message); 
     } finally {
         btn.innerHTML = originalText; 
         btn.disabled = false;
     }
};

el('file-import-others').onchange = () => {
    const input = el('file-import-others');
    const file = input.files[0];
    if (!file) return;
    
    const progress = el('progress-others');
    if (!progress) return;
    
    progress.innerText = "جاري التحليل...";
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            let count = 0;
            const batch = writeBatch(db);
            
            for(let item of data) {
                const col = item._collection;
                const id = item._docId;
                delete item._collection; 
                delete item._docId;
                item = restoreTimestamps(item);
                
                if(col && id) {
                    batch.set(doc(db, col, id), item);
                    count++;
                }
                
                if (count % 10 === 0) {
                     await batch.commit();
                     batch = writeBatch(db);
                     progress.innerText = `تم استعادة ${count} عنصر...`;
                }
            }
            await batch.commit();

            progress.innerText = `✅ تم استعادة ${count} عنصر بنجاح`;
            toast(`تم استيراد ${count} إعداد/تقرير`);
            input.value = '';
        } catch (error) {
            console.error(error);
            progress.innerText = "❌ حدث خطأ في الاستيراد";
        }
    };
    reader.readAsText(file);
};

// =========================================================
// 11. INITIALIZATION & GLOBAL HANDLERS
// =========================================================

function updateLocalCache(id, newData) {
    if (!allQuestionsCache || allQuestionsCache.length === 0) return;    
    const index = allQuestionsCache.findIndex(q => q.id === id);
    if (index !== -1) {
        allQuestionsCache[index] = { ...allQuestionsCache[index], ...newData };
    }
}

function bindEventHandlers() {
    // تهيئة نظام الرسائل (منفصل) + فقاعة إشعار
    if (!window.__adminMessagingInited) {
        window.__adminMessagingInited = true;
        try { initAdminMessaging({ db, el, show, hide }); } catch(e) { console.warn('Messaging init failed', e); }
    }
    console.log("Starting App Initialization..."); // للتأكد من تشغيل الدالة

    // 1. تحميل إعدادات "ما الجديد"
    loadWhatsNewSettings();
    
    // 2. إعداد AI
    setupAI();
    
    // 3. تهيئة القوائم المنسدلة (Drops)
    const checkBtn = () => {
        const expCat = el('export-cat');
        const btnExp = el('btn-export-filtered');
        if(btnExp) btnExp.disabled = !expCat || !expCat.value;

        const delTopic = el('delete-topic');
        const btnDel = el('btn-delete-filtered');
        if(btnDel) btnDel.disabled = !delTopic || !delTopic.value;
    };
    
    // قوائم الإضافة والرفع
    initDrops('upload-cat', 'upload-topic'); 
    initDrops('man-cat', 'man-topic'); 
    initDrops('paste-cat', 'paste-topic'); 
    initDrops('edit-q-cat', 'edit-q-topic'); 

    // قوائم التصدير والحذف
    initDrops('export-cat', 'export-topic', checkBtn);
    initDrops('delete-cat', 'delete-topic', checkBtn);
    
    // [مهم جداً] قوائم بنك الأسئلة
    initDrops('manage-cat-filter', 'manage-topic-filter', () => loadQuestions(false));
    
    // 4. تحميل الإحصائيات
    loadStats();
}

// تسجيل الدخول المجهول وتهيئة التطبيق
signInAnonymously(auth)
    .then(() => { 
        isAuthReady = true; 
        console.log("✅ Admin Auth Ready"); 
        
        // [تصحيح] التحقق مما إذا كانت الصفحة محملة بالفعل أم لا
        if (document.readyState === "loading") {
            // إذا كانت الصفحة لا تزال تحمل، ننتظر
            document.addEventListener('DOMContentLoaded', bindEventHandlers);
        } else {
            // إذا انتهى التحميل، نشغل الدالة فوراً
            bindEventHandlers();
        }
        
        // تحميل الصفحة الافتراضية
        triggerTab('view-dashboard');
    })
    .catch(e => {
        console.error("Firebase Auth Error:", e);
        toast("خطأ في المصادقة مع Firebase", "error");
    });

// =========================================================
// 12. GLOBAL HELPER FUNCTIONS
// =========================================================

window.closeModal = (modalId) => {
    const modal = document.getElementById(modalId);

    // صفحة ملف اللاعب (داخلية): رجوع للتبويب السابق
    if (modalId === 'user-edit-modal' && modal && modal.classList.contains('view-section')) {
        const backTo = window.__lastTabBeforeUserEdit || 'view-users';
        window.triggerTab(backTo);
        return;
    }

    if (modal) {
        modal.classList.remove('active', 'flex');
        modal.classList.add('hidden');
    }
};
