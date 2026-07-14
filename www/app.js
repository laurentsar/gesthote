/* GestHôte — PMS / channel manager pour locations courte durée (démo).
 * Vanilla JS, aucune dépendance. État persisté en localStorage.
 * Modules : Tableau · Planning · Réservations · Messages · Ménage · Livret · Tarifs.
 */

// ---------- Utilitaires date ----------
const DAY = 86400000;
const today0 = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
const d = off => new Date(today0().getTime() + off * DAY);        // Date à J+off
const iso = dt => new Date(dt).toISOString().slice(0, 10);        // 'YYYY-MM-DD'
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
    template: "Bonjour {prenom}, votre arrivée approche ! Accès autonome dès 15h. Code porte : {code}. Wifi : {wifi} ({wifiPass})." },
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
    v: 2,
  };
}

// ---------- État ----------
const KEY = 'gesthote.state';
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || S.v !== 2) { S = seed(); save(); }
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
const prop = id => S.properties.find(p => p.id === id);
const booking = id => S.bookings.find(b => b.id === id);

// ---------- Routeur ----------
let TAB = 'home';
const app = document.getElementById('app');

function render() {
  const views = { home: vHome, plan: vPlanning, resa: vResa, msg: vMessages, plus: vPlus };
  const body = (views[TAB] || vHome)();
  app.innerHTML = `<div class="screen">${body}</div>${nav()}`;
  wire();
  app.querySelector('.screen').scrollTo?.(0, 0);
}

function nav() {
  const unread = Object.values(S.conversations).reduce((n, c) => n + (c.unread || 0), 0);
  const items = [
    ['home', '📊', 'Tableau'],
    ['plan', '📅', 'Planning'],
    ['resa', '📖', 'Résas'],
    ['msg', '💬', 'Messages'],
    ['plus', '☰', 'Plus'],
  ];
  return `<div class="nav">${items.map(([k, ic, l]) => `
    <button data-tab="${k}" class="${TAB === k ? 'active' : ''}">
      <span class="wrap"><span class="ico">${ic}</span>${k === 'msg' && unread ? `<span class="badge-dot"></span>` : ''}<span>${l}</span></span>
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

  const pendingReviews = bks.filter(b => b.review === 'pending').length;
  const unread = Object.entries(S.conversations)
    .filter(([id, c]) => c.unread && (S.activePid === 'all' || booking(id)?.pid === S.activePid)).length;
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
    <div class="kpi"><div class="v">${unread + pendingReviews}</div><div class="l">À traiter</div>
      <div class="sub muted">${unread} msg · ${pendingReviews} avis</div></div>
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
  const props = S.activePid === 'all' ? S.properties : [prop(S.activePid)];
  const DAYS = 21;
  let head = '';
  for (let i = 0; i < DAYS; i++) {
    const dt = d(planStart + i), wk = dt.getDay() === 0 || dt.getDay() === 6;
    head += `<th class="${wk?'wknd':''}"><div class="tl-day">${JOURS[dt.getDay()][0].toUpperCase()}<b>${dt.getDate()}</b></div></th>`;
  }
  const rows = props.map(p => {
    let cells = '';
    for (let i = 0; i < DAYS; i++) {
      const dayIso = D(planStart + i);
      const wk = [0,6].includes(d(planStart+i).getDay());
      // barre de réservation démarrant ce jour
      const b = S.bookings.find(x => x.pid === p.id && x.checkIn === dayIso);
      let bar = '';
      if (b) {
        const span = Math.min(b.nights, DAYS - i);
        bar = `<div class="res-bar" data-open="${b.id}"
          style="background:${PLAT[b.plat].cls==='b-airbnb'?'#ff5a5f':PLAT[b.plat].cls==='b-booking'?'#3b82f6':PLAT[b.plat].cls==='b-direct'?'#a855f7':'#f59e0b'};
          width:calc(${span*100}% + ${span-1}px);z-index:3">${b.guest.split(' ')[0]}</div>`;
      }
      cells += `<td class="${wk?'wknd':''}">${bar}</td>`;
    }
    return `<tr><th class="prop-cell">${p.emoji} ${p.name}</th>${cells}</tr>`;
  }).join('');

  const range = `${fmtDate(D(planStart))} – ${fmtDate(D(planStart + DAYS - 1))}`;
  return `
  <div class="topbar"><h1>Planning</h1><span class="spacer"></span>
    <button class="btn sm" data-add>+ Résa</button></div>
  ${propSwitch()}
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
    <span class="badge plat b-direct">Direct</span> <span class="badge plat b-abritel">Abritel</span>
  </div>
  <div class="card" style="margin-top:12px">
    <h2>🔄 Synchronisation Booking.com</h2>
    <div class="small muted" style="margin-bottom:8px">Import iCal en lecture seule : bloque les dates réservées côté Booking.com pour éviter le surbooking.</div>
    ${S.properties.length ? S.properties.map(p => `<div class="row">
      <div class="grow"><div class="title small">${p.emoji} ${p.name}</div>
        <div class="tiny muted">${p.icalUrl ? (p.icalLastSync ? 'Dernière synchro : ' + fmtDateJ(iso(p.icalLastSync)) + ' ' + new Date(p.icalLastSync).toTimeString().slice(0,5) : 'Jamais synchronisé') : 'Aucune URL iCal configurée'}</div></div>
      ${p.icalUrl ? `<button class="btn ghost sm" data-sync-ical="${p.id}">🔄 Synchroniser</button>`
        : `<button class="btn ghost sm" data-edit-prop="${p.id}">Configurer</button>`}
    </div>`).join('') : '<div class="empty small">Ajoutez un logement pour activer la synchro.</div>'}
    <div class="tiny muted" style="margin-top:8px">Airbnb / Abritel : pas de synchro automatique pour l'instant (nécessite un partenariat officiel). En attendant, leur export iCal peut être ajouté de la même façon.</div>
  </div>`;
}

