/* GestHôte — PMS / channel manager pour locations courte durée (démo).
 * Vanilla JS, aucune dépendance. État persisté en localStorage.
 * Modules : Tableau · Planning · Réservations · Messages · Ménage · Livret · Tarifs.
 */

// ---------- Utilitaires date ----------
const DAY = 86400000;
const today0 = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const d = off => new Date(today0().getTime() + off * DAY);        // Date à J+off
const iso = dt => {                                               // 'YYYY-MM-DD' (fuseau local)
  const x = new Date(dt);
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;
};
const D = off => iso(d(off));                                     // iso à J+off
const parse = s => { const [y,m,day] = s.split('-').map(Number); return new Date(y, m-1, day); };
const nightsBetween = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
const MOIS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const JOURS = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
const fmtDate = s => { const dt = parse(s); return `${dt.getDate()} ${MOIS[dt.getMonth()]}`; };
const fmtDateJ = s => { const dt = parse(s); return `${JOURS[dt.getDay()]} ${dt.getDate()} ${MOIS[dt.getMonth()]}`; };
const money = n => n.toLocaleString('fr-FR') + ' €';

// ---------- Plateformes ----------
const PLAT = {
  airbnb:  { label: 'Airbnb',  cls: 'b-airbnb',  emoji: '🅰️' },
  booking: { label: 'Booking', cls: 'b-booking', emoji: '🅱️' },
  direct:  { label: 'Direct',  cls: 'b-direct',  emoji: '🔗' },
  abritel: { label: 'Abritel', cls: 'b-abritel', emoji: '🏖️' },
};

// ---------- Messages automatiques (réglages par défaut) ----------
const DEFAULT_AUTO_MESSAGES = () => [
  { id: 'reservation', label: 'Le jour de la réservation', enabled: true,
    template: "Bonjour {prenom}, votre réservation à {logement} est confirmée ✅. À bientôt !" },
  { id: 'arrival-1', label: "La veille de l'arrivée", enabled: true,
    template: "Bonjour {prenom}, votre arrivée approche ! Accès autonome dès 15h. Code porte : {code}." },
  { id: 'departure-1', label: 'La veille du départ', enabled: true,
    template: "Bonjour {prenom}, nous espérons que votre séjour se passe bien. Petit rappel : départ demain avant 11h, merci de nous laisser les clés à l'endroit convenu." },
  { id: 'departure+2h', label: '2h après le départ', enabled: true,
    template: "Merci pour votre séjour {prenom} ! Ce fut un plaisir de vous accueillir. Un avis nous aiderait beaucoup ⭐" },
];

// ---------- État initial (aucune donnée de test : à configurer par l'hôte) ----------
function seed() {
  return {
    properties: [],
    bookings: [],
    conversations: {},
    cleaning: [],
    cleaners: [],
    autoMessages: DEFAULT_AUTO_MESSAGES(),
    activePid: 'all',
    accounts: { admin: { name: 'Admin', password: 'Pialou2023-', email: '' }, user: { name: 'Utilisateur' } },
    cleaningPrices: { hourly: 0, towel: 0, sheetPair: 0 },
    v: 2,
  };
}

// ---------- État ----------
const KEY = 'gesthote.state';
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || S.v !== 2) { S = seed(); save(); }
  if (!S.accounts) { S.accounts = seed().accounts; save(); }
  if (S.accounts.admin.password === undefined) { S.accounts.admin.password = 'Pialou2023-'; save(); }
  if (S.accounts.admin.email === undefined) { S.accounts.admin.email = ''; save(); }
  if (!S.cleaningPrices) { S.cleaningPrices = seed().cleaningPrices; save(); }
  let changed = false;
  S.cleaning.forEach(c => { if (c.status === 'planned' && c.date <= D(0)) { c.status = 'todo'; changed = true; } });
  if (changed) save();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} pushCloud(); }
const prop = id => S.properties.find(p => p.id === id);

// ---------- Synchronisation cloud (optionnelle, Firebase) ----------
// Si window.FIREBASE_CONFIG est renseigné (voir index.html), les données sont
// synchronisées en temps réel via Firestore entre tous les appareils connectés
// au même projet Firebase. Sinon (par défaut), l'app reste 100% locale,
// exactement comme avant — aucun changement de comportement.
let cloudMode = false, cloudReady = false;
let fbDb = null, fbAuth = null, fbUnsub = null, applyingRemoteUpdate = false, cloudPushTimer = null;
const fb = {};

async function initCloudSync() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey) return false;
  try {
    const [{ initializeApp }, firestoreMod, authMod] = await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js'),
      import('https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js'),
    ]);
    const app = initializeApp(cfg);
    // Les WebView Android (utilisées par l'app Capacitor) ne supportent pas
    // toujours les flux HTTP/2 streaming dont Firestore a besoin par défaut
    // (getFirestore), ce qui provoque des erreurs "unavailable" au moment de
    // lire/écrire un document alors que l'authentification (simple HTTPS)
    // fonctionne. On force donc le long-polling, fiable dans une WebView.
    fbDb = firestoreMod.initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
      useFetchStreams: false,
    });
    fbAuth = authMod.getAuth(app);
    Object.assign(fb, {
      doc: firestoreMod.doc, getDoc: firestoreMod.getDoc,
      onSnapshot: firestoreMod.onSnapshot, setDoc: firestoreMod.setDoc,
      signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
      signOut: authMod.signOut,
    });
    cloudMode = true;
    return true;
  } catch (e) {
    console.error('Firebase indisponible, passage en mode local', e);
    return false;
  }
}
const workspaceDocRef = () => fb.doc(fbDb, 'workspace', 'default');

function subscribeCloud() {
  if (fbUnsub) fbUnsub();
  fbUnsub = fb.onSnapshot(workspaceDocRef(), snap => {
    if (!snap.exists()) { pushCloud(); return; }
    applyingRemoteUpdate = true;
    S = snap.data();
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    render();
    applyingRemoteUpdate = false;
  });
}

function pushCloud() {
  if (!cloudMode || !cloudReady || applyingRemoteUpdate) return;
  clearTimeout(cloudPushTimer);
  cloudPushTimer = setTimeout(() => {
    fb.setDoc(workspaceDocRef(), S).catch(e => console.error('Échec de synchro cloud', e));
  }, 500);
}

async function attemptCloudLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const msg = document.getElementById('lock-msg');
  let cred;
  try {
    cred = await fb.signInWithEmailAndPassword(fbAuth, email, password);
  } catch (e) {
    if (msg) msg.textContent = e.code === 'auth/network-request-failed'
      ? '⛔ Pas de connexion internet — réessayez.'
      : '⛔ Email ou mot de passe incorrect.';
    return;
  }
  try {
    const snap = await fb.getDoc(workspaceDocRef());
    let needsPush = !snap.exists();
    if (snap.exists()) {
      S = snap.data();
      try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
    }
    // window.ADMIN_EMAIL (défini dans index.html) fait toujours autorité
    // quand il est renseigné : ça évite qu'un document cloud désynchronisé
    // ou créé par erreur par un autre compte ne prive le vrai administrateur
    // de ses droits (auto-réparation de S.accounts.admin.email si besoin).
    // À défaut, on garde l'ancien comportement : le tout premier compte à se
    // connecter (document inexistant) devient Admin.
    const adminEmail = window.ADMIN_EMAIL || '';
    const shouldBeAdmin = adminEmail ? (email === adminEmail) : !snap.exists();
    if (shouldBeAdmin && S.accounts.admin.email !== email) {
      S.accounts.admin.email = email;
      needsPush = true;
    }
    if (needsPush) await fb.setDoc(workspaceDocRef(), S);
    currentRole = (email === S.accounts.admin.email) ? 'admin' : 'user';
    cloudReady = true;
    setLastEmail(email);
    resetIdleTimer();
    subscribeCloud();
    render();
  } catch (e) {
    if (msg) msg.textContent = `⛔ Connecté, mais accès à la base refusé (${e.code || e.message}). Vérifiez les règles Firestore.`;
  }
}
const booking = id => S.bookings.find(b => b.id === id);

// ---------- Authentification (mot de passe Admin, accès direct Utilisateur) ----------
// Deux comptes : Admin (protégé par mot de passe, accès complet) et
// Utilisateur (aucun mot de passe, accès direct, droits restreints).
let currentRole = null;
const isAdmin = () => currentRole === 'admin';

const LAST_EMAIL_KEY = 'gesthote.lastEmail';
const lastEmail = () => { try { return localStorage.getItem(LAST_EMAIL_KEY) || ''; } catch (e) { return ''; } };
const setLastEmail = email => { try { localStorage.setItem(LAST_EMAIL_KEY, email); } catch (e) {} };

const pwToggleBtn = id => `<button type="button" class="btn ghost" data-pw-toggle="${id}" style="padding:0 16px" aria-label="Afficher le mot de passe">👁</button>`;

