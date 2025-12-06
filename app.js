// =========================================================
// 1. IMPORTS & CONFIGURATION
// =========================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc, updateDoc, deleteDoc, addDoc, setDoc, query, where, orderBy, limit, serverTimestamp, writeBatch, startAfter, deleteField, Timestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// استيراد البيانات الثابتة من ملف data.js
import { topics, badgesMap, badgesData } from './data.js';

// تعريف كائن Timestamp ليكون متاحاً عالمياً
window.Timestamp = Timestamp;

// ===> (تم النقل هنا) مفتاح API الخاص بالذكاء الاصطناعي <===
const GEMINI_API_KEY = "AIzaSyAE1fkxt0RsTtzmLRnkHLfbAo3eEWDu6nI"; 

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
// ... باقي الكود كما هو
let isAuthReady = false;
signInAnonymously(auth).then(() => { 
    isAuthReady = true; 
    console.log("Admin Auth Ready"); 
    // ربط الأحداث بعد تأكد الاتصال
    bindEventHandlers();
}).catch(e => console.error("Firebase Auth Error:", e));


// =========================================================
// 2. GLOBAL UI/UTILITY HELPERS
// =========================================================

const el = (id) => document.getElementById(id);
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

    if (!t || !tMsg || !tIcon) return; // تأكد من وجود العناصر

    tMsg.innerText = msg; 
    tIcon.innerText = icon; 
    
    // إزالة فئة hidden وإضافة flex
    t.classList.remove('hidden', 'translate-y-5', 'opacity-0'); 
    t.classList.add('flex'); 
    t.classList.add('opacity-100'); 
    
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
// 3. AUTHENTICATION & INITIAL BINDING
// =========================================================

el('btn-login').onclick = () => { 
    if(!isAuthReady) return el('login-msg').innerText = "جاري الاتصال..."; 
    // الرمز السري هنا
    if(el('admin-pin').value.replace(/[^0-9]/g, '') === '0000') { 
        hide('login-screen'); 
        show('dashboard-container'); 
        triggerTab('view-dashboard'); // البدء من لوحة القيادة
    } else { 
        el('login-msg').innerText = "رمز خاطئ"; 
        setTimeout(()=>el('login-msg').innerText='', 2000); 
    } 
};
el('admin-pin').addEventListener('input', function (e) { 
    this.value = this.value.replace(/[^0-9]/g, ''); 
});

// =========================================================
// 4. NAVIGATION & UI HANDLERS
// =========================================================

/**
 * فتح وإغلاق القائمة الجانبية (للموبايل)
 */
window.toggleAdminMenu = (show) => {
    const sidebar = el('admin-sidebar');
    const overlay = el('side-menu-overlay');
    if (!sidebar || !overlay) return;

    if (show) {
        sidebar.style.right = '0';
        overlay.classList.remove('hidden');
        setTimeout(() => overlay.classList.remove('opacity-0'), 10);
    } else {
        sidebar.style.right = '-300px';
        overlay.classList.add('opacity-0');
        setTimeout(() => overlay.classList.add('hidden'), 300);
    }
};

el('mobile-menu-btn').onclick = () => window.toggleAdminMenu(true);
el('side-menu-overlay').onclick = () => window.toggleAdminMenu(false);


/**
 * دالة التبديل بين الأقسام الرئيسية
 * @param {string} tabId - ID القسم المطلوب عرضه
 */
window.triggerTab = (tabId) => {
    // 1. تحديث القائمة الجانبية
    document.querySelectorAll('.nav-item').forEach(b => { 
        b.classList.remove('active'); 
        if(b.dataset.tab === tabId) b.classList.add('active'); 
    });

    // 2. تبديل الصفحات
    document.querySelectorAll('.view-section').forEach(v => v.classList.add('hidden'));
    show(tabId);

    // 3. تحميل البيانات الخاصة بكل صفحة
    if(tabId === 'view-users') loadUsers();
    if(tabId === 'view-reports') loadReports();
    if(tabId === 'view-manage') { 
        el('qs-search-input').value=''; 
        loadQuestions(false); 
    }
    if(tabId === 'view-dashboard') loadStats();

    // 4. إغلاق القائمة الجانبية بعد الاختيار (للموبايل)
    window.toggleAdminMenu(false);
    
    // العودة لأعلى الصفحة
    el('main-view-area')?.scrollTo(0, 0);
};

document.querySelectorAll('.nav-item').forEach(btn => btn.onclick = () => window.triggerTab(btn.dataset.tab));
document.querySelectorAll('.glass[data-target]').forEach(card => card.onclick = () => window.triggerTab(card.dataset.target));


/**
 * تهيئة قوائم التصنيفات والمواضيع
 * @param {string} cId - ID لقائمة التصنيفات (الفئة)
 * @param {string} tId - ID لقائمة المواضيع (الموضوع)
 * @param {function} onChangeCallback - دالة تُنفذ عند تغيير الفئة أو الموضوع
 */
