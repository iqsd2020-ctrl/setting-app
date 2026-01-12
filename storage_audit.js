// =========================================================
// Storage Audit (كشف حساب التخزين) — Admin Panel
// =========================================================
// يحسب حجم مستند المستخدم (تقريبي) ويعرض تفصيل الحقول والعناصر التي تشغل المساحة
// ويوفر أدوات تنظيف/حذف.
//
// ⚠️ Firestore حد المستند 1MiB هو حجم ترميز داخلي (protobuf).
// هذا الملف يحسب الحجم تقريبياً عبر UTF-8 لتمثيل JSON.

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  setDoc,
  writeBatch,
  deleteField,
  serverTimestamp,
  FieldPath
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const DOC_LIMIT_BYTES = 1048576; // 1 MiB

let _db = null;
let _el = null;
let _toast = null;

let _usersIndex = [];
let _usersLoadedAt = 0;
let _activeUserId = null;
let _activeUserDoc = null;
let _activeSelectedField = null;

function norm(s) {
  return (s || '').toString().trim().toLowerCase();
}

function fmtBytes(bytes) {
  const n = Number(bytes || 0);
  if (!Number.isFinite(n)) return '0 B';
  const units = ['B', 'KB', 'MB'];
  let val = n;
  let u = 0;
  while (val >= 1024 && u < units.length - 1) {
    val /= 1024;
    u++;
  }
  const digits = u === 0 ? 0 : 2;
  return `${val.toFixed(digits)} ${units[u]}`;
}

function utf8BytesFromString(str) {
  try {
    return new TextEncoder().encode(String(str ?? '')).length;
  } catch (_) {
    // fallback (تقريبي)
    return String(str ?? '').length;
  }
}

function jsonBytes(value) {
  try {
    return utf8BytesFromString(JSON.stringify(value));
  } catch (_) {
    // circular / bigint …
    try {
      return utf8BytesFromString(String(value));
    } catch {
      return 0;
    }
  }
}

function safeType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

async function loadUsersIndex(force = false) {
  const fresh = (Date.now() - _usersLoadedAt) < 5 * 60 * 1000;
  if (!force && _usersIndex.length && fresh) return _usersIndex;

  let snap = null;
  try {
    const q = query(collection(_db, 'users'), orderBy('username', 'asc'), limit(1200));
    snap = await getDocs(q);
  } catch (e) {
    // fallback بدون orderBy (في حال عدم وجود فهرس/حقل)
    try {
      const q = query(collection(_db, 'users'), limit(1200));
      snap = await getDocs(q);
    } catch (e2) {
      console.warn('loadUsersIndex failed', e2);
      return _usersIndex;
    }
  }

  const arr = [];
  snap.forEach(d => {
    const data = d.data() || {};
    arr.push({
      id: d.id,
      username: (data.username || '').toString().trim() || d.id,
    });
  });

  _usersIndex = arr;
  _usersLoadedAt = Date.now();
  return _usersIndex;
}

function renderUserRow(u) {
  const row = document.createElement('div');
  row.className = 'p-3 rounded-xl border border-slate-700/60 bg-slate-900/35 hover:bg-slate-900/55 transition cursor-pointer flex items-center gap-3';

  const icon = document.createElement('div');
  icon.className = 'w-10 h-10 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0';
  icon.innerHTML = '<span class="material-symbols-rounded text-cyan-300">person</span>';

  const center = document.createElement('div');
  center.className = 'min-w-0 flex-1';

  const title = document.createElement('div');
  title.className = 'text-sm font-bold truncate';
  title.textContent = u.username || u.id;

  const sub = document.createElement('div');
  sub.className = 'text-[10px] text-slate-400 truncate';
  sub.textContent = `ID: ${u.id}`;

  center.appendChild(title);
  center.appendChild(sub);

  row.appendChild(icon);
  row.appendChild(center);

  row.onclick = () => openUserAudit(u.id, u.username);
  return row;
}

function setActiveUserRow(userId) {
  const list = _el('audit-user-list');
  if (!list) return;
  [...list.children].forEach(ch => {
    ch.classList.toggle('ring-2', ch.dataset?.uid === userId);
    ch.classList.toggle('ring-cyan-500/40', ch.dataset?.uid === userId);
  });
}