function renderLock() {
  if (typeof checkForUpdate === 'function') checkForUpdate();
  app.innerHTML = `
    <div class="screen" style="display:flex;flex-direction:column;justify-content:center;align-items:center;gap:22px;min-height:calc(100vh - var(--nav-h) - var(--safe-b) - var(--safe-t) - 32px);padding:24px;text-align:center">
      <img src="img/logo-chalets-du-pialou.jpg" alt="" style="width:88px;height:88px;border-radius:20px;object-fit:cover">
      <div><h1 style="margin:0 0 4px">GestHôte</h1><div class="small muted">${cloudMode ? 'Connectez-vous' : 'Choisissez votre compte'}</div></div>
      ${cloudMode ? `
      <div style="width:100%;max-width:320px">
        <input id="login-email" type="email" placeholder="Email" autofocus value="${lastEmail()}"
          style="width:100%;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);text-align:center">
        <div style="display:flex;gap:8px;margin-top:10px">
          <input id="login-password" type="password" placeholder="Mot de passe"
            style="flex:1;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);text-align:center">
          ${pwToggleBtn('login-password')}
        </div>
        <button class="btn block" id="cloud-login-go" style="margin-top:10px">Se connecter</button>
        <div id="lock-msg" class="small muted" style="margin-top:8px"></div>
      </div>` : `
      <div style="display:flex;flex-direction:column;gap:12px;width:100%;max-width:320px">
        <button class="btn block" data-login="admin">👤 ${S.accounts.admin.name}</button>
        <button class="btn ghost block" data-login="user">👤 ${S.accounts.user.name}</button>
      </div>
      <div id="lock-form" style="width:100%;max-width:320px"></div>`}
    </div>`;
  app.querySelectorAll('[data-pw-toggle]').forEach(el => el.onclick = () => {
    const input = document.getElementById(el.dataset.pwToggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? '🙈' : '👁';
  });
  if (cloudMode) {
    const submit = () => attemptCloudLogin();
    document.getElementById('cloud-login-go').onclick = submit;
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  } else {
    app.querySelectorAll('[data-login]').forEach(el => el.onclick = () => attemptLogin(el.dataset.login));
  }
}

function attemptLogin(role) {
  if (role === 'user') { currentRole = 'user'; resetIdleTimer(); render(); return; }
  const box = document.getElementById('lock-form');
  box.innerHTML = `
    <div style="display:flex;gap:8px;margin-top:6px">
      <input id="admin-pass" type="password" placeholder="Mot de passe Admin" autofocus
        style="flex:1;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);text-align:center">
      ${pwToggleBtn('admin-pass')}
    </div>
    <button class="btn block" id="admin-pass-go" style="margin-top:10px">Se connecter</button>
    <div id="lock-msg" class="small muted" style="margin-top:8px"></div>`;
  box.querySelectorAll('[data-pw-toggle]').forEach(el => el.onclick = () => {
    const input = document.getElementById(el.dataset.pwToggle);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    el.textContent = show ? '🙈' : '👁';
  });
  const input = box.querySelector('#admin-pass');
  input.focus();
  const submit = () => {
    if (input.value === S.accounts.admin.password) { currentRole = 'admin'; resetIdleTimer(); render(); }
    else { document.getElementById('lock-msg').textContent = '⛔ Mot de passe incorrect.'; input.value = ''; input.focus(); }
  };
  box.querySelector('#admin-pass-go').onclick = submit;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

function lockApp() {
  currentRole = null;
  cloudReady = false;
  clearTimeout(idleTimer);
  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  if (cloudMode) fb.signOut(fbAuth).catch(() => {});
  renderLock();
}

// ---------- Déconnexion automatique après inactivité ----------
const IDLE_MS = 5 * 60 * 1000;
let idleTimer = null;
function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!currentRole) return;
  idleTimer = setTimeout(() => {
    if (currentRole) { lockApp(); toast('🔒 Déconnecté pour inactivité'); }
  }, IDLE_MS);
}
['click', 'keydown', 'touchstart', 'pointerdown'].forEach(evt =>
  document.addEventListener(evt, resetIdleTimer, { passive: true }));

// ---------- Routeur ----------
let TAB = 'home';
const app = document.getElementById('app');

function render() {
  if (TAB === 'home' && !isAdmin()) TAB = 'cleaning';
  const views = { home: vHome, plan: vPlanning, cleaning: vCleaning, checkio: vCheckInOut, plus: vPlus };
  const body = (views[TAB] || vHome)();
  app.innerHTML = `<div class="screen">${body}</div>${nav()}`;
  wire();
  app.querySelector('.screen').scrollTo?.(0, 0);
}

function nav() {
  const items = [
    ...(isAdmin() ? [['home', '📊', 'Tableau']] : []),
    ['plan', '📅', 'Planning'],
    ['cleaning', '🧹', 'Ménages'],
    ['checkio', '🔑', 'Entretien'],
    ['plus', '☰', 'Plus'],
  ];
  return `<div class="nav">${items.map(([k, ic, l]) => `
    <button data-tab="${k}" class="${TAB === k ? 'active' : ''}">
      <span class="wrap"><span class="ico">${ic}</span><span>${l}</span></span>
    </button>`).join('')}</div>`;
}

// ---------- Filtre logement ----------
function propSwitch() {
  const chip = (id, label, color) =>
    `<button class="prop-chip ${S.activePid === id ? 'active' : ''}" data-pid="${id}">
       ${color ? `<span class="dot" style="background:${color}"></span>` : '🏠'} ${label}</button>`;
  return `<div class="prop-switch">
    ${chip('all', 'Tous les logements', '')}
    ${S.properties.map(p => chip(p.id, p.name, p.color)).join('')}
  </div>`;
}
const filtered = list => S.activePid === 'all' ? list : list.filter(x => x.pid === S.activePid);

// ================= TABLEAU DE BORD =================
function vHome() {
  const bks = filtered(S.bookings);
  const arr = bks.filter(b => b.checkIn === D(0));
  const dep = bks.filter(b => b.checkOut === D(0));
  const inhouse = bks.filter(b => b.checkIn <= D(0) && b.checkOut > D(0));
  const upcoming = bks.filter(b => b.checkIn > D(0)).sort((a,b) => a.checkIn.localeCompare(b.checkIn));

  // Revenu du mois : réservations dont le séjour touche le mois courant
  const now = today0();
  const monthRevenue = bks
    .filter(b => parse(b.checkIn).getMonth() === now.getMonth())
    .reduce((s, b) => s + b.amount, 0);

  // Taux d'occupation 30 j
  const props = S.activePid === 'all' ? S.properties : [prop(S.activePid)];
  let occ = 0, cap = props.length * 30;
  for (let off = 0; off < 30; off++) {
    const day = D(off);
    occ += bks.filter(b => b.checkIn <= day && b.checkOut > day).length;
  }
  const occRate = cap ? Math.round((occ / cap) * 100) : 0;

  const cleaningToday = filtered(S.cleaning).filter(c => c.date === D(0));
  const cleaningTodoToday = cleaningToday.filter(c => c.status !== 'done').length;
  const cleaningDoneToday = cleaningToday.filter(c => c.status === 'done').length;
  const alerts = alertsList();

  const bkRow = b => {
    const p = prop(b.pid);
    return `<div class="row" data-open="${b.id}">
      <div class="avatar" style="background:${b.avatarColor}">${b.guest[0]}</div>
      <div class="grow">
        <div class="title ellipsis">${b.guest}</div>
        <div class="small muted ellipsis">${p.emoji} ${p.name} · ${b.guests} pers.</div>
      </div>
      <span class="badge plat ${PLAT[b.plat].cls}">${PLAT[b.plat].label}</span>
    </div>`;
  };

  return `
  <div class="topbar"><h1>Tableau de bord</h1><span class="spacer"></span>
    <button class="btn sm" data-add>+ Résa</button></div>
  ${propSwitch()}
  <div class="kpis">
    <div class="kpi"><div class="v">${occRate}%</div><div class="l">Occupation 30 j</div>
      <div class="sub ${occRate>=60?'up':'down'}">${occRate>=60?'▲ bonne dynamique':'▼ à optimiser'}</div></div>
    <div class="kpi"><div class="v">${money(monthRevenue)}</div><div class="l">Revenu ${MOIS[now.getMonth()]}</div>
      <div class="sub up">▲ ${bks.filter(b=>parse(b.checkIn).getMonth()===now.getMonth()).length} réservations</div></div>
    <div class="kpi"><div class="v">${arr.length}·${dep.length}</div><div class="l">Arrivées · Départs (auj.)</div>
      <div class="sub muted">${inhouse.length} voyageurs sur place</div></div>
    <div class="kpi"><div class="v">${cleaningTodoToday}·${cleaningDoneToday}</div><div class="l">Ménages auj.</div>
      <div class="sub muted">${cleaningTodoToday} à faire · ${cleaningDoneToday} fait(s)</div></div>
  </div>

  ${alerts.length ? `<div class="card" style="border-color:var(--warn)">
    <h2>⚠️ À votre attention</h2>
    ${alerts.map(a => `<div class="row" ${a.open?`data-open="${a.open}"`:a.tab?`data-goto="${a.tab}"`:''}>
      <div class="grow"><div class="title small">${a.title}</div><div class="tiny muted">${a.sub}</div></div>
      <span class="badge ${a.level}">${a.tag}</span></div>`).join('')}
  </div>` : ''}

  ${arr.length ? `<div class="sec-title">Arrivées aujourd'hui</div>
    <div class="card">${arr.map(bkRow).join('')}</div>` : ''}
  ${dep.length ? `<div class="sec-title">Départs aujourd'hui</div>
    <div class="card">${dep.map(bkRow).join('')}</div>` : ''}

  <div class="sec-title">Prochaines arrivées</div>
  <div class="card">${upcoming.length ? upcoming.slice(0,5).map(b => {
    const p = prop(b.pid);
    return `<div class="row" data-open="${b.id}">
      <div class="avatar" style="background:${b.avatarColor}">${b.guest[0]}</div>
      <div class="grow"><div class="title ellipsis">${b.guest}</div>
        <div class="small muted ellipsis">${p.emoji} ${p.name}</div></div>
      <div style="text-align:right"><div class="small" style="font-weight:700">${fmtDate(b.checkIn)}</div>
        <div class="tiny muted">${b.nights} nuits</div></div>
    </div>`;
  }).join('') : '<div class="empty small">Aucune arrivée à venir</div>'}</div>`;
}

