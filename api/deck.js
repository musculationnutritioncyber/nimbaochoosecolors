import { loadDeck } from '../lib/store.js';

// Public: the colours a voter can get. Cached briefly so an email blast does not
// hit the Blob store once per visitor.
export default async function handler(req, res) {
  const d = await loadDeck();
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  return res.status(200).json({
    product: d.product,
    perVoter: d.perVoter,
    colors: d.colors.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name, img: c.img || null }))
  });
}
