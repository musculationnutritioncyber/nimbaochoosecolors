import { readBlob } from '../lib/store.js';

// Serves the photos added from the admin: they live in the private Blob store.
export default async function handler(req, res) {
  const u = String(req.query.u || '');
  if (!/^https:\/\/[a-z0-9]+\.private\.blob\.vercel-storage\.com\/img\/[\w.-]+$/i.test(u)) {
    return res.status(400).end('bad url');
  }
  const r = await readBlob(u);
  if (!r.ok) return res.status(404).end('not found');
  res.setHeader('Content-Type', r.headers.get('content-type') || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=2592000, immutable');
  return res.status(200).send(Buffer.from(await r.arrayBuffer()));
}