// Alertes intelligentes (améliorations)
function alertsList() {
  const out = [];
  // Sentiment négatif détecté
  for (const [id, c] of Object.entries(S.conversations)) {
    const b = booking(id); if (!b) continue;
    if (S.activePid !== 'all' && b.pid !== S.activePid) continue;
    const last = [...c.msgs].reverse().find(m => m.from === 'guest');
    if (last && sentiment(last.text) === 'neg') {
      out.push({ title: `Message négatif — ${b.guest}`, sub: 'Répondez vite pour éviter un mauvais avis',
        tag: 'Urgent', level: 'bad', open: id, isMsg: true, tab: null });
    } else if (c.unread) {
      out.push({ title: `Question sans réponse — ${b.guest}`, sub: 'Message voyageur en attente',
        tag: 'Msg', level: 'info', open: id, isMsg: true });
    }
  }
  // Avis à demander
  S.bookings.filter(b => b.review === 'pending' && (S.activePid==='all'||b.pid===S.activePid))
    .forEach(b => out.push({ title: `Demander un avis — ${b.guest}`, sub: `Parti le ${fmtDate(b.checkOut)}`,
      tag: 'Avis', level: 'warn', open: b.id }));
  return out;
}

// ================= PLANNING (calendrier multi-logements) =================
let planStart = 0;
function vPlanning() {
  const props = S.properties;
  const DAYS = 21;
  const barColor = plat => PLAT[plat].cls==='b-airbnb'?'#ff5a5f':PLAT[plat].cls==='b-booking'?'#3b82f6':PLAT[plat].cls==='b-direct'?'#a855f7':'#f59e0b';
  const barHtml = (b, span, leftOffset) => {
    const clean = S.cleaning.find(c => c.bookingId === b.id);
    const cleanerInitial = clean && clean.cleaner ? clean.cleaner.trim()[0].toUpperCase() : '';
    return `<div class="res-bar" ${isAdmin() ? `data-open="${b.id}"` : ''}
      style="background:${barColor(b.plat)};
      left:${leftOffset};width:calc(${span*100}% + ${span-1}px - 4px);z-index:3">${b.guest.split(' ')[0]}${cleanerInitial ? `<span class="clean-badge" title="Ménage : ${clean.cleaner}">${cleanerInitial}</span>` : ''}</div>`;
  };
  let head = '';
  for (let i = 0; i < DAYS; i++) {
    const dt = d(planStart + i), wk = dt.getDay() === 0 || dt.getDay() === 6;
    const isToday = D(planStart + i) === D(0);
    head += `<th class="${wk?'wknd':''}${isToday?' today':''}"><div class="tl-day">${JOURS[dt.getDay()][0].toUpperCase()}<b>${dt.getDate()}</b></div></th>`;
  }
  const rows = props.map(p => {
    let cells = '';
    // Séjour déjà en cours à l'ouverture de la période affichée (arrivée avant le 1er jour visible)
    const ongoing = S.bookings.find(x => x.pid === p.id && x.checkIn < D(planStart) && x.checkOut > D(planStart));
    for (let i = 0; i < DAYS; i++) {
      const dayIso = D(planStart + i);
      const wk = [0,6].includes(d(planStart+i).getDay());
      const isToday = dayIso === D(0);
      let bar = '';
      if (i === 0 && ongoing) {
        const span = Math.min(nightsBetween(D(planStart), ongoing.checkOut), DAYS);
        bar = barHtml(ongoing, span, '2px');
      } else {
        const b = S.bookings.find(x => x.pid === p.id && x.checkIn === dayIso);
        if (b) bar = barHtml(b, Math.min(b.nights, DAYS - i), 'calc(50% + 2px)');
      }
      cells += `<td class="${wk?'wknd':''}${isToday?' today':''}">${bar}</td>`;
    }
    return `<tr><th class="prop-cell">${p.emoji} ${p.name}</th>${cells}</tr>`;
  }).join('');

  const range = `${fmtDate(D(planStart))} – ${fmtDate(D(planStart + DAYS - 1))}`;
  return `
  <div class="topbar"><h1>Planning</h1><span class="spacer"></span>
    ${isAdmin() ? `<button class="btn sm" data-add>+ Résa</button>` : ''}</div>
  <div class="btn-row" style="margin-bottom:10px">
    <button class="btn ghost sm" data-plan="-7">← Semaine</button>
    <button class="btn ghost sm" data-plan="0">Aujourd'hui</button>
    <button class="btn ghost sm" data-plan="7">Semaine →</button>
    <span class="spacer" style="flex:1"></span><span class="small muted" style="align-self:center">${range}</span>
  </div>
  <div class="card" style="padding:0;overflow:hidden">
    <div class="planning-scroll"><table class="timeline">
      <thead><tr><th class="prop-cell">Logement</th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>
  <div class="small muted" style="margin-top:6px">
    <span class="badge plat b-airbnb">Airbnb</span> <span class="badge plat b-booking">Booking</span>
    <span class="badge plat b-direct">Direct</span>
  </div>`;
}

// Analyse de sentiment simplifiée (mock — remplacer par appel Claude API)
function sentiment(txt) {
  const t = txt.toLowerCase();
  const neg = ['déçu','decu','problème','probleme','fuit','ne marche pas','sale','froid','nul','horrible','plainte','rembours','mauvais'];
  const pos = ['merci','parfait','super','génial','genial','superbe','excellent','top','adoré','adore','😍','🙏','recommande'];
  if (neg.some(w => t.includes(w))) return 'neg';
  if (pos.some(w => t.includes(w))) return 'pos';
  return 'neu';
}

// Suggestion de réponse IA (mock)
function aiSuggest(convId) {
  const c = S.conversations[convId];
  const b = booking(convId), p = prop(b.pid);
  const last = [...c.msgs].reverse().find(m => m.from === 'guest');
  const t = (last?.text || '').toLowerCase();
  if (t.includes('parking')) return `Bonjour ${b.guest.split(' ')[0]}, il y a un parking public à 150 m (Indigo, ~18 €/j). Je peux vous réserver une place si besoin 🚗`;
  if (sentiment(t) === 'neg') return `Bonjour, je suis vraiment navré pour ce désagrément 🙏. J'envoie un technicien dans l'heure et vous propose un geste commercial. Puis-je vous appeler ?`;
  if (t.includes('arriv') || t.includes('heure')) return `Bonjour, l'arrivée se fait dès 15h en autonomie. Code porte : ${p.code}. Bon voyage !`;
  return `Bonjour ${b.guest.split(' ')[0]}, merci pour votre message ! Je reste à votre entière disposition 😊`;
}

// ================= PLUS (menu) =================
function vPlus() {
  const items = [
    ['cleanhist', '🧺', 'Historique des ménages', `${S.cleaning.filter(c=>c.status==='done').length} enregistré(s)`],
    ...(isAdmin() ? [
      ['stats', '📈', 'Statistiques', 'Revenus & occupation'],
      ['settings', '⚙️', 'Réglages', 'Logements, démo'],
    ] : []),
  ];
  return `
  <div class="topbar"><h1>Plus</h1></div>
  <div class="card" style="padding:4px 14px">
    ${items.map(([k, ic, l, s]) => `<div class="row" data-more="${k}">
      <div class="avatar" style="background:var(--card2);font-size:20px">${ic}</div>
      <div class="grow"><div class="title">${l}</div><div class="small muted">${s}</div></div>
      <span class="dim">›</span></div>`).join('')}
  </div>
  <button class="btn ghost block" data-lock>🔒 Changer de compte</button>
  <div class="card small muted">GestHôte v${window.APP_VERSION} — démo. Données locales à cet appareil.</div>`;
}