// ================= RÉSERVATIONS =================
let resaFilter = 'all';
function vResa() {
  const all = filtered(S.bookings);
  const groups = {
    all: all,
    inhouse: all.filter(b => b.checkIn <= D(0) && b.checkOut > D(0)),
    upcoming: all.filter(b => b.checkIn > D(0)),
    past: all.filter(b => b.checkOut <= D(0)),
  };
  const list = groups[resaFilter].slice().sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const tab = (k, l) => `<button class="chip ${resaFilter===k?'ai':''}" data-rf="${k}">${l} (${groups[k].length})</button>`;

  const card = b => {
    const p = prop(b.pid);
    const status = b.checkOut <= D(0) ? ['muted','Terminé']
      : b.checkIn <= D(0) ? ['ok','Sur place'] : ['info','À venir'];
    return `<div class="card" data-open="${b.id}" style="cursor:pointer">
      <div class="row" style="border:0;padding:0">
        <div class="avatar" style="background:${b.avatarColor}">${b.guest[0]}</div>
        <div class="grow"><div class="title">${b.guest}</div>
          <div class="small muted ellipsis">${p.emoji} ${p.name}</div></div>
        <div style="text-align:right">
          <span class="badge plat ${PLAT[b.plat].cls}">${PLAT[b.plat].label}</span>
          <div class="small" style="font-weight:800;margin-top:5px">${money(b.amount)}</div>
        </div>
      </div>
      <div class="row" style="border:0;padding:8px 0 0;color:var(--txt2)">
        <span class="small">📅 ${fmtDate(b.checkIn)} → ${fmtDate(b.checkOut)} · ${b.nights} nuits</span>
        <span class="spacer" style="flex:1"></span>
        <span class="badge ${status[0]}">${status[1]}</span>
      </div>
    </div>`;
  };

  return `
  <div class="topbar"><h1>Réservations</h1><span class="spacer"></span>
    <button class="btn sm" data-add>+ Résa</button></div>
  ${propSwitch()}
  <div class="chips">${tab('all','Toutes')}${tab('inhouse','Sur place')}${tab('upcoming','À venir')}${tab('past','Passées')}</div>
  ${list.length ? list.map(card).join('') :
    '<div class="empty"><div class="ico">📖</div>Aucune réservation</div>'}`;
}

