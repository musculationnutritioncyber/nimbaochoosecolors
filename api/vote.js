import { saveBatch } from '../lib/store.js';

// POST { sid, seq, src, votes:[{id, v}], fav, done } — one immutable batch of swipes.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'bad body' });

  const sid = String(body.sid || '');
  const seq = Number(body.seq);
  if (!/^[a-z0-9-]{16,40}$/.test(sid) || !Number.isInteger(seq) || seq < 0 || seq > 200) {
    return res.status(400).json({ error: 'bad session' });
  }
  const ids = { has: (id) => /^[a-z0-9]{1,16}$/.test(id) };
  const votes = Array.isArray(body.votes) ? body.votes.slice(0, 200)
    .filter((v) => v && ids.has(String(v.id)))
    .map((v) => ({ id: String(v.id), v: v.v ? 1 : 0 })) : [];
  const fav = ids.has(String(body.fav)) ? String(body.fav) : null;
  if (!votes.length && !fav && !body.done) return res.status(400).json({ error: 'empty' });

  await saveBatch(sid, seq, {
    sid, seq, votes, fav,
    done: body.done ? 1 : 0,
    src: String(body.src || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
    t: Date.now()
  });
  return res.status(200).json({ ok: true });
}