// ---------- Sheets (détails) ----------
function openSheet(html) {
  const bg = document.createElement('div');
  bg.className = 'sheet-bg';
  bg.innerHTML = `<div class="sheet"><div class="grip"></div>${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) bg.remove(); });
  document.body.appendChild(bg);
  return bg;
}
const closeSheet = () => document.querySelector('.sheet-bg')?.remove();

// Détail réservation + moteur de messages automatiques
function sheetBooking(id) {
  if (!isAdmin()) { toast('⛔ Réservé à l\'administrateur'); return; }
  const b = booking(id);
  const inHouse = b.checkIn <= D(0) && b.checkOut > D(0);
  const past = b.checkOut <= D(0);
  const f = field => `data-edit-booking="${id}" data-field="${field}"`;
  openSheet(`
    <h2>${b.guest}</h2>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <span class="badge plat ${PLAT[b.plat].cls}">${PLAT[b.plat].label}</span>
      <span class="badge ${past?'':inHouse?'ok':'info'}">${past?'Terminé':inHouse?'Sur place':'À venir'}</span>
    </div>
    <div class="card">
      <label class="small muted">Logement</label>
      <select ${f('pid')} style="width:100%;margin:6px 0 12px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
        ${S.properties.map(p=>`<option value="${p.id}" ${p.id===b.pid?'selected':''}>${p.emoji} ${p.name}</option>`).join('')}
      </select>
      <label class="small muted">Nom du voyageur</label>
      <input ${f('guest')} value="${b.guest}" style="width:100%;margin:6px 0 12px;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
      <div style="display:flex;gap:10px">
        <div style="flex:1"><label class="small muted">Arrivée</label>
          <input type="date" ${f('checkIn')} value="${b.checkIn}" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)"></div>
        <div style="flex:1"><label class="small muted">Départ</label>
          <input type="date" ${f('checkOut')} value="${b.checkOut}" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <div style="flex:1"><label class="small muted">Voyageurs</label>
          <input type="number" min="1" ${f('guests')} value="${b.guests}" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)"></div>
        <div style="flex:1"><label class="small muted">Canal</label>
          <select ${f('plat')} style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
            ${Object.entries(PLAT).filter(([k])=>k!=='abritel').map(([k,v])=>`<option value="${k}" ${k===b.plat?'selected':''}>${v.label}</option>`).join('')}</select></div>
      </div>
      <label class="small muted" style="display:block;margin-top:12px">Prix total (€)</label>
      <input type="number" inputmode="numeric" min="0" ${f('amount')} value="${b.amount}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
      <label class="small muted" style="display:block;margin-top:12px">Commentaire</label>
      <textarea ${f('note')} rows="3" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font:inherit;resize:vertical">${b.note || ''}</textarea>
    </div>

    ${b.review==='pending' ? `<button class="btn block" style="margin-top:8px" data-review="${id}">⭐ Envoyer la demande d'avis</button>` : ''}
    ${!past ? `<button class="btn ghost block" style="margin-top:8px" data-cancel="${id}">Annuler la réservation</button>` : ''}
  `);
}

// Fil de discussion
function sheetThread(id) {
  const b = booking(id), p = prop(b.pid), c = S.conversations[id];
  c.unread = 0; save();
  const guestLast = [...c.msgs].reverse().find(m => m.from === 'guest');
  const sent = guestLast ? sentiment(guestLast.text) : null;
  const bubbles = c.msgs.map(m => `
    <div class="msg ${m.from} ${m.isAuto?'auto':''}">
      ${m.isAuto?'<div class="tiny" style="opacity:.7">🤖 auto</div>':''}${escapeHtml(m.text)}
      <div class="meta">${m.at.slice(11)}</div>
    </div>`).join('');

  const sg = openSheet(`
    <h2>${b.guest} <span class="badge plat ${PLAT[b.plat].cls}" style="vertical-align:middle">${PLAT[b.plat].label}</span></h2>
    <div class="small muted" style="margin-top:-6px">${p.emoji} ${p.name} · ${fmtDate(b.checkIn)}→${fmtDate(b.checkOut)}</div>
    ${sent==='neg'?`<div class="card" style="border-color:var(--bad);margin-top:10px"><div class="small">⚠️ <b>Insatisfaction détectée.</b> Réponse prioritaire recommandée pour préserver la note.</div></div>`:''}
    <div class="thread" id="thread">${bubbles}</div>
    <div class="chips">
      <button class="chip ai" data-ai="${id}">✨ Suggérer une réponse (IA)</button>
      <button class="chip" data-tpl="${id}|arrival">🔑 Arrivée</button>
      <button class="chip" data-tpl="${id}|thanks">🙏 Remerciement</button>
      <button class="chip" data-tpl="${id}|upsell">➕ Upsell</button>
    </div>
    <div class="composer">
      <input id="msgInput" placeholder="Votre message…" autocomplete="off">
      <button class="btn" data-send="${id}">➤</button>
    </div>
  `);
  const th = sg.querySelector('#thread'); th.scrollTop = th.scrollHeight;
  const input = sg.querySelector('#msgInput');
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendMsg(id, input.value), input.value=''; });
}

function sendMsg(id, text) {
  text = (text || '').trim(); if (!text) return;
  const now = new Date();
  const at = `${iso(now)} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  S.conversations[id].msgs.push({ from: 'host', text, at });
  save();
  closeSheet(); sheetThread(id);
}
const TPL = {
  arrival: b => `Bonjour ${b.guest.split(' ')[0]}, votre arrivée approche ! Accès autonome dès 15h, code porte ${prop(b.pid).code}. Bon voyage 🔑`,
  thanks:  b => `Un grand merci pour votre séjour ${b.guest.split(' ')[0]} ! Ce fut un plaisir de vous accueillir. À très bientôt 🙏`,
  upsell:  b => `Petit plus : arrivée anticipée (+20 €), ménage de mi-séjour (+35 €) ou panier de produits locaux (+25 €) ? Dites-moi ✨`,
};

// Rendu d'un message automatique configuré (Réglages → Messages automatiques) pour une réservation
function renderAutoTemplate(msgId, b) {
  const m = S.autoMessages.find(x => x.id === msgId);
  if (!m || !m.enabled) return null;
  const p = prop(b.pid);
  return m.template
    .replaceAll('{prenom}', b.guest.split(' ')[0])
    .replaceAll('{logement}', `${p.emoji} ${p.name}`)
    .replaceAll('{code}', p.code || '')
    .replaceAll('{wifi}', p.wifi || '')
    .replaceAll('{wifiPass}', p.wifiPass || '');
}

// Ménage
function vCleaning() {
  const list = filtered(S.cleaning).filter(c => c.status !== 'done').sort((a,b) => a.date.localeCompare(b.date));
  const item = c => {
    const b = booking(c.bookingId), p = prop(c.pid);
    const st = { done:['ok','Fait'], todo:['warn','À faire'], planned:['info','Planifié'] }[c.status];
    const nextIn = S.bookings.find(x => x.pid === c.pid && x.checkIn === c.date);
    return `<div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="avatar" style="background:${p.color}">${p.emoji}</div>
      <div class="grow"><div class="title small">${p.name}</div>
        <div class="tiny muted">${fmtDateJ(c.date)}${nextIn?` · arrivée ${nextIn.guest.split(' ')[0]} même jour`:''}</div>
        <select data-clean-assign="${c.id}" ${isAdmin() ? '' : 'disabled'} style="margin-top:6px;padding:6px 8px;border-radius:8px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font-size:12px">
          <option value="">— Qui fait le ménage ? —</option>
          ${S.cleaners.map(name => `<option value="${name}" ${c.cleaner===name?'selected':''}>${name}</option>`).join('')}
        </select>
        <textarea data-clean-comment="${c.id}" ${isAdmin() ? '' : 'disabled'} placeholder="Commentaire (ex. clé cachée, linge à racheter, panne signalée…)" rows="2" style="margin-top:6px;width:100%;padding:8px;border-radius:8px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font:inherit;font-size:12px;resize:vertical">${c.comment || ''}</textarea></div>
      <button class="badge ${st[0]}" data-clean="${c.id}">${st[1]}</button>
    </div>`;
  };
  return `
  <div class="topbar"><h1>🧹 Ménages</h1></div>
  ${propSwitch()}
  <div class="small muted" style="margin-bottom:10px">Une intervention est créée à chaque départ. Choisissez qui s'en charge dans la liste, touchez le statut pour le faire avancer.</div>
  <div class="card">${list.length ? list.map(item).join('') : '<div class="empty small">Rien à nettoyer</div>'}</div>
  ${isAdmin() ? `<button class="btn ghost block" data-manage-cleaners>⚙️ Gérer la liste des intervenants</button>` : ''}`;
}

