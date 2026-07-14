(() => {
  'use strict';

  const THEME_KEY = 'la-bobine.theme';
  const savedTheme = localStorage.getItem(THEME_KEY);
  if (savedTheme === 'light' || savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }

  const STORAGE_KEY = 'la-bobine.movies';

  const STATUS_LABELS = {
    want: 'À voir',
    seen: 'Vu',
    dnf: 'Abandonné',
  };

  // ---------- Utilitaires premium ----------

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supportsViewTransition = typeof document !== 'undefined' && 'startViewTransition' in document;

  /** Ripple liquide depuis le point de clic, sur l'élément ciblé. */
  function spawnRipple(target, clientX, clientY) {
    if (prefersReducedMotion) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 1.1;
    const span = document.createElement('span');
    span.className = 'ripple';
    span.style.width = span.style.height = size + 'px';
    span.style.left = (clientX - rect.left - size / 2) + 'px';
    span.style.top = (clientY - rect.top - size / 2) + 'px';
    target.appendChild(span);
    span.addEventListener('animationend', () => span.remove(), { once: true });
  }

  /** Haptique léger (no-op sur desktop). */
  function haptic(ms = 18) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
  }

  // ---------- Confettis (canvas, zéro dépendance) ----------

  let confettiCanvas = null;
  let confettiCtx = null;
  let confettiParticles = [];
  let confettiRAF = null;

  function ensureConfettiCanvas() {
    if (confettiCanvas) return confettiCanvas;
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'confettiCanvas';
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    document.body.appendChild(confettiCanvas);
    confettiCtx = confettiCanvas.getContext('2d');
    window.addEventListener('resize', () => {
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    });
    return confettiCanvas;
  }

  function confettiBurst(originX, originY, opts = {}) {
    if (prefersReducedMotion) return;
    ensureConfettiCanvas();
    const colors = opts.colors || ['#8069ff', '#6fd39a', '#f5b400', '#ff8a5b', '#4dabff', '#ffffff'];
    const count = opts.count || 90;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 4 + Math.random() * 8;
      confettiParticles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: 5 + Math.random() * 7,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.4,
        life: 1,
        decay: 0.008 + Math.random() * 0.008,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
      });
    }
    if (!confettiRAF) confettiRAF = requestAnimationFrame(stepConfetti);
  }

  function stepConfetti() {
    if (!confettiCtx) return;
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiParticles = confettiParticles.filter(p => p.life > 0);
    for (const p of confettiParticles) {
      p.vy += 0.18;          // gravité
      p.vx *= 0.99;          // friction
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.vr;
      p.life -= p.decay;
      confettiCtx.save();
      confettiCtx.globalAlpha = Math.max(0, p.life);
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rotation);
      confettiCtx.fillStyle = p.color;
      if (p.shape === 'rect') {
        confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        confettiCtx.beginPath();
        confettiCtx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
        confettiCtx.fill();
      }
      confettiCtx.restore();
    }
    if (confettiParticles.length > 0) {
      confettiRAF = requestAnimationFrame(stepConfetti);
    } else {
      confettiRAF = null;
      confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    }
  }

  // ---------- Extraction couleur dominante d'une affiche ----------

  const colorCache = new Map();

  function extractDominantColor(url) {
    if (!url) return Promise.resolve(null);
    if (colorCache.has(url)) return Promise.resolve(colorCache.get(url));
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const size = 24;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          // Quantification par buckets de teinte, on évite trop clair / trop sombre / trop gris.
          const buckets = {};
          let rSum = 0, gSum = 0, bSum = 0, weightSum = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a < 125) continue;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            const lum = (max + min) / 2;
            const sat = max === 0 ? 0 : (max - min) / max;
            // ignore quasi-blanc, quasi-noir et gris
            if (lum > 235 || lum < 18 || sat < 0.12) continue;
            const weight = sat * (1 - Math.abs(lum - 128) / 128);
            rSum += r * weight; gSum += g * weight; bSum += b * weight; weightSum += weight;
          }
          if (weightSum === 0) { colorCache.set(url, null); resolve(null); return; }
          const r = Math.round(rSum / weightSum);
          const g = Math.round(gSum / weightSum);
          const b = Math.round(bSum / weightSum);
          const rgb = `rgb(${r}, ${g}, ${b})`;
          colorCache.set(url, rgb);
          resolve(rgb);
        } catch (err) {
          colorCache.set(url, null);
          resolve(null); // canvas tainted (CORS)
        }
      };
      img.onerror = () => { colorCache.set(url, null); resolve(null); };
      img.src = url;
    });
  }

  // ---------- TMDB (affiches, réalisateur, durée, synopsis) ----------
  // La clé API reste côté serveur (fonction serverless /api/movies), jamais exposée au client.

  async function searchTmdb(query, limit = 8) {
    const url = `/api/movies?q=${encodeURIComponent(query)}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('TMDB indisponible');
    const data = await res.json();
    return data.results || [];
  }

  async function getMovieDetails(tmdbId) {
    const url = `/api/movies?id=${encodeURIComponent(tmdbId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('TMDB indisponible');
    return res.json();
  }

  function truncateSynopsis(text, maxChars = 1100) {
    const clean = text.trim();
    if (clean.length <= maxChars) return clean;
    const cut = clean.slice(0, maxChars);
    const lastSpace = cut.lastIndexOf(' ');
    return cut.slice(0, lastSpace > 0 ? lastSpace : maxChars).trim() + '…';
  }

  function renderSynopsisLoading() {
    document.getElementById('mmSynopsisBody').innerHTML = `
      <div class="synopsis-skel">
        <div class="sr-skel-line"></div>
        <div class="sr-skel-line"></div>
        <div class="sr-skel-line" style="width:65%"></div>
      </div>`;
  }

  function renderSynopsisText(text) {
    document.getElementById('mmSynopsisBody').innerHTML = `<p>${escapeHtml(text)}</p>`;
  }

  function renderSynopsisEmpty() {
    document.getElementById('mmSynopsisBody').innerHTML = '<p class="synopsis-empty">Synopsis indisponible pour ce film.</p>';
  }

  async function loadSynopsis(movie) {
    const movieId = movie.id;
    renderSynopsisLoading();

    try {
      let tmdbId = movie.tmdbId;
      if (!tmdbId) {
        const results = await searchTmdb(`${movie.title} ${movie.director}`, 1);
        tmdbId = results[0] && results[0].id;
      }
      if (activeMovieId !== movieId) return;
      if (!tmdbId) { renderSynopsisEmpty(); return; }

      const details = await getMovieDetails(tmdbId);
      if (activeMovieId !== movieId) return;

      movie.tmdbId = tmdbId;
      if (!movie.director && details.director) movie.director = details.director;
      if (!movie.runtime && details.runtime) movie.runtime = details.runtime;
      if (!movie.poster && details.poster) movie.poster = details.poster;
      if (!movie.year && details.year) movie.year = details.year;

      if (!details.overview) { renderSynopsisEmpty(); saveMovies(); return; }

      const truncated = truncateSynopsis(details.overview);
      movie.synopsis = truncated;
      saveMovies();
      renderSynopsisText(truncated);
    } catch (err) {
      if (activeMovieId !== movieId) return;
      renderSynopsisEmpty();
    }
  }

  // ---------- Genres, casting, bande-annonce, films similaires ----------
  // Récupérés à chaque ouverture de fiche (non mis en cache, contrairement au
  // synopsis) : ce sont des infos secondaires, peu coûteuses à rafraîchir.

  function renderGenres(genres) {
    const el = document.getElementById('mmGenres');
    if (!genres || genres.length === 0) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = genres.map(g => `<span class="genre-tag">${escapeHtml(g)}</span>`).join('');
  }

  function renderCast(cast) {
    const block = document.getElementById('mmCastBlock');
    if (!cast || cast.length === 0) { block.hidden = true; return; }
    block.hidden = false;
    document.getElementById('mmCastBody').textContent = cast.join(', ');
  }

  function renderTrailer(key) {
    const link = document.getElementById('mmTrailerLink');
    if (!key) { link.hidden = true; return; }
    link.hidden = false;
    link.href = `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`;
  }

  function renderSimilar(items) {
    const block = document.getElementById('mmSimilarBlock');
    const strip = document.getElementById('mmSimilarStrip');
    if (!items || items.length === 0) { block.hidden = true; strip.innerHTML = ''; return; }
    block.hidden = false;
    strip.innerHTML = '';
    items.forEach(item => {
      const el = document.createElement('div');
      el.className = 'similar-item';
      el.innerHTML = `
        <img src="${escapeAttr(item.poster)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <p>${escapeHtml(item.title)}</p>
      `;
      el.addEventListener('click', () => {
        closeModals();
        openAddModal();
        setAddMode('search');
        selectMovie(item);
      });
      strip.appendChild(el);
    });
  }

  // "Où le regarder" : données JustWatch redistribuées par TMDB. L'attribution
  // (lien retourné par l'API) doit rester visible, c'est une condition d'usage.
  function renderWatchProviders(wp) {
    const block = document.getElementById('mmWatchBlock');
    const list = document.getElementById('mmWatchProviders');
    const attribution = document.getElementById('mmWatchAttribution');
    const all = wp ? [...(wp.flatrate || []), ...(wp.rent || []), ...(wp.buy || [])] : [];
    if (all.length === 0) { block.hidden = true; list.innerHTML = ''; attribution.hidden = true; return; }

    block.hidden = false;
    const seen = new Set();
    const unique = all.filter(p => (seen.has(p.name) ? false : (seen.add(p.name), true)));
    list.innerHTML = unique.map(p => `<img src="${escapeAttr(p.logo)}" alt="${escapeAttr(p.name)}" title="${escapeAttr(p.name)}" loading="lazy" onerror="this.remove()">`).join('');

    if (wp.link) {
      attribution.hidden = false;
      attribution.href = wp.link;
    } else {
      attribution.hidden = true;
    }
  }

  async function loadFilmExtras(movie) {
    const movieId = movie.id;
    renderGenres(null);
    renderCast(null);
    renderTrailer(null);
    renderSimilar(null);
    renderWatchProviders(null);

    try {
      let tmdbId = movie.tmdbId;
      if (!tmdbId) {
        const results = await searchTmdb(`${movie.title} ${movie.director}`, 1);
        tmdbId = results[0] && results[0].id;
      }
      if (activeMovieId !== movieId || !tmdbId) return;

      const details = await getMovieDetails(tmdbId);
      if (activeMovieId !== movieId) return;

      renderGenres(details.genres);
      renderCast(details.cast);
      renderTrailer(details.trailerKey);
      renderSimilar(details.similar);
      renderWatchProviders(details.watchProviders);

      // Mémorisé une seule fois pour permettre le filtrage par genre dans la grille.
      if (!movie.genres && details.genres && details.genres.length) {
        movie.genres = details.genres;
        saveMovies();
      }
    } catch (err) { /* infos secondaires : on laisse les blocs masqués */ }
  }

  const MOCK_MOVIES = [];

  function loadMovies() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { movies: JSON.parse(raw), wasEmpty: false };
    } catch (e) { /* localStorage indisponible, on retombe sur les mocks */ }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(MOCK_MOVIES));
    return { movies: structuredClone(MOCK_MOVIES), wasEmpty: true };
  }

  const initialLoad = loadMovies();
  let movies = initialLoad.movies;
  // true si le stockage du téléphone était vide au démarrage (donc rempli avec les
  // films de démo) : sert à savoir si on peut écraser sans risque avec la sauvegarde cloud.
  const libraryWasEmpty = initialLoad.wasEmpty;
  let activeFilter = 'all';
  let activeGenre = 'all';
  let activeDecade = 'all';
  let searchTerm = '';
  let activeMovieId = null;
  // true → on anime l'entrée des cartes (tab/sort/initial), false pendant la frappe de recherche.
  let animateGrid = true;

  function saveMovies(immediate = false) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
    if (immediate) syncNow();
    else queueSync();
  }

  function uid() {
    return 'm' + Math.random().toString(36).slice(2, 10);
  }

  // ---------- Rendu ----------

  const movieGrid = document.getElementById('movieGrid');
  const emptyState = document.getElementById('emptyState');
  const tabsEl = document.getElementById('tabs');

  function renderAll() {
    renderTopMovies();
    renderTabCounts();
    renderFilters();
    renderGrid();
  }

  function renderTopMovies() {
    const topSection = document.getElementById('topSection');
    const topStrip = document.getElementById('topStrip');
    const rated = movies.filter(m => m.rating > 0);

    if (rated.length === 0) {
      topSection.hidden = true;
      return;
    }
    topSection.hidden = false;

    const top = [...rated]
      .sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title, 'fr'))
      .slice(0, 10);

    topStrip.innerHTML = '';
    top.forEach((movie, i) => {
      const card = document.createElement('div');
      card.className = 'top-card';
      card.dataset.id = movie.id;
      card.innerHTML = `
        <span class="top-rank">${i + 1}</span>
        <div class="top-card-cover"><img src="${escapeAttr(movie.poster)}" alt="" loading="lazy" onerror="this.style.display='none'"></div>
        <p class="top-card-title">${escapeHtml(movie.title)}</p>
        <p class="top-card-director">${escapeHtml(movie.director)}</p>
        <div class="top-card-rating"><svg viewBox="0 0 24 24"><use href="#star-icon-path"/></svg><span>${movie.rating}</span></div>
      `;
      card.addEventListener('click', (e) => openMovieModal(movie.id, e));
      topStrip.appendChild(card);
    });
  }

  function renderTabCounts() {
    const counts = { all: movies.length, want: 0, seen: 0, dnf: 0 };
    movies.forEach(m => { counts[m.status] = (counts[m.status] || 0) + 1; });
    tabsEl.querySelectorAll('.tab').forEach(tab => {
      const f = tab.dataset.filter;
      const span = tab.querySelector('span');
      if (span) span.textContent = counts[f] || 0;
    });
  }

  // ---------- Filtres genre / décennie ----------

  const genreFilterRow = document.getElementById('genreFilterRow');
  const decadeFilterRow = document.getElementById('decadeFilterRow');

  function renderFilters() {
    const genreSet = new Set();
    const decadeSet = new Set();
    movies.forEach(m => {
      (m.genres || []).forEach(g => genreSet.add(g));
      if (m.year) decadeSet.add(Math.floor(m.year / 10) * 10);
    });

    if (genreSet.size === 0) {
      genreFilterRow.hidden = true;
    } else {
      genreFilterRow.hidden = false;
      const genres = [...genreSet].sort((a, b) => a.localeCompare(b, 'fr'));
      genreFilterRow.innerHTML = ['all', ...genres].map(g => `
        <button type="button" class="filter-badge ${g === activeGenre ? 'is-active' : ''}" data-genre="${escapeAttr(g)}">${g === 'all' ? 'Tous les genres' : escapeHtml(g)}</button>
      `).join('');
    }

    if (decadeSet.size === 0) {
      decadeFilterRow.hidden = true;
    } else {
      decadeFilterRow.hidden = false;
      const decades = [...decadeSet].sort((a, b) => b - a);
      decadeFilterRow.innerHTML = ['all', ...decades].map(d => `
        <button type="button" class="filter-badge ${d === activeDecade ? 'is-active' : ''}" data-decade="${d}">${d === 'all' ? 'Toutes les décennies' : d + 's'}</button>
      `).join('');
    }
  }

  genreFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-badge');
    if (!btn) return;
    activeGenre = btn.dataset.genre;
    renderFilters();
    renderGrid();
  });

  decadeFilterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-badge');
    if (!btn) return;
    activeDecade = btn.dataset.decade === 'all' ? 'all' : parseInt(btn.dataset.decade, 10);
    renderFilters();
    renderGrid();
  });

  function renderGrid() {
    let list = activeFilter === 'all' ? movies : movies.filter(m => m.status === activeFilter);
    if (activeGenre !== 'all') list = list.filter(m => (m.genres || []).includes(activeGenre));
    if (activeDecade !== 'all') list = list.filter(m => m.year && Math.floor(m.year / 10) * 10 === activeDecade);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(m => m.title.toLowerCase().includes(q) || m.director.toLowerCase().includes(q));
    }

    list = sortList(list);

    movieGrid.innerHTML = '';
    emptyState.hidden = list.length > 0;

    list.forEach((movie, i) => {
      const card = document.createElement('div');
      card.className = 'movie-card';
      if (animateGrid) {
        card.classList.add('is-entering');
        card.style.animationDelay = (i * 30) + 'ms';
      }
      card.dataset.id = movie.id;
      // Couleur extraite en cache (déjà calculée lors d'un rendu précédent).
      if (movie.colorHex) card.style.setProperty('--movie-color', movie.colorHex);
      const ratingHtml = movie.rating > 0
        ? `<div class="movie-card-rating"><svg viewBox="0 0 24 24"><use href="#star-icon-path"/></svg><span>${movie.rating}</span></div>`
        : '';
      card.innerHTML = `
        <div class="movie-card-cover">
          <img src="${escapeAttr(movie.poster)}" alt="" loading="lazy" onerror="this.parentElement.style.background='linear-gradient(160deg, var(--surface-3), var(--surface-2))'; this.remove();">
          <span class="movie-card-status" data-s="${movie.status}">${STATUS_LABELS[movie.status]}</span>
          ${ratingHtml}
        </div>
        <p class="movie-card-title">${escapeHtml(movie.title)}</p>
        <p class="movie-card-director">${escapeHtml(movie.director)}</p>
      `;
      card.addEventListener('click', (e) => openMovieModal(movie.id, e));

      // Color extraction : teinte le glow de la carte à la couleur dominante de l'affiche.
      const coverImg = card.querySelector('.movie-card-cover img');
      if (coverImg && !movie.colorHex) {
        const applyColor = (rgb) => {
          if (rgb) {
            card.style.setProperty('--movie-color', rgb);
            movie.colorHex = rgb;   // mis en cache puis persisté
            saveMovies();
          }
        };
        if (coverImg.complete && coverImg.naturalWidth > 0) {
          extractDominantColor(movie.poster).then(applyColor);
        } else {
          coverImg.addEventListener('load', () => extractDominantColor(movie.poster).then(applyColor), { once: true });
        }
      }

      // Bonus : tilt 3D au survol (desktop uniquement).
      attachTilt(card);

      movieGrid.appendChild(card);
    });
    animateGrid = true; // réarmé pour le prochain changement de tab/sort
  }

  function attachTilt(card) {
    if (prefersReducedMotion) return;
    const cover = card.querySelector('.movie-card-cover');
    if (!cover) return;
    const MAX = 8; // degrés
    card.addEventListener('mousemove', (e) => {
      const rect = cover.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;   // 0..1
      const py = (e.clientY - rect.top) / rect.height;   // 0..1
      const ry = (px - 0.5) * MAX * 2;
      const rx = -(py - 0.5) * MAX * 2;
      cover.classList.add('tilting');
      cover.style.transform = `translateY(-4px) scale(1.015) rotateX(${rx}deg) rotateY(${ry}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      cover.classList.remove('tilting');
      cover.style.transform = '';
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;');
  }

  // ---------- Tri ----------

  let activeSort = 'recent';

  function sortList(list) {
    const sorted = [...list];
    switch (activeSort) {
      case 'title':
        return sorted.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      case 'director':
        return sorted.sort((a, b) => a.director.localeCompare(b.director, 'fr'));
      case 'rating':
        return sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title, 'fr'));
      case 'year':
        return sorted.sort((a, b) => (b.year || 0) - (a.year || 0) || a.title.localeCompare(b.title, 'fr'));
      default:
        return sorted;
    }
  }

  document.getElementById('sortSelect').addEventListener('change', (e) => {
    activeSort = e.target.value;
    renderGrid();
  });

  // ---------- Recherche & onglets ----------

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchTerm = e.target.value.trim();
    animateGrid = false; // pas de cascade pendant la frappe
    renderGrid();
  });

  tabsEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    tabsEl.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
    tab.classList.add('is-active');
    activeFilter = tab.dataset.filter;
    renderGrid();
  });

  // ---------- Étoiles (demi-étoiles au survol) ----------

  function setupStarWidget(container, fillEl, onChange) {
    let currentValue = 0;

    function valueFromEvent(e) {
      const stars = container.querySelectorAll('.stars-bg svg');
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const starWidth = rect.width / stars.length;
      let index = Math.floor(x / starWidth);
      index = Math.max(0, Math.min(stars.length - 1, index));
      const withinStar = x - index * starWidth;
      const half = withinStar < starWidth / 2;
      return index + (half ? 0.5 : 1);
    }

    function paint(value) {
      fillEl.style.width = (value / 5 * 100) + '%';
    }

    container.addEventListener('mousemove', (e) => paint(valueFromEvent(e)));
    container.addEventListener('mouseleave', () => paint(currentValue));
    container.addEventListener('click', (e) => {
      currentValue = valueFromEvent(e);
      paint(currentValue);
      onChange(currentValue);
    });

    return {
      set(value) { currentValue = value; paint(value); },
      get() { return currentValue; },
    };
  }

  const mmStars = setupStarWidget(
    document.getElementById('mmStars'),
    document.getElementById('mmStarsFill'),
    (v) => { document.getElementById('mmStarsValue').textContent = v > 0 ? v + ' / 5' : 'Pas encore noté'; }
  );

  const afStars = setupStarWidget(
    document.getElementById('afStars'),
    document.getElementById('afStarsFill'),
    (v) => { document.getElementById('afStarsValue').textContent = v > 0 ? v + ' / 5' : 'Pas encore noté'; }
  );

  // ---------- Modale fiche film ----------

  const movieModalOverlay = document.getElementById('movieModalOverlay');
  const mmStatusChips = document.getElementById('mmStatusChips');
  const mmPoster = document.getElementById('mmPoster');
  const mmPosterUrl = document.getElementById('mmPosterUrl');
  const mmPosterUrlBlock = document.getElementById('mmPosterUrlBlock');
  let mmSelectedStatus = 'want';

  // Élément affiche "source" pour le morph View Transition.
  let vtSourceCover = null;

  function clearVtNames() {
    document.documentElement.style.removeProperty('--vt-active');
    if (vtSourceCover) { vtSourceCover.style.removeProperty('--vt-name'); vtSourceCover = null; }
    mmPoster.style.removeProperty('--vt-name');
  }

  function openMovieModal(id, event) {
    const movie = movies.find(m => m.id === id);
    if (!movie) return;

    // Identify the source cover from the click, for the morph transition.
    if (event && event.currentTarget) {
      const src = event.currentTarget.querySelector('.movie-card-cover');
      if (src) vtSourceCover = src;
    }

    const doOpen = () => {
      activeMovieId = id;

      mmPoster.src = movie.poster;
      document.getElementById('mmDirector').value = movie.director;
      document.getElementById('mmTitle').value = movie.title;
      mmPosterUrl.value = movie.poster;
      mmPosterUrlBlock.hidden = true;
      document.getElementById('mmRuntime').textContent = movie.runtime + ' min' + (movie.year ? ' · ' + movie.year : '');
      document.getElementById('mmNotes').value = movie.notes || '';

      mmSelectedStatus = movie.status;
      updateStatusChips(mmStatusChips, mmSelectedStatus);
      toggleSynopsisBlock();
      if (mmSelectedStatus === 'seen') {
        if (movie.synopsis) renderSynopsisText(movie.synopsis);
        else loadSynopsis(movie);
      }
      loadFilmExtras(movie);

      mmStars.set(movie.rating || 0);
      document.getElementById('mmStarsValue').textContent = movie.rating > 0 ? movie.rating + ' / 5' : 'Pas encore noté';

      movieModalOverlay.classList.add('is-open');
    };

    if (supportsViewTransition && !prefersReducedMotion && vtSourceCover) {
      vtSourceCover.style.setProperty('--vt-name', 'movie-cover');
      mmPoster.style.setProperty('--vt-name', 'movie-cover');
      const transition = document.startViewTransition(doOpen);
      transition.finished.finally(clearVtNames);
    } else {
      doOpen();
    }
  }

  document.getElementById('mmPosterEditBtn').addEventListener('click', () => {
    mmPosterUrlBlock.hidden = !mmPosterUrlBlock.hidden;
    if (!mmPosterUrlBlock.hidden) mmPosterUrl.focus();
  });

  mmPosterUrl.addEventListener('input', () => {
    const url = mmPosterUrl.value.trim();
    if (url) mmPoster.src = url;
  });

  function toggleSynopsisBlock() {
    document.getElementById('mmSynopsisBlock').hidden = mmSelectedStatus !== 'seen';
  }

  function updateStatusChips(container, status) {
    container.querySelectorAll('.chip').forEach(chip => {
      chip.classList.toggle('is-active', chip.dataset.status === status);
    });
  }

  mmStatusChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    spawnRipple(chip, e.clientX, e.clientY);
    haptic(12);
    mmSelectedStatus = chip.dataset.status;
    updateStatusChips(mmStatusChips, mmSelectedStatus);
    toggleSynopsisBlock();
    if (mmSelectedStatus === 'seen') {
      const movie = movies.find(m => m.id === activeMovieId);
      if (movie) {
        if (movie.synopsis) renderSynopsisText(movie.synopsis);
        else loadSynopsis(movie);
      }
    }
  });

  document.getElementById('mmSaveBtn').addEventListener('click', () => {
    const movie = movies.find(m => m.id === activeMovieId);
    if (!movie) return;

    // Détection d'un passage au statut "Vu" pour la célébration.
    const justFinished = movie.status !== 'seen' && mmSelectedStatus === 'seen';

    const newTitle = document.getElementById('mmTitle').value.trim();
    const newDirector = document.getElementById('mmDirector').value.trim();
    const newPoster = mmPosterUrl.value.trim();
    if ((newTitle && newTitle !== movie.title) || (newDirector && newDirector !== movie.director)) {
      movie.tmdbId = null;
      movie.synopsis = null;
    }
    if (newTitle) movie.title = newTitle;
    if (newDirector) movie.director = newDirector;
    if (newPoster) movie.poster = newPoster;

    movie.status = mmSelectedStatus;
    movie.notes = document.getElementById('mmNotes').value;
    movie.rating = mmStars.get();
    saveMovies();
    renderAll();
    closeModals();

    if (justFinished) {
      const btn = document.getElementById('mmSaveBtn');
      const rect = btn.getBoundingClientRect();
      confettiBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
      haptic([20, 40, 30]);
      showToast('Film terminé — bravo !', 'celebrate');
    } else if (mmSelectedStatus === 'dnf' && movie.status === 'dnf') {
      haptic(15);
    }
  });

  document.getElementById('mmDeleteBtn').addEventListener('click', () => {
    movies = movies.filter(m => m.id !== activeMovieId);
    saveMovies(true);
    renderAll();
    closeModals();
  });

  // ---------- Modale ajout de film ----------

  const addModalOverlay = document.getElementById('addModalOverlay');
  const afStatusChips = document.getElementById('afStatusChips');
  const addForm = document.getElementById('addForm');
  const addSubmitBtn = document.getElementById('addSubmitBtn');
  const searchModeBlock = document.getElementById('searchModeBlock');
  const describeModeBlock = document.getElementById('describeModeBlock');
  const manualFieldsBlock = document.getElementById('manualFieldsBlock');
  const runtimeBlock = document.getElementById('runtimeBlock');
  const srQuery = document.getElementById('srQuery');
  const srResults = document.getElementById('srResults');
  const srSelected = document.getElementById('srSelected');
  const afRuntimeInput = document.getElementById('afRuntime');

  let afSelectedStatus = 'want';
  let addMode = 'search';
  let selectedMovie = null;
  let srAbortController = null;
  let srDebounceTimer = null;

  const afRatingBlock = document.getElementById('afRatingBlock');

  afStatusChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    spawnRipple(chip, e.clientX, e.clientY);
    haptic(12);
    afSelectedStatus = chip.dataset.status;
    updateStatusChips(afStatusChips, afSelectedStatus);
    afRatingBlock.hidden = afSelectedStatus !== 'seen';
  });

  // ---- Bascule Recherche / Saisie manuelle ----

  document.getElementById('modeTabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.mode-tab');
    if (!tab) return;
    setAddMode(tab.dataset.mode);
  });

  function setAddMode(mode) {
    addMode = mode;
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('is-active', t.dataset.mode === mode));
    searchModeBlock.hidden = mode !== 'search';
    describeModeBlock.hidden = mode !== 'describe';
    manualFieldsBlock.hidden = mode !== 'manual';

    if (mode === 'manual') {
      runtimeBlock.hidden = false;
      afRuntimeInput.required = true;
      document.getElementById('afTitle').required = true;
      document.getElementById('afDirector').required = true;
      updateSubmitState();
    } else {
      document.getElementById('afTitle').required = false;
      document.getElementById('afDirector').required = false;
      runtimeBlock.hidden = !selectedMovie;
      afRuntimeInput.required = false;
      updateSubmitState();
    }
  }

  function updateSubmitState() {
    if (addMode === 'manual') {
      const ok = document.getElementById('afTitle').value.trim() && document.getElementById('afDirector').value.trim() && parseInt(afRuntimeInput.value, 10) > 0;
      addSubmitBtn.disabled = !ok;
    } else {
      addSubmitBtn.disabled = !selectedMovie || !(parseInt(afRuntimeInput.value, 10) > 0);
    }
  }

  ['afTitle', 'afDirector', 'afRuntime'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateSubmitState);
  });

  // ---- Recherche : TMDB (affiches, année, synopsis) ----

  srQuery.addEventListener('input', () => {
    clearTimeout(srDebounceTimer);
    const q = srQuery.value.trim();
    if (!q) { srResults.innerHTML = ''; return; }
    srDebounceTimer = setTimeout(() => runTmdbSearch(q), 350);
  });

  async function runTmdbSearch(query) {
    if (srAbortController) srAbortController.abort();
    srAbortController = new AbortController();

    renderSrSkeleton();

    try {
      const results = await searchTmdb(query, 8);
      renderTmdbResults(results);
    } catch (err) {
      srResults.innerHTML = '<p class="sr-error">Recherche indisponible pour le moment. Essayez la saisie manuelle.</p>';
    }
  }

  function renderSrSkeleton(target = srResults) {
    target.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="sr-result-skeleton">
        <div class="sr-skel-cover"></div>
        <div class="sr-skel-lines">
          <div class="sr-skel-line"></div>
          <div class="sr-skel-line short"></div>
        </div>
      </div>
    `).join('');
  }

  function renderTmdbResults(items) {
    if (items.length === 0) {
      srResults.innerHTML = '<p class="sr-empty">Aucun résultat. Essayez un autre terme ou passez en saisie manuelle.</p>';
      return;
    }

    srResults.innerHTML = '';
    items.forEach(item => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'sr-result-row';
      const meta = item.year ? item.year : 'Année inconnue';
      row.innerHTML = `
        <div class="sr-result-cover">${item.poster ? `<img src="${escapeAttr(item.poster)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
        <div class="sr-result-info">
          <p class="sr-result-title">${escapeHtml(item.title)}</p>
          <p class="sr-result-meta">${escapeHtml(meta)}</p>
        </div>
      `;
      row.addEventListener('click', () => selectMovie(item));
      srResults.appendChild(row);
    });
  }

  async function selectMovie(item) {
    selectedMovie = {
      title: item.title,
      director: '',
      poster: item.poster || fallbackCover(item.title),
      runtime: 0,
      year: item.year || null,
      genres: [],
      tmdbId: item.id,
      synopsis: item.overview ? truncateSynopsis(item.overview) : null,
    };
    applySelectedMovie();

    try {
      const details = await getMovieDetails(item.id);
      if (!selectedMovie || selectedMovie.tmdbId !== item.id) return; // sélection changée entre-temps
      selectedMovie.director = details.director || '';
      selectedMovie.runtime = details.runtime || 0;
      if (details.year) selectedMovie.year = details.year;
      if (details.genres) selectedMovie.genres = details.genres;
      if (details.poster) selectedMovie.poster = details.poster;
      if (details.overview) selectedMovie.synopsis = truncateSynopsis(details.overview);
      applySelectedMovie();
    } catch (err) { /* on garde les infos partielles issues de la recherche */ }
  }

  function applySelectedMovie() {
    document.getElementById('srSelPoster').src = selectedMovie.poster;
    document.getElementById('srSelDirector').textContent = selectedMovie.director || '…';
    document.getElementById('srSelTitle').textContent = selectedMovie.title;

    srResults.innerHTML = '';
    srQuery.value = '';
    srSelected.hidden = false;

    runtimeBlock.hidden = false;
    afRuntimeInput.value = selectedMovie.runtime || '';

    updateSubmitState();
  }

  document.getElementById('srChangeBtn').addEventListener('click', () => {
    selectedMovie = null;
    srSelected.hidden = true;
    runtimeBlock.hidden = true;
    updateSubmitState();
    srQuery.focus();
  });

  // ---- Décrire : identification d'un film par description libre (IA) ----

  const describeInput = document.getElementById('describeInput');
  const describeResults = document.getElementById('describeResults');
  const describeSubmitBtn = document.getElementById('describeSubmitBtn');

  // Dictée vocale : API native du navigateur, gratuite, aucun service tiers.
  // Support inégal (Chrome/Edge oui, Safari iOS non) — le bouton reste masqué
  // (attribut hidden dans le HTML) si l'API n'existe pas.
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const describeMicBtn = document.getElementById('describeMicBtn');
  if (SpeechRecognitionCtor && describeMicBtn) {
    describeMicBtn.hidden = false;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'fr-FR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let listening = false;

    recognition.addEventListener('result', (e) => {
      const transcript = e.results[0][0].transcript;
      describeInput.value = (describeInput.value.trim() ? describeInput.value.trim() + ' ' : '') + transcript;
    });
    recognition.addEventListener('end', () => {
      listening = false;
      describeMicBtn.classList.remove('is-listening');
    });
    recognition.addEventListener('error', () => {
      listening = false;
      describeMicBtn.classList.remove('is-listening');
    });

    describeMicBtn.addEventListener('click', () => {
      if (listening) { recognition.stop(); return; }
      listening = true;
      describeMicBtn.classList.add('is-listening');
      recognition.start();
    });
  }

  function renderCandidateRow(container, item, onPick, metaText) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'sr-result-row';
    row.innerHTML = `
      <div class="sr-result-cover">${item.poster ? `<img src="${escapeAttr(item.poster)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
      <div class="sr-result-info">
        <p class="sr-result-title">${escapeHtml(item.title)}</p>
        <p class="sr-result-meta">${escapeHtml(metaText)}</p>
      </div>
    `;
    row.addEventListener('click', () => onPick(item));
    container.appendChild(row);
  }

  describeSubmitBtn.addEventListener('click', async () => {
    const description = describeInput.value.trim();
    if (!description || describeSubmitBtn.disabled) return;

    describeSubmitBtn.disabled = true;
    describeSubmitBtn.classList.add('is-busy');
    renderSrSkeleton(describeResults);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'identify', description }),
      });
      if (!res.ok) throw new Error('IA indisponible');
      const data = await res.json();
      const items = data.results || [];

      describeResults.innerHTML = '';
      if (items.length === 0) {
        describeResults.innerHTML = '<p class="sr-empty">Aucune piste trouvée. Essayez de reformuler, ou passez en recherche/saisie manuelle.</p>';
      } else {
        items.forEach(item => renderCandidateRow(describeResults, item, (picked) => {
          setAddMode('search');
          selectMovie(picked);
        }, item.year || ''));
      }
    } catch (err) {
      describeResults.innerHTML = '<p class="sr-error">IA indisponible pour le moment. Essayez la recherche classique.</p>';
    } finally {
      describeSubmitBtn.disabled = false;
      describeSubmitBtn.classList.remove('is-busy');
    }
  });

  // ---- Suggestions IA basées sur les films notés ----

  const recommendModalOverlay = document.getElementById('recommendModalOverlay');
  const recommendResults = document.getElementById('recommendResults');
  const recommendGenreRow = document.getElementById('recommendGenreRow');
  const recommendStyleInput = document.getElementById('recommendStyleInput');
  const recommendSubmitBtn = document.getElementById('recommendSubmitBtn');

  let recommendGenre = 'all';

  function renderRecommendGenres() {
    const genreSet = new Set();
    movies.filter(m => m.rating > 0).forEach(m => (m.genres || []).forEach(g => genreSet.add(g)));

    if (genreSet.size === 0) {
      recommendGenreRow.hidden = true;
      return;
    }
    recommendGenreRow.hidden = false;
    const genres = [...genreSet].sort((a, b) => a.localeCompare(b, 'fr'));
    recommendGenreRow.innerHTML = ['all', ...genres].map(g => `
      <button type="button" class="filter-badge ${g === recommendGenre ? 'is-active' : ''}" data-genre="${escapeAttr(g)}">${g === 'all' ? 'Peu importe' : escapeHtml(g)}</button>
    `).join('');
  }

  recommendGenreRow.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-badge');
    if (!btn) return;
    recommendGenre = btn.dataset.genre;
    renderRecommendGenres();
  });

  document.getElementById('recommendBtn').addEventListener('click', () => {
    recommendGenre = 'all';
    recommendStyleInput.value = '';
    renderRecommendGenres();

    const rated = movies.filter(m => m.rating > 0);
    recommendResults.innerHTML = rated.length === 0
      ? '<p class="sr-empty">Notez au moins un film pour obtenir des suggestions.</p>'
      : '';

    recommendModalOverlay.classList.add('is-open');
  });

  recommendSubmitBtn.addEventListener('click', async () => {
    const rated = movies.filter(m => m.rating > 0);
    if (rated.length === 0 || recommendSubmitBtn.disabled) return;

    recommendSubmitBtn.disabled = true;
    recommendSubmitBtn.classList.add('is-busy');
    renderSrSkeleton(recommendResults);

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recommend',
          movies: rated.map(m => ({ title: m.title, director: m.director, genres: m.genres || [], rating: m.rating })),
          genre: recommendGenre === 'all' ? '' : recommendGenre,
          style: recommendStyleInput.value.trim(),
        }),
      });
      if (!res.ok) throw new Error('IA indisponible');
      const data = await res.json();
      const items = data.suggestions || [];

      recommendResults.innerHTML = '';
      if (items.length === 0) {
        recommendResults.innerHTML = '<p class="sr-empty">Aucune suggestion pour le moment.</p>';
      } else {
        items.forEach(item => renderCandidateRow(recommendResults, item, (picked) => {
          recommendModalOverlay.classList.remove('is-open');
          openAddModal();
          setAddMode('search');
          selectMovie(picked);
        }, item.reason || ''));
      }
    } catch (err) {
      recommendResults.innerHTML = '<p class="sr-error">Suggestions indisponibles pour le moment.</p>';
    } finally {
      recommendSubmitBtn.disabled = false;
      recommendSubmitBtn.classList.remove('is-busy');
    }
  });

  function openAddModal() {
    addForm.reset();
    afSelectedStatus = 'want';
    updateStatusChips(afStatusChips, afSelectedStatus);
    afRatingBlock.hidden = true;
    afStars.set(0);
    selectedMovie = null;
    srSelected.hidden = true;
    srResults.innerHTML = '';
    describeInput.value = '';
    describeResults.innerHTML = '';
    setAddMode('search');
    addModalOverlay.classList.add('is-open');
    setTimeout(() => srQuery.focus(), 150);
  }

  document.getElementById('openAddBtn').addEventListener('click', openAddModal);
  document.getElementById('emptyStateAddBtn').addEventListener('click', openAddModal);
  const fabAddBtn = document.getElementById('fabAddBtn');
  fabAddBtn.addEventListener('click', openAddModal);

  // Bonus : FAB magnétique (attire le curseur sur desktop).
  if (!prefersReducedMotion && window.matchMedia('(pointer: fine)').matches) {
    fabAddBtn.classList.add('magnetic');
    const PULL = 18;
    window.addEventListener('mousemove', (e) => {
      if (getComputedStyle(fabAddBtn).display === 'none') return;
      const rect = fabAddBtn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist < 90) {
        const strength = (1 - dist / 90) * PULL;
        fabAddBtn.style.transform = `translate(${(dx / dist || 0) * strength}px, ${(dy / dist || 0) * strength}px)`;
      } else {
        fabAddBtn.style.transform = '';
      }
    });
  }

  addForm.addEventListener('submit', (e) => {
    e.preventDefault();

    let title, director, poster, runtime, year, genres, tmdbId, synopsis;

    if (addMode === 'search') {
      if (!selectedMovie) return;
      title = selectedMovie.title;
      director = selectedMovie.director;
      poster = selectedMovie.poster;
      runtime = parseInt(afRuntimeInput.value, 10) || selectedMovie.runtime || 0;
      year = selectedMovie.year || null;
      genres = selectedMovie.genres || [];
      tmdbId = selectedMovie.tmdbId || null;
      synopsis = selectedMovie.synopsis || null;
    } else {
      title = document.getElementById('afTitle').value.trim();
      director = document.getElementById('afDirector').value.trim();
      poster = document.getElementById('afPoster').value.trim();
      runtime = parseInt(afRuntimeInput.value, 10) || 0;
      year = parseInt(document.getElementById('afYear').value, 10) || null;
      genres = [];
      tmdbId = null;
      synopsis = null;
      if (!title || !director) return;
    }

    movies.unshift({
      id: uid(),
      title,
      director,
      runtime,
      year,
      genres,
      status: afSelectedStatus,
      rating: afSelectedStatus === 'seen' ? afStars.get() : 0,
      notes: '',
      poster: poster || fallbackCover(title),
      tmdbId,
      synopsis,
    });

    saveMovies();
    renderAll();
    closeModals();
  });

  function fallbackCover(title) {
    const hue = Math.abs(hashCode(title)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
      <rect width="400" height="600" fill="hsl(${hue},35%,18%)"/>
      <text x="50%" y="50%" fill="hsl(${hue},40%,75%)" font-family="sans-serif" font-size="28" text-anchor="middle" dominant-baseline="middle">${(title[0] || '?').toUpperCase()}</text>
    </svg>`;
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
  }

  function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return hash;
  }

  // ---------- Fermeture des modales ----------

  function closeModals() {
    const doClose = () => {
      movieModalOverlay.classList.remove('is-open');
      addModalOverlay.classList.remove('is-open');
      recommendModalOverlay.classList.remove('is-open');
      activeMovieId = null;
    };

    // Si la fiche film est ouverte, on remonte le morph vers l'affiche d'origine.
    if (supportsViewTransition && !prefersReducedMotion && movieModalOverlay.classList.contains('is-open') && vtSourceCover) {
      vtSourceCover.style.setProperty('--vt-name', 'movie-cover');
      mmPoster.style.setProperty('--vt-name', 'movie-cover');
      const transition = document.startViewTransition(doClose);
      transition.finished.finally(clearVtNames);
    } else {
      doClose();
      clearVtNames();
    }
  }

  document.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModals));
  [movieModalOverlay, addModalOverlay, recommendModalOverlay].forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModals(); });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModals(); });

  // ---------- Import via lien (?import=) ----------

  function normKey(str) {
    return (str || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }

  function showToast(message, variant = 'info') {
    const toast = document.createElement('div');
    toast.className = 'toast is-' + variant;
    const icon = variant === 'celebrate'
      ? '<span class="toast-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span>'
      : '<span class="toast-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg></span>';
    toast.innerHTML = icon + '<span>' + escapeHtml(message) + '</span>';
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('is-visible'));
    setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => toast.remove(), 400);
    }, 3200);
  }

  function applyImport(incoming, opts = {}) {
    try {
      if (!Array.isArray(incoming)) return;

      const existingKeys = new Set(movies.map(m => normKey(m.title) + '|' + normKey(m.director)));
      let added = 0;
      let updated = 0;

      incoming.forEach(item => {
        const matchTitle = item.matchTitle !== undefined ? item.matchTitle : item.title;
        const matchDirector = item.matchDirector !== undefined ? item.matchDirector : item.director;
        const matchKey = normKey(matchTitle) + '|' + normKey(matchDirector);
        const existing = movies.find(m => (normKey(m.title) + '|' + normKey(m.director)) === matchKey);

        if (existing) {
          let changed = false;
          if (item.title && item.title !== existing.title) { existing.title = item.title; changed = true; }
          if (item.director && item.director !== existing.director) { existing.director = item.director; changed = true; }
          if (item.poster) { existing.poster = item.poster; changed = true; }
          if (item.runtime) { existing.runtime = item.runtime; changed = true; }
          if (item.year) { existing.year = item.year; changed = true; }
          if (item.genres) { existing.genres = item.genres; changed = true; }
          if (item.tmdbId) { existing.tmdbId = item.tmdbId; changed = true; }
          if (changed) updated++;
          return;
        }

        const newKey = normKey(item.title) + '|' + normKey(item.director);
        if (existingKeys.has(newKey)) return;
        existingKeys.add(newKey);

        movies.unshift({
          id: uid(),
          title: item.title,
          director: item.director,
          runtime: item.runtime || 0,
          year: item.year || null,
          genres: item.genres || [],
          status: item.status || 'seen',
          rating: 0,
          notes: '',
          poster: item.poster || fallbackCover(item.title),
          tmdbId: item.tmdbId || null,
          synopsis: null,
        });
        added++;
      });

      if (added > 0 || updated > 0) {
        saveMovies();
        renderAll();
      }
      if (opts.silent) return;
      const parts = [];
      if (added > 0) parts.push(`${added} ajouté${added > 1 ? 's' : ''}`);
      if (updated > 0) parts.push(`${updated} mis à jour`);
      showToast(parts.length ? parts.join(' · ') : 'Rien à changer (déjà à jour)');
    } catch (err) {
      if (!opts.silent) showToast('Import impossible : lien invalide');
    }
  }

  // ---------- Synchronisation cloud (Vercel Blob) ----------
  // Le localStorage reste le cache rapide/hors-ligne ; ce blob est la sauvegarde
  // qui survit à un nettoyage du stockage navigateur.

  const SYNC_URL = '/api/library';
  let syncTimer = null;

  function queueSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 800);
  }

  // Envoi sans délai : utilisé pour les suppressions, où le débounce classique
  // laisse une fenêtre pendant laquelle fermer/recharger la page avant l'envoi
  // ferait revenir l'entrée supprimée au prochain chargement (fusion depuis le cloud).
  function syncNow() {
    clearTimeout(syncTimer);
    fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(movies),
    }).catch(() => { /* hors-ligne : on retentera au prochain changement */ });
  }

  async function syncFromServer() {
    try {
      const res = await fetch(SYNC_URL, { cache: 'no-store' });
      const data = await res.json();
      if (!Array.isArray(data.books)) {
        queueSync(); // rien côté serveur pour l'instant : on l'initialise avec l'état local
        return;
      }
      if (libraryWasEmpty && data.books.length > 0) {
        // Stockage du téléphone vide au démarrage → la sauvegarde cloud est la seule
        // source fiable, on remplace les films de démo sans les fusionner.
        movies = data.books;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
        renderAll();
        showToast('Filmothèque restaurée depuis la sauvegarde en ligne');
        return;
      }
      applyImport(data.books, { silent: true });
    } catch (err) { /* hors-ligne : le cache local reste la référence */ }
  }

  function importFromUrl() {
    const params = new URLSearchParams(location.search);
    const raw = params.get('import');
    const fromFile = params.get('importFrom');
    if (!raw && !fromFile) return;

    history.replaceState(null, '', location.pathname);

    if (raw) {
      try {
        const decoded = decodeURIComponent(escape(atob(raw)));
        applyImport(JSON.parse(decoded));
      } catch (err) {
        showToast('Import impossible : lien invalide');
      }
    }

    if (fromFile) {
      fetch(fromFile)
        .then(res => res.json())
        .then(applyImport)
        .catch(() => showToast('Import impossible : fichier introuvable'));
    }
  }

  // ---------- Amélioration des affiches (TMDB, depuis l'appareil de l'utilisateur) ----------

  function looksLikeTmdbPoster(url) {
    return !!url && url.includes('image.tmdb.org');
  }

  const improvePostersBtn = document.getElementById('improvePostersBtn');

  improvePostersBtn.addEventListener('click', async () => {
    if (improvePostersBtn.classList.contains('is-busy')) return;

    const targets = movies.filter(m => !looksLikeTmdbPoster(m.poster));
    if (targets.length === 0) {
      showToast('Toutes les affiches viennent déjà de TMDB');
      return;
    }

    improvePostersBtn.classList.add('is-busy');
    improvePostersBtn.disabled = true;
    let improved = 0;

    for (let i = 0; i < targets.length; i++) {
      const movie = targets[i];
      improvePostersBtn.querySelector('span').textContent = `Vérification ${i + 1}/${targets.length}…`;
      try {
        const results = await searchTmdb(`${movie.title} ${movie.director}`, 1);
        const match = results[0];
        if (match) {
          const details = await getMovieDetails(match.id);
          if (details.poster) movie.poster = details.poster;
          if (details.runtime) movie.runtime = details.runtime;
          if (details.director) movie.director = details.director;
          if (details.year) movie.year = details.year;
          movie.tmdbId = match.id;
          if (details.overview && !movie.synopsis) movie.synopsis = truncateSynopsis(details.overview);
          improved++;
        }
      } catch (err) { /* on continue avec le suivant */ }
      await new Promise(r => setTimeout(r, 250));
    }

    improvePostersBtn.classList.remove('is-busy');
    improvePostersBtn.disabled = false;
    improvePostersBtn.querySelector('span').textContent = 'Affiches';

    if (improved > 0) {
      saveMovies();
      renderAll();
    }
    showToast(improved > 0 ? `${improved} affiche${improved > 1 ? 's' : ''} améliorée${improved > 1 ? 's' : ''}` : 'Aucune amélioration trouvée sur TMDB');
  });

  // ---------- Réglages : thème clair/sombre ----------

  const avatarBtn = document.getElementById('avatarBtn');

  function currentTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  function markActiveTheme() {
    avatarBtn.classList.toggle('is-dark', currentTheme() === 'dark');
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    markActiveTheme();
  }

  avatarBtn.addEventListener('click', () => {
    setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  markActiveTheme();

  // ---------- Init ----------

  renderAll();
  importFromUrl();
  syncFromServer();

  const isLocalDev = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && !isLocalDev) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