const initDrops = (cId, tId, onChangeCallback = null) => {
    const c = el(cId), t = el(tId);
    if (!c || !t) return;
    
    c.innerHTML = '<option value="">-- اختر التصنيف --</option>'; 
    Object.keys(topics).forEach(k => c.add(new Option(k, k)));
    
    // دالة تحديث المواضيع بناءً على التصنيف المختار
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
// 5. DASHBOARD & CHARTS LOGIC
// =========================================================
let myChart = null; 
let myActivityChart = null; 
let cachedQuestionsData = []; 

async function loadStats() {
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
}

/**
 * دالة رسم المخطط الخطي (النشاط اليومي)
 */
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

/**
 * دالة رسم المخطط الدائري (توزيع الأسئلة)
 */
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
// 6. USER MANAGEMENT (LOAD, RENDER, EDIT/SAVE LOGIC)
// =========================================================

let currentUserEditId = null;

async function loadUsers() {
    const grid = el('users-grid'); 
    grid.innerHTML = '<div class="text-center py-8"><span class="material-symbols-rounded spinner text-amber-500 text-3xl">sync</span></div>';
    const term = el('user-search').value.toLowerCase();
    
    try {
        const snap = await getDocs(query(collection(db, "users"), orderBy("highScore", "desc"), limit(50)));
        grid.innerHTML = '';
        
        snap.forEach(d => {
            const u = d.data();
            if(term && !u.username?.toLowerCase().includes(term) && !d.id.includes(term)) return;
            
            const displayName = u.username || 'ضيف';
            const stats = u.stats || {};
            
            // --- عرض الأوسمة ---
            let badgesHtml = '';
            if (u.badges && Array.isArray(u.badges) && u.badges.length > 0) {
                badgesHtml = '<div class="flex flex-wrap gap-1 mt-2">';
                u.badges.slice(0, 5).forEach(bId => {
                    const baseId = bId.split('_lvl')[0];
                    const badgeInfo = badgesMap[baseId];
                    const badgeName = badgeInfo ? badgeInfo.name : baseId; 
                    const lvlMatch = bId.match(/lvl(\d+)/);
                    const lvl = lvlMatch ? lvlMatch[1] : '?';
                    
                    let colorClass = "bg-slate-700 text-slate-300";
                    if(lvl == '3') colorClass = "bg-amber-500/20 text-amber-400 border border-amber-500/30";
                    if(lvl == '4') colorClass = "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30";
                    if(lvl == '5') colorClass = "bg-red-500/20 text-red-400 border border-red-500/30";

                    badgesHtml += `<span class="${colorClass} text-[9px] px-1.5 py-0.5 rounded flex items-center gap-1" title="${bId}">${badgeName} <span class="text-[8px] opacity-70">${lvl}</span></span>`;
                });
                if(u.badges.length > 5) badgesHtml += `<span class="text-[9px] text-slate-500 px-1">+${u.badges.length - 5}</span>`;
                badgesHtml += '</div>';
            } else {
                badgesHtml = '<div class="text-[10px] text-slate-600 mt-1">لا توجد أوسمة</div>';
            }
            
            const div = document.createElement('div');
            div.className = `admin-item flex flex-col md:flex-row items-start md:items-center gap-3 w-full ${u.isBanned?'bg-red-900/10 border-red-500/30':''}`;
            
            let av = `<span class="material-symbols-rounded text-xl text-slate-400">person</span>`;
            if(u.customAvatar) av = `<img src="${u.customAvatar}" class="w-full h-full object-cover">`;
            
            div.innerHTML = `
                <div class="flex items-center gap-3 w-full md:w-auto flex-1 min-w-0">
                    <div class="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden border border-slate-600 shrink-0">${av}</div>
                    <div class="min-w-0 flex-1">
                        <div class="font-bold text-white truncate flex items-center gap-2">
                            ${displayName} 
                            ${u.isBanned ? '<span class="text-[9px] bg-red-500 text-white px-1 rounded">محظور</span>' : ''}
                        </div>
                        <div class="text-[10px] text-slate-500 font-mono select-all truncate">${d.id}</div>
                        ${badgesHtml}
                    </div>
                </div>
                <div class="flex items-center justify-between w-full md:w-auto gap-4 pl-2 pt-2 md:pt-0 border-t md:border-0 border-slate-700/50 mt-2 md:mt-0">
                    <div class="text-center px-2">
                        <div class="text-[9px] text-slate-400">النقاط</div>
                        <div class="text-amber-500 font-bold font-mono text-sm">${u.highScore||0}</div>
                    </div>
                    <div class="text-center px-2 border-r border-slate-700">
                        <div class="text-[9px] text-slate-400">الأسبوع</div>
                        <div class="text-green-400 font-bold font-mono text-sm">${u.weeklyStats?.correct || 0}</div>
                    </div>
                    <button class="bg-slate-700 hover:bg-blue-600 p-2 rounded-lg text-white btn-edit-user transition shrink-0"><span class="material-symbols-rounded">settings</span></button>
                </div>
            `;
            
            div.querySelector('.btn-edit-user').onclick = () => openEditUserModal(d.id, u, stats);
            grid.appendChild(div);
        });
    } catch(e) { console.error(e); }
}

el('btn-refresh-users').onclick = loadUsers; 
el('user-search').oninput = loadUsers;

/**
 * فتح وتعبئة بيانات نافذة تعديل المستخدم
 */
function openEditUserModal(userId, u, stats) {
    currentUserEditId = userId;
    
    el('edit-name').value = u.username || ''; 
    el('edit-score').value = u.highScore || 0; 
    el('edit-banned').checked = u.isBanned || false; 
    el('edit-pass').value = u.password || '';
    
    el('edit-quizzes-played').value = stats.quizzesPlayed || 0;
    el('edit-total-correct').value = stats.totalCorrect || 0;
    
    el('edit-weekly-score').value = u.weeklyStats?.correct || 0;
    el('edit-monthly-score').value = u.monthlyStats?.correct || 0;

    el('edit-badges').value = Array.isArray(u.badges) ? u.badges.join(', ') : '';
    
    // الصورة
    const prev = el('edit-avatar-preview'); prev.innerHTML = '';
    if(u.customAvatar) { prev.innerHTML = `<img src="${u.customAvatar}" class="w-full h-full object-cover">`; show('btn-del-avatar'); }
    else { prev.innerHTML = `<span class="material-symbols-rounded text-slate-500 text-4xl">person</span>`; hide('btn-del-avatar'); }
    
    el('user-edit-modal').classList.add('active', 'flex');
    el('user-edit-modal').classList.remove('hidden');
    // لتمكين الانتقال السلس للنموذج
    setTimeout(() => el('user-edit-modal').querySelector('.modal-content').classList.remove('scale-95'), 10);
}

el('btn-save-user').onclick = async () => {
    const btn = el('btn-save-user');
    const originalText = btn.innerText;
    btn.innerText = "جاري التحديث...";
    btn.disabled = true;

    try {
        if (!currentUserEditId) throw new Error("لم يتم تحديد المستخدم");

        const today = new Date();
        // حساب مفتاح الأسبوع الحالي (يوم الجمعة كنهاية أسبوع)
        const day = today.getDay(); 
        const diff = (day + 2) % 7; 
        const lastFriday = new Date(today);
        lastFriday.setDate(today.getDate() - diff);
        const currentWeekKey = lastFriday.toISOString().split('T')[0];
        const currentMonthKey = today.toISOString().slice(0, 7); 

        const updates = { 
            username: el('edit-name').value, 
            highScore: parseInt(el('edit-score').value) || 0, 
            isBanned: el('edit-banned').checked,
            
            "stats.quizzesPlayed": parseInt(el('edit-quizzes-played').value) || 0,
            "stats.totalCorrect": parseInt(el('edit-total-correct').value) || 0,

            "weeklyStats.correct": parseInt(el('edit-weekly-score').value) || 0,
            "weeklyStats.key": currentWeekKey, 
            
            "monthlyStats.correct": parseInt(el('edit-monthly-score').value) || 0,
            "monthlyStats.key": currentMonthKey 
        };

        if(el('edit-pass').value.trim() !== "") updates.password = el('edit-pass').value;
        if(window.newAvatarBase64 !== undefined) updates.customAvatar = window.newAvatarBase64 === '' ? deleteField() : window.newAvatarBase64;
        
        const badgesInput = el('edit-badges').value;
        updates.badges = badgesInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
        
        await updateDoc(doc(db, "users", currentUserEditId), updates);
        
        toast("تم تحديث بيانات المستخدم والإحصائيات ✅"); 
        el('user-edit-modal').classList.remove('active', 'flex'); 
        el('user-edit-modal').classList.add('hidden');
        loadUsers();
        
        window.newAvatarBase64 = undefined; 

    } catch (error) {
        console.error(error);
        alert("فشل الحفظ: " + error.message);
    } finally {
        btn.innerText = originalText;
        btn.disabled = false;
    }
};

el('btn-delete-user-permanent').onclick = async () => {
    if (!currentUserEditId) return;
    if (!confirm("⚠️ تحذير خطير!\n\nهل أنت متأكد تماماً من رغبتك في حذف هذا اللاعب نهائياً؟")) return;
    
    const confirmationName = prompt("للتأكيد النهائي، اكتب كلمة (حذف):");
    if (confirmationName !== "حذف") return alert("لم يتم الحذف.");

    const btn = el('btn-delete-user-permanent');
    const originalText = btn.innerHTML;
    btn.innerHTML = "جاري الحذف...";
    btn.disabled = true;

    try {
        await deleteDoc(doc(db, "users", currentUserEditId));
        toast("تم حذف المستخدم نهائياً 🗑️", "delete");
        el('user-edit-modal').classList.remove('active', 'flex');
        el('user-edit-modal').classList.add('hidden');
        loadUsers();
    } catch (e) {
        alert("خطأ: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// كود معالجة رفع الصورة وحذفها
el('upload-new-avatar').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast("حجم الصورة كبير جداً", "warning");

    const reader = new FileReader();
    reader.onload = (ev) => {
        window.newAvatarBase64 = ev.target.result;
        el('edit-avatar-preview').innerHTML = `<img src="${ev.target.result}" class="w-full h-full object-cover">`;
        show('btn-del-avatar');
    };
    reader.readAsDataURL(file);
};

el('btn-del-avatar').onclick = () => {
    window.newAvatarBase64 = ''; 
    el('edit-avatar-preview').innerHTML = `<span class="material-symbols-rounded text-slate-500 text-4xl">person</span>`;
    hide('btn-del-avatar');
};


// =========================================================
// 7. REPORTS LOGIC
// =========================================================

async function loadReports() {
    const grid = el('reports-grid'); 
    grid.innerHTML = '<div class="col-span-1 lg:col-span-2 text-center text-slate-500 py-8"><span class="material-symbols-rounded spinner text-3xl">sync</span></div>';
    try {
        const snap = await getDocs(query(collection(db, "reports"), orderBy("timestamp", "desc")));
        grid.innerHTML = '';
        if(snap.empty) { grid.innerHTML = '<div class="col-span-1 lg:col-span-2 text-center text-slate-500 py-8 border border-dashed border-slate-700 rounded-xl">لا توجد بلاغات جديدة 🎉</div>'; return; }
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
            div.querySelector('.btn-dismiss').onclick = async () => { if(confirm("حذف البلاغ فقط؟")) { await deleteDoc(doc(db, "reports", docSnap.id)); div.remove(); toast("تم حذف البلاغ"); } };
            div.querySelector('.btn-nuke-q').onclick = async () => { if(confirm("حذف السؤال والبلاغ نهائياً؟")) { try { if(r.questionId && r.questionId !== 'N/A') await deleteDoc(doc(db, "questions", r.questionId)); await deleteDoc(doc(db, "reports", docSnap.id)); div.remove(); toast("تم حذف السؤال والبلاغ", "delete"); } catch(e) { alert(e.message); } } };
            div.querySelector('.btn-fix').onclick = async () => { 
                if(!r.questionId || r.questionId === 'N/A') return alert("لا يوجد معرف للسؤال"); 
                const btn = div.querySelector('.btn-fix'); 
                btn.innerText = "جاري الجلب..."; 
                try { 
                    const qDoc = await getDoc(doc(db, "questions", r.questionId)); 
                    if(qDoc.exists()) { openEditQModal(r.questionId, qDoc.data()); } 
                    else { alert("السؤال محذوف مسبقاً."); } 
                } catch(e) { alert("خطأ: " + e.message); } 
                btn.innerText = "فحص وتعديل"; 
            };
            grid.appendChild(div);
        });
    } catch(e) { console.error(e); }
}
el('btn-refresh-reports').onclick = loadReports;

// =========================================================
// 8. CONTENT MANAGEMENT (ADD/PASTE/UPLOAD)
// =========================================================

// تهيئة قوائم الإضافة
const checkBtn = () => {
    const checkTopic = (id) => { 
        const topicEl = el(id);
        const btnEl = el(`btn-${id.split('-')[0]}-filtered`);
        if(btnEl) btnEl.disabled = !topicEl || topicEl.disabled || !topicEl.value;
    };
    checkTopic('export-topic');
    checkTopic('delete-topic');
};
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
    if(!q || !topic) return toast("بيانات ناقصة (السؤال والموضوع)", "warning");
    const ansIdx = Array.from(document.getElementsByName('correct_ans_selector')).findIndex(r => r.checked);
    
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
    el('man-q').value=''; // تصفير السؤال
    // يمكن إضافة المزيد من التصفير هنا
};