function renderUsersList(users) {
  const box = _el('audit-user-list');
  const cnt = _el('audit-users-count');
  if (!box || !cnt) return;

  box.innerHTML = '';
  cnt.textContent = users.length ? `${users.length} مستخدم` : '—';

  if (!users.length) {
    box.innerHTML = '<div class="text-slate-400 text-sm p-3">لا يوجد مستخدمون.</div>';
    return;
  }

  users.forEach(u => {
    const row = renderUserRow(u);
    row.dataset.uid = u.id;
    box.appendChild(row);
  });
}

function applyUsersSearch() {
  const input = _el('audit-user-search');
  if (!input) return;
  const q = norm(input.value);
  if (!q) {
    renderUsersList(_usersIndex);
    if (_activeUserId) setActiveUserRow(_activeUserId);
    return;
  }

  const hits = _usersIndex.filter(u => {
    return norm(u.username).includes(q) || norm(u.id).includes(q);
  }).slice(0, 300);

  renderUsersList(hits);
  if (_activeUserId) setActiveUserRow(_activeUserId);
}

function showPanel(show) {
  _el('audit-empty')?.classList.toggle('hidden', show);
  _el('audit-panel')?.classList.toggle('hidden', !show);
}

function setBar(barEl, pct) {
  if (!barEl) return;
  const p = Math.max(0, Math.min(100, pct || 0));
  barEl.style.width = `${p}%`;
}

function buildFieldSizes(docData) {
  const total = jsonBytes(docData);
  const rows = [];
  const keys = Object.keys(docData || {});
  for (const k of keys) {
    const v = docData[k];
    // include key overhead (تقريب): stringify({k:v})
    const bytes = jsonBytes({ [k]: v });
    rows.push({
      key: k,
      type: safeType(v),
      bytes,
      pct: total ? (bytes / total) * 100 : 0,
      value: v,
    });
  }
  rows.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  return { total, rows };
}

function renderFieldsTable(total, rows) {
  const body = _el('audit-fields-body');
  if (!body) return;
  body.innerHTML = '';

  if (!rows.length) {
    body.innerHTML = '<tr><td class="py-3 text-slate-400" colspan="4">لا توجد حقول.</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-800/60 hover:bg-slate-800/20 cursor-pointer';

    const td1 = document.createElement('td');
    td1.className = 'py-2 font-mono text-xs text-cyan-200';
    td1.textContent = r.key;

    const td2 = document.createElement('td');
    td2.className = 'py-2 text-xs text-slate-300';
    td2.textContent = r.type;

    const td3 = document.createElement('td');
    td3.className = 'py-2 text-xs font-mono text-slate-200';
    td3.textContent = fmtBytes(r.bytes);

    const td4 = document.createElement('td');
    td4.className = 'py-2 text-xs font-mono text-slate-400';
    td4.textContent = `${(r.pct || 0).toFixed(1)}%`;

    tr.appendChild(td1);
    tr.appendChild(td2);
    tr.appendChild(td3);
    tr.appendChild(td4);

    tr.onclick = () => openFieldDetail(r.key, r.value, total);

    body.appendChild(tr);
  });
}

function renderNestedList(title, items) {
  const box = _el('audit-nested-body');
  const t = _el('audit-nested-title');
  if (!box || !t) return;

  t.textContent = title;
  box.innerHTML = '';

  if (!items.length) {
    box.innerHTML = '<div class="text-slate-400 text-sm">لا يوجد تفصيل.</div>';
    return;
  }

  items.forEach(it => {
    const row = document.createElement('div');
    row.className = 'p-3 rounded-xl bg-slate-900/40 border border-slate-700/50 flex items-center justify-between gap-2';

    const left = document.createElement('div');
    left.className = 'min-w-0';

    const k = document.createElement('div');
    k.className = 'text-xs font-mono text-cyan-200 truncate';
    k.textContent = it.key;

    const s = document.createElement('div');
    s.className = 'text-[10px] text-slate-400 truncate';
    s.textContent = it.meta;

    left.appendChild(k);
    left.appendChild(s);

    const right = document.createElement('div');
    right.className = 'text-xs font-mono text-slate-200 shrink-0';
    right.textContent = fmtBytes(it.bytes);

    row.appendChild(left);
    row.appendChild(right);

    box.appendChild(row);
  });
}

