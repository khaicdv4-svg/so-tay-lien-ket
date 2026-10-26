import { firebaseConfig } from './firebase-config.js';
import { diffLinks, applyChanges } from './sync-core.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { getFirestore, doc, onSnapshot, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js';
const KEY = 'THAYKHAI_EDU_LINKS_V1';
const status = document.getElementById('cloudSyncStatus');
const login = document.getElementById('googleSignInButton');
const logout = document.getElementById('googleSignOutButton');
const app = initializeApp(firebaseConfig);
const auth = getAuth(app), db = getFirestore(app), provider = new GoogleAuthProvider();
auth.languageCode = 'vi';
provider.setCustomParameters({prompt:'select_account'});
let uid = null, unsubscribe = null, baseline = [], ready = false, pumping = false, generation = 0;
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const queueKey = id => `${KEY}:queue:${id}`;
const cacheKey = id => `${KEY}:user:${id}`;
const queue = id => read(queueKey(id), []);
const say = text => { status.textContent = text; };
function show(items) {
  baseline = structuredClone(items);
  window.applyCloudLinks(items);
  if (uid) localStorage.setItem(cacheKey(uid), JSON.stringify(items));
}
function enqueue(change) {
  if (!change.upsert.length && !change.remove.length) return;
  localStorage.setItem(queueKey(uid), JSON.stringify([...queue(uid), {...change, token:crypto.randomUUID()}]));
}
async function pump() {
  if (pumping || !uid || !ready || !navigator.onLine) return;
  const id = uid, epoch = generation;
  pumping = true;
  try {
    while (uid === id && generation === epoch && queue(id).length) {
      const changes = queue(id);
      say('Đang gửi thay đổi lên đám mây...');
      await runTransaction(db, async tx => {
        const ref = doc(db, 'users', id);
        const snapshot = await tx.get(ref);
        const current = snapshot.exists() && Array.isArray(snapshot.data().links) ? snapshot.data().links : [];
        tx.set(ref, { links:applyChanges(current, changes), updatedAt:serverTimestamp() });
      });
      const sent = new Set(changes.map(x => x.token));
      localStorage.setItem(queueKey(id), JSON.stringify(queue(id).filter(x => !sent.has(x.token))));
    }
    if (uid === id) say(`Đã đồng bộ · ${auth.currentUser?.email || ''}`);
  } catch (error) {
    console.error('Sync:', error.code);
    if (uid === id) say('Đã lưu trên thiết bị. Chưa đồng bộ; kiểm tra mạng hoặc tải lại để thử lại.');
  } finally { pumping = false; if (uid && uid !== id) pump(); }
}
window.addEventListener('so-tay-links-changed', event => {
  const items = structuredClone(event.detail.links);
  if (!uid) return;
  enqueue(diffLinks(baseline, items));
  baseline = items;
  localStorage.setItem(cacheKey(uid), JSON.stringify(items));
  pump();
});
login.hidden = false;
login.addEventListener('click', async () => {
  try { await signInWithPopup(auth, provider); }
  catch (error) { console.error('Login:', error.code); say('Chưa đăng nhập được. Cho phép cửa sổ bật lên rồi thử lại trong Safari/Chrome.'); }
});
logout.addEventListener('click', async () => {
  if (uid && queue(uid).length && !confirm('Còn thay đổi chưa đồng bộ. Chúng được giữ riêng trên thiết bị cho tài khoản này. Thầy vẫn muốn đăng xuất?')) return;
  await signOut(auth);
});
onAuthStateChanged(auth, async user => {
  const epoch = ++generation;
  if (unsubscribe) unsubscribe();
  unsubscribe = null; ready = false; uid = user?.uid || null;
  login.hidden = !!user; logout.hidden = !user;
  if (!user) {
    if (localStorage.getItem(`${KEY}:owner`)) show([]);
    say('Chưa đăng nhập · dữ liệu đã đồng bộ được giữ riêng theo tài khoản');
    return;
  }
  // Capture legacy data only once, before it is associated with any Google account.
  const owner = localStorage.getItem(`${KEY}:owner`);
  const legacy = !owner ? read(KEY, []) : [];
  if (!owner) {
    localStorage.setItem(`${KEY}:legacy-backup`, JSON.stringify(legacy));
    localStorage.setItem(`${KEY}:owner`, user.uid);
  }
  show(read(cacheKey(uid), []));
  say(`Đang kết nối · ${user.email}`);
  try {
    if (legacy.length) {
      // Add legacy items once with fresh IDs so they cannot overwrite cloud entries.
      const imported = legacy.map(link => ({...link,id:`legacy-${user.uid}-${link.id}`}));
      enqueue({upsert:imported,remove:[]});
      show(applyChanges(baseline, queue(uid)));
    }
    ready = true;
    unsubscribe = onSnapshot(doc(db,'users',user.uid), snapshot => {
      if (generation !== epoch) return;
      const items = snapshot.exists() && Array.isArray(snapshot.data().links) ? snapshot.data().links : [];
      show(applyChanges(items, queue(user.uid)));
      say(queue(user.uid).length ? 'Đã lưu trên thiết bị · đang đồng bộ...' : `Đã đồng bộ · ${user.email}`);
      pump();
    }, error => { console.error('Listener:', error.code); say('Chưa kết nối được Firestore. Dữ liệu trên thiết bị vẫn được giữ.'); });
    pump();
  } catch (error) { console.error('Init:',error.code); say('Chưa khởi tạo được đồng bộ. Thầy tải lại để thử lại.'); }
});
window.addEventListener('online', pump);
window.addEventListener('offline', () => say('Mất mạng · thay đổi được giữ trên thiết bị và gửi khi kết nối lại'));