el('btn-upload-file').onclick = () => {
    const f = el('json-file-input').files[0], t = el('upload-topic').value;
    if(!f || !t) return toast("اختر ملف وموضوع", "warning");
    const r = new FileReader(); 
    r.onload = async (e) => { 
        try { 
            const d = JSON.parse(e.target.result); 
            let c=0; 
            for(let q of d) { 
                if(q.question) { 
                    await addDoc(collection(db,"questions"),{
                        ...q, 
                        topic:t, 
                        difficulty: q.difficulty || 'متوسط', // استخدام صعوبة الملف إن وجدت
                        isReviewed: q.isReviewed || false, 
                        createdAt:serverTimestamp()
                    }); 
                    c++; 
                } 
            } 
            toast(`تم رفع ${c} سؤال`); 
        } catch(x){ 
            alert("خطأ في تحليل ملف JSON: " + x.message); 
        } 
    }; 
    r.readAsText(f);
};

el('btn-paste-upload').onclick = async () => {
    const txt = el('json-paste-area').value, t = el('paste-topic').value;
    if(!txt || !t) return toast("أدخل النص واختر الموضوع", "warning");
    try { 
        const d = JSON.parse(txt); 
        let c=0; 
        for(let q of d) { 
            if(q.question) { 
                await addDoc(collection(db,"questions"),{
                    ...q, 
                    topic:t, 
                    difficulty: q.difficulty || 'متوسط',
                    isReviewed: q.isReviewed || false, 
                    createdAt:serverTimestamp()
                }); 
                c++; 
            } 
        } 
        toast(`تمت إضافة ${c} سؤال`); 
        el('json-paste-area').value=''; 
    } catch(x){ 
        alert("خطأ في تحليل كود JSON: " + x.message); 
    }
};

