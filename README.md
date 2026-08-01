# GestHôte

Application de gestion de locations courte durée (PMS + channel manager), style **Superhote**, avec améliorations. PWA + APK Android (Capacitor), données de démonstration locales.

## Modules (MVP)

- **Tableau de bord** — occupation 30 j, revenu du mois, arrivées/départs du jour, alertes intelligentes.
- **Planning** — calendrier timeline multi-logements, barres colorées par canal, synchro iCal Booking.com par logement (anti-double réservation).
- **Réservations** — liste filtrable (sur place / à venir / passées), fiche détaillée, création avec contrôle de conflit de dates.
- **Messagerie** — boîte unifiée tous canaux, messages automatiques configurables (jour de la réservation, veille d'arrivée, veille de départ, 2h après départ) dans *Plus → Messages automatiques*.
- **Ménage** — turnover auto à chaque départ, statut planifié → à faire → fait, assignation à un intervenant via une liste déroulante paramétrable (*Plus → Ménage → Gérer la liste des intervenants*).
- **Livret d'accueil** — guide digital par logement (wifi, code, règles, bonnes adresses).
- **Logements** — ajout / modification / suppression depuis *Plus → Réglages*.

## Améliorations vs Superhote

- 🤖 **Réponses IA suggérées** dans la messagerie (mock — à brancher sur Claude API).
- ⚠️ **Détection d'insatisfaction** — analyse de sentiment des messages → alerte avant un mauvais avis.
- 💶 **Tarification dynamique** — prix conseillés selon saison/week-end/remplissage (base pour intégration météo + agenda événementiel).
- ➕ **Upsell** — arrivée anticipée, ménage mi-séjour, panier local en 1 tap.
- 📈 **Focus canal direct** (0 % commission) mis en avant dans les stats.

## Build APK

CI GitHub Actions (`.github/workflows/build-apk.yml`) : au push sur `main`/`master`, génère la plateforme Android au 1er run, signe avec un keystore stable persisté, publie l'APK en Release sur ce repo **et** sur `gesthote-releases` (public, pour l'auto-MAJ in-app).

### Prérequis GitHub (une fois)
1. Créer les repos `laurentsar/gesthote` (privé) et `laurentsar/gesthote-releases` (public).
2. Ajouter le secret `RELEASE_PAT` (token avec accès au repo releases).
3. `git push` → le CI build et publie.

## Installation sur iPhone (PWA, gratuit)

Une vraie app iOS nécessiterait un Mac (Xcode) et un compte Apple Developer
payant (99 $/an), même pour un usage privé (TestFlight). En attendant, l'app
est aussi publiée comme **PWA installable** : mêmes fonctionnalités, mise à
jour automatique, sans passer par l'App Store.

Le CI publie `www/` sur la branche `gh-pages` du dépôt public
`laurentsar/gesthote-releases` (étape *"Publish web app to GitHub Pages"* de
`build-apk.yml`, via le secret `RELEASE_PAT`).

**Une seule fois** (activer GitHub Pages sur `gesthote-releases`) :
1. `github.com/laurentsar/gesthote-releases/settings/pages`
2. Source : **Deploy from a branch** → branche `gh-pages` → dossier `/ (root)` → **Save**
3. L'URL devient active : `https://laurentsar.github.io/gesthote-releases/`

**Sur chaque iPhone** :
1. Ouvrir cette URL dans **Safari** (obligatoire — les autres navigateurs
   iOS ne proposent pas l'installation).
2. Bouton **Partager** → **"Sur l'écran d'accueil"** → **Ajouter**.

Une icône GestHôte apparaît alors sur l'écran d'accueil et s'ouvre en plein
écran comme une app native.

## Sauvegarde automatique (Home Assistant)

`www/autobackup.js` sauvegarde en continu l'intégralité du `localStorage` de
l'app vers un serveur Home Assistant auto-hébergé (entité `sensor`), pour
survivre à une désinstallation.

**Pourquoi** : Android ne fournit aucun hook fiable au moment de la
désinstallation (l'app est tuée puis son stockage effacé, sans prévenir) — la
seule approche robuste est de sauvegarder en continu, *avant* que ça arrive.
L'Auto Backup de Google ne couvre pas ce cas non plus : la restauration est
liée à la signature de l'app, qui a changé en cours de route sur ce projet.

C'est un module générique (pas spécifique à GestHôte), réutilisé sur
plusieurs apps du même auteur. Réglages via *Sauvegarde des données* en bas
de l'app (URL Home Assistant + jeton d'accès long-lived).

## Statut

Données stockées localement (localStorage), l'app démarre vide : ajoutez vos logements dans Réglages. Étapes suivantes : sync iCal réelle Airbnb/Booking, paiements, serrures connectées, IA messagerie via Claude API.
