# FILMLIOGRAPHIE (repo/projet : la-bobine)

Application de suivi de films — site statique + fonctions serverless.
Déployée sur Vercel : **https://la-bobine-one.vercel.app**

Nom affiché dans l'app : **FILMLIOGRAPHIE** (jeu de mots sur « filmographie »,
avec « LIO » en couleur accent dans le logo de la topbar). Le nom du dépôt
GitHub (`studiolm1977/la-bobine`), du projet Vercel (`studio-lm/la-bobine`)
et les clés `localStorage` sont volontairement restés `la-bobine` / anciens
identifiants — voir section « Renommage » ci-dessous, ne pas les renommer
sans lire cette section d'abord.

Ce projet a été créé à partir de **reliure** (book-tracker), même stack et
même design system, adapté au suivi de films.

## Stack

- Site **statique** (pas de framework, pas de build) + 2 fonctions serverless.
- 3 fichiers front-end : `index.html`, `style.css`, `app.js`.
- `api/movies.js` : proxy TMDB (recherche + fiche détaillée : réalisateur,
  durée, genres, casting, bande-annonce, films similaires, où le regarder).
  Clé API côté serveur, jamais exposée au client.
- `api/library.js` : GET/POST de la sauvegarde cloud de la filmothèque
  (Vercel Blob, store `la-bobine-library`, accès public, pathname fixe
  `library.json`). `package.json` ne sert qu'à installer `@vercel/blob`
  pour cette fonction.
- PWA : `manifest.json` + `service-worker.js` + `icons/` (icônes générées
  par script Playwright, pas dessinées à la main — voir `icons/` pour le
  design : bobine de film violette sur fond sombre).
- Données : `localStorage` (clé `la-bobine.movies`) = cache local rapide.
  Le Blob cloud est la source de vérité qui survit à un nettoyage de
  stockage navigateur/iOS (même logique que reliure).

## Déploiement

