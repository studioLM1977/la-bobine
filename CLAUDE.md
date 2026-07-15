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
même design system, adapté au suivi de films — puis étendu aux séries TV
(juillet 2026, voir section « Films vs séries » ci-dessous).

## Stack

- Site **statique** (pas de framework, pas de build) + fonctions serverless.
- 3 fichiers front-end : `index.html`, `style.css`, `app.js`.
- `api/movies.js` : proxy TMDB films (recherche + fiche détaillée : réalisateur,
  durée, genres, casting, bande-annonce, films similaires, où le regarder).
  Clé API côté serveur, jamais exposée au client.
- `api/tv.js` : même chose que `api/movies.js` mais pour les séries (endpoints
  TMDB `/search/tv` et `/tv/{id}`) — fichier séparé plutôt qu'un paramètre sur
  `api/movies.js`, chaque fonction serverless reste autonome. Champs TMDB TV
  différents des films : `name`/`first_air_date` (pas `title`/`release_date`),
  `created_by` (pas de réalisateur), `number_of_seasons`/`number_of_episodes`/
  `episode_run_time` (pas un `runtime` unique).
- `api/ai.js` : proxy Gemini (`gemini-3.1-flash-lite`) pour les suggestions et
  la recherche par description libre. Mediatype-aware (`mediaType: 'movie'|'series'`
  dans le corps de la requête) : adapte le prompt et recherche ensuite sur TMDB
  films ou séries selon le cas. Clé API côté serveur, jamais exposée au client.
- `api/library.js` : GET/POST de la sauvegarde cloud de la filmothèque (films
  **et** séries mélangés dans le même tableau, voir « Films vs séries »)
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
vercel dev             # teste en local (y compris /api/movies, /api/tv, /api/ai et /api/library)
```

**⚠️ L'auto-déploiement Git n'est probablement pas connecté** (tentative de
connexion échouée via CLI — nécessite une autorisation OAuth GitHub App
depuis le dashboard Vercel, jamais confirmée comme faite). Vérifier sur
https://vercel.com/studio-lm/la-bobine/settings/git avant de supposer qu'un
`git push` déclenche un déploiement automatique. Si non connecté, chaque
changement de code nécessite un `vercel --prod` manuel après le push.

Variables d'environnement Vercel déjà configurées (production/preview/dev) :
- `TMDB_API_KEY` — clé API TMDB (v3)
- `GEMINI_API_KEY` — clé API Gemini, pour `api/ai.js` (suggestions + recherche par description)
- `YOUTUBE_API_KEY` — optionnelle, repli pour trouver une vraie bande-annonce VF
- `BLOB_READ_WRITE_TOKEN` — généré automatiquement à la création du store Blob

## Développement local

```bash
vercel dev                      # recommandé : fait tourner /api/movies, /api/tv, /api/ai et /api/library
# ou, sans l'API :
python3 -m http.server 8000     # recherche/enrichissement TMDB et IA indisponibles
```

## Structure

```
index.html            Structure de l'app (topbar avec toggle Films/Séries, top-strip, filtres, movie-grid, 3 modales)
style.css              Design system dark-first, violet #8069ff, Inter + Bricolage Grotesque
app.js                 IIFE unique, localStorage + sync cloud, recherche/enrichissement TMDB, IA
api/movies.js          Endpoint serverless /api/movies (recherche ?q= + fiche détaillée ?id=) — films
api/tv.js              Endpoint serverless /api/tv, même contrat que movies.js — séries
api/ai.js              Endpoint serverless /api/ai (proxy Gemini : identify + recommend, mediatype-aware)
api/library.js         Endpoint serverless /api/library (GET/POST sauvegarde cloud Vercel Blob)
service-worker.js      PWA : network-first pour le code, cache-first pour les assets/affiches
manifest.json          Manifeste PWA
icons/                 Icônes PWA (générées via script Playwright, cf. historique de session)
```

Pas de dossier `covers/` (contrairement à reliure) : les affiches viennent
toujours de TMDB (`image.tmdb.org`) ou d'un placeholder généré (SVG data URI).

## Films vs séries

Ajouté en juillet 2026. Un **seul** tableau `movies` (même clé `localStorage`
`la-bobine.movies`, même endpoint `/api/library`) contient les films **et**
les séries, distingués par le champ `mediaType` (`'movie'` ou `'series'` —
absent = `'movie'`, pour toutes les entrées créées avant cette fonctionnalité :
compatibilité ascendante automatique, aucune migration nécessaire).

Un toggle **Films / Séries** dans la topbar (`#mediaToggle`, réutilise les
classes `.mode-tabs`/`.mode-tab` du sélecteur de mode de la modale d'ajout)
bascule `activeMediaType` (persisté dans `localStorage.la-bobine.mediaType`)
et filtre **tout** l'affichage : grille, top 10, compteurs d'onglets, filtres
genre/décennie, recherche, suggestions IA. Voir `currentLibrary()` dans
`app.js`, point d'entrée commun à toutes les fonctions de rendu.

**Champs réutilisés plutôt que dupliqués** (pour ne rien casser sur les
films existants en prod, dont le schéma JSON ne doit pas changer) :
- `director` contient le réalisateur (film) OU le·s créateur·s (série,
  noms TMDB `created_by` joints par une virgule) — seul le **libellé** affiché
  change (`creatorLabel(item)` → « Réalisateur » ou « Créateur »).
- `runtime` contient la durée totale (film) OU la durée moyenne d'un épisode
  en minutes (série).
- `seasons`/`episodes` (nouveaux champs, optionnels) : uniquement pour les séries.
- Statuts identiques aux films : `want` / `seen` / `dnf` (pas de suivi
  saison/épisode en cours — décision explicite pour rester cohérent avec le
  choix déjà fait de ne pas suivre la progression des films).

