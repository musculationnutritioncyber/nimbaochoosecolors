import { put, list, del } from '@vercel/blob';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Storage model: every flush of a voter is ONE immutable blob `votes/<sid>/<seq>.json`.
// The ranking is the sum of all those blobs. The admin endpoint folds new blobs into a
// cached state (`agg/<key>/<timestamp>.json`, a new name each time because overwritten
// blobs stay cached on the CDN for up to a minute).

// Default admin PIN, chosen by Nicolas; set the ADMIN_PIN env var on Vercel to override it.
export const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

// The Blob store is private: every read carries the store token.
export function readBlob(url) {
  return fetch(url, { cache: 'no-store', headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
}

let deckCache = null;
export function deck() {
  if (!deckCache) {
    deckCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'deck.json'), 'utf8'));
  }
  return deckCache;
}

// The admin can hide colours and add photos: once edited, the list lives in Blob
// (`config/<timestamp>.json`, newest wins) and deck.json is only the starting point.
async function latest(prefix) {
  const blobs = await listAll(prefix);
  blobs.sort((a, b) => (a.pathname < b.pathname ? 1 : -1));
  return blobs;
}

export async function loadDeck() {
  const base = deck();
  const blobs = await latest('config/');
  if (!blobs.length) return base;
  try {
    const r = await readBlob(blobs[0].url);
    const cfg = await r.json();
    const known = new Set(base.colors.map((c) => c.id));
    const kept = cfg.colors.filter((c) => known.has(c.id) || c.img); // removed from deck.json = gone
    const seen = new Set(kept.map((c) => c.id));
    return { ...base, colors: [...kept, ...base.colors.filter((c) => !seen.has(c.id))] };
  } catch {
    return base;
  }
}

export async function saveDeck(colors) {
  const old = await latest('config/');
  await put(`config/${String(Date.now()).padStart(15, '0')}.json`, JSON.stringify({ colors }), {
    access: 'private', addRandomSuffix: false, contentType: 'application/json'
  });
  if (old.length > 5) await del(old.slice(5).map((b) => b.url)); // keep a few versions back
}

export async function saveImage(id, buffer, contentType) {
  const ext = contentType === 'image/webp' ? 'webp' : 'jpg';
  const blob = await put(`img/${id}.${ext}`, buffer, { access: 'private', addRandomSuffix: true, contentType });
  return `/api/img?u=${encodeURIComponent(blob.url)}`; // served through api/img.js
}

export async function saveBatch(sid, seq, payload) {
  await put(`votes/${sid}/${seq}.json`, JSON.stringify(payload), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json'
  });
}

function aggPrefix() {
  const key = crypto.createHash('sha256').update(`agg:${ADMIN_PIN}`).digest('hex').slice(0, 24);
  return `agg/${key}/`;
}

async function listAll(prefix) {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function loadState() {
  const blobs = await latest(aggPrefix());
  const empty = { processed: {}, colors: {}, sessions: {} };
  if (!blobs.length) return { state: empty, old: [] };
  try {
    const r = await readBlob(blobs[0].url);
    return { state: await r.json(), old: blobs };
  } catch {
    return { state: empty, old: blobs };
  }
}

function fold(state, pathname, batch) {
  state.processed[pathname] = 1;
  if (batch.src === 'test') return; // our own test runs never count
  const sid = String(batch.sid || '');
  const s = state.sessions[sid] || (state.sessions[sid] = { n: 0, done: 0, src: batch.src || '', t: batch.t || 0, seen: {} });
  for (const v of batch.votes || []) {
    if (s.seen[v.id]) continue; // one vote per colour per voter
    s.seen[v.id] = 1;
    s.n += 1;
    const c = state.colors[v.id] || (state.colors[v.id] = { l: 0, d: 0, f: 0 });
    if (v.v) c.l += 1; else c.d += 1;
  }
  if (batch.fav && !s.fav) {
    s.fav = batch.fav;
    const c = state.colors[batch.fav] || (state.colors[batch.fav] = { l: 0, d: 0, f: 0 });
    c.f += 1;
  }
  if (batch.done) s.done = 1;
  if (batch.t && batch.t > s.t) s.t = batch.t;
}

// Folds the vote blobs not yet counted into the cached state, within a time budget.
// Returns the state and how many blobs are still waiting (the admin page calls again).
export async function aggregate(budgetMs = 40000) {
  const t0 = Date.now();
  const [{ state, old }, votes] = await Promise.all([loadState(), listAll('votes/')]);
  const todo = votes.filter((b) => !state.processed[b.pathname]);
  let done = 0;
  const CONC = 80;
  while (done < todo.length && Date.now() - t0 < budgetMs) {
    const slice = todo.slice(done, done + CONC);
    const batches = await Promise.all(slice.map(async (b) => {
      try {
        const r = await readBlob(b.url);
        return await r.json();
      } catch {
        return null;
      }
    }));
    slice.forEach((b, i) => { if (batches[i]) fold(state, b.pathname, batches[i]); });
    done += slice.length;
  }
  if (done > 0) {
    await put(`${aggPrefix()}${String(Date.now()).padStart(15, '0')}.json`, JSON.stringify(state), {
      access: 'private', addRandomSuffix: false, contentType: 'application/json'
    });
    if (old.length) await del(old.map((b) => b.url));
  }
  return { state, pending: todo.length - done };
}
