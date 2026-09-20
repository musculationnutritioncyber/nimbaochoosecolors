import crypto from 'node:crypto';
import { aggregate, loadDeck, saveDeck, saveImage } from '../lib/store.js';

function pinOk(given) {
  const pin = process.env.ADMIN_PIN || '';
  if (!pin || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pin).digest();
  return crypto.timingSafeEqual(a, b);
}

// POST { action: 'active', ids, active } | { action: 'rename', id, name } | { action: 'add', name, dataUrl }
async function edit(body) {
  const d = await loadDeck();
  const colors = d.colors.map((c) => ({ ...c }));
  if (body.action === 'active') {
    const ids = new Set((body.ids || []).map(String));
    colors.forEach((c) => { if (ids.has(c.id)) c.active = !!body.active; });
  } else if (body.action === 'rename') {
    const c = colors.find((x) => x.id === String(body.id));
    const name = String(body.name || '').trim().slice(0, 40);
    if (!c || !name) throw new Error('bad rename');
    c.name = name;
  } else if (body.action === 'add') {
    const m = /^data:(image\/(?:webp|jpeg));base64,(.+)$/.exec(String(body.dataUrl || ''));
    const name = String(body.name || '').trim().slice(0, 40);
    if (!m || !name) throw new Error('bad photo');
    const id = 'u' + Date.now().toString(36);
    const img = await saveImage(id, Buffer.from(m[2], 'base64'), m[1]);
    colors.unshift({ id, name, active: true, img });
  } else {
    throw new Error('unknown action');
  }
  await saveDeck(colors);
}

// GET with header x-admin-pin → ranking. Counts new votes on the way (see lib/store.js).
export default async function handler(req, res) {
  if (!pinOk(req.headers['x-admin-pin'])) return res.status(401).json({ error: 'wrong PIN' });
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    try {
      await edit(typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {});
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  const [{ state, pending }, d] = await Promise.all([aggregate(), loadDeck()]);
  const sessions = Object.values(state.sessions);
  return res.status(200).json({
    product: d.product,
    perVoter: d.perVoter,
    pending,
    voters: sessions.length,
    completed: sessions.filter((s) => s.done).length,
    swipes: sessions.reduce((n, s) => n + s.n, 0),
    lastVote: sessions.reduce((t, s) => Math.max(t, s.t || 0), 0),
    colors: d.colors.map((c) => ({ ...c, ...(state.colors[c.id] || { l: 0, d: 0, f: 0 }) }))
  });
}