function openFieldDetail(fieldKey, fieldValue, docTotalBytes) {
  _activeSelectedField = fieldKey;
  const nested = _el('audit-nested');
  if (!nested) return;

  nested.classList.remove('hidden');

  const t = safeType(fieldValue);

  if (t === 'object' && fieldValue) {
    const entries = Object.keys(fieldValue).map(k => {
      const v = fieldValue[k];
      const bytes = jsonBytes({ [k]: v });
      const meta = `${safeType(v)}`;
      return { key: k, bytes, meta };
    }).sort((a,b)=>b.bytes-a.bytes);

    // عرض أكبر 60 مفتاح
    const sliced = entries.slice(0, 60);
    const extra = entries.length > sliced.length ? ` (+${entries.length - sliced.length})` : '';
    renderNestedList(`تفصيل الحقل: ${fieldKey}${extra}`, sliced);
  } else if (t === 'array') {
    const arr = Array.isArray(fieldValue) ? fieldValue : [];
    const cap = Math.min(arr.length, 1500);
    const sizes = [];
    for (let i=0;i<cap;i++) {
      const bytes = jsonBytes(arr[i]);
      sizes.push({ idx: i, bytes });
    }
    sizes.sort((a,b)=>b.bytes-a.bytes);
    const top = sizes.slice(0, 20).map(s => ({
      key: `#${s.idx}`,
      bytes: s.bytes,
      meta: 'عنصر'
    }));
    const note = arr.length > cap ? ` (تم فحص أول ${cap} عنصر فقط)` : '';
    renderNestedList(`أكبر عناصر داخل ${fieldKey}${note}`, top);
  } else {
    const bytes = jsonBytes({ [fieldKey]: fieldValue });
    renderNestedList(`الحقل: ${fieldKey}`, [{ key: fieldKey, bytes, meta: t }]);
  }

  // تلميح نسبة الحقل داخل المستند
  try {
    const fieldBytes = jsonBytes({ [fieldKey]: fieldValue });
    const pct = docTotalBytes ? (fieldBytes / docTotalBytes) * 100 : 0;
    const lf = _el('audit-largest-field');
    const lb = _el('audit-largest-bytes');
    if (lf && lb) {
      lf.textContent = fieldKey;
      lb.textContent = `${fmtBytes(fieldBytes)} — ${(pct || 0).toFixed(1)}% من المستند`;
    }
  } catch (_) {}
}

