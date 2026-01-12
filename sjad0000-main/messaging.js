// نظام مراسلة إداري مستقل (لوحة المطور)
// يعرض المحادثات ويتيح الرد + فقاعة إشعار عامة عند وجود رسائل جديدة

import {
  collection, doc, setDoc, updateDoc, addDoc, getDoc, getDocs, writeBatch,
  query, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let _db = null;
let _el = null;
let _show = null;
let _hide = null;

let _convUnsub = null;
let _msgsUnsub = null;
let _activeConvId = null;

let _usersCache = [];
let _usersLoadedAt = 0;

function fmtTime(ts){
  try{
    const d = ts?.toDate ? ts.toDate() : null;
    if(!d) return '';
    return d.toLocaleString('ar-IQ', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' });
  }catch(_){ return ''; }
}

function norm(s){
  return (s || '').toString().trim().toLowerCase();
}

// تحميل فهرس المستخدمين (للبحث وبدء محادثة مع أي مستخدم)
async function loadUsersIndex(force=false){
  try{
    if(!force && _usersCache.length && (Date.now() - _usersLoadedAt < 5*60*1000)){
      return _usersCache;
    }
    const q = query(collection(_db,'users'), orderBy('username','asc'), limit(800));
    const snap = await getDocs(q);
    const arr = [];
    snap.forEach(d=>{
      const data = d.data() || {};
      arr.push({
        id: d.id,
        username: (data.username || '').toString().trim() || d.id
      });
    });
    _usersCache = arr;
    _usersLoadedAt = Date.now();
    return _usersCache;
  }catch(e){
    console.warn('loadUsersIndex failed', e);
    return _usersCache;
  }
}

function renderUserResultRow(u){
  const row = document.createElement('div');
  row.className = 'p-3 rounded-xl border border-slate-700/60 bg-slate-900/35 hover:bg-slate-900/55 transition cursor-pointer flex items-center gap-3';

  const icon = document.createElement('div');
  icon.className = 'w-10 h-10 rounded-full bg-slate-800/70 border border-slate-700/60 flex items-center justify-center shrink-0';
  const ic = document.createElement('span');
  ic.className = 'material-symbols-rounded text-emerald-300';
  ic.textContent = 'person';
  icon.appendChild(ic);

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

  const right = document.createElement('div');
  right.className = 'text-[10px] text-emerald-300 shrink-0';
  right.textContent = 'بدء محادثة';

  row.appendChild(icon);
  row.appendChild(center);
  row.appendChild(right);

  row.onclick = ()=> openUserConversation(u.id, u.username);
  return row;
}

function showUserResults(show){
  const box = _el('admin-user-results');
  if(!box) return;
  box.classList.toggle('hidden', !show);
}

function applyUserSearchFilter(){
  const input = _el('admin-user-search');
  const box = _el('admin-user-results');
  if(!input || !box) return;

  const q = norm(input.value);

  const list = (_usersCache || []);

  // عند التركيز على مربع البحث: اعرض قائمة مختصرة حتى بدون كتابة
  if(!q){
    if(document.activeElement === input){
      const hits = list.slice(0, 20);
      box.innerHTML = '';
      showUserResults(true);
      if(hits.length === 0){
        box.innerHTML = '<div class="text-slate-400 text-sm p-3">لا يوجد مستخدمون.</div>';
        return;
      }
      hits.forEach(u=> box.appendChild(renderUserResultRow(u)));
      return;
    }
    box.innerHTML = '';
    showUserResults(false);
    return;
  }

  const hits = list.filter(u=>{
    const name = norm(u.username);
    return name.includes(q) || norm(u.id).includes(q);
  }).slice(0, 30);

  box.innerHTML = '';
  showUserResults(true);

  if(hits.length === 0){
    box.innerHTML = '<div class="text-slate-400 text-sm p-3">لا يوجد تطابق.</div>';
    return;
  }
  hits.forEach(u=> box.appendChild(renderUserResultRow(u)));
}

async function ensureConversationDoc(convId, username){
  const ref = doc(_db, 'conversations', convId);
  const snap = await getDoc(ref).catch(()=>null);
  if(!snap || !snap.exists()){
    await setDoc(ref, {
      userId: convId,
      username: (username || convId),
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      unreadByUser: false,
      unreadByDeveloper: false
    }, { merge: true }).catch(()=>{});
  }else{
    const d = snap.data() || {};
    if((!d.username) && username){
      await updateDoc(ref, { username }).catch(()=>{});
    }
  }
}

async function openUserConversation(userId, username){
  if(!userId) return;
  await ensureConversationDoc(userId, username);

  const input = _el('admin-user-search');
  if(input){ input.value = ''; }
  applyUserSearchFilter();

  const convSnap = await getDoc(doc(_db,'conversations',userId)).catch(()=>null);
  const data = convSnap?.data ? (convSnap.data() || {}) : ({ username });

  await openConversation(userId, data);
}


function setBubble(unreadCount){
  const bubble = _el('admin-msg-bubble');
  const badge = _el('admin-msg-badge');
  if(!bubble || !badge) return;

  if(unreadCount > 0){
    bubble.classList.remove('hidden');
    badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
    badge.classList.remove('hidden');
  } else {
    badge.textContent = '';
    badge.classList.add('hidden');
    bubble.classList.add('hidden');
  }
}

function clearMessagesListener(){
  if(_msgsUnsub){
    try{ _msgsUnsub(); }catch(_){}
    _msgsUnsub = null;
  }
}

function renderConversationRow(convId, data){
  const row = document.createElement('div');
  row.className = 'p-3 rounded-xl border border-slate-700/60 bg-slate-900/40 hover:bg-slate-900/70 cursor-pointer transition flex items-center gap-3';
  row.dataset.convid = convId;

  const icon = document.createElement('div');
  icon.className = 'w-10 h-10 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center';
  icon.innerHTML = '<span class="material-symbols-rounded text-amber-300">person</span>';

  const center = document.createElement('div');
  center.className = 'flex-1 min-w-0';
  const name = document.createElement('div');
  name.className = 'font-bold text-sm truncate';
  name.textContent = data.username || convId;

  const last = document.createElement('div');
  last.className = 'text-xs text-slate-400 truncate mt-0.5';
  last.textContent = data.lastMessage || '';

  center.appendChild(name);
  center.appendChild(last);

  const right = document.createElement('div');
  right.className = 'shrink-0 flex flex-col items-end gap-1';

  const t = document.createElement('div');
  t.className = 'text-[10px] text-slate-500';
  t.textContent = fmtTime(data.lastMessageAt);

  right.appendChild(t);

  if(data.unreadByDeveloper){
    const dot = document.createElement('div');
    dot.className = 'w-3 h-3 rounded-full bg-red-500 border-2 border-slate-900';
    right.appendChild(dot);
  }

  row.appendChild(icon);
  row.appendChild(center);
  row.appendChild(right);

  row.onclick = ()=> openConversation(convId, data);
  return row;
}

function renderMessageBubble(msg){
  const wrap = document.createElement('div');
  const isDev = msg.sender === 'developer';
  wrap.className = `w-full flex ${isDev ? 'justify-end' : 'justify-start'}`;

  const bubble = document.createElement('div');
  bubble.className = [
    'max-w-[85%] rounded-2xl px-3 py-2 border text-sm leading-relaxed',
    isDev ? 'bg-emerald-500/15 border-emerald-500/25' : 'bg-slate-800/70 border-slate-700'
  ].join(' ');

  const txt = document.createElement('div');
  txt.className = 'whitespace-pre-wrap break-words';
  txt.textContent = msg.text || '';
  bubble.appendChild(txt);

  const meta = document.createElement('div');
  meta.className = `mt-1 text-[10px] opacity-70 flex items-center gap-1 ${isDev ? 'justify-start text-left' : 'justify-end text-right'}`;

  const t = document.createElement('span');
  t.textContent = fmtTime(msg.createdAt);
  meta.appendChild(t);

  // ✓✓ عند قراءة المستخدم لرسائل المطور
  if(isDev){
    const ticks = document.createElement('span');
    const read = !!(msg.readByUser);
    ticks.textContent = read ? '✓✓' : '✓';
    ticks.className = 'opacity-80';
    meta.appendChild(ticks);
  }

  bubble.appendChild(meta);

  wrap.appendChild(bubble);
  return wrap;
}

function scrollThreadBottom(){
  const box = _el('admin-chat-thread');
  if(!box) return;
  box.scrollTop = box.scrollHeight + 9999;
}

async function markIncomingMessagesReadByDeveloper(snap, convId){
  if(!_db || !convId) return;
  let changed = 0;
  const batch = writeBatch(_db);

  snap.forEach(docu=>{
    const m = docu.data() || {};
    if(m.sender === 'user' && !m.readByDeveloper){
      batch.update(docu.ref, { readByDeveloper: true, readAtDeveloper: serverTimestamp() });
      changed++;
    }
  });

  if(changed){
    batch.update(doc(_db,'conversations',convId), { unreadByDeveloper: false });
    await batch.commit().catch(()=>{});
  }
}

async function openConversation(convId, data){
  _activeConvId = convId;

  // إظهار منطقة الدردشة
  _hide('admin-chat-empty');
  _show('admin-chat-panel');

  // عنوان
  _el('admin-chat-title').textContent = data.username ? `${data.username}` : `${convId}`;
  _el('admin-chat-subtitle').textContent = `ID: ${convId}`;

  // تحديد المحادثة (تصميم)
  document.querySelectorAll('[data-convid]').forEach(x=>{
    x.classList.toggle('ring-2', x.dataset.convid === convId);
    x.classList.toggle('ring-amber-500/40', x.dataset.convid === convId);
  });

  // تعليم كمقروء للمطور
  await updateDoc(doc(_db,'conversations',convId), { unreadByDeveloper: false }).catch(()=>{});

  // استماع للرسائل
  clearMessagesListener();
  const msgsRef = collection(_db,'conversations',convId,'messages');
  const q = query(msgsRef, orderBy('createdAt','asc'), limit(400));

  const thread = _el('admin-chat-thread');
  if(thread) thread.innerHTML = '';

  _msgsUnsub = onSnapshot(q, (snap)=>{
    const thread = _el('admin-chat-thread');
    if(!thread) return;
    thread.innerHTML = '';
    snap.forEach(docu=>{
      thread.appendChild(renderMessageBubble(docu.data()||{}));
    });

    // أثناء فتح المحادثة نعلّم رسائل المستخدم كمقروءة (لأجل ✓✓ لديه)
    markIncomingMessagesReadByDeveloper(snap, convId);

    scrollThreadBottom();
  });

  // على الموبايل: إظهار لوحة الدردشة وإخفاء القائمة
  if(window.innerWidth < 768){
    _el('admin-messages-layout')?.classList.add('admin-chat-open');
  }
}

async function sendAdminMessage(){
  const input = _el('admin-chat-input');
  if(!input) return;
  const text = (input.value || '').replace(/\r/g,'').trim();
  if(!text || !_activeConvId) return;

  input.value = '';
  const btn = _el('admin-chat-send');
  if(btn) btn.disabled = true;

  try{
    const convRef = doc(_db,'conversations',_activeConvId);
    const msgsRef = collection(_db,'conversations',_activeConvId,'messages');

    await addDoc(msgsRef, {
      sender: 'developer',
      text,
      createdAt: serverTimestamp(),
      // Read receipts
      readByDeveloper: true,
      readByUser: false
    });

    await setDoc(convRef, {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
      unreadByUser: true,
      unreadByDeveloper: false
    }, { merge: true });

    scrollThreadBottom();
  } finally {
    if(btn) btn.disabled = false;
  }
}

function wireUI(){
  // فقاعة الرسائل
  _el('admin-msg-bubble')?.addEventListener('click', ()=>{
    window.triggerTab?.('view-messages');
  });

  // البحث عن مستخدم وبدء محادثة
  const search = _el('admin-user-search');
  search?.addEventListener('input', ()=> applyUserSearchFilter());
  search?.addEventListener('focus', async ()=>{
    await loadUsersIndex(false);
    applyUserSearchFilter();
  });
  search?.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape'){
      search.value = '';
      applyUserSearchFilter();
      search.blur();
    }
  });

  _el('admin-users-refresh')?.addEventListener('click', async ()=>{
    await loadUsersIndex(true);
    applyUserSearchFilter();
  });

  // رجوع للموبايل من الدردشة إلى القائمة
  _el('admin-chat-back')?.addEventListener('click', ()=>{
    _el('admin-messages-layout')?.classList.remove('admin-chat-open');
  });

  _el('admin-chat-send')?.addEventListener('click', (e)=>{
    e.preventDefault();
    sendAdminMessage();
  });

  _el('admin-chat-input')?.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' && !e.shiftKey){
      e.preventDefault();
      sendAdminMessage();
    }
  });
}

