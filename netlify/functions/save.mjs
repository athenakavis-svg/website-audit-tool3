// save — freeze a finished report, return a short share id. Netlify Functions v2.
import { randomBytes } from 'node:crypto';
import { withStore, json } from './lib/store.mjs';

const MAX_BYTES = 400_000;
const hits = new Map();

function rateLimited(ip){
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500){
    for (const [k,v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
  }
  return list.length > 12;
}

function makeId(len = 8){
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

export default async (req) => {
  if (req.method === 'OPTIONS') return json(204, {});
  if (req.method !== 'POST')    return json(405, { error: 'Use POST.' });

  const ip = req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return json(429, { error: 'Too many saves in a row. Wait a minute.' });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return json(413, { error: 'That report is too large to save.' });

  let body;
  try { body = JSON.parse(raw || '{}'); }
  catch { return json(400, { error: 'Could not read the report data.' }); }

  const { audit, psi, places, author } = body;
  if (!audit || !audit.score || !audit.finalUrl)
    return json(400, { error: 'No report data to save.' });

  const name = clean(author?.name, 80);
  if (!name) return json(400, { error: 'A name is required before saving.' });

  const email = clean(author?.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json(400, { error: 'That email address does not look valid.' });

  const record = {
    version: 1,
    savedAt: new Date().toISOString(),
    author: { name, email },
    audit,
    psi: psi && !psi.error ? psi : null,
    places: places && places.found ? places : null
  };

  try {
    const id = await withStore(async store => {
      for (let i = 0; i < 5; i++){
        const candidate = makeId();
        if (!(await store.get(candidate))){
          await store.set(candidate, JSON.stringify(record));
          return candidate;
        }
      }
      return null;
    });
    if (!id) return json(500, { error: 'Could not allocate a report id. Try again.' });
    return json(200, { id, savedAt: record.savedAt });
  } catch (e) {
    return json(500, { error: e.configIssue ? e.message : 'Could not save the report: ' + (e.message || 'storage unavailable') });
  }
};
