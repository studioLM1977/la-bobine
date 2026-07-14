// Proxy serverless vers TMDB (The Movie Database) : la clé reste côté serveur
// (variable d'env Vercel), jamais exposée dans le JS envoyé au navigateur.
export default async function handler(req, res) {
  const apiKey = process.env.TMDB_API_KEY;
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
    // Fiche détaillée d'un film : durée + réalisateur + synopsis en un seul appel
    // (append_to_response=credits évite un second aller-retour pour le réalisateur).
    try {
      const url = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?api_key=${apiKey}&language=fr-FR&append_to_response=credits`;
      const data = await tmdbFetch(url);
      const director = ((data.credits && data.credits.crew) || []).find((c) => c.job === 'Director');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.status(200).json({
        id: data.id,
        title: data.title,
        director: director ? director.name : '',
        runtime: data.runtime || 0,
        overview: data.overview || '',
        poster: data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : '',
        year: (data.release_date || '').slice(0, 4),
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