// Confirmation de fin de ménage : quantité de linge à laver
function sheetCleanDone(id) {
  const c = S.cleaning.find(x => x.id === id), p = prop(c.pid);
  openSheet(`
    <h2>✅ Ménage terminé</h2>
    <div class="small muted" style="margin-bottom:10px">${p.emoji} ${p.name} — ${fmtDateJ(c.date)}</div>
    <div class="card">
      <label class="small muted">Nombre de serviettes</label>
      <input id="f-towels" type="number" inputmode="numeric" min="0" value="${c.towels ?? ''}" style="${FIELD}">
      <label class="small muted">Nombre de paires de draps</label>
      <input id="f-sheets" type="number" inputmode="numeric" min="0" value="${c.sheetPairs ?? ''}" style="${FIELD}">
      <label class="small muted">Temps passé</label>
      <div style="display:flex;gap:10px">
        <div style="flex:1"><input id="f-hours" type="number" inputmode="numeric" min="0" placeholder="Heures" value="${c.durationMin!==undefined?Math.floor(c.durationMin/60):''}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
        <div style="flex:1"><select id="f-minutes" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%">
          ${[0,10,20,30,40,50].map(m => `<option value="${m}" ${c.durationMin!==undefined && c.durationMin%60===m?'selected':''}>${m} min</option>`).join('')}
        </select></div>
      </div>
    </div>
    <div class="btn-row even" style="margin-top:4px">
      <button class="btn ghost" data-clean-done-cancel>Annuler</button>
      <button class="btn" data-clean-done-confirm="${id}">Valider</button>
    </div>
  `);
}

// Historique des ménages effectués : consultation, édition, filtres mois/intervenant
let cleanHistoryFilter = { month: '', cleaner: 'all' };
function sheetCleaningHistory() {
  const list = S.cleaning.filter(c => c.status === 'done')
    .filter(c => !cleanHistoryFilter.month || c.date.slice(0,7) === cleanHistoryFilter.month)
    .filter(c => cleanHistoryFilter.cleaner === 'all' || c.cleaner === cleanHistoryFilter.cleaner)
    .sort((a,b) => b.date.localeCompare(a.date));
  const ro = isAdmin() ? '' : 'disabled';
  const minuteSelect = c => `<select data-hist-minutes="${c.id}" ${ro} style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%">
    ${[0,10,20,30,40,50].map(m => `<option value="${m}" ${(c.durationMin||0)%60===m?'selected':''}>${m} min</option>`).join('')}
  </select>`;
  const item = c => {
    const p = prop(c.pid);
    return `<div class="card">
      <div class="row" style="border:0;padding:0 0 8px">
        <div class="avatar" style="background:${p.color}">${p.emoji}</div>
        <div class="grow title small">${p.name}</div>
      </div>
      <label class="small muted">Date</label>
      <input type="date" data-hist-date="${c.id}" ${ro} value="${c.date}" style="${FIELD}">
      <label class="small muted">Intervenant</label>
      <select data-hist-cleaner="${c.id}" ${ro} style="${FIELD}">
        <option value="">—</option>
        ${S.cleaners.map(n => `<option value="${n}" ${c.cleaner===n?'selected':''}>${n}</option>`).join('')}
      </select>
      <div style="display:flex;gap:10px">
        <div style="flex:1"><label class="small muted">Heures</label>
          <input type="number" inputmode="numeric" min="0" data-hist-hours="${c.id}" ${ro} value="${Math.floor((c.durationMin||0)/60)}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
        <div style="flex:1"><label class="small muted">Minutes</label>${minuteSelect(c)}</div>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <div style="flex:1"><label class="small muted">Serviettes</label>
          <input type="number" inputmode="numeric" min="0" data-hist-towels="${c.id}" ${ro} value="${c.towels||0}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
        <div style="flex:1"><label class="small muted">Paires de draps</label>
          <input type="number" inputmode="numeric" min="0" data-hist-sheets="${c.id}" ${ro} value="${c.sheetPairs||0}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
      </div>
    </div>`;
  };
  openSheet(`
    <h2>🧺 Historique des ménages</h2>
    <div class="card">
      <label class="small muted">Filtrer par mois</label>
      <input type="month" data-hist-filter-month value="${cleanHistoryFilter.month}" style="${FIELD}">
      <label class="small muted">Filtrer par intervenant</label>
      <select data-hist-filter-cleaner style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
        <option value="all" ${cleanHistoryFilter.cleaner==='all'?'selected':''}>Tous les intervenants</option>
        ${S.cleaners.map(n => `<option value="${n}" ${cleanHistoryFilter.cleaner===n?'selected':''}>${n}</option>`).join('')}
      </select>
    </div>
    ${(() => {
      const totalMin = list.reduce((s,c) => s + (c.durationMin||0), 0);
      const totalTowels = list.reduce((s,c) => s + (c.towels||0), 0);
      const totalSheets = list.reduce((s,c) => s + (c.sheetPairs||0), 0);
      const totalHoursDecimal = totalMin / 60;
      const totalCost = totalHoursDecimal * (S.cleaningPrices.hourly||0) + totalTowels * (S.cleaningPrices.towel||0) + totalSheets * (S.cleaningPrices.sheetPair||0);
      return `
      <div class="sec-title">Totaux (filtre actuel)</div>
      <div class="card">
        <div class="kv"><span class="k">Temps passé</span><span class="v">${Math.floor(totalMin/60)}h${String(totalMin%60).padStart(2,'0')}</span></div>
        <div class="kv"><span class="k">Serviettes lavées</span><span class="v">${totalTowels}</span></div>
        <div class="kv"><span class="k">Paires de draps lavées</span><span class="v">${totalSheets}</span></div>
        ${isAdmin() ? `<div class="kv"><span class="k">Coût total estimé</span><span class="v">${money(Math.round(totalCost))}</span></div>` : ''}
      </div>
      ${isAdmin() ? `
      <div class="sec-title">Tarifs (Admin)</div>
      <div class="card">
        <label class="small muted">Prix de l'heure de ménage (€)</label>
        <input type="number" inputmode="numeric" min="0" step="0.01" data-price="hourly" value="${S.cleaningPrices.hourly}" style="${FIELD}">
        <label class="small muted">Prix de la serviette (€)</label>
        <input type="number" inputmode="numeric" min="0" step="0.01" data-price="towel" value="${S.cleaningPrices.towel}" style="${FIELD}">
        <label class="small muted">Prix de la paire de draps (€)</label>
        <input type="number" inputmode="numeric" min="0" step="0.01" data-price="sheetPair" value="${S.cleaningPrices.sheetPair}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
      </div>` : ''}`;
    })()}
    ${list.length ? list.map(item).join('') : '<div class="empty small">Aucun ménage effectué pour ces filtres</div>'}
  `);
}

// Gestion de la liste des intervenants ménage
function sheetCleaners() {
  if (!isAdmin()) { toast('⛔ Réservé à l\'administrateur'); return; }
  openSheet(`
    <h2>👤 Intervenants ménage</h2>
    <div class="small muted" style="margin-bottom:10px">Liste des personnes ou équipes qui peuvent être assignées au ménage.</div>
    <div class="card">${S.cleaners.length ? S.cleaners.map(name => `<div class="row">
      <div class="grow title small">${name}</div>
      <button class="btn ghost sm" data-remove-cleaner="${name}">Retirer</button>
    </div>`).join('') : '<div class="empty small">Aucun intervenant — ajoutez-en un ci-dessous</div>'}</div>
    <div class="card">
      <label class="small muted">Nouvel intervenant</label>
      <input id="f-cleaner" placeholder="Ex. Fatima, Agence CleanPro…" style="${FIELD}">
      <button class="btn block" data-add-cleaner>+ Ajouter</button>
    </div>
  `);
}

