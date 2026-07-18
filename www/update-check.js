/*
 * update-check.js — vérification de mise à jour applicative (générique).
 * Interroge la dernière Release GitHub, compare au numéro embarqué et affiche
 * une carte de mise à jour (façon Play Store) avec les nouveautés si une
 * version plus récente est publiée.
 *
 * Config (dans index.html, avant ce script) :
 *   window.UPDATE_REPO = 'laurentsar/<repo>';   // obligatoire
 *   window.APP_VERSION = '1.2';                  // obligatoire (version installée)
 *
 * Autonome : aucune dépendance JS, réutilise les variables CSS de style.css
 * pour rester visuellement cohérent avec le reste de l'app. Anti-spam :
 * 1 requête / 6 h, mémorise la version ignorée. Échec réseau silencieux.
 */
(function () {
  'use strict';
  var REPO = window.UPDATE_REPO;
  var CURRENT = window.APP_VERSION;
  if (!REPO || !CURRENT) return;

  var POLL_INTERVAL = 6 * 3600 * 1000; // 6 h
  var KEY_POLL = 'updPoll:' + REPO;
  var KEY_DISMISS = 'updDismiss:' + REPO;

  function ls(get, k, v) {
    try { return get ? localStorage.getItem(k) : localStorage.setItem(k, v); }
    catch (e) { return null; }
  }

  // Compare deux versions "a.b.c" → >0 si va plus récente que vb.
  function cmp(va, vb) {
    var a = String(va).replace(/^v/, '').split('.');
    var b = String(vb).replace(/^v/, '').split('.');
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var d = (parseInt(a[i], 10) || 0) - (parseInt(b[i], 10) || 0);
      if (d) return d;
    }
    return 0;
  }

  // Nettoie le corps markdown d'une release GitHub en quelques puces lisibles.
  function extractNotes(body) {
    if (!body) return [];
    return body.split('\n')
      .map(function (l) { return l.replace(/^[-*]\s+/, '').replace(/https?:\/\/\S+/g, '').trim(); })
      .filter(function (l) { return l && !/^#/.test(l) && !/^\*\*full changelog/i.test(l); })
      .slice(0, 4);
  }

  function runCheck(force) {
    var last = parseInt(ls(true, KEY_POLL), 10) || 0;
    if (!force && Date.now() - last < POLL_INTERVAL) return;

    // Cache-buster (_) : évite qu'un service worker "cache-first" serve une
    // réponse d'API périmée. GitHub ignore les paramètres inconnus.
    fetch('https://api.github.com/repos/' + REPO + '/releases/latest?_=' + Date.now(), {
      headers: { Accept: 'application/vnd.github+json' }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (rel) {
        if (!rel || !rel.tag_name) return;
        ls(false, KEY_POLL, Date.now());
        var latest = String(rel.tag_name).replace(/^v/, '');
        if (cmp(latest, CURRENT) <= 0) return;          // déjà à jour
        if (ls(true, KEY_DISMISS) === latest) return;    // version déjà ignorée
        var apk = (rel.assets || []).filter(function (a) {
          return /\.apk$/i.test(a.name);
        })[0];
        showCard(latest, apk ? apk.browser_download_url : rel.html_url, extractNotes(rel.body));
      })
      .catch(function () { /* hors-ligne : silencieux */ });
  }

  // Vérification automatique au chargement (respecte le throttle 6h).
  runCheck(false);
  // Vérification forcée exposée pour l'écran de connexion (bypass throttle) :
  // on veut toujours savoir si l'app est à jour avant de se connecter.
  window.checkForUpdate = function () { runCheck(true); };

  function showCard(version, url, notes) {
    if (document.getElementById('update-card')) return;
    var css = document.createElement('style');
    css.textContent =
      '#update-card{position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom, 0px));' +
      'z-index:99999;padding:16px;border-radius:var(--r, 16px);background:var(--card, #13203a);' +
      'color:var(--txt, #eaf1ff);border:1px solid var(--line, #24365c);' +
      'box-shadow:0 8px 28px rgba(0,0,0,.4);font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'max-width:480px;margin:0 auto}' +
      '#update-card .uc-head{display:flex;align-items:center;gap:10px;margin-bottom:2px}' +
      '#update-card .uc-title{font-weight:700;font-size:15px;flex:1}' +
      '#update-card .uc-close{background:transparent;border:0;color:var(--txt2, #9fb2d4);' +
      'font-size:18px;line-height:1;cursor:pointer;padding:2px 4px}' +
      '#update-card .uc-ver{color:var(--txt2, #9fb2d4);font-size:12px;margin:2px 0 10px}' +
      '#update-card ul{margin:0 0 14px;padding-left:18px;color:var(--txt2, #9fb2d4);font-size:13px}' +
      '#update-card li{margin-bottom:3px}' +
      '#update-card .uc-actions{display:flex;gap:8px}' +
      '#update-card .uc-actions button, #update-card .uc-actions a{flex:1;text-align:center;' +
      'text-decoration:none;font-weight:700;font-size:13px;padding:10px;border-radius:10px;border:0}' +
      '#update-card .uc-later{background:var(--card2, #182a4a);color:var(--txt, #eaf1ff);' +
      'border:1px solid var(--line, #24365c) !important}' +
      '#update-card .uc-update{background:var(--accent, #14b8a6);color:#062622}';
    document.head.appendChild(css);

    var b = document.createElement('div');
    b.id = 'update-card';
    b.innerHTML =
      '<div class="uc-head"><span style="font-size:20px">🔄</span>' +
      '<span class="uc-title">Mise à jour disponible</span>' +
      '<button class="uc-close" aria-label="Ignorer">✕</button></div>' +
      '<div class="uc-ver">Version v' + version + '</div>' +
      (notes.length ? '<ul>' + notes.map(function (n) { return '<li>' + n.replace(/</g, '&lt;') + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="uc-actions">' +
      '<button class="uc-later">Plus tard</button>' +
      '<a class="uc-update" href="' + url + '" target="_blank" rel="noopener">Mettre à jour</a>' +
      '</div>';
    document.body.appendChild(b);
    var dismiss = function () { ls(false, KEY_DISMISS, version); b.remove(); };
    b.querySelector('.uc-close').onclick = dismiss;
    b.querySelector('.uc-later').onclick = dismiss;
  }
})();