function listenConversations(){
  if(_convUnsub){
    try{ _convUnsub(); }catch(_){}
    _convUnsub = null;
  }

  const list = _el('admin-conv-list');
  if(list) list.innerHTML = '<div class="text-slate-400 text-sm p-3">جاري التحميل...</div>';

  const q = query(collection(_db,'conversations'), orderBy('lastMessageAt','desc'), limit(200));

  _convUnsub = onSnapshot(q, (snap)=>{
    const list = _el('admin-conv-list');
    if(!list) return;

    let unread = 0;
    const rows = [];
    snap.forEach(d=>{
      const data = d.data() || {};
      if(data.unreadByDeveloper) unread++;
      rows.push({ id: d.id, data });
    });

    setBubble(unread);

    list.innerHTML = '';
    if(rows.length === 0){
      list.innerHTML = '<div class="text-slate-400 text-sm p-3">لا توجد محادثات.</div>';
      return;
    }

    rows.forEach(r=>{
      list.appendChild(renderConversationRow(r.id, r.data));
    });

    // تحديث عنوان المحادثة المفتوحة (إن وجدت)
    if(_activeConvId){
      const active = rows.find(x=>x.id===_activeConvId);
      if(active){
        _el('admin-chat-title').textContent = active.data.username || _activeConvId;
        _el('admin-chat-subtitle').textContent = `ID: ${_activeConvId}`;
      }
    }
  });
}

export function initAdminMessaging({ db, el, show, hide }){
  _db = db;
  _el = el;
  _show = (id)=> show(id);
  _hide = (id)=> hide(id);

  wireUI();

  // دالة يستدعيها app.js عند فتح تبويب الرسائل
  window.adminMessagingOpen = () => {
    // فتح الـ View والتأكد من الاستماع
    listenConversations();
    loadUsersIndex(false).then(()=> applyUserSearchFilter());
    // في حالة لم يكن هناك محادثة مختارة نعرض placeholder
    _show('admin-chat-empty');
    _hide('admin-chat-panel');
    _el('admin-messages-layout')?.classList.remove('admin-chat-open');
    // فوكس على القائمة
    _el('admin-conv-list')?.scrollTo(0,0);
  };

  // البدء بالاستماع للفقاعة (حتى لو لم يفتح تبويب الرسائل)
  listenConversations();
}