// Check-in / Check-out : accès et entretien par logement
function vCheckInOut() {
  if (!S.properties.length) {
    return `<div class="topbar"><h1>🔑 Entretien</h1></div><div class="empty small">Ajoutez d'abord un logement dans Réglages pour gérer ses accès et son entretien.</div>`;
  }
  const p = S.activePid === 'all' ? S.properties[0] : prop(S.activePid);
  const overdue = (dateVal, days) => !dateVal || nightsBetween(dateVal, D(0)) > days;
  const dot = (label, overdueFlag) => overdueFlag ? `${label} <span title="En retard" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--bad);margin-left:4px;vertical-align:middle"></span>` : label;
  return `
  <div class="topbar"><h1>🔑 Entretien</h1></div>
  <div class="chips">${S.properties.map(x => `<button class="chip ${x.id===p.id?'ai':''}" data-checkio="${x.id}">${x.emoji} ${x.name}</button>`).join('')}</div>

  <div class="sec-title">Accès</div>
  <div class="card">
    <label class="small muted">Code boîte à clé</label>
    <input data-checkio-code="${p.id}" value="${p.code || ''}" style="${FIELD}">
    <label class="small muted">Commentaire</label>
    <textarea data-checkio-comment="${p.id}" rows="3" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font:inherit;resize:vertical">${p.checkioComment || ''}</textarea>
  </div>

  <div class="sec-title">Entretien</div>
  <div class="card">
    <label class="small muted">${dot('🧪 Chlore piscine — dernier passage', overdue(p.poolChlorineDate, 7))}</label>
    <input type="date" data-checkio-date="${p.id}|poolChlorineDate" value="${p.poolChlorineDate || ''}" style="${FIELD}">
    <label class="small muted">🛁 Jacuzzi vidé le</label>
    <input type="date" data-checkio-date="${p.id}|jacuzziEmptiedDate" value="${p.jacuzziEmptiedDate || ''}" style="${FIELD}">
    <label class="small muted">🛁 Jacuzzi rempli le</label>
    <input type="date" data-checkio-date="${p.id}|jacuzziFilledDate" value="${p.jacuzziFilledDate || ''}" style="${FIELD}">
    <label class="small muted">${dot('🌿 Arrosé le', overdue(p.wateredDate, 3))}</label>
    <input type="date" data-checkio-date="${p.id}|wateredDate" value="${p.wateredDate || ''}" style="${FIELD}">
    <label class="small muted">${dot('🚜 Tondeuse fait le', overdue(p.mowedDate, 10))}</label>
    <input type="date" data-checkio-date="${p.id}|mowedDate" value="${p.mowedDate || ''}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
  </div>`;
}

// Statistiques
let statsFilter = { mode: 'all', month: D(0).slice(0,7), year: D(0).slice(0,4) };
function sheetStats() {
  if (!isAdmin()) { toast('⛔ Réservé à l\'administrateur'); return; }
  const bks = S.bookings.filter(b => {
    if (statsFilter.mode === 'month') return b.checkIn.slice(0,7) === statsFilter.month;
    if (statsFilter.mode === 'year') return b.checkIn.slice(0,4) === statsFilter.year;
    return true;
  });
  const rev = bks.reduce((s,b)=>s+b.amount,0);
  const nights = bks.reduce((s,b)=>s+b.nights,0);
  const byPlat = {};
  bks.forEach(b => byPlat[b.plat] = (byPlat[b.plat]||0) + b.amount);
  const max = Math.max(1, ...Object.values(byPlat));
  openSheet(`
    <h2>📈 Statistiques</h2>
    <div class="btn-row even" style="margin-bottom:10px">
      <button class="btn ${statsFilter.mode==='all'?'':'ghost'} sm" data-stats-mode="all">Tout</button>
      <button class="btn ${statsFilter.mode==='month'?'':'ghost'} sm" data-stats-mode="month">Mois</button>
      <button class="btn ${statsFilter.mode==='year'?'':'ghost'} sm" data-stats-mode="year">Année</button>
    </div>
    ${statsFilter.mode==='month' ? `<input type="month" data-stats-month value="${statsFilter.month}" style="${FIELD}">` : ''}
    ${statsFilter.mode==='year' ? (() => {
      const years = Array.from(new Set([...S.bookings.map(b => b.checkIn.slice(0,4)), D(0).slice(0,4)])).sort((a,b)=>b.localeCompare(a));
      return `<select data-stats-year style="${FIELD}">${years.map(y => `<option value="${y}" ${y===statsFilter.year?'selected':''}>${y}</option>`).join('')}</select>`;
    })() : ''}
    <div class="kpis">
      <div class="kpi"><div class="v">${money(rev)}</div><div class="l">Revenu total</div></div>
      <div class="kpi"><div class="v">${money(nights ? Math.round(rev/nights) : 0)}</div><div class="l">Prix moyen / nuit</div></div>
      <div class="kpi"><div class="v">${nights}</div><div class="l">Nuits vendues</div></div>
      <div class="kpi"><div class="v">${bks.length}</div><div class="l">Réservations</div></div>
    </div>
    <div class="sec-title">Revenu par canal</div>
    <div class="card">${Object.keys(byPlat).length ? Object.entries(byPlat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
      <div style="margin-bottom:10px"><div class="row" style="border:0;padding:0 0 4px">
        <span class="small" style="font-weight:600">${PLAT[k].label}</span><span class="spacer" style="flex:1"></span>
        <span class="small">${money(v)}</span></div>
        <div class="bar"><span style="width:${Math.round(v/max*100)}%;background:${k==='airbnb'?'#ff5a5f':k==='booking'?'#3b82f6':k==='direct'?'#a855f7':'#f59e0b'}"></span></div></div>
    `).join('') : '<div class="empty small">Aucune réservation</div>'}</div>
    <div class="card small muted">💡 Améliorer la part « Direct » (0% de commission) via le livret + relance des anciens voyageurs.</div>
  `);
}

// Réglages
function sheetSettings() {
  if (!isAdmin()) { toast('⛔ Réservé à l\'administrateur'); return; }
  openSheet(`
    <h2>⚙️ Réglages</h2>
    <div class="sec-title">Logements</div>
    <div class="card">${S.properties.length ? S.properties.map(p => `<div class="row" data-edit-prop="${p.id}" style="cursor:pointer">
      <img src="img/logo-chalets-du-pialou.jpg" alt="" class="avatar" style="object-fit:cover">
      <div class="grow"><div class="title small">${p.name}</div><div class="tiny muted">${p.cap} voyageurs · base ${p.base}€</div></div>
      <span class="dim">›</span>
    </div>`).join('') : '<div class="empty small">Aucun logement — ajoutez le premier ci-dessous</div>'}</div>
    <button class="btn ghost block" data-add-prop>+ Ajouter un logement</button>
    <div class="sec-title">Comptes</div>
    <div class="card">
      <label class="small muted">Nom du compte Admin</label>
      <input data-account-name="admin" value="${S.accounts.admin.name}" style="${FIELD}">
      ${cloudMode ? `
      <div class="tiny muted" style="margin-top:-8px">Synchro cloud active — l'email <b>${S.accounts.admin.email || '(non défini)'}</b> est l'Admin. Tout autre compte créé dans Firebase Authentication est automatiquement Utilisateur.</div>
      ` : `
      <label class="small muted">Mot de passe Admin</label>
      <input data-account-password="admin" type="text" value="${S.accounts.admin.password}" style="${FIELD}">
      `}
      <label class="small muted">Nom du compte Utilisateur</label>
      <input data-account-name="user" value="${S.accounts.user.name}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
      <div class="tiny muted" style="margin-top:8px">L'Admin a accès à tout. L'Utilisateur${cloudMode ? '' : ' entre sans mot de passe et'} voit Tableau, Planning, Ménage et Check-in/Check-out, mais pas Statistiques ni Réglages.</div>
    </div>
    <div class="sec-title">Données</div>
    <div class="card">
      <button class="btn ghost block" data-reset>♻️ Réinitialiser l'application</button>
      <div class="tiny muted" style="margin-top:8px">Efface toutes les données (logements, réservations, ménage, messages) et repart de zéro.</div>
    </div>
    <div class="sec-title">À propos</div>
    <div class="card">
      <div class="kv"><span class="k">Application</span><span class="v">GestHôte</span></div>
      <div class="kv"><span class="k">Version</span><span class="v">v${window.APP_VERSION}</span></div>
      <div class="kv"><span class="k">Build</span><span class="v">${window.APP_VERSION}</span></div>
    </div>
    <div class="card small muted">Clone Superhote. Prochaines étapes : sync iCal réelle, paiements, serrures connectées, IA messagerie via Claude API.</div>
  `);
}

const FIELD = 'width:100%;margin:6px 0 12px;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)';

// Ajouter / modifier un logement
function sheetPropertyForm(id) {
  const p = id ? prop(id) : null;
  openSheet(`
    <h2>${p ? '✏️ Modifier le logement' : '+ Nouveau logement'}</h2>

    <div class="sec-title">Identité</div>
    <div class="card">
      <label class="small muted">Nom</label>
      <input id="f-name" placeholder="Ex. Studio Vieux-Port" value="${p ? p.name : ''}" style="${FIELD}" autofocus>
      <div style="display:flex;gap:10px">
        <div style="flex:1"><label class="small muted">Emoji</label>
          <input id="f-emoji" placeholder="🏠" value="${p ? p.emoji : '🏠'}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
        <div style="flex:1"><label class="small muted">Couleur</label>
          <input id="f-color" type="color" value="${p ? p.color : '#14b8a6'}" style="width:100%;margin-top:6px;height:42px;border-radius:10px;border:1px solid var(--line);background:var(--card2)"></div>
      </div>
    </div>

    <div class="sec-title">Capacité &amp; tarif</div>
    <div class="card">
      <div style="display:flex;gap:10px">
        <div style="flex:1"><label class="small muted">Capacité (voyageurs)</label>
          <input id="f-cap" type="number" inputmode="numeric" min="1" value="${p ? p.cap : 2}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
        <div style="flex:1"><label class="small muted">Prix de base / nuit</label>
          <input id="f-base" type="number" inputmode="numeric" min="0" value="${p ? p.base : 80}" style="margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);width:100%"></div>
      </div>
    </div>

    <div class="sec-title">Accès voyageur</div>
    <div class="card">
      <label class="small muted">Code porte</label>
      <input id="f-code" value="${p ? p.code : ''}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
    </div>

    <div class="btn-row even" style="margin-top:4px">
      <button class="btn ghost" data-cancel-prop>Annuler</button>
      <button class="btn" data-save-prop="${id || ''}">${p ? 'Enregistrer' : 'Créer le logement'}</button>
    </div>
    ${p ? `<button class="btn danger block" style="margin-top:10px" data-delete-prop="${id}">🗑️ Supprimer ce logement</button>` : ''}
  `);
}
function saveProperty(sg, id) {
  const name = sg.querySelector('#f-name').value.trim();
  if (!name) { toast('Le nom est obligatoire'); return; }
  const data = {
    name,
    emoji: sg.querySelector('#f-emoji').value.trim() || '🏠',
    color: sg.querySelector('#f-color').value,
    cap: +sg.querySelector('#f-cap').value || 1,
    base: +sg.querySelector('#f-base').value || 0,
    code: sg.querySelector('#f-code').value.trim(),
  };
  if (id) {
    Object.assign(prop(id), data);
  } else {
    S.properties.push({ id: 'p' + Date.now().toString(36), ...data });
  }
  save(); closeSheet(); toast('✅ Logement enregistré'); render(); sheetSettings();
}
function deleteProperty(id) {
  if (!confirm('Supprimer ce logement et toutes ses données (réservations, ménage) ?')) return;
  S.properties = S.properties.filter(p => p.id !== id);
  const removedBookingIds = S.bookings.filter(b => b.pid === id).map(b => b.id);
  S.bookings = S.bookings.filter(b => b.pid !== id);
  removedBookingIds.forEach(bid => delete S.conversations[bid]);
  S.cleaning = S.cleaning.filter(c => c.pid !== id);
  if (S.activePid === id) S.activePid = 'all';
  save(); closeSheet(); toast('Logement supprimé'); render(); sheetSettings();
}

// Ajouter une réservation
function sheetAdd() {
  if (!isAdmin()) { toast('⛔ Réservé à l\'administrateur'); return; }
  if (!S.properties.length) {
    openSheet(`<h2>+ Nouvelle réservation</h2><div class="empty small">Ajoutez d'abord un logement dans Réglages → Logements.</div>`);
    return;
  }
  openSheet(`
    <h2>+ Nouvelle réservation</h2>
    <div class="card">
      <label class="small muted">Logement</label>
      <select id="f-pid" style="width:100%;margin:6px 0 12px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
        ${S.properties.map(p=>`<option value="${p.id}">${p.emoji} ${p.name}</option>`).join('')}
      </select>
      <label class="small muted">Nom du voyageur</label>
      <input id="f-guest" placeholder="Ex. Camille Durand" style="width:100%;margin:6px 0 12px;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
      <div style="display:flex;gap:10px">
        <div style="flex:1"><label class="small muted">Arrivée</label>
          <input id="f-in" type="date" value="${D(3)}" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)"></div>
        <div style="flex:1"><label class="small muted">Départ</label>
          <input id="f-out" type="date" value="${D(6)}" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)"></div>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <div style="flex:1"><label class="small muted">Voyageurs</label>
          <input id="f-guests" type="number" value="2" min="1" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)"></div>
        <div style="flex:1"><label class="small muted">Canal</label>
          <select id="f-plat" style="width:100%;margin-top:6px;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
            ${Object.entries(PLAT).filter(([k])=>k!=='abritel').map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div>
      </div>
      <label class="small muted" style="display:block;margin-top:12px">Prix total (€)</label>
      <input id="f-amount" type="number" inputmode="numeric" min="0" placeholder="Calculé automatiquement si vide" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
      <label class="small muted" style="display:block;margin-top:12px">Commentaire</label>
      <textarea id="f-note" rows="3" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font:inherit;resize:vertical"></textarea>
    </div>
    <button class="btn block" data-save-add>Créer la réservation</button>
  `);
}
function saveAdd(sg) {
  const g = sg.querySelector('#f-guest').value.trim() || 'Voyageur';
  const pid = sg.querySelector('#f-pid').value;
  const inIso = sg.querySelector('#f-in').value, outIso = sg.querySelector('#f-out').value;
  const nights = Math.max(1, nightsBetween(inIso, outIso));
  const guests = +sg.querySelector('#f-guests').value || 2;
  const plat = sg.querySelector('#f-plat').value;
  const amountRaw = sg.querySelector('#f-amount').value;
  const note = sg.querySelector('#f-note').value.trim();
  // anti double-réservation
  const clash = S.bookings.some(b => b.pid === pid && inIso < b.checkOut && outIso > b.checkIn);
  if (clash) { toast('⛔ Conflit : dates déjà réservées sur ce logement'); return; }
  const p = prop(pid);
  const id = 'b' + Date.now().toString(36);
  const newBooking = { id, pid, plat, guest: g, checkIn: inIso, checkOut: outIso, nights, guests,
    amount: amountRaw !== '' ? +amountRaw || 0 : p.base * nights, avatarColor: '#14b8a6', review: null, note };
  S.bookings.push(newBooking);
  S.cleaning.push({ id: 'c' + id, pid, date: outIso, bookingId: id, cleaner: '', comment: '',
    status: outIso < D(0) ? 'done' : outIso === D(0) ? 'todo' : 'planned' });
  const confirmText = renderAutoTemplate('reservation', newBooking);
  S.conversations[id] = { unread: 0, msgs: confirmText ? [
    { from:'host', text: confirmText, at:`${D(0)} 12:00`, isAuto:true }
  ] : [] };
  save(); closeSheet(); toast('✅ Réservation créée'); render();
}