Le projet Vercel est `studio-lm/la-bobine` (team `studio-lm`, différent du
nom d'org GitHub `studiolm1977` — normal, ce sont deux systèmes distincts).

```bash
vercel --prod --yes    # déploie en production (nécessite un token/login Vercel)
vercel dev             # teste en local (y compris /api/movies et /api/library)
```

**⚠️ L'auto-déploiement Git n'est probablement pas connecté** (tentative de
connexion échouée via CLI — nécessite une autorisation OAuth GitHub App
depuis le dashboard Vercel, jamais confirmée comme faite). Vérifier sur
https://vercel.com/studio-lm/la-bobine/settings/git avant de supposer qu'un
`git push` déclenche un déploiement automatique. Si non connecté, chaque
changement de code nécessite un `vercel --prod` manuel après le push.

Variables d'environnement Vercel déjà configurées (production/preview/dev) :
- `TMDB_API_KEY` — clé API TMDB (v3)
- `BLOB_READ_WRITE_TOKEN` — généré automatiquement à la création du store Blob

## Développement local

```bash
vercel dev                      # recommandé : fait tourner /api/movies et /api/library
# ou, sans l'API :
python3 -m http.server 8000     # recherche/enrichissement TMDB indisponibles
```

## Structure

```
index.html            Structure de l'app (topbar, top-strip, filtres, movie-grid, 2 modales)
style.css              Design system dark-first, violet #8069ff, Inter + Bricolage Grotesque
app.js                 IIFE unique, localStorage + sync cloud, recherche/enrichissement TMDB
api/movies.js          Endpoint serverless /api/movies (recherche ?q= + fiche détaillée ?id=)
api/library.js         Endpoint serverless /api/library (GET/POST sauvegarde cloud Vercel Blob)
service-worker.js      PWA : network-first pour le code, cache-first pour les assets/affiches
manifest.json          Manifeste PWA
icons/                 Icônes PWA (générées via script Playwright, cf. historique de session)
```

Pas de dossier `covers/` (contrairement à reliure) : les affiches viennent
toujours de TMDB (`image.tmdb.org`) ou d'un placeholder généré (SVG data URI).

## Modèle de données (un film)

```js
{
  id, title, director, runtime,        // durée en minutes
  currentMinute,                        // progression si status === 'watching'
  year,                                 // année de sortie (optionnelle, pour tri/filtre décennie)
  genres,                               // tableau de noms de genres (mémorisé une fois récupéré via TMDB)
  status,                               // 'want' | 'watching' | 'seen' | 'dnf'
  rating, notes, poster, tmdbId, synopsis, colorHex,
}
```

`MOCK_MOVIES` est un tableau **vide** : aucune donnée de démo au premier
lancement (contrairement à reliure). Ne pas réintroduire de films d'exemple
sans demande explicite.

## Architecture du code (app.js)

Points d'entrée clés :

- `renderAll()` → `renderTopMovies()` + `renderTabCounts()` + `renderFilters()` + `renderGrid()`
- `renderFilters()` — badges de filtre genre/décennie, générés dynamiquement à partir des films présents
- `openMovieModal(id, event)` — ouverture avec View Transition (morph de l'affiche)
- `loadSynopsis(movie)` — synopsis TMDB (statut seen/watching uniquement), avec cache persistant
- `loadFilmExtras(movie)` — genres, casting, bande-annonce, films similaires, où le regarder
  (récupérés à **chaque** ouverture de fiche, non mis en cache — sauf `genres`, mémorisé une
  fois pour permettre le filtrage dans la grille)
- `queueSync()` / `syncNow()` / `syncFromServer()` — sauvegarde cloud, voir section dédiée

Pas de section « En cours de visionnage » (bande de progression) : supprimée
sur demande explicite de l'utilisateur, ne pas la réintroduire sans qu'on
le redemande.

## TMDB (api/movies.js)

Deux modes sur le même endpoint :
- `?q=<query>&limit=<n>` — recherche (titre, année, affiche, résumé)
- `?id=<tmdbId>` — fiche détaillée : `append_to_response=credits,recommendations,watch/providers`
  + un appel séparé sans filtre de langue vers `/movie/{id}/videos` (peu de bandes-annonces
  YouTube sont cataloguées en français sur TMDB, donc pas de `language=fr-FR` sur cet appel).

« Où le regarder » utilise l'endpoint officiel `watch/providers` de TMDB (données
JustWatch redistribuées, région France en dur). **Attribution obligatoire** :
le lien retourné (`wp.link`) doit rester affiché à côté des logos de plateformes
— condition d'usage TMDB, ne pas le retirer.

## Sauvegarde cloud (api/library.js + Vercel Blob)

Même logique que reliure : `saveMovies()` écrit en `localStorage` et déclenche
un sync cloud ; `syncFromServer()` au chargement fusionne ou remplace selon
`libraryWasEmpty`.

**Piège identifié et corrigé** : la suppression d'un film utilisait le même
débounce de 800ms que les sauvegardes mineures. Fermer/recharger l'onglet
dans cette fenêtre empêchait l'envoi cloud ; au rechargement suivant, la
fusion « on ne supprime jamais rien localement » réimportait le film depuis
l'ancienne version cloud (le film supprimé « revenait »). Fix : `saveMovies(true)`
déclenche un `syncNow()` immédiat (sans débounce) — utilisé uniquement pour
la suppression (`mmDeleteBtn`). Si un autre point d'écriture destructif est
ajouté un jour, lui appliquer le même traitement.

## Pièges CSS déjà rencontrés

- **`hidden` court-circuité** : un attribut HTML `hidden` peut être neutralisé
  par une règle d'auteur qui fixe `display` sur le même sélecteur (spécificité
  égale, l'auteur gagne sur l'UA stylesheet). Fixé une fois pour toutes avec
  une règle globale `[hidden] { display: none !important; }` — ne pas la
  retirer, et s'appuyer dessus plutôt que de gérer `display` manuellement
  quand on ajoute un nouveau bloc masquable.
- **Badge de statut illisible en thème clair** : `.movie-card-status` a un
  fond toujours sombre (peu importe le thème, pour rester lisible sur
  n'importe quelle affiche) — le texte par défaut doit donc être fixé en
  blanc (`color: #fff`), jamais suivre une variable de thème comme
  `--text-primary` qui devient sombre en thème clair.

## Renommage (FILMLIOGRAPHIE)

L'app s'appelle FILMLIOGRAPHIE mais **le dépôt GitHub, le projet Vercel et
les clés `localStorage` (`la-bobine.movies`, `la-bobine.theme`) sont restés
inchangés délibérément** : renommer une clé `localStorage` orpheline les
données existantes des utilisateurs (l'app ne les retrouve plus sous
l'ancienne clé). Si on renomme un jour ces clés, il faudra migrer les
données existantes (lire l'ancienne clé, la recopier sous la nouvelle,
supprimer l'ancienne) plutôt que de simplement changer la constante.

## Convention de thème

- Couleur d'accent : `--accent` (`#8069ff` dark / `#6f56f2` light)
- Polices : `'Inter'` (corps) + `'Bricolage Grotesque'` (titres, logo)
- Le « LIO » du logo topbar utilise `.brand-highlight { color: var(--accent); }`