// =========================================================
// 9. QUESTION MANAGEMENT (LOAD, SEARCH, RENDER CARD)
// =========================================================

let lastVisible = null; 
let allQuestionsCache = [];
let isCacheLoaded = false;
let isFetchingQs = false;

// تهيئة قوائم فلترة إدارة الأسئلة
initDrops('manage-cat-filter', 'manage-topic-filter', () => loadQuestions(false));
el('manage-status-filter').onchange = () => loadQuestions(false);

async function fetchAllForSearch() {
     const loader = el('q-loader');
     if(loader) loader.innerHTML = '<span class="material-symbols-rounded spinner text-3xl">cloud_download</span><p class="text-xs mt-2">جاري تحميل الأرشيف الكامل للبحث...</p>';
     
     try {
        const qSnap = await getDocs(query(collection(db, "questions"), orderBy("createdAt", "desc")));
        allQuestionsCache = [];
        qSnap.forEach(doc => allQuestionsCache.push({ id: doc.id, ...doc.data() }));
        isCacheLoaded = true;
        return true;
     } catch(e) { console.error(e); return false; }
}

el('qs-search-input').oninput = async function() {
    const term = this.value.trim().toLowerCase();
    const grid = el('questions-grid');
    const loadBtn = el('btn-load-more');

    if (term === "") {
        loadQuestions(false);
        return;
    }

    if (!isCacheLoaded) {
         grid.innerHTML = '<div id="q-loader" class="text-center py-12 text-slate-500"><span class="material-symbols-rounded spinner text-3xl">sync</span></div>';
         await fetchAllForSearch();
    }

    const results = allQuestionsCache.filter(q => {
        const qText = (q.question || "").toLowerCase();
        const expText = (q.explanation || "").toLowerCase();
        const optText = (q.options || []).join(" ").toLowerCase();
        return qText.includes(term) || expText.includes(term) || optText.includes(term) || q.id.toLowerCase().includes(term);
    });

    grid.innerHTML = '';
    loadBtn.classList.add('hidden');
    el('qs-counter').innerText = results.length;

    if (results.length === 0) {
        grid.innerHTML = '<div class="text-center py-8 text-slate-500 bg-slate-800/20 rounded border border-slate-700/50">لا توجد نتائج مطابقة</div>';
        return;
    }

    results.slice(0, 50).forEach(d => renderQuestionCard(d, grid));
    if(results.length > 50) {
         grid.innerHTML += `<div class="text-center text-xs text-slate-500 py-2">تم عرض 50 نتيجة من أصل ${results.length}</div>`;
    }
};