async function estimateRelatedSizes(userId) {
  let relatedBytes = 0;
  let msgCount = 0;
  let convBytes = 0;
  let msgsBytes = 0;
  let reportCount = 0;
  let reportsBytes = 0;

  // conversations/{userId}
  try {
    const cs = await getDoc(doc(_db, 'conversations', userId));
    if (cs.exists()) {
      convBytes = jsonBytes(cs.data());
      relatedBytes += convBytes;
    }
  } catch (_) {}

  // messages
  try {
    const msgsRef = collection(_db, 'conversations', userId, 'messages');
    // ⚠️ قد تكون كبيرة. نضع سقف لحماية الأداء.
    const PAGE = 400;
    const HARD_LIMIT = 4000;
    let fetched = 0;

    // لا نعتمد orderBy لتجنب متطلبات فهرسة إضافية
    while (fetched < HARD_LIMIT) {
      const q = query(msgsRef, limit(PAGE));
      const snap = await getDocs(q);
      if (snap.empty) break;

      // لكي لا نكرر نفس الدُفعة، نحذف بعد الحساب؟ لا، فقط حساب. بدون startAfter قد يعيد نفس العناصر.
      // لذا نستخدم طريقة آمنة: حساب مرة واحدة عبر جلب كامل ضمن السقف باستخدام orderBy(FieldPath.documentId()) إن أمكن.
      break;
    }

    // محاولة أكثر دقة: orderBy(FieldPath.documentId()) عادة تعمل بدون فهرس مخصص.
    try {
      const q2 = query(msgsRef, orderBy(FieldPath.documentId()), limit(HARD_LIMIT));
      const snap2 = await getDocs(q2);
      snap2.forEach(d => {
        msgCount += 1;
        const data = d.data() || {};
        const b = jsonBytes(data);
        msgsBytes += b;
        relatedBytes += b;
      });
      // ملاحظة: إن كان أكثر من HARD_LIMIT لن نكمل؛ سنذكر ذلك في الميتا.
      fetched = snap2.size;
    } catch (e) {
      // fallback: جلب بدون orderBy (قد يكون ترتيب غير ثابت، لكن غالباً يعمل)
      const q3 = query(msgsRef, limit(HARD_LIMIT));
      const snap3 = await getDocs(q3);
      snap3.forEach(d => {
        msgCount += 1;
        const data = d.data() || {};
        const b = jsonBytes(data);
        msgsBytes += b;
        relatedBytes += b;
      });
      fetched = snap3.size;
    }

    // حفظ ملاحظة السقف ضمن meta
    const relatedMeta = _el('audit-related-meta');
    if (relatedMeta) {
      const capNote = (msgCount >= HARD_LIMIT) ? ` (تم حساب أول ${HARD_LIMIT} رسالة فقط)` : '';
      relatedMeta.textContent = `المحادثة: ${fmtBytes(convBytes)} — الرسائل: ${msgCount} / ${fmtBytes(msgsBytes)}${capNote}`;
    }

  } catch (e) {
    console.warn('estimate messages size failed', e);
  }

  // reports where userId == ...
  try {
    const rQ = query(collection(_db, 'reports'), where('userId', '==', userId), limit(1000));
    const rs = await getDocs(rQ);
    reportCount = rs.size;
    rs.forEach(d => {
      const b = jsonBytes(d.data() || {});
      reportsBytes += b;
      relatedBytes += b;
    });
  } catch (_) {}

  return {
    relatedBytes,
    msgCount,
    convBytes,
    msgsBytes,
    reportCount,
    reportsBytes,
  };
}

async function openUserAudit(userId, usernameHint = '') {
  if (!userId) return;
  _activeUserId = userId;

  showPanel(true);
  setActiveUserRow(userId);

  _el('audit-title').textContent = usernameHint || userId;
  _el('audit-subtitle').textContent = `ID: ${userId}`;

  _el('audit-json').value = '';
  _el('audit-fields-body').innerHTML = '';
  _el('audit-nested')?.classList.add('hidden');
  _activeSelectedField = null;

  await reloadActiveUser();
}

async function reloadActiveUser() {
  if (!_activeUserId) return;

  const userId = _activeUserId;
  const userRef = doc(_db, 'users', userId);
  const snap = await getDoc(userRef).catch(() => null);
  if (!snap || !snap.exists()) {
    _toast?.('المستخدم غير موجود', 'error');
    return;
  }

  const data = snap.data() || {};
  _activeUserDoc = data;

  // JSON textarea
  const jsonBox = _el('audit-json');
  if (jsonBox) {
    jsonBox.value = JSON.stringify(data, null, 2);
  }

  // sizes
  const { total, rows } = buildFieldSizes(data);

  const pct = total ? (total / DOC_LIMIT_BYTES) * 100 : 0;
  _el('audit-doc-size').textContent = fmtBytes(total);
  setBar(_el('audit-doc-bar'), pct);

  const remaining = Math.max(0, DOC_LIMIT_BYTES - total);
  _el('audit-doc-meta').textContent = `المتبقي: ${fmtBytes(remaining)} — ${(pct || 0).toFixed(1)}% من 1MiB`;

  // largest field
  const largest = rows[0] || null;
  if (largest) {
    _el('audit-largest-field').textContent = largest.key;
    _el('audit-largest-bytes').textContent = `${fmtBytes(largest.bytes)} — ${(largest.pct || 0).toFixed(1)}% من المستند`;
  } else {
    _el('audit-largest-field').textContent = '—';
    _el('audit-largest-bytes').textContent = '—';
  }

  renderFieldsTable(total, rows);

  // related sizes (conversation/messages/reports)
  _el('audit-related-size').textContent = '...';
  _el('audit-related-meta').textContent = '...';
  const rel = await estimateRelatedSizes(userId);
  _el('audit-related-size').textContent = fmtBytes(rel.relatedBytes + total);
  if (!_el('audit-related-meta').textContent || _el('audit-related-meta').textContent === '...') {
    _el('audit-related-meta').textContent = `رسائل: ${rel.msgCount} — بلاغات: ${rel.reportCount}`;
  }
}

