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

// ---------- Données de démonstration ----------
function seed() {
  const properties = [
    { id: 'p1', name: 'Studio Vieux-Port', emoji: '🌊', color: '#14b8a6',
      city: 'Marseille', address: '12 quai du Port, 13002 Marseille', cap: 2, base: 89,
      wifi: 'VieuxPort_5G', wifiPass: 'soleil2026', code: '4821' },
    { id: 'p2', name: 'Chalet des Cimes', emoji: '🏔️', color: '#f59e0b',
      city: 'Chamonix', address: '340 route des Praz, 74400 Chamonix', cap: 6, base: 240,
      wifi: 'ChaletCimes', wifiPass: 'montagne74', code: '7093' },
    { id: 'p3', name: 'Loft Canal', emoji: '🎨', color: '#a855f7',
      city: 'Paris 10e', address: '8 rue de Marseille, 75010 Paris', cap: 4, base: 155,
      wifi: 'LoftCanal', wifiPass: 'paris10eme', code: '1150' },
  ];

  const mk = (id, pid, plat, guest, inO, nights, guests, amount, extra = {}) => ({
    id, pid, plat, guest,
    checkIn: D(inO), checkOut: D(inO + nights), nights, guests, amount,
    avatarColor: ['#ef4444','#3b82f6','#a855f7','#14b8a6','#f59e0b','#ec4899'][id.charCodeAt(1) % 6],
    review: extra.review || null, note: extra.note || '',
  });

  const bookings = [
    mk('b1', 'p1', 'airbnb',  'Marie Lefebvre',    -1, 3, 2, 267),
    mk('b2', 'p1', 'booking', 'Thomas & Julie',     5, 4, 2, 356),
    mk('b7', 'p1', 'airbnb',  'Kevin Roy',          -8, 3, 1, 240, { review: 'pending' }),
    mk('b3', 'p2', 'direct',  'Famille Nguyen',      0, 7, 5, 1680),
    mk('b8', 'p2', 'booking', 'Groupe Ski Lyon',    -4, 4, 6, 960),
    mk('b4', 'p2', 'abritel', 'Sophie Marchand',    12, 3, 4, 720),
    mk('b5', 'p3', 'booking', 'Anna Schmidt',        2, 4, 4, 620),
    mk('b9', 'p3', 'direct',  'David Cohen',        -2, 3, 3, 465),
    mk('b6', 'p3', 'airbnb',  'Lucas Bernard',      -3, 2, 2, 310, { review: 5 }),
  ];

  // Conversations (msg auto marqués isAuto)
  const t = (off, h) => `${D(off)} ${h}`;
  const conversations = {
    b1: { unread: 0, msgs: [
      { from: 'host',  text: 'Bonjour Marie, votre réservation au Studio Vieux-Port est confirmée ✅. À bientôt !', at: t(-6,'09:12'), isAuto: true },
      { from: 'host',  text: "Bienvenue ! Arrivée autonome dès 15h. Code de la porte : 4821. Wifi : VieuxPort_5G.", at: t(-1,'08:00'), isAuto: true },
      { from: 'guest', text: 'Merci beaucoup, tout est parfait, la vue est superbe ! 😍', at: t(-1,'16:40') },
    ]},
    b5: { unread: 1, msgs: [
      { from: 'host',  text: 'Bonjour Anna, réservation confirmée pour le Loft Canal ✅', at: t(-2,'11:00'), isAuto: true },
      { from: 'guest', text: 'Bonjour ! Est-ce que le parking est possible à proximité ? Nous arrivons en voiture.', at: t(-1,'19:22') },
    ]},
    b8: { unread: 1, msgs: [
      { from: 'guest', text: "Bonjour, la douche fuit et le chauffage ne marche pas. On est très déçus pour ce prix, c'est un problème.", at: t(-1,'21:05') },
    ]},
    b3: { unread: 0, msgs: [
      { from: 'host',  text: 'Bonjour, bienvenue au Chalet des Cimes ! Arrivée à partir de 16h aujourd’hui 🏔️', at: t(0,'08:30'), isAuto: true },
      { from: 'guest', text: 'Parfait, on arrive vers 17h. Hâte !', at: t(0,'09:10') },
    ]},
    b9: { unread: 0, msgs: [
      { from: 'host',  text: 'Bon séjour David ! N’hésitez pas si besoin.', at: t(-2,'15:00'), isAuto: true },
    ]},
  };

  const cleaners = ['Fatima', 'Sébastien', 'Agence CleanPro'];
  // Ménage : un turnover à chaque départ
  const cleaning = bookings
    .filter(b => nightsBetween(D(-2), b.checkOut) >= 0)     // départs récents/à venir
    .map((b, i) => ({
      id: 'c' + b.id, pid: b.pid, date: b.checkOut, bookingId: b.id,
      cleaner: cleaners[i % cleaners.length],
      status: nightsBetween(D(0), b.checkOut) < 0 ? 'done'
            : nightsBetween(D(0), b.checkOut) === 0 ? 'todo' : 'planned',
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return { properties, bookings, conversations, cleaning, activePid: 'all', v: 1 };
}

// ---------- État ----------
const KEY = 'gesthote.state';
let S;
function load() {
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || S.v !== 1) { S = seed(); save(); }
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
  const occRate = Math.round((occ / cap) * 100);

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
    <h2>🔄 Synchronisation des canaux</h2>
    <div class="small muted" style="margin-bottom:8px">Calendriers synchronisés — anti-double réservation actif.</div>
    ${['Airbnb','Booking.com','Abritel'].map(c => `<div class="row">
      <div class="grow"><div class="title small">${c}</div><div class="tiny muted">Dernière synchro il y a 8 min</div></div>
      <span class="badge ok">● à jour</span></div>`).join('')}
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

  // Moteur d'automatisation : statut de chaque message programmé
  const now = D(0);
  const steps = [
    { ic: '✅', label: 'Confirmation de réservation', when: b.checkIn, rule: 'à la réservation', sent: true },
    { ic: '🔑', label: "Instructions d'arrivée (code, wifi)", whenIso: D_before(b.checkIn, 1), rule: 'J-1' },
    { ic: '👋', label: 'Message de bienvenue', whenIso: b.checkIn, rule: "jour d'arrivée" },
    { ic: '🧳', label: 'Rappel de départ', whenIso: b.checkOut, rule: 'jour du départ' },
    { ic: '⭐', label: "Demande d'avis", whenIso: D_after(b.checkOut, 1), rule: 'J+1' },
  ];
  const stepHtml = steps.map(s => {
    const w = s.whenIso || s.when;
    const done = s.sent || w < now;
    const next = !done && w === now;
    return `<li>
      <span class="st-ico ${done?'done':next?'next':''}">${done?'✓':s.ic}</span>
      <div><div class="small" style="font-weight:600">${s.label}</div>
        <div class="tiny muted">${s.rule} · ${done?'envoyé':next?"aujourd'hui":'programmé '+fmtDate(w)}</div></div>
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
const D_after  = (isoStr, n) => iso(new Date(parse(isoStr).getTime() + n * DAY));

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

// Ménage
function sheetCleaning() {
  const list = filtered(S.cleaning);
  const item = c => {
    const b = booking(c.bookingId), p = prop(c.pid);
    const st = { done:['ok','Fait'], todo:['warn','À faire'], planned:['info','Planifié'] }[c.status];
    const nextIn = S.bookings.find(x => x.pid === c.pid && x.checkIn === c.date);
    return `<div class="row">
      <div class="avatar" style="background:${p.color}">${p.emoji}</div>
      <div class="grow"><div class="title small">${p.name}</div>
        <div class="tiny muted">${fmtDateJ(c.date)} · ${c.cleaner}${nextIn?` · arrivée ${nextIn.guest.split(' ')[0]} même jour`:''}</div></div>
      <button class="badge ${st[0]}" data-clean="${c.id}">${st[1]}</button>
    </div>`;
  };
  openSheet(`
    <h2>🧹 Ménage & turnover</h2>
    <div class="small muted" style="margin-bottom:10px">Une intervention est créée à chaque départ. Touchez le statut pour le faire avancer.</div>
    <div class="card">${list.length ? list.map(item).join('') : '<div class="empty small">Rien à nettoyer</div>'}</div>
    <div class="card small muted">💡 Amélioration : notification auto à l'équipe dès qu'un départ est confirmé + checklist photo de fin de ménage.</div>
  `);
}

// Livret d'accueil
function sheetLivret() {
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
    ${props.map(block).join('')}
    <button class="btn block" data-apply-price>✅ Appliquer les prix conseillés</button>
  `);
}

// Voyageurs
function sheetGuests() {
  const list = filtered(S.bookings).slice().sort((a,b)=>b.checkIn.localeCompare(a.checkIn));
  openSheet(`
    <h2>👥 Voyageurs</h2>
    <div class="card" style="padding:4px 14px">${list.map(b => {
      const p = prop(b.pid);
      return `<div class="row" data-open="${b.id}">
        <div class="avatar" style="background:${b.avatarColor}">${b.guest[0]}</div>
        <div class="grow"><div class="title small">${b.guest}</div>
          <div class="tiny muted">${p.emoji} ${p.name} · ${fmtDate(b.checkIn)}</div></div>
        ${typeof b.review==='number'?`<span class="badge ok">★ ${b.review}</span>`:b.review==='pending'?'<span class="badge warn">avis ?</span>':`<span class="badge plat ${PLAT[b.plat].cls}">${PLAT[b.plat].label}</span>`}
      </div>`;
    }).join('')}</div>
  `);
}

// Statistiques
function sheetStats() {
  const bks = S.bookings;
  const rev = bks.reduce((s,b)=>s+b.amount,0);
  const nights = bks.reduce((s,b)=>s+b.nights,0);
  const byPlat = {};
  bks.forEach(b => byPlat[b.plat] = (byPlat[b.plat]||0) + b.amount);
  const max = Math.max(...Object.values(byPlat));
  openSheet(`
    <h2>📈 Statistiques</h2>
    <div class="kpis">
      <div class="kpi"><div class="v">${money(rev)}</div><div class="l">Revenu total</div></div>
      <div class="kpi"><div class="v">${money(Math.round(rev/nights))}</div><div class="l">Prix moyen / nuit</div></div>
      <div class="kpi"><div class="v">${nights}</div><div class="l">Nuits vendues</div></div>
      <div class="kpi"><div class="v">${bks.length}</div><div class="l">Réservations</div></div>
    </div>
    <div class="sec-title">Revenu par canal</div>
    <div class="card">${Object.entries(byPlat).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`
      <div style="margin-bottom:10px"><div class="row" style="border:0;padding:0 0 4px">
        <span class="small" style="font-weight:600">${PLAT[k].label}</span><span class="spacer" style="flex:1"></span>
        <span class="small">${money(v)}</span></div>
        <div class="bar"><span style="width:${Math.round(v/max*100)}%;background:${k==='airbnb'?'#ff5a5f':k==='booking'?'#3b82f6':k==='direct'?'#a855f7':'#f59e0b'}"></span></div></div>
    `).join('')}</div>
    <div class="card small muted">💡 Améliorer la part « Direct » (0% de commission) via le livret + relance des anciens voyageurs.</div>
  `);
}

// Réglages
function sheetSettings() {
  openSheet(`
    <h2>⚙️ Réglages</h2>
    <div class="sec-title">Logements</div>
    <div class="card">${S.properties.map(p => `<div class="row">
      <div class="avatar" style="background:${p.color}">${p.emoji}</div>
      <div class="grow"><div class="title small">${p.name}</div><div class="tiny muted">${p.city} · base ${p.base}€</div></div>
    </div>`).join('')}</div>
    <div class="sec-title">Données</div>
    <div class="card">
      <button class="btn ghost block" data-reset>♻️ Réinitialiser la démo</button>
      <div class="tiny muted" style="margin-top:8px">Efface vos modifications locales et recharge les données d'exemple.</div>
    </div>
    <div class="sec-title">À propos</div>
    <div class="card">
      <div class="kv"><span class="k">Application</span><span class="v">GestHôte</span></div>
      <div class="kv"><span class="k">Version</span><span class="v">v${window.APP_VERSION}</span></div>
      <div class="kv"><span class="k">Build</span><span class="v">${window.APP_VERSION} · démo</span></div>
    </div>
    <div class="card small muted">Clone Superhote (démo). Prochaines étapes : sync iCal réelle, paiements, serrures connectées, IA messagerie via Claude API.</div>
  `);
}

// Ajouter une réservation
function sheetAdd() {
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
  S.bookings.push({ id, pid, plat, guest: g, checkIn: inIso, checkOut: outIso, nights, guests,
    amount: p.base * nights, avatarColor: '#14b8a6', review: null, note: '' });
  S.conversations[id] = { unread: 0, msgs: [
    { from:'host', text:`Bonjour ${g.split(' ')[0]}, votre réservation ${p.emoji} ${p.name} est confirmée ✅`,
      at:`${D(0)} 12:00`, isAuto:true }
  ]};
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
    ({ cleaning: sheetCleaning, livret: sheetLivret, pricing: sheetPricing,
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
    save(); closeSheet(); toast('Réservation annulée'); render();
  });
  root.querySelectorAll('[data-clean]').forEach(el => el.onclick = () => {
    const c = S.cleaning.find(x => x.id === el.dataset.clean);
    c.status = c.status === 'planned' ? 'todo' : c.status === 'todo' ? 'done' : 'planned';
    save(); closeSheet(); sheetCleaning();
  });
  root.querySelectorAll('[data-livret]').forEach(el => el.onclick = () => {
    S.activePid = el.dataset.livret; save(); closeSheet(); sheetLivret();
  });
  root.querySelectorAll('[data-share]').forEach(el => el.onclick = () => toast('🔗 Lien du livret copié'));
  root.querySelectorAll('[data-apply-price]').forEach(el => el.onclick = () => { closeSheet(); toast('✅ Prix conseillés appliqués'); });
  root.querySelectorAll('[data-reset]').forEach(el => el.onclick = () => {
    if (!confirm('Réinitialiser toutes les données de démo ?')) return;
    localStorage.removeItem(KEY); load(); closeSheet(); toast('♻️ Démo réinitialisée'); render();
  });
  root.querySelectorAll('[data-save-add]').forEach(el => el.onclick = () => saveAdd(document.querySelector('.sheet-bg')));
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