el('btn-load-more').onclick = () => loadQuestions(true);
el('btn-refresh-qs').onclick = () => loadQuestions(false);

async function loadQuestions(loadMore = false) {
    if (el('qs-search-input').value.trim() !== "") return; 
    if (isFetchingQs) return; 

    const grid = el('questions-grid'); 
    const loadBtn = el('btn-load-more'); 
    const statusVal = el('manage-status-filter').value;
    const topicVal = el('manage-topic-filter').value;

    if (!loadMore) { 
        grid.innerHTML = ''; 
        lastVisible = null; 
        el('qs-counter').innerText = '0'; 
        loadBtn.classList.add('hidden'); 
        grid.innerHTML = '<div id="q-loader" class="text-center py-12 text-slate-500"><span class="material-symbols-rounded spinner text-3xl">sync</span><p class="text-xs mt-2">جاري جلب البيانات...</p></div>'; 
    } 
    else { 
        loadBtn.innerHTML = '<span class="material-symbols-rounded spinner text-sm">sync</span> جاري التحميل...'; 
    }

    isFetchingQs = true;

    try {
        let constraints = [];
        
        if (statusVal === 'unreviewed') {
            constraints.push(where("isReviewed", "==", false));
        } else if (statusVal === 'uncategorized') {
            const validTopics = new Set();
            Object.values(topics).forEach(subList => subList.forEach(t => validTopics.add(t)));
            // البحث عن الأسئلة التي موضوعها ليس في القائمة (عملية صعبة قد تتطلب حلولاً غير فهرسة)
            // لحل مشكلة الفهرسة في Firestore، سنبحث عن الأسئلة التي موضوعها 'غير مصنف' فقط كمؤشر:
             constraints.push(where("topic", "==", "غير مصنف")); 
        }

        if (topicVal) {
            constraints.push(where("topic", "==", topicVal));
        }
        
        constraints.push(orderBy("createdAt", "desc")); 
        if (loadMore && lastVisible) constraints.push(startAfter(lastVisible));
        constraints.push(limit(50)); // تقليل الحد من 200 إلى 50 لأداء أفضل

        const q = query(collection(db, "questions"), ...constraints);
        const snapshot = await getDocs(q);
        
        const loader = el('q-loader'); if (loader) loader.remove();

        if (snapshot.empty) {
            if (!loadMore) grid.innerHTML = '<div class="text-center py-8 text-slate-500 bg-slate-800/20 rounded border border-slate-700/50">لا توجد نتائج</div>';
            loadBtn.classList.add('hidden');
        } else {
            lastVisible = snapshot.docs[snapshot.docs.length - 1];
            if (snapshot.docs.length < 50) loadBtn.classList.add('hidden'); else { loadBtn.classList.remove('hidden'); loadBtn.innerHTML = 'تحميل المزيد (50+)'; }
            snapshot.forEach(docSnap => {
                const data = { id: docSnap.id, ...docSnap.data() };
                renderQuestionCard(data, grid);
            });
            el('qs-counter').innerText = document.querySelectorAll('#questions-grid .admin-item').length;
        }
    } catch(e) { 
        console.error(e); 
        toast("خطأ في تحميل الأسئلة: " + e.message, "error");
    }
    isFetchingQs = false;
}

/**
/**
 * دالة عرض بطاقة السؤال (محدثة مع زر الذكاء الاصطناعي)
 */
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