// ================= MESSAGES =================
function vMessages() {
  const convs = Object.entries(S.conversations)
    .map(([id, c]) => ({ id, c, b: booking(id) }))
    .filter(x => x.b && (S.activePid === 'all' || x.b.pid === S.activePid))
    .sort((a, b) => lastAt(b.c).localeCompare(lastAt(a.c)));

  const row = ({ id, c, b }) => {
    const p = prop(b.pid);
    const last = c.msgs[c.msgs.length - 1];
    const guestLast = [...c.msgs].reverse().find(m => m.from === 'guest');
    const sent = guestLast ? sentiment(guestLast.text) : null;
    const sentIco = sent === 'neg' ? '⚠️' : sent === 'pos' ? '😊' : sent === 'neu' ? '💬' : '';
    return `<div class="row" data-msg="${id}">
      <div class="avatar" style="background:${b.avatarColor}">${b.guest[0]}</div>
      <div class="grow">
        <div class="title ellipsis">${b.guest} ${sentIco}</div>
        <div class="small muted ellipsis">${last.from==='host'?'Vous : ':''}${last.text}</div>
        <div class="tiny dim">${p.emoji} ${p.name}</div>
      </div>
      <div style="text-align:right">
        ${c.unread ? '<span class="badge-dot" style="position:static;display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--bad)"></span>' : ''}
        <div class="tiny dim">${last.at.slice(11)}</div>
      </div>
    </div>`;
  };

  return `
  <div class="topbar"><h1>Messagerie</h1></div>
  ${propSwitch()}
  <div class="card small muted" style="display:flex;gap:8px;align-items:center">
    <span>🤖</span><span>Boîte unifiée tous canaux · réponses IA suggérées · détection d'insatisfaction.</span>
  </div>
  <div class="card" style="padding:4px 14px">
    ${convs.length ? convs.map(row).join('') :
      '<div class="empty small">Aucune conversation</div>'}
  </div>`;
}
const lastAt = c => c.msgs[c.msgs.length - 1].at;

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
    ['cleaning', '🧹', 'Ménage & turnover', `${S.cleaning.filter(c=>c.status!=='done').length} à venir`],
    ['checkio', '🔑', 'Check-in / Check-out', 'Codes, piscine, jacuzzi, arrosage'],
    ['automsg', '🔔', 'Messages automatiques', `${S.autoMessages.filter(m=>m.enabled).length}/${S.autoMessages.length} actifs`],
    ['livret', '📗', "Livret d'accueil", 'Guide voyageur digital'],
    ['pricing', '💶', 'Tarification dynamique', 'Recommandations IA'],
    ['guests', '👥', 'Voyageurs', `${S.bookings.length} séjours`],
    ['stats', '📈', 'Statistiques', 'Revenus & occupation'],
    ['settings', '⚙️', 'Réglages', 'Logements, démo'],
  ];
  return `
  <div class="topbar"><h1>Plus</h1></div>
  <div class="card" style="padding:4px 14px">
    ${items.map(([k, ic, l, s]) => `<div class="row" data-more="${k}">
      <div class="avatar" style="background:var(--card2);font-size:20px">${ic}</div>
      <div class="grow"><div class="title">${l}</div><div class="small muted">${s}</div></div>
      <span class="dim">›</span></div>`).join('')}
  </div>
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
  const b = booking(id), p = prop(b.pid);
  const inHouse = b.checkIn <= D(0) && b.checkOut > D(0);
  const past = b.checkOut <= D(0);
  const perNight = Math.round(b.amount / b.nights);

  // Moteur d'automatisation : statut de chaque message programmé (réglages dans Plus → Messages automatiques)
  const now = D(0);
  const triggerDate = {
    'reservation': b.checkIn,
    'arrival-1': D_before(b.checkIn, 1),
    'departure-1': D_before(b.checkOut, 1),
    'departure+2h': b.checkOut,
  };
  const stepHtml = S.autoMessages.map(m => {
    const w = triggerDate[m.id];
    const sent = m.id === 'reservation' || w < now;
    const next = !sent && w === now;
    return `<li>
      <span class="st-ico ${m.enabled && sent?'done':m.enabled && next?'next':''}">${m.enabled && sent?'✓':'🔔'}</span>
      <div><div class="small" style="font-weight:600">${m.label}</div>
        <div class="tiny muted">${!m.enabled?'désactivé':sent?'envoyé':next?"aujourd'hui":'programmé '+fmtDate(w)}</div></div>
    </li>`;
  }).join('');

  const conv = S.conversations[id];
  openSheet(`
    <h2>${b.guest}</h2>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <span class="badge plat ${PLAT[b.plat].cls}">${PLAT[b.plat].label}</span>
      <span class="badge ${past?'':inHouse?'ok':'info'}">${past?'Terminé':inHouse?'Sur place':'À venir'}</span>
    </div>
    <div class="card" style="background:var(--card2)">
      <div class="kv"><span class="k">Logement</span><span class="v">${p.emoji} ${p.name}</span></div>
      <div class="kv"><span class="k">Séjour</span><span class="v">${fmtDateJ(b.checkIn)} → ${fmtDateJ(b.checkOut)}</span></div>
      <div class="kv"><span class="k">Nuits</span><span class="v">${b.nights} · ${b.guests} voyageurs</span></div>
      <div class="kv"><span class="k">Montant</span><span class="v">${money(b.amount)} <span class="tiny muted">(${money(perNight)}/nuit)</span></span></div>
      <div class="kv"><span class="k">Code porte</span><span class="v">🔑 ${p.code}</span></div>
    </div>

    <div class="sec-title" style="margin-top:8px">Messages automatiques</div>
    <div class="card"><ul class="timeline-steps">${stepHtml}</ul></div>

    <div class="btn-row">
      <button class="btn ghost block" data-msg="${id}">💬 Ouvrir la conversation</button>
    </div>
    ${b.review==='pending' ? `<button class="btn block" style="margin-top:8px" data-review="${id}">⭐ Envoyer la demande d'avis</button>` : ''}
    ${!past ? `<button class="btn ghost block" style="margin-top:8px" data-cancel="${id}">Annuler la réservation</button>` : ''}
  `);
}
const D_before = (isoStr, n) => iso(new Date(parse(isoStr).getTime() - n * DAY));

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
  arrival: b => `Bonjour ${b.guest.split(' ')[0]}, votre arrivée approche ! Accès autonome dès 15h, code porte ${prop(b.pid).code}. Wifi : ${prop(b.pid).wifi}. Bon voyage 🔑`,
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

// Messages automatiques
function sheetAutoMessages() {
  const row = m => `<div class="card">
    <div class="row" style="border:0;padding:0 0 8px">
      <div class="grow title small">${m.label}</div>
      <label class="small" style="display:flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap">
        <input type="checkbox" data-toggle-auto="${m.id}" ${m.enabled?'checked':''}> Actif
      </label>
    </div>
    <textarea data-tpl-auto="${m.id}" rows="3" style="width:100%;padding:10px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font:inherit;resize:vertical">${m.template}</textarea>
  </div>`;
  openSheet(`
    <h2>🔔 Messages automatiques</h2>
    <div class="small muted" style="margin-bottom:10px">Envoyés automatiquement à vos voyageurs. Activez/désactivez et personnalisez le texte de chacun. Variables disponibles : {prenom} {logement} {code} {wifi} {wifiPass}</div>
    ${S.autoMessages.map(row).join('')}
  `);
}

// Ménage
function sheetCleaning() {
  const list = filtered(S.cleaning);
  const item = c => {
    const b = booking(c.bookingId), p = prop(c.pid);
    const st = { done:['ok','Fait'], todo:['warn','À faire'], planned:['info','Planifié'] }[c.status];
    const nextIn = S.bookings.find(x => x.pid === c.pid && x.checkIn === c.date);
    return `<div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="avatar" style="background:${p.color}">${p.emoji}</div>
      <div class="grow"><div class="title small">${p.name}</div>
        <div class="tiny muted">${fmtDateJ(c.date)}${nextIn?` · arrivée ${nextIn.guest.split(' ')[0]} même jour`:''}</div>
        <select data-clean-assign="${c.id}" style="margin-top:6px;padding:6px 8px;border-radius:8px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font-size:12px">
          <option value="">— Qui fait le ménage ? —</option>
          ${S.cleaners.map(name => `<option value="${name}" ${c.cleaner===name?'selected':''}>${name}</option>`).join('')}
        </select>
        <textarea data-clean-comment="${c.id}" placeholder="Commentaire (ex. clé cachée, linge à racheter, panne signalée…)" rows="2" style="margin-top:6px;width:100%;padding:8px;border-radius:8px;background:var(--card2);color:var(--txt);border:1px solid var(--line);font:inherit;font-size:12px;resize:vertical">${c.comment || ''}</textarea></div>
      <button class="badge ${st[0]}" data-clean="${c.id}">${st[1]}</button>
    </div>`;
  };
  openSheet(`
    <h2>🧹 Ménage & turnover</h2>
    <div class="small muted" style="margin-bottom:10px">Une intervention est créée à chaque départ. Choisissez qui s'en charge dans la liste, touchez le statut pour le faire avancer.</div>
    <div class="card">${list.length ? list.map(item).join('') : '<div class="empty small">Rien à nettoyer</div>'}</div>
    <button class="btn ghost block" data-manage-cleaners>⚙️ Gérer la liste des intervenants</button>
  `);
}

// Gestion de la liste des intervenants ménage
function sheetCleaners() {
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

// Livret d'accueil
function sheetLivret() {
  if (!S.properties.length) {
    openSheet(`<h2>📗 Livret d'accueil</h2><div class="empty small">Ajoutez d'abord un logement dans Réglages pour créer son livret d'accueil.</div>`);
    return;
  }
  const p = S.activePid === 'all' ? S.properties[0] : prop(S.activePid);
  openSheet(`
    <h2>📗 Livret d'accueil</h2>
    <div class="chips">${S.properties.map(x => `<button class="chip ${x.id===p.id?'ai':''}" data-livret="${x.id}">${x.emoji} ${x.name}</button>`).join('')}</div>
    <div class="livret-hero">
      <div style="font-size:34px">${p.emoji}</div>
      <h2>${p.name}</h2>
      <div class="small" style="opacity:.9">${p.address}</div>
    </div>
    <div class="info-grid">
      <div class="info-tile"><div class="ico">📶</div><div class="l">Wifi</div><div class="v">${p.wifi}</div><div class="small muted">${p.wifiPass}</div></div>
      <div class="info-tile"><div class="ico">🔑</div><div class="l">Code porte</div><div class="v">${p.code}</div></div>
      <div class="info-tile"><div class="ico">🕓</div><div class="l">Arrivée / Départ</div><div class="v">15h / 11h</div></div>
      <div class="info-tile"><div class="ico">👥</div><div class="l">Capacité</div><div class="v">${p.cap} voyageurs</div></div>
    </div>
    <div class="sec-title">Guide</div>
    <div class="card"><ul class="list-plain small">
      <li class="kv"><span class="k">🚪 Arrivée</span><span class="v">Boîte à clés à droite de l'entrée, code ${p.code}</span></li>
      <li class="kv"><span class="k">🗑️ Poubelles</span><span class="v">Local au RDC, tri sélectif</span></li>
      <li class="kv"><span class="k">🔥 Chauffage</span><span class="v">Thermostat mural, ne pas dépasser 22°</span></li>
      <li class="kv"><span class="k">🚭 Règles</span><span class="v">Non-fumeur · pas de fête</span></li>
      <li class="kv"><span class="k">📞 Urgence</span><span class="v">Hôte : 06 12 34 56 78</span></li>
    </ul></div>
    <div class="sec-title">Bonnes adresses ${p.city}</div>
    <div class="card small"><ul class="list-plain">
      <li class="kv"><span class="k">🍽️ Restaurant</span><span class="v">Chez Marco — 5 min à pied</span></li>
      <li class="kv"><span class="k">🥐 Boulangerie</span><span class="v">Le Fournil — au coin de la rue</span></li>
      <li class="kv"><span class="k">🛒 Supérette</span><span class="v">Ouverte 7j/7 jusqu'à 22h</span></li>
    </ul></div>
    <button class="btn block" data-share style="margin-top:8px">🔗 Partager le lien au voyageur</button>
  `);
}

