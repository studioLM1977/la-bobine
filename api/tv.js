// Proxy serverless vers TMDB pour les séries (mêmes principes que api/movies.js,
// mais sur les endpoints /search/tv et /tv/{id} — champs différents : name/
// first_air_date au lieu de title/release_date, created_by au lieu de credits.crew,
// number_of_seasons/number_of_episodes/episode_run_time au lieu de runtime).
export default async function handler(req, res) {
  const apiKey = process.env.TMDB_API_KEY;
  const youtubeKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Clé TMDB non configurée' });
    return;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const skipYoutube = (req.query.skipYoutube || '') === '1';
    try {
      const detailUrl = `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}?api_key=${apiKey}&language=fr-FR&append_to_response=credits,recommendations,watch/providers`;
      const videosUrlFr = `https://api.themoviedb.org/3/tv/${encodeURIComponent(id)}/videos?api_key=${apiKey}&language=fr-FR`;
      const [data, videosFr] = await Promise.all([
        tmdbFetch(detailUrl),
        tmdbFetch(videosUrlFr).catch(() => ({ results: [] })),
      ]);

      const creators = (data.created_by || []).map((c) => c.name);
      const cast = ((data.credits && data.credits.cast) || []).slice(0, 5).map((c) => c.name);
      const genres = (data.genres || []).map((g) => g.name);
      const videos = videosFr.results || [];
      const tmdbTrailer = videos.find((v) => v.site === 'YouTube' && v.type === 'Trailer')
        || videos.find((v) => v.site === 'YouTube' && v.type === 'Teaser');

      let trailerKey = tmdbTrailer ? tmdbTrailer.key : null;
      if (!trailerKey && youtubeKey && !skipYoutube) {
        try {
          const q = `${data.name} bande annonce VF`;
          const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=1&videoDuration=short&relevanceLanguage=fr&q=${encodeURIComponent(q)}&key=${youtubeKey}`;
          const yr = await fetch(searchUrl);
          const ydata = await yr.json();
          const item = (ydata.items || [])[0];
          if (item && item.id && item.id.videoId) trailerKey = item.id.videoId;
        } catch (err) { /* on retombe sur le lien de recherche */ }
      }

      const similar = ((data.recommendations && data.recommendations.results) || []).slice(0, 8).map((s) => ({
        id: s.id,
        title: s.name,
        year: (s.first_air_date || '').slice(0, 4),
        poster: s.poster_path ? `https://image.tmdb.org/t/p/w185${s.poster_path}` : '',
      }));

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
        title: data.name,
        director: creators.join(', '),
        cast,
        genres,
        trailerKey,
        trailerSearchQuery: trailerKey ? null : `${data.name} bande annonce VF`,
        similar,
        watchProviders,
        // `episode_run_time` est déprécié côté TMDB et revient vide pour la
        // plupart des séries récentes : on retombe sur la durée du dernier
        // (ou prochain) épisode diffusé, seuls champs encore renseignés dans
        // ce cas.
        runtime: (data.episode_run_time && data.episode_run_time[0])
          || (data.last_episode_to_air && data.last_episode_to_air.runtime)
          || (data.next_episode_to_air && data.next_episode_to_air.runtime)
          || 0,
        seasons: data.number_of_seasons || 0,
        episodes: data.number_of_episodes || 0,
        overview: data.overview || '',
        poster: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : '',
        year: (data.first_air_date || '').slice(0, 4),
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
  const url = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(q)}`;

  try {
    const data = await tmdbFetch(url);
    const results = (data.results || []).slice(0, limit).map((s) => ({
      id: s.id,
      title: s.name,
      year: (s.first_air_date || '').slice(0, 4),
      poster: s.poster_path ? `https://image.tmdb.org/t/p/w500${s.poster_path}` : '',
      overview: s.overview || '',
    }));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.status(200).json({ results });
  } catch (err) {
    res.status(502).json(err);
  }
}
