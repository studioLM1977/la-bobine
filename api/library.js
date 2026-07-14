// Sauvegarde cloud de la filmothèque (Vercel Blob) : le localStorage du téléphone
// reste le cache rapide, mais ce blob est la source de vérité qui survit à un
// nettoyage de stockage navigateur/iOS.
import { put, head } from '@vercel/blob';

const PATHNAME = 'library.json';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const meta = await head(PATHNAME, { token: process.env.BLOB_READ_WRITE_TOKEN });
      const fresh = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!fresh.ok) throw new Error('fetch blob failed');
      const data = await fresh.json();
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ books: data });
    } catch (err) {
      res.status(200).json({ books: null });
    }
    return;
  }

  if (req.method === 'POST') {
    const movies = req.body;
    if (!Array.isArray(movies)) {
      res.status(400).json({ error: 'Le corps doit être un tableau de films' });
      return;
    }
    try {
      await put(PATHNAME, JSON.stringify(movies), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      res.status(200).json({ status: 'ok' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).json({ error: 'Méthode non supportée' });
}