// Check-in / Check-out : accès et entretien par logement
function sheetCheckInOut() {
  if (!S.properties.length) {
    openSheet(`<h2>🔑 Check-in / Check-out</h2><div class="empty small">Ajoutez d'abord un logement dans Réglages pour gérer ses accès et son entretien.</div>`);
    return;
  }
  const p = S.activePid === 'all' ? S.properties[0] : prop(S.activePid);
  openSheet(`
    <h2>🔑 Check-in / Check-out</h2>
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
      <label class="small muted">🧪 Chlore piscine — dernier passage</label>
      <input type="date" data-checkio-date="${p.id}|poolChlorineDate" value="${p.poolChlorineDate || ''}" style="${FIELD}">
      <label class="small muted">🛁 Jacuzzi vidé le</label>
      <input type="date" data-checkio-date="${p.id}|jacuzziEmptiedDate" value="${p.jacuzziEmptiedDate || ''}" style="${FIELD}">
      <label class="small muted">🛁 Jacuzzi rempli le</label>
      <input type="date" data-checkio-date="${p.id}|jacuzziFilledDate" value="${p.jacuzziFilledDate || ''}" style="${FIELD}">
      <label class="small muted">🌿 Arrosé le</label>
      <input type="date" data-checkio-date="${p.id}|wateredDate" value="${p.wateredDate || ''}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
    </div>
  `);
}