// 1. ربط زر الذكاء الاصطناعي
div.querySelector('.btn-ai-check').onclick = () => checkQuestionWithAI(d); // تم حذف 'window.'
// ...


    // 2. زر الحفظ السريع
    div.querySelector('.btn-quick-save').onclick = async () => {
        const newQ = el(`inline-q-${d.id}`).value;
        const newExp = el(`inline-exp-${d.id}`).value;
        const options = [el(`inline-opt-${d.id}-0`).value, el(`inline-opt-${d.id}-1`).value, el(`inline-opt-${d.id}-2`).value, el(`inline-opt-${d.id}-3`).value];
        const checkedRadio = div.querySelector(`input[name="rad-${d.id}"]:checked`);
        const newCorrect = checkedRadio ? parseInt(checkedRadio.value) : 0;

        if(!newQ || !options[0] || !options[1]) return toast("يرجى ملء السؤال والخيارات الأساسية", "warning");

        const btn = div.querySelector('.btn-quick-save');
        btn.innerHTML = '<span class="material-symbols-rounded spinner text-sm">sync</span>';
        
        try {
            await updateDoc(doc(db, "questions", d.id), {
                question: newQ,
                options: options,
                correctAnswer: newCorrect,
                explanation: newExp
            });
            toast("تم حفظ التعديلات ✅");
            btn.innerHTML = '<span class="material-symbols-rounded text-sm">save</span> حفظ';
            div.classList.add('ring-2', 'ring-blue-500');
            setTimeout(() => div.classList.remove('ring-2', 'ring-blue-500'), 500);
        } catch(e) {
            console.error(e);
            toast("خطأ في الحفظ", "error");
            btn.innerHTML = '<span class="material-symbols-rounded text-sm">save</span> حفظ';
        }
    };

    // 3. زر الحذف
    div.querySelector('.btn-del-q').onclick = async () => { if(confirm("حذف السؤال نهائياً؟")) { await deleteDoc(doc(db,"questions",d.id)); div.remove(); toast("تم الحذف","delete"); } };
    
    // 4. زر تبديل الحالة
    div.querySelector('.btn-toggle-review').onclick = async () => {
        const newStatus = !d.isReviewed;
        await updateDoc(doc(db, "questions", d.id), { isReviewed: newStatus });
        d.isReviewed = newStatus;
        // إعادة رسم البطاقة لتحديث الحالة والألوان
        renderQuestionCard(d, container).then(newDiv => {
             // نستبدل البطاقة القديمة بالجديدة في نفس المكان
             const oldDiv = document.getElementById(`q-row-${d.id}`);
             if(oldDiv) oldDiv.replaceWith(newDiv);
        });
        toast(newStatus ? "تم الاعتماد" : "تم إلغاء الاعتماد");
    };

    // 5. زر الإعدادات المتقدمة
    div.querySelector('.btn-advanced-edit').onclick = () => window.openEditQModal(d.id, d);

    container.appendChild(div);
    return div;
}


/**
 * فتح وتعبئة بيانات نافذة تعديل السؤال المتقدمة
 */
window.openEditQModal = (id, data) => {
    window.currQId = id; window.currQStatus = data.isReviewed || false;
    
    el('edit-q-text').value = data.question; 
    el('edit-o1').value = data.options[0] || ''; 
    el('edit-o2').value = data.options[1] || ''; 
    el('edit-o3').value = data.options[2] || ''; 
    el('edit-o4').value = data.options[3] || ''; 
    el('edit-q-exp').value = data.explanation || ""; 
    el('edit-q-diff').value = data.difficulty || "متوسط";
    
    if(document.getElementsByName('edit_ans_selector')[data.correctAnswer]) {
        document.getElementsByName('edit_ans_selector')[data.correctAnswer].checked = true;
    }

    let catFound = ""; 
    for(let c in topics) if(topics[c].includes(data.topic)) { catFound = c; break; } 
    
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
    const newStatus = !window.currQStatus;
    await updateDoc(doc(db, "questions", window.currQId), { isReviewed: newStatus });
    window.currQStatus = newStatus;
    el('question-edit-modal').classList.remove('active', 'flex'); 
    el('question-edit-modal').classList.add('hidden');
    toast(newStatus ? "تم الاعتماد" : "تم إلغاء الاعتماد");
    loadQuestions(false);
};

el('btn-save-edit-q').onclick = async () => {
    const btn = el('btn-save-edit-q');
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

// =========================================================
// 10. SYSTEM & MIGRATION LOGIC
// =========================================================

// What's New Logic
async function loadWhatsNewSettings() {
    try {
        const docSnap = await getDoc(doc(db, "system", "whats_new"));
        if (docSnap.exists()) {
            const data = docSnap.data();
            el('news-message-input').value = data.message || '';
            el('news-active-toggle').checked = data.isActive || false;
        }
    } catch (e) { console.error("Error loading news settings:", e); }
}
// Run on initialization after all bindings are done
function bindEventHandlers() {
    loadWhatsNewSettings();
}

el('btn-save-news').onclick = async () => {
    const btn = el('btn-save-news');
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
        msgEl.style.opacity = '1';
        msgEl.className = isActive ? "text-xs font-bold self-center text-green-400" : "text-xs font-bold self-center text-slate-400";
        msgEl.innerText = isActive ? "تم النشر والتفعيل ✅" : "تم الحفظ (معطل) ⏸️";
        
        setTimeout(() => { msgEl.style.opacity = '0'; }, 3000);

    } catch (e) {
        console.error(e);
        alert("حدث خطأ أثناء الحفظ: " + e.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
};

// Exports / Deletes
el('btn-export-filtered').onclick = async () => {
    const t = el('export-topic').value; const diff = el('export-diff').value;
    const constr = [where("topic","==",t)]; if(diff) constr.push(where("difficulty","==",diff));
    const snap = await getDocs(query(collection(db,"questions"), ...constr));
    if(snap.empty) return alert("لا توجد بيانات");
    const data = []; snap.forEach(d => { let x = d.data(); delete x.createdAt; data.push(x); });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})); a.download = `Export_${t}_${diff||'All'}.json`; a.click();
};