async function deleteSelectedField() {
  if (!_activeUserId || !_activeSelectedField) return;
  const field = _activeSelectedField;

  if (!confirm(`حذف الحقل "${field}" من مستند المستخدم؟`)) return;

  try {
    await updateDoc(doc(_db, 'users', _activeUserId), {
      [field]: deleteField(),
      updatedAt: serverTimestamp(),
    });
    _toast?.('تم حذف الحقل', 'delete');
    await reloadActiveUser();
  } catch (e) {
    console.error(e);
    _toast?.('فشل حذف الحقل', 'error');
  }
}

async function clearSelectedField() {
  if (!_activeUserId || !_activeSelectedField) return;
  const field = _activeSelectedField;

  if (!confirm(`تفريغ الحقل "${field}"؟ (سيصبح فارغاً)`)) return;

  const v = _activeUserDoc ? _activeUserDoc[field] : null;
  const t = safeType(v);
  let newVal = null;
  if (t === 'array') newVal = [];
  else if (t === 'object') newVal = {};
  else newVal = null;

  try {
    await updateDoc(doc(_db, 'users', _activeUserId), {
      [field]: newVal,
      updatedAt: serverTimestamp(),
    });
    _toast?.('تم التفريغ', 'cleaning_services');
    await reloadActiveUser();
  } catch (e) {
    console.error(e);
    _toast?.('فشل التفريغ', 'error');
  }
}

async function saveJson(merge = true) {
  if (!_activeUserId) return;
  const box = _el('audit-json');
  if (!box) return;

  let obj = null;
  try {
    obj = JSON.parse(box.value || '{}');
  } catch {
    _toast?.('JSON غير صالح', 'error');
    return;
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    _toast?.('يجب أن يكون JSON كائن (object)', 'error');
    return;
  }

  const msg = merge ? 'حفظ دمج على المستند؟' : 'حفظ استبدال كامل للمستند؟';
  if (!confirm(msg)) return;

  try {
    if (merge) {
      await setDoc(doc(_db, 'users', _activeUserId), { ...obj, updatedAt: serverTimestamp() }, { merge: true });
    } else {
      await setDoc(doc(_db, 'users', _activeUserId), { ...obj, updatedAt: serverTimestamp() }, { merge: false });
    }
    _toast?.('تم الحفظ', 'save');
    await reloadActiveUser();
  } catch (e) {
    console.error(e);
    _toast?.('فشل الحفظ', 'error');
  }
}

async function deleteAllDocsInCollection(colRef, hardLimit = 20000) {
  let deleted = 0;
  const PAGE = 450;

  while (deleted < hardLimit) {
    const snap = await getDocs(query(colRef, limit(PAGE))).catch(() => null);
    if (!snap || snap.empty) break;

    const batch = writeBatch(_db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();

    deleted += snap.size;
    if (snap.size < PAGE) break;
  }

  return deleted;
}

async function deleteUserMessages() {
  if (!_activeUserId) return;
  if (!confirm('حذف كل رسائل المحادثة لهذا المستخدم؟')) return;

  try {
    const msgsRef = collection(_db, 'conversations', _activeUserId, 'messages');
    const n = await deleteAllDocsInCollection(msgsRef, 20000);
    await updateDoc(doc(_db, 'conversations', _activeUserId), {
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      unreadByUser: false,
      unreadByDeveloper: false,
    }).catch(()=>{});

    _toast?.(`تم حذف ${n} رسالة`, 'delete_sweep');
    await reloadActiveUser();
  } catch (e) {
    console.error(e);
    _toast?.('فشل حذف الرسائل', 'error');
  }
}

async function deleteUserReports() {
  if (!_activeUserId) return;
  if (!confirm('حذف بلاغات هذا المستخدم؟')) return;

  try {
    const rs = await getDocs(query(collection(_db, 'reports'), where('userId', '==', _activeUserId), limit(1000))).catch(()=>null);
    if (!rs || rs.empty) {
      _toast?.('لا توجد بلاغات', 'info');
      return;
    }

    // batch delete (<=500)
    let deleted = 0;
    const docs = rs.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const slice = docs.slice(i, i + 450);
      const batch = writeBatch(_db);
      slice.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += slice.length;
    }

    _toast?.(`تم حذف ${deleted} بلاغ`, 'delete_sweep');
    await reloadActiveUser();
  } catch (e) {
    console.error(e);
    _toast?.('فشل حذف البلاغات', 'error');
  }
}