// Tarification dynamique (amélioration IA)
function sheetPricing() {
  const props = S.activePid === 'all' ? S.properties : [prop(S.activePid)];
  const reco = (p, off) => {
    const dt = d(off), wk = [5,6].includes(dt.getDay());
    // occupation du jour toutes annonces
    const occ = S.bookings.some(b => b.pid === p.id && b.checkIn <= D(off) && b.checkOut > D(off));
    let factor = 1, reason = 'demande standard';
    if (wk) { factor += .18; reason = 'week-end'; }
    if (dt.getMonth() === 7) { factor += .25; reason = 'haute saison (août)'; }
    if (!occ && off < 4) { factor -= .12; reason = 'dernière minute — remplir'; }
    const price = Math.round(p.base * factor);
    return { date: D(off), old: p.base, price, reason, up: price >= p.base, booked: occ };
  };
  const block = p => {
    const rows = [1,2,3,4,5,6,7].map(off => {
      const r = reco(p, off);
      return `<div class="row">
        <div class="grow"><div class="small" style="font-weight:600">${fmtDateJ(r.date)}</div>
          <div class="tiny muted">${r.booked?'réservé':r.reason}</div></div>
        ${r.booked ? '<span class="badge">réservé</span>' :
          `<div class="pricebar"><span class="old">${r.old}€</span>
           <span class="new" style="color:${r.up?'var(--ok)':'var(--warn)'}">${r.price}€</span></div>`}
      </div>`;
    }).join('');
    return `<div class="card"><h2>${p.emoji} ${p.name} <span class="tiny muted">base ${p.base}€</span></h2>${rows}</div>`;
  };
  openSheet(`
    <h2>💶 Tarification dynamique</h2>
    <div class="small muted" style="margin-bottom:10px">Prix conseillés selon saison, week-end, événements locaux et taux de remplissage. 🤖 Amélioration : intégration météo + agenda événementiel de la ville.</div>
    ${props.length ? props.map(block).join('') : '<div class="empty small">Ajoutez un logement pour voir les recommandations tarifaires.</div>'}
    ${props.length ? '<button class="btn block" data-apply-price>✅ Appliquer les prix conseillés</button>' : ''}
  `);
}

