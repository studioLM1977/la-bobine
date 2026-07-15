// Proxy serverless vers TMDB (The Movie Database) : la clé reste côté serveur
// (variable d'env Vercel), jamais exposée dans le JS envoyé au navigateur.
export default async function handler(req, res) {
  const apiKey = process.env.TMDB_API_KEY;
  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Clé TMDB non configurée' });
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // TMDB renvoie parfois une erreur transitoire : on retente avant d'abandonner.
  async function tmdbFetch(url) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url);
        const data = await r.json();
        if (r.ok) return data;
        lastError = data;
      } catch (err) {
        lastError = { status_message: err.message };
      }
      if (attempt < 2) await sleep(400 * (attempt + 1));
    }
    throw lastError || { status_message: 'TMDB indisponible' };
  }

  const id = (req.query.id || '').toString().trim();

  if (id) {
    // Fiche détaillée d'un film : durée + réalisateur + genres + casting + synopsis
    // en un seul appel (append_to_response évite plusieurs allers-retours).
    // TMDB catalogue très peu de bandes-annonces réellement en français : en
    // repli, une recherche YouTube Data API ciblée trouve la vraie vidéo FR
    // (quota limité à 100 requêtes/jour, d'où skipYoutube : le client ne la
    // redemande qu'une fois par film, jamais à chaque réouverture de fiche).
    const skipYoutube = (req.query.skipYoutube || '') === '1';
    try {
      const detailUrl = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?api_key=${apiKey}&language=fr-FR&append_to_response=credits,recommendations,watch/providers`;
      const videosUrlFr = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}/videos?api_key=${apiKey}&language=fr-FR`;
      const [data, videosFr] = await Promise.all([
        tmdbFetch(detailUrl),
        tmdbFetch(videosUrlFr).catch(() => ({ results: [] })),
      ]);

      const director = ((data.credits && data.credits.crew) || []).find((c) => c.job === 'Director');
      const cast = ((data.credits && data.credits.cast) || []).slice(0, 5).map((c) => c.name);
      const genres = (data.genres || []).map((g) => g.name);
      const videos = videosFr.results || [];
      const tmdbTrailer = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer')
        || videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser');

      let trailerKey = tmdbTrailer ? tmdbTrailer.key : null;
      if (!trailerKey && youtubeKey && !skipYoutube) {
        try {
          const q = `${data.title} bande annonce VF`;
          const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&videoDuration=short&relevanceLanguage=fr&q=${encodeURIComponent(q)}&key=${youtubeKey}`;
          const yr = await fetch(searchUrl);
          const ydata = await yr.json();
          const item = (ydata.items || [])[0];
          if (item && item.id && item.id.videoId) trailerKey = item.id.videoId;
        } catch (err) { /* on retombe sur le lien de recherche */ }
      }

      const similar = ((data.recommendations && data.recommendations.results) || []).slice(0, 8).map((m) => ({
        id: m.id,
        title: m.title,
        year: (m.release_date || '').slice(0, 4),
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w185${m.poster_path}` : '',
      }));

      // "Où le regarder" : données JustWatch redistribuées par TMDB (région France).
      // Attribution obligatoire : le lien renvoyé (wp.link) doit rester visible.
      const mapProviders = (list) => (list || []).map((p) => ({
        name: p.provider_name,
        logo: p.logo_path ? `https://image.tmdb.org/t/p/w92${p.logo_path}` : '',
      }));
      const wp = (data['watch/providers'] && data['watch/providers'].results && data['watch/providers'].results.FR) || null;
      const watchProviders = wp ? {
        link: wp.link || null,
        flatrate: mapProviders(wp.flatrate),
        rent: mapProviders(wp.rent),
        buy: mapProviders(wp.buy),
      } : null;

      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).json({
        id: data.id,
        title: data.title,
        director: director ? director.name : '',
        cast,
        genres,
        trailerKey,
        trailerSearchQuery: trailerKey ? null : `${data.title} bande annonce VF`,
        similar,
        watchProviders,
        runtime: data.runtime || 0,
        overview: data.overview || '',
        poster: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : '',
        year: (data.release_date || '').slice(0, 4),
        voteAverage: data.vote_average || 0,
        voteCount: data.vote_count || 0,
      });
    } catch (err) {
      res.status(502).json(err);
    }
    return;
  }

  const q = (req.query.q || '').toString().trim();
  if (!q) {
    res.status(400).json({ error: 'Paramètre q manquant' });
    return;
  }

  const limit = Math.min(parseInt(req.query.limit, 10) || 8, 20);
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(q)}`;

  try {
    const data = await tmdbFetch(url);
    const results = (data.results || []).slice(0, limit).map((m) => ({
      id: m.id,
      title: m.title,
      year: (m.release_date || '').slice(0, 4),
      poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : '',
      overview: m.overview || '',
    }));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json({ results });
  } catch (err) {
    res.status(502).json(err);
  }
}