`formatRuntimeLine(item)` construit la ligne affichée dans la fiche
(`#mmRuntime`) : `"148 min · 2010"` pour un film, `"47 min/ép. · 5 saisons ·
62 épisodes · 2008"` pour une série.

**Libellés dynamiques dans le HTML** : tout élément qui doit changer de texte
selon le mode porte `data-movie="…"`/`data-series="…"` (texte),
`data-ph-movie="…"`/`data-ph-series="…"` (placeholder) ou
`data-aria-movie="…"`/`data-aria-series="…"` (aria-label). `applyMediaTypeLabels()`
dans `app.js` balaie ces attributs à l'init et à chaque bascule du toggle — pour
ajouter un nouveau libellé film/série, ajouter les attributs `data-*` dans
`index.html`, rien à toucher côté JS.

**Modale d'ajout** : `addMediaType` (état local à la modale, fixé à l'ouverture
sur `activeMediaType` par défaut, ou explicitement lors d'un clic sur un
« similaire ») détermine l'endpoint TMDB appelé (`/api/movies` vs `/api/tv`)
et si les champs optionnels Saisons/Épisodes (`#afSeriesFieldsBlock`, saisie
manuelle uniquement) sont affichés.

**Piège rencontré** : `setAddMode()` filtrait initialement `.mode-tab`
globalement (`document.querySelectorAll('.mode-tab')`), ce qui désactivait
aussi le toggle Films/Séries de la topbar à chaque fois que le mode
Rechercher/Décrire/Saisie manuelle changeait dans la modale (même classe CSS
réutilisée aux deux endroits). Scopé à `#modeTabs .mode-tab`. Idem, les
écouteurs `click` sur `openAddBtn`/`emptyStateAddBtn`/`fabAddBtn` passent
`() => openAddModal()` et non `openAddModal` directement : sinon l'event
`click` (objet truthy) est reçu comme premier argument `mediaType`, écrasant
la valeur par défaut `activeMediaType`.

## Architecture du code (app.js)

Points d'entrée clés :

- `renderAll()` → `renderTopMovies()` + `renderTabCounts()` + `renderFilters()` + `renderGrid()`
  (toutes partent de `currentLibrary()`, le sous-ensemble filtré par `activeMediaType`)
- `renderFilters()` — badges de filtre genre/décennie, générés dynamiquement à partir des films/séries présents
- `openMovieModal(id, event)` — ouverture avec View Transition (morph de l'affiche)
- `loadSynopsis(movie)` — synopsis TMDB (statut seen uniquement), avec cache persistant
- `loadFilmExtras(movie)` — genres, casting, bande-annonce, films/séries similaires, où le regarder
  (récupérés à **chaque** ouverture de fiche, non mis en cache — sauf `genres`
  et, pour les séries, `seasons`/`episodes`, mémorisés une fois)
- `queueSync()` / `syncNow()` / `syncFromServer()` — sauvegarde cloud, voir section dédiée
- `setActiveMediaType(type)` — bascule le toggle Films/Séries, voir « Films vs séries »

Pas de section « En cours de visionnage » (bande de progression) : supprimée
sur demande explicite de l'utilisateur, ne pas la réintroduire sans qu'on
le redemande.

## TMDB (api/movies.js + api/tv.js)

Deux modes sur chaque endpoint (mêmes paramètres, films ou séries) :
- `?q=<query>&limit=<n>` — recherche (titre, année, affiche, résumé)
- `?id=<tmdbId>` — fiche détaillée : `append_to_response=credits,recommendations,watch/providers`
  + un appel séparé sans filtre de langue vers `/movie|tv/{id}/videos` (peu de bandes-annonces
  YouTube sont cataloguées en français sur TMDB, donc pas de `language=fr-FR` sur cet appel).

« Où le regarder » utilise l'endpoint officiel `watch/providers` de TMDB (données
JustWatch redistribuées, région France en dur). **Attribution obligatoire** :
le lien retourné (`wp.link`) doit rester affiché à côté des logos de plateformes
— condition d'usage TMDB, ne pas le retirer.

## Suggestions IA et recherche par description (api/ai.js, Gemini)

Deux actions sur le même endpoint `/api/ai` (POST, `{action: 'identify'|'recommend', mediaType: 'movie'|'series', ...}`) :
- **`identify`** — retrouve un titre à partir d'une description libre (modale d'ajout, onglet « Décrire »).
- **`recommend`** — suggère 6 titres non présents dans la bibliothèque notée (bouton « Suggestions IA »).

Les deux passent par Gemini (`gemini-3.1-flash-lite`, JSON structuré) puis
revérifient chaque titre suggéré sur TMDB (`tmdbSearchFirst`, film ou série
selon `mediaType`) avant de le renvoyer au client — évite d'afficher un titre
halluciné sans affiche ni fiche réelle.

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
les clés `localStorage` (`la-bobine.movies`, `la-bobine.theme`, `la-bobine.mediaType`,
`la-bobine.sort`) sont restés inchangés délibérément** : renommer une clé `localStorage` orpheline les
données existantes des utilisateurs (l'app ne les retrouve plus sous
l'ancienne clé). Si on renomme un jour ces clés, il faudra migrer les
données existantes (lire l'ancienne clé, la recopier sous la nouvelle,
supprimer l'ancienne) plutôt que de simplement changer la constante.

## Convention de thème

- Couleur d'accent : `--accent` (`#8069ff` dark / `#6f56f2` light)
- Polices : `'Inter'` (corps) + `'Bricolage Grotesque'` (titres, logo)
- Le « LIO » du logo topbar utilise `.brand-highlight { color: var(--accent); }`
