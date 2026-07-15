// Sauvegarde cloud de la filmothèque (Vercel Blob) : le localStorage du téléphone
// reste le cache rapide, mais ce blob est la source de vérité qui survit à un
// nettoyage de stockage navigateur/iOS.
// Un fichier par profil (?profile=p1|p2|p3...) pour que chaque personne ait sa
// propre bibliothèque. Le tout premier profil (p1) hérite en lecture de
// l'ancien fichier unique `library.json` (créé avant l'introduction des
// profils), pour ne rien perdre lors de la migration.
import { put, head } from '@vercel/blob';

const LEGACY_PATHNAME = 'library.json';
const LEGACY_PROFILE_ID = 'p1';

function pathnameFor(profile) {
  if (!profile) return LEGACY_PATHNAME;
  const safe = String(profile).replace(/[^a-zA-Z0-9_-]/g, '');
  return `library-${safe || 'default'}.json`;
}

async function headSafe(pathname) {
  try {
    return await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  const profile = (req.query.profile || '').toString();
  const pathname = pathnameFor(profile);

  if (req.method === 'GET') {
    try {
      let meta = await headSafe(pathname);
      if (!meta && profile === LEGACY_PROFILE_ID) meta = await headSafe(LEGACY_PATHNAME);
      if (!meta) { res.status(200).json({ books: null }); return; }
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
      await put(pathname, JSON.stringify(movies), {
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