async function deleteUserFully() {
  if (!_activeUserId) return;

  if (!confirm('حذف المستخدم بالكامل مع بيانات المحادثة؟')) return;

  try {
    const msgsRef = collection(_db, 'conversations', _activeUserId, 'messages');
    await deleteAllDocsInCollection(msgsRef, 20000).catch(()=>{});

    await deleteDoc(doc(_db, 'conversations', _activeUserId)).catch(()=>{});
    await deleteDoc(doc(_db, 'users', _activeUserId)).catch(()=>{});

    _toast?.('تم حذف المستخدم', 'delete');

    // تحديث القائمة
    _activeUserId = null;
    _activeUserDoc = null;
    _activeSelectedField = null;

    showPanel(false);
    await refreshUsers(true);

  } catch (e) {
    console.error(e);
    _toast?.('فشل حذف المستخدم', 'error');
  }
}

async function openUserEditPage() {
  if (!_activeUserId) return;
  // استخدام صفحة تحرير المستخدم الحالية الموجودة بالتطبيق
  try {
    window.__lastTabBeforeUserEdit = 'view-storage-audit';
    window.openUserEdit?.(_activeUserId);
  } catch (_) {
    _toast?.('تعذر فتح صفحة التحرير', 'error');
  }
}

async function refreshUsers(force = false) {
  await loadUsersIndex(force);
  renderUsersList(_usersIndex);
  if (_activeUserId) setActiveUserRow(_activeUserId);
}

function bindUIOnce() {
  // search
  const input = _el('audit-user-search');
  if (input) {
    input.oninput = () => applyUsersSearch();
  }

  _el('audit-refresh-users')?.addEventListener('click', () => refreshUsers(true));
  _el('audit-reload-user')?.addEventListener('click', () => reloadActiveUser());

  _el('audit-delete-field')?.addEventListener('click', () => deleteSelectedField());
  _el('audit-clear-field')?.addEventListener('click', () => clearSelectedField());

  _el('audit-save-merge')?.addEventListener('click', () => saveJson(true));
  _el('audit-save-replace')?.addEventListener('click', () => saveJson(false));

  _el('audit-delete-user')?.addEventListener('click', () => deleteUserFully());
  _el('audit-delete-messages')?.addEventListener('click', () => deleteUserMessages());
  _el('audit-delete-reports')?.addEventListener('click', () => deleteUserReports());
  _el('audit-open-user-edit')?.addEventListener('click', () => openUserEditPage());

  const toggle = _el('audit-json-edit-toggle');
  const box = _el('audit-json');
  if (toggle && box) {
    toggle.onchange = () => {
      box.readOnly = !toggle.checked;
      box.classList.toggle('ring-2', toggle.checked);
      box.classList.toggle('ring-cyan-500/40', toggle.checked);
    };
  }
}

export function initStorageAudit({ db, el, toast }) {
  _db = db;
  _el = el;
  _toast = toast;

  // init UI
  if (!window.__storageAuditInited) {
    window.__storageAuditInited = true;
    bindUIOnce();
  }

  // expose open hook
  window.storageAuditOpen = async () => {
    await refreshUsers(false);
  };
}