// Voyageurs
function sheetGuests() {
  const list = filtered(S.bookings).slice().sort((a,b)=>b.checkIn.localeCompare(a.checkIn));
  openSheet(`
    <h2>👥 Voyageurs</h2>
    <div class="card" style="padding:4px 14px">${list.length ? list.map(b => {
      const p = prop(b.pid);
      return `<div class="row" data-open="${b.id}">
        <div class="avatar" style="background:${b.avatarColor}">${b.guest[0]}</div>
        <div class="grow"><div class="title small">${b.guest}</div>
          <div class="tiny muted">${p.emoji} ${p.name} · ${fmtDate(b.checkIn)}</div></div>
        ${typeof b.review==='number'?`<span class="badge ok">★ ${b.review}</span>`:b.review==='pending'?'<span class="badge warn">avis ?</span>':`<span class="badge plat ${PLAT[b.plat].cls}">${PLAT[b.plat].label}</span>`}
      </div>`;
    }).join('') : '<div class="empty small">Aucun voyageur</div>'}</div>
  `);
}

// Statistiques
let statsFilter = { mode: 'all', month: D(0).slice(0,7), year: D(0).slice(0,4) };
function sheetStats() {
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
    ${statsFilter.mode==='year' ? `<input type="number" data-stats-year value="${statsFilter.year}" min="2000" max="2100" style="${FIELD}">` : ''}
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
  openSheet(`
    <h2>⚙️ Réglages</h2>
    <div class="sec-title">Logements</div>
    <div class="card">${S.properties.length ? S.properties.map(p => `<div class="row" data-edit-prop="${p.id}" style="cursor:pointer">
      <img src="img/logo-chalets-du-pialou.jpg" alt="" class="avatar" style="object-fit:cover">
      <div class="grow"><div class="title small">${p.name}</div><div class="tiny muted">${p.city || 'Ville non renseignée'} · base ${p.base}€</div></div>
      <span class="dim">›</span>
    </div>`).join('') : '<div class="empty small">Aucun logement — ajoutez le premier ci-dessous</div>'}</div>
    <button class="btn ghost block" data-add-prop>+ Ajouter un logement</button>
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

    <div class="sec-title">Adresse</div>
    <div class="card">
      <label class="small muted">Ville</label>
      <input id="f-city" value="${p ? p.city : ''}" style="${FIELD}">
      <label class="small muted">Adresse</label>
      <input id="f-address" value="${p ? p.address : ''}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
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
      <label class="small muted">Wifi (nom du réseau)</label>
      <input id="f-wifi" value="${p ? p.wifi : ''}" style="${FIELD}">
      <label class="small muted">Mot de passe wifi</label>
      <input id="f-wifiPass" value="${p ? p.wifiPass : ''}" style="${FIELD}">
      <label class="small muted">Code porte</label>
      <input id="f-code" value="${p ? p.code : ''}" style="width:100%;margin:6px 0 0;padding:11px;border-radius:10px;background:var(--card2);color:var(--txt);border:1px solid var(--line)">
    </div>

    <div class="sec-title">Synchronisation Booking.com</div>
    <div class="card">
      <label class="small muted">URL iCal</label>
      <input id="f-ical" placeholder="https://admin.booking.com/.../calendar.ics" value="${p ? (p.icalUrl || '') : ''}" style="${FIELD}">
      <div class="tiny muted" style="margin-top:-8px">Extranet Booking.com → Réglages → Calendrier → Synchroniser les calendriers → copier le lien d'export iCal. Synchro en lecture seule : bloque les dates, ne remonte pas le nom du voyageur.</div>
      ${p && p.icalUrl ? `<div class="small muted" style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px">
        <span>Dernière synchro : ${p.icalLastSync ? fmtDateJ(iso(p.icalLastSync)) + ' ' + new Date(p.icalLastSync).toTimeString().slice(0,5) : 'jamais'}</span>
        <button class="btn ghost sm" data-sync-ical="${id}">🔄 Synchroniser</button>
      </div>` : ''}
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
    city: sg.querySelector('#f-city').value.trim(),
    address: sg.querySelector('#f-address').value.trim(),
    cap: +sg.querySelector('#f-cap').value || 1,
    base: +sg.querySelector('#f-base').value || 0,
    wifi: sg.querySelector('#f-wifi').value.trim(),
    wifiPass: sg.querySelector('#f-wifiPass').value.trim(),
    code: sg.querySelector('#f-code').value.trim(),
    icalUrl: sg.querySelector('#f-ical').value.trim(),
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

// ---------- Synchronisation iCal Booking.com (lecture seule) ----------
function parseIcal(text) {
  const unfolded = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
  return unfolded.split('BEGIN:VEVENT').slice(1).map(block => {
    const body = block.split('END:VEVENT')[0];
    const grab = re => { const m = body.match(re); return m ? m[1].replace(/\r$/, '').trim() : null; };
    const startRaw = grab(/DTSTART[^:\n]*:(\d{8})/);
    const endRaw = grab(/DTEND[^:\n]*:(\d{8})/);
    const toIso = raw => `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;
    return {
      start: startRaw ? toIso(startRaw) : null,
      end: endRaw ? toIso(endRaw) : null,
      uid: grab(/UID:(.+)/),
      summary: grab(/SUMMARY:(.+)/),
    };
  }).filter(ev => ev.start && ev.end);
}