el('btn-delete-filtered').onclick = async () => {
    const t = el('delete-topic').value; const diff = el('delete-diff').value;
    if(!t) return;
    if(!confirm(`تحذير: هل أنت متأكد من حذف أسئلة موضوع (${t}) ${diff ? 'بصعوبة '+diff : 'بكل الصعوبات'}؟`)) return;
    
    const btn = el('btn-delete-filtered'); btn.innerText = "جاري الحذف...";
    try {
        const constr = [where("topic","==",t)]; if(diff) constr.push(where("difficulty","==",diff));
        const snap = await getDocs(query(collection(db,"questions"), ...constr));
        if(snap.empty) { alert("لا توجد أسئلة مطابقة"); }
        else {
            const batch = writeBatch(db); snap.forEach(d => batch.delete(d.ref));
            await batch.commit(); alert(`تم حذف ${snap.size} سؤال.`); loadStats();
            isCacheLoaded = false;
        }
    } catch(e) { alert("خطأ: " + e.message); }
    btn.innerText = "حذف الحزمة";
};

// Full Backup (All Questions)
el('btn-backup').onclick = async () => { 
    const btn = el('btn-backup'); 
    btn.innerText = "جاري التحميل..."; 
    const snap = await getDocs(collection(db,"questions")); 
    const data = []; 
    snap.forEach(d => data.push(d.data())); 
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'})); 
    a.download = `Full_Backup_${new Date().toISOString().split('T')[0]}.json`; 
    a.click(); 
    btn.innerText = "تصدير"; 
};

// Nuke (Delete All Questions)
el('btn-nuke').onclick = async () => { 
    if(prompt("تحذير: هذا سيحذف جميع الأسئلة! اكتب 'حذف الكل' للتأكيد:") === "حذف الكل") { 
        const s = await getDocs(collection(db,"questions")); 
        const b = writeBatch(db); 
        let c=0; 
        s.forEach(d => { b.delete(d.ref); c++; }); 
        if(c>0) await b.commit(); 
        alert(`تم حذف ${c} سؤال.`); 
        loadStats(); 
    } 
};


// ------------------------------------
// MIGRATION ENGINE (Import/Export with IDs)
// ------------------------------------

/**
 * دالة استعادة التواريخ بعد الترحيل
 */
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

/**
 * دالة التصدير العامة (تحفظ البيانات مع ID الأصلي)
 */
async function exportCollection(colName, filename, btnId) {
    const btn = el(btnId);
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span class="material-symbols-rounded spinner">sync</span>`;
    btn.disabled = true;

    try {
        const snap = await getDocs(collection(db, colName));
        const data = [];
        snap.forEach(d => {
            data.push({ _docId: d.id, ...d.data() });
        });

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_(${data.length})_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        toast(`تم تصدير ${data.length} مستند بنجاح ✅`);
    } catch (e) {
        console.error(e);
        alert("خطأ في التصدير: " + e.message);
    } finally {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
}

/**
 * دالة الاستيراد العامة (تستعيد البيانات بنفس الـ ID)
 */
async function importCollection(colName, fileInputId, progressId) {
    const input = el(fileInputId);
    const file = input.files[0];
    if (!file) return;

    const progressEl = el(progressId);
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
                
                if (!docId) { console.warn("عنصر بدون ID:", item); errorCount++; continue; }

                delete item._docId;
                item = restoreTimestamps(item);

                batch.set(doc(db, colName, docId), item);
                
                if ((i + 1) % BATCH_SIZE === 0) {
                    await batch.commit();
                    batch = writeBatch(db); 
                    progressEl.innerText = `جاري المعالجة: ${i + 1} / ${data.length}`;
                }
                successCount++;
            }
            // تنفيذ الدفعة الأخيرة
            await batch.commit(); 

            progressEl.innerText = `✅ تم! نجح: ${successCount} | فشل: ${errorCount}`;
            progressEl.className = "text-xs text-center mt-2 text-green-400 font-bold";
            toast(`تم استيراد ${successCount} مستند بنجاح`);
            
            if(colName === 'questions') { loadStats(); isCacheLoaded = false; }
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

// تصدير "أخرى" (البلاغات والنظام)
el('btn-export-others-json').onclick = async () => {
     const btn = el('btn-export-others-json');
     btn.disabled = true; btn.innerHTML = '...';
     try {
         const reports = []; (await getDocs(collection(db, "reports"))).forEach(d => reports.push({_docId: d.id, ...d.data(), _collection: 'reports'}));
         const system = []; (await getDocs(collection(db, "system"))).forEach(d => system.push({_docId: d.id, ...d.data(), _collection: 'system'}));
         const combined = [...reports, ...system];
         
         const blob = new Blob([JSON.stringify(combined, null, 2)], { type: 'application/json' });
         const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Others_Backup_${combined.length}.json`;
         document.body.appendChild(a); a.click(); document.body.removeChild(a);
         toast(`تم تصدير ${combined.length} عنصر`);
         btn.innerHTML = `<span class="material-symbols-rounded">download</span> تصدير`; btn.disabled = false;
     } catch(e) { alert(e.message); btn.disabled=false; }
};

