// Proxy serverless vers Gemini (LLM) : la clé reste côté serveur (variable
// d'env Vercel), jamais exposée dans le JS envoyé au navigateur. Les titres
// suggérés par le modèle sont toujours revérifiés via TMDB (recherche du
// premier résultat) avant d'être renvoyés au client : ça évite d'afficher un
// titre halluciné sans affiche ni fiche réelle, et ça fournit directement les
// données nécessaires pour l'ajout à la filmothèque.
export default async function handler(req, res) {
  const apiKey = process.env.GEMINI_API_KEY;
  const tmdbKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Clé Gemini non configurée' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Méthode non supportée' });
    return;
  }

  async function tmdbSearchFirst(title) {
    if (!tmdbKey || !title) return null;
    try {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&language=fr-FR&include_adult=false&query=${encodeURIComponent(title)}`;
      const r = await fetch(url);
      const data = await r.json();
      const m = (data.results || [])[0];
      if (!m) return null;
      return {
        id: m.id,
        title: m.title,
        year: (m.release_date || '').slice(0, 4),
        poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : '',
        overview: m.overview || '',
      };
    } catch (err) {
      return null;
    }
  }

  async function askGemini(system, user) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.6,
        },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw data;
    const content = data.candidates
      && data.candidates[0]
      && data.candidates[0].content
      && data.candidates[0].content.parts
      && data.candidates[0].content.parts[0]
      && data.candidates[0].content.parts[0].text;
    return JSON.parse(content);
  }

  const action = (req.body && req.body.action) || '';

  try {
    if (action === 'recommend') {
      const rated = (req.body.movies || []).filter((m) => m && m.rating > 0);
      if (rated.length === 0) {
        res.status(400).json({ error: 'Aucun film noté pour baser une recommandation' });
        return;
      }
      const genre = ((req.body.genre || '').toString().trim());
      const style = ((req.body.style || '').toString().trim());

      let system = 'Tu es un expert cinéma. On te donne les films notés par un utilisateur '
        + '(titre, réalisateur, genres, note sur 5). Propose 6 films QU\'IL N\'A PAS DANS CETTE LISTE '
        + 'et qu\'il pourrait aimer, en te basant sur ses goûts (genres et réalisateurs récurrents '
        + 'parmi ses mieux notés).';
      if (genre) system += ` Il veut cette fois précisément un film du genre "${genre}" : respecte ce choix en priorité.`;
      if (style) system += ` Ambiance recherchée : "${style}".`;
      system += ' Réponds uniquement en JSON strictement de la forme '
        + '{"suggestions":[{"title":"...","reason":"phrase courte en français expliquant pourquoi"}]}.';

      const user = JSON.stringify(rated.map((m) => ({
        title: m.title, director: m.director, genres: m.genres || [], rating: m.rating,
      })));

      const parsed = await askGemini(system, user);
      const suggestions = (parsed.suggestions || []).slice(0, 8);
      const withPosters = await Promise.all(suggestions.map(async (s) => {
        const match = await tmdbSearchFirst(s.title);
        return match ? { ...match, reason: s.reason || '' } : null;
      }));

      res.status(200).json({ suggestions: withPosters.filter(Boolean) });
      return;
    }

    if (action === 'identify') {
      const description = ((req.body && req.body.description) || '').toString().trim();
      if (!description) {
        res.status(400).json({ error: 'Description manquante' });
        return;
      }
      const system = 'Tu es un expert cinéma qui aide à retrouver le titre d\'un film à partir '
        + 'd\'une description floue (intrigue, acteur, scène, ambiance), en français. Propose '
        + 'jusqu\'à 5 films candidats, du plus probable au moins probable. Réponds uniquement en '
        + 'JSON strictement de la forme {"titles":["Titre 1","Titre 2"]}.';

      const parsed = await askGemini(system, description);
      const titles = (parsed.titles || []).slice(0, 5);
      const results = await Promise.all(titles.map((t) => tmdbSearchFirst(t)));

      res.status(200).json({ results: results.filter(Boolean) });
      return;
    }

    res.status(400).json({ error: 'Action inconnue' });
  } catch (err) {
    res.status(502).json({ error: (err && err.error && err.error.message) || 'IA indisponible' });
  }
}