async function importIcal(propId) {
  const p = prop(propId);
  if (!p || !p.icalUrl) { toast('Aucune URL iCal configurée'); return; }
  toast('🔄 Synchronisation Booking.com…');
  let text;
  try {
    const res = await fetch(p.icalUrl, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    text = await res.text();
  } catch (e) {
    toast("⛔ Échec de la synchro — sur la version web, Booking.com bloque souvent l'accès direct (CORS) ; utilisez l'app Android.");
    return;
  }
  const events = parseIcal(text);
  let added = 0, updated = 0;
  events.forEach(ev => {
    const existing = S.bookings.find(b => b.pid === propId && b.icalUid === ev.uid);
    if (existing) {
      existing.checkIn = ev.start; existing.checkOut = ev.end;
      existing.nights = nightsBetween(ev.start, ev.end);
      updated++;
    } else {
      const id = 'bic' + Math.random().toString(36).slice(2, 9);
      S.bookings.push({
        id, pid: propId, plat: 'booking', guest: ev.summary || 'Réservation Booking.com',
        checkIn: ev.start, checkOut: ev.end, nights: nightsBetween(ev.start, ev.end),
        guests: p.cap, amount: 0, avatarColor: '#3b82f6', review: null, note: '',
        icalUid: ev.uid, imported: true,
      });
      S.conversations[id] = { unread: 0, msgs: [] };
      added++;
    }
  });
  p.icalLastSync = new Date().toISOString();
  save();
  toast(`✅ Booking.com : ${added} ajoutée(s), ${updated} mise(s) à jour`);
  closeSheet(); sheetPropertyForm(propId);
}

// Ajouter une réservation
function sheetAdd() {
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
            ${Object.entries(PLAT).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select></div>
      </div>
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
  // anti double-réservation
  const clash = S.bookings.some(b => b.pid === pid && inIso < b.checkOut && outIso > b.checkIn);
  if (clash) { toast('⛔ Conflit : dates déjà réservées sur ce logement'); return; }
  const p = prop(pid);
  const id = 'b' + Date.now().toString(36);
  const newBooking = { id, pid, plat, guest: g, checkIn: inIso, checkOut: outIso, nights, guests,
    amount: p.base * nights, avatarColor: '#14b8a6', review: null, note: '' };
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
  root.querySelectorAll('[data-plan]').forEach(el => el.onclick = () => {
    const v = +el.dataset.plan; planStart = v === 0 ? 0 : planStart + v; render();
  });
  root.querySelectorAll('[data-rf]').forEach(el => el.onclick = () => { resaFilter = el.dataset.rf; render(); });
  root.querySelectorAll('[data-more]').forEach(el => el.onclick = () => {
    ({ cleaning: sheetCleaning, checkio: sheetCheckInOut, automsg: sheetAutoMessages, livret: sheetLivret, pricing: sheetPricing,
       guests: sheetGuests, stats: sheetStats, settings: sheetSettings }[el.dataset.more])();
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
    c.status = c.status === 'planned' ? 'todo' : c.status === 'todo' ? 'done' : 'planned';
    save(); closeSheet(); sheetCleaning();
  });
  root.querySelectorAll('[data-clean-assign]').forEach(el => el.onchange = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.cleanAssign);
    c.cleaner = el.value; save();
  });
  root.querySelectorAll('[data-clean-comment]').forEach(el => el.onblur = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.cleanComment);
    c.comment = el.value; save();
  });
  root.querySelectorAll('[data-checkio]').forEach(el => el.onclick = () => {
    S.activePid = el.dataset.checkio; save(); closeSheet(); sheetCheckInOut();
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
  root.querySelectorAll('[data-toggle-auto]').forEach(el => el.onchange = () => {
    const m = S.autoMessages.find(x => x.id === el.dataset.toggleAuto);
    m.enabled = el.checked; save();
  });
  root.querySelectorAll('[data-tpl-auto]').forEach(el => el.onblur = () => {
    const m = S.autoMessages.find(x => x.id === el.dataset.tplAuto);
    m.template = el.value; save();
  });
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
  root.querySelectorAll('[data-livret]').forEach(el => el.onclick = () => {
    S.activePid = el.dataset.livret; save(); closeSheet(); sheetLivret();
  });
  root.querySelectorAll('[data-share]').forEach(el => el.onclick = () => toast('🔗 Lien du livret copié'));
  root.querySelectorAll('[data-apply-price]').forEach(el => el.onclick = () => { closeSheet(); toast('✅ Prix conseillés appliqués'); });
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
  root.querySelectorAll('[data-sync-ical]').forEach(el => el.onclick = () => importIcal(el.dataset.syncIcal));
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
render();