// استيراد "أخرى"
el('file-import-others').onchange = () => {
    const input = el('file-import-others');
    const file = input.files[0];
    if (!file) return;
    const progress = el('progress-others');
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
                delete item._collection; delete item._docId;
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
// ==========================================
// 11. AI ASSISTANT INTEGRATION (GEMINI)
// ==========================================

// (تم حذف سطر GEMINI_API_KEY من هنا لأنه تم نقله للأعلى)

/**
 * دالة عرض نافذة نتائج الذكاء الاصطناعي
 */
function showAIResultModal(analysis, qData) { 
    const modal = document.getElementById('ai-modal');
    const statusBadge = document.getElementById('ai-status-badge');
    const feedbackText = document.getElementById('ai-feedback-text');
    const suggestQ = document.getElementById('ai-suggested-q');
    const suggestExp = document.getElementById('ai-suggested-exp');
    const applyBtn = document.getElementById('btn-apply-ai-fix');
    const correctionSection = document.getElementById('ai-correction-section');

    // 1. تعبئة البيانات
    feedbackText.innerText = analysis.feedback;
    suggestQ.value = analysis.correction || qData.question;
    suggestExp.value = analysis.suggested_explanation || qData.explanation || "";

    // 2. ضبط الألوان والحالة
    if (analysis.status.includes("سليم")) {
        statusBadge.className = "px-4 py-1 rounded-full text-sm font-bold border flex items-center gap-2 bg-green-900/20 text-green-400 border-green-500/50";
        statusBadge.innerHTML = '<span class="material-symbols-rounded text-base">check_circle</span> السؤال سليم ولغته صحيحة';
        correctionSection.classList.add('hidden');
    } else {
        statusBadge.className = "px-4 py-1 rounded-full text-sm font-bold border flex items-center gap-2 bg-amber-900/20 text-amber-500 border-amber-500/50";
        statusBadge.innerHTML = '<span class="material-symbols-rounded text-base">warning</span> يحتاج إلى تحسينات';
        correctionSection.classList.remove('hidden');
    }

    // 3. برمجة زر "تطبيق التصحيحات"
    applyBtn.onclick = () => {
        const qInput = document.getElementById(`inline-q-${qData.id}`);
        const expInput = document.getElementById(`inline-exp-${qData.id}`);

        if (qInput) {
            qInput.value = suggestQ.value;
            qInput.parentElement.classList.add('ring-2', 'ring-green-500/50');
            setTimeout(()=>qInput.parentElement.classList.remove('ring-2', 'ring-green-500/50'), 1000);
        }
        
        if (expInput) {
            expInput.value = suggestExp.value;
            expInput.classList.add('border-green-500');
        }

        modal.classList.remove('active', 'flex');
        modal.classList.add('hidden');
        
        toast("تم تطبيق المقترحات! اضغط 'حفظ' لتثبيتها", "check_circle");
        
        const saveBtn = document.querySelector(`#q-row-${qData.id} .btn-quick-save`);
        if(saveBtn) {
            saveBtn.classList.add('animate-pulse', 'bg-green-600');
            setTimeout(()=> saveBtn.classList.remove('animate-pulse', 'bg-green-600'), 2000);
        }
    };

    modal.classList.remove('hidden');
    modal.classList.add('flex', 'active');
    setTimeout(() => modal.querySelector('.modal-content').classList.remove('scale-95'), 10);
}

/**
/**
 * دالة فحص السؤال باستخدام الذكاء الاصطناعي
 */
async function checkQuestionWithAI(questionData) {
    if (!window.GoogleGenerativeAI) {
        return toast("مكتبة الذكاء الاصطناعي غير محملة! تأكد من تحديث الصفحة", "error");
    }

    const btnIcon = document.getElementById(`ai-icon-${questionData.id}`);
    const btnText = document.getElementById(`ai-text-${questionData.id}`);
    
    if(btnIcon) btnIcon.innerText = "hourglass_top";
    if(btnText) btnText.innerText = "جاري الفحص...";

    try {
        const genAI = new window.GoogleGenerativeAI(GEMINI_API_KEY);
        
        // تعديل هام: استخدام الاسم الدقيق للإصدار 001 لتجنب خطأ 404
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
            بصفتك خبيراً لغوياً ومدققاً للمحتوى الإسلامي، قم بمراجعة هذا السؤال المخصص لمسابقة ثقافية:

            --- بيانات السؤال ---
            - نص السؤال: "${questionData.question}"
            - الخيارات: [${questionData.options.join(' - ')}]
            - الإجابة الصحيحة المسجلة: "${questionData.options[questionData.correctAnswer]}"
            - الشرح الإثرائي: "${questionData.explanation || 'لا يوجد'}"
            - التصنيف: "${questionData.topic}"
            ---------------------

            المطلوب منك بالتحديد:
            1. التأكد من (صحة المعلومة) دينياً وتاريخياً.
            2. مراجعة (اللغة والإملاء) بدقة.
            3. التأكد من أن الإجابة الصحيحة المختارة هي الوحيدة الصحيحة ولا يوجد غموض.
            4. إذا كان الشرح فارغاً، اقترح شرحاً مختصراً ومفيداً.

            أجبني بصيغة JSON فقط (بدون أي نصوص إضافية) بهذا الهيكل:
            {
                "status": "سليم" (أو "يحتوي على مشاكل"),
                "correction": "النص المقترح للسؤال بعد تصحيح الأخطاء (أعد كتابة السؤال كاملاً حتى لو كان صحيحاً)",
                "suggested_explanation": "نص الشرح المحسن أو المقترح",
                "feedback": "ملاحظاتك المختصرة جداً (مثلاً: خطأ إملائي في كلمة كذا، أو المعلومة غير دقيقة)"
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
        
        // التعامل مع الخطأ 404 بشكل خاص لتقديم نصيحة للمستخدم
        if (error.message.includes('404') || error.message.includes('not found')) {
            toast("موديل الذكاء الاصطناعي غير متوفر حالياً، جرب لاحقاً", "error");
        } else {
            toast("حدث خطأ أثناء الاتصال بالمساعد الذكي", "error");
        }
    } finally {
        if(btnIcon) btnIcon.innerText = "smart_toy";
        if(btnText) btnText.innerText = "فحص AI";
    }
}