// ---------- Actions / câblage ----------
function wire() {
  app.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { TAB = el.dataset.tab; render(); });
  bindCommon(app);
}
function bindCommon(root) {
  root.querySelectorAll('[data-pid]').forEach(el => el.onclick = () => { S.activePid = el.dataset.pid; save(); render(); });
  root.querySelectorAll('[data-open]').forEach(el => el.onclick = e => { e.stopPropagation(); sheetBooking(el.dataset.open); });
  root.querySelectorAll('[data-msg]').forEach(el => el.onclick = e => { e.stopPropagation(); closeSheet(); sheetThread(el.dataset.msg); });
  root.querySelectorAll('[data-goto]').forEach(el => el.onclick = () => { TAB = el.dataset.goto; render(); });
  root.querySelectorAll('[data-add]').forEach(el => el.onclick = sheetAdd);
  root.querySelectorAll('[data-lock]').forEach(el => el.onclick = lockApp);
  root.querySelectorAll('[data-account-name]').forEach(el => el.onblur = () => {
    S.accounts[el.dataset.accountName].name = el.value.trim() || (el.dataset.accountName === 'admin' ? 'Admin' : 'Utilisateur');
    save();
  });
  root.querySelectorAll('[data-account-password]').forEach(el => el.onblur = () => {
    S.accounts[el.dataset.accountPassword].password = el.value;
    save();
  });
  root.querySelectorAll('[data-plan]').forEach(el => el.onclick = () => {
    const v = +el.dataset.plan; planStart = v === 0 ? 0 : planStart + v; render();
  });
  root.querySelectorAll('[data-more]').forEach(el => el.onclick = () => {
    ({ cleanhist: sheetCleaningHistory, stats: sheetStats, settings: sheetSettings }[el.dataset.more])();
  });
  // Thread actions
  root.querySelectorAll('[data-send]').forEach(el => el.onclick = () => {
    const inp = document.getElementById('msgInput'); sendMsg(el.dataset.send, inp.value);
  });
  root.querySelectorAll('[data-ai]').forEach(el => el.onclick = () => {
    document.getElementById('msgInput').value = aiSuggest(el.dataset.ai);
    document.getElementById('msgInput').focus();
  });
  root.querySelectorAll('[data-tpl]').forEach(el => el.onclick = () => {
    const [id, k] = el.dataset.tpl.split('|');
    document.getElementById('msgInput').value = TPL[k](booking(id));
  });
  root.querySelectorAll('[data-review]').forEach(el => el.onclick = () => {
    const b = booking(el.dataset.review); b.review = null; save();
    closeSheet(); toast('⭐ Demande d\'avis envoyée'); render();
  });
  root.querySelectorAll('[data-cancel]').forEach(el => el.onclick = () => {
    if (!confirm('Annuler cette réservation ?')) return;
    S.bookings = S.bookings.filter(b => b.id !== el.dataset.cancel);
    delete S.conversations[el.dataset.cancel];
    S.cleaning = S.cleaning.filter(c => c.bookingId !== el.dataset.cancel);
    save(); closeSheet(); toast('Réservation annulée'); render();
  });
  root.querySelectorAll('[data-clean]').forEach(el => el.onclick = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.clean);
    if (c.status === 'todo') { sheetCleanDone(c.id); return; }
    c.status = c.status === 'planned' ? 'todo' : 'planned';
    save(); render();
  });
  root.querySelectorAll('[data-clean-done-cancel]').forEach(el => el.onclick = () => { closeSheet(); render(); });
  root.querySelectorAll('[data-clean-done-confirm]').forEach(el => el.onclick = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.cleanDoneConfirm);
    const sg = document.querySelector('.sheet-bg');
    c.towels = +sg.querySelector('#f-towels').value || 0;
    c.sheetPairs = +sg.querySelector('#f-sheets').value || 0;
    c.durationMin = (+sg.querySelector('#f-hours').value || 0) * 60 + (+sg.querySelector('#f-minutes').value || 0);
    c.status = 'done';
    save(); closeSheet();
    toast(`✅ Ménage terminé — ${c.towels} serviette(s), ${c.sheetPairs} paire(s) de draps, ${Math.floor(c.durationMin/60)}h${String(c.durationMin%60).padStart(2,'0')}`);
    render();
  });
  root.querySelectorAll('[data-clean-assign]').forEach(el => el.onchange = () => {
    if (!isAdmin()) return;
    const c = S.cleaning.find(x => x.id === el.dataset.cleanAssign);
    c.cleaner = el.value; save();
  });
  root.querySelectorAll('[data-hist-date]').forEach(el => el.onchange = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.histDate); c.date = el.value; save();
  });
  root.querySelectorAll('[data-hist-cleaner]').forEach(el => el.onchange = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.histCleaner); c.cleaner = el.value; save();
  });
  root.querySelectorAll('[data-hist-towels]').forEach(el => el.onblur = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.histTowels); c.towels = +el.value || 0; save();
  });
  root.querySelectorAll('[data-hist-sheets]').forEach(el => el.onblur = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.histSheets); c.sheetPairs = +el.value || 0; save();
  });
  const updateHistDuration = el => {
    const card = el.closest('.card');
    const hoursEl = card.querySelector('[data-hist-hours]'), minutesEl = card.querySelector('[data-hist-minutes]');
    const c = S.cleaning.find(x => x.id === (el.dataset.histHours || el.dataset.histMinutes));
    c.durationMin = (+hoursEl.value || 0) * 60 + (+minutesEl.value || 0); save();
  };
  root.querySelectorAll('[data-hist-hours]').forEach(el => el.onblur = () => updateHistDuration(el));
  root.querySelectorAll('[data-hist-minutes]').forEach(el => el.onchange = () => updateHistDuration(el));
  root.querySelectorAll('[data-hist-filter-month]').forEach(el => el.onchange = () => {
    cleanHistoryFilter.month = el.value; closeSheet(); sheetCleaningHistory();
  });
  root.querySelectorAll('[data-hist-filter-cleaner]').forEach(el => el.onchange = () => {
    cleanHistoryFilter.cleaner = el.value; closeSheet(); sheetCleaningHistory();
  });
  root.querySelectorAll('[data-price]').forEach(el => el.onblur = () => {
    S.cleaningPrices[el.dataset.price] = +el.value || 0; save(); closeSheet(); sheetCleaningHistory();
  });
  root.querySelectorAll('[data-clean-comment]').forEach(el => el.onblur = () => {
    if (!isAdmin()) return;
    const c = S.cleaning.find(x => x.id === el.dataset.cleanComment);
    c.comment = el.value; save();
  });
  root.querySelectorAll('[data-checkio]').forEach(el => el.onclick = () => {
    S.activePid = el.dataset.checkio; save(); render();
  });
  root.querySelectorAll('[data-checkio-code]').forEach(el => el.onblur = () => {
    prop(el.dataset.checkioCode).code = el.value.trim(); save();
  });
  root.querySelectorAll('[data-checkio-comment]').forEach(el => el.onblur = () => {
    prop(el.dataset.checkioComment).checkioComment = el.value; save();
  });
  root.querySelectorAll('[data-checkio-date]').forEach(el => el.onchange = () => {
    const [pid, field] = el.dataset.checkioDate.split('|');
    prop(pid)[field] = el.value; save();
  });
  root.querySelectorAll('[data-edit-booking]').forEach(el => el.onchange = () => {
    const id = el.dataset.editBooking, field = el.dataset.field;
    const b = booking(id);
    const numericFields = ['guests', 'amount'];
    const dateOrPidFields = ['checkIn', 'checkOut', 'pid'];
    const prevPid = b.pid, prevIn = b.checkIn, prevOut = b.checkOut;
    b[field] = numericFields.includes(field) ? (+el.value || 0) : el.value;
    if (dateOrPidFields.includes(field)) {
      const clash = S.bookings.some(x => x.id !== id && x.pid === b.pid && b.checkIn < x.checkOut && b.checkOut > x.checkIn);
      if (clash) {
        toast('⛔ Conflit : dates déjà réservées sur ce logement');
        b.pid = prevPid; b.checkIn = prevIn; b.checkOut = prevOut;
        closeSheet(); sheetBooking(id); return;
      }
      b.nights = Math.max(1, nightsBetween(b.checkIn, b.checkOut));
      const c = S.cleaning.find(x => x.bookingId === id);
      if (c) { c.pid = b.pid; c.date = b.checkOut; }
      save(); closeSheet(); sheetBooking(id); return;
    }
    save();
  });
  root.querySelectorAll('[data-stats-mode]').forEach(el => el.onclick = () => {
    statsFilter.mode = el.dataset.statsMode; closeSheet(); sheetStats();
  });
  root.querySelectorAll('[data-stats-month]').forEach(el => el.onchange = () => {
    statsFilter.month = el.value; closeSheet(); sheetStats();
  });
  root.querySelectorAll('[data-stats-year]').forEach(el => el.onchange = () => {
    statsFilter.year = el.value; closeSheet(); sheetStats();
  });
  root.querySelectorAll('[data-manage-cleaners]').forEach(el => el.onclick = () => { closeSheet(); sheetCleaners(); });
  root.querySelectorAll('[data-add-cleaner]').forEach(el => el.onclick = () => {
    const inp = document.getElementById('f-cleaner');
    const name = inp.value.trim();
    if (!name) return;
    if (!S.cleaners.includes(name)) S.cleaners.push(name);
    save(); closeSheet(); sheetCleaners();
  });
  root.querySelectorAll('[data-remove-cleaner]').forEach(el => el.onclick = () => {
    const name = el.dataset.removeCleaner;
    S.cleaners = S.cleaners.filter(c => c !== name);
    S.cleaning.forEach(c => { if (c.cleaner === name) c.cleaner = ''; });
    save(); closeSheet(); sheetCleaners();
  });
  root.querySelectorAll('[data-reset]').forEach(el => el.onclick = () => {
    if (!confirm('Réinitialiser toutes les données de l\'application ?')) return;
    localStorage.removeItem(KEY); load(); closeSheet(); toast('♻️ Application réinitialisée'); render();
  });
  root.querySelectorAll('[data-save-add]').forEach(el => el.onclick = () => saveAdd(document.querySelector('.sheet-bg')));
  root.querySelectorAll('[data-add-prop]').forEach(el => el.onclick = () => { closeSheet(); sheetPropertyForm(); });
  root.querySelectorAll('[data-edit-prop]').forEach(el => el.onclick = () => { closeSheet(); sheetPropertyForm(el.dataset.editProp); });
  root.querySelectorAll('[data-cancel-prop]').forEach(el => el.onclick = () => { closeSheet(); sheetSettings(); });
  root.querySelectorAll('[data-save-prop]').forEach(el => el.onclick = () => saveProperty(document.querySelector('.sheet-bg'), el.dataset.saveProp || null));
  root.querySelectorAll('[data-delete-prop]').forEach(el => el.onclick = () => deleteProperty(el.dataset.deleteProp));
}
// Re-câbler dans les sheets injectées
const _openSheet = openSheet;
openSheet = function (html) { const bg = _openSheet(html); bindCommon(bg); return bg; };

// ---------- Divers ----------
function toast(msg) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2200);
}
function escapeHtml(s) { return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---------- Boot ----------
load();
initCloudSync().then(renderLock);
