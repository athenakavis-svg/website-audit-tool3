// save.js — freeze a finished report and hand back a short share id.
const { getStore } = require('@netlify/blobs');

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

// Short, unambiguous ids: no 0/O/1/I/l.
function makeId(len = 8){
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = require('crypto').randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

const clean = (v, max) => typeof v === 'string' ? v.trim().slice(0, max) : '';

exports.handler = async (event) => {
  const cors = {
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:cors, body:'' };
  if (event.httpMethod !== 'POST')
    return { statusCode:405, headers:cors, body:JSON.stringify({ error:'Use POST.' }) };

  const ip = event.headers['x-nf-client-connection-ip']
    || (event.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip))
    return { statusCode:429, headers:cors, body:JSON.stringify({ error:'Too many saves in a row. Wait a minute.' }) };

  if ((event.body || '').length > MAX_BYTES)
    return { statusCode:413, headers:cors, body:JSON.stringify({ error:'That report is too large to save.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode:400, headers:cors, body:JSON.stringify({ error:'Could not read the report data.' }) }; }

  const { audit, psi, author } = body;
  if (!audit || !audit.score || !audit.finalUrl)
    return { statusCode:400, headers:cors, body:JSON.stringify({ error:'No report data to save.' }) };

  const name = clean(author && author.name, 80);
  if (!name)
    return { statusCode:400, headers:cors, body:JSON.stringify({ error:'A name is required before saving.' }) };

  const email = clean(author && author.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return { statusCode:400, headers:cors, body:JSON.stringify({ error:'That email address does not look valid.' }) };

  const record = {
    version: 1,
    savedAt: new Date().toISOString(),
    author: { name, email },
    audit,
    psi: psi && !psi.error ? psi : null
  };

  try {
    const store = getStore({ name: 'reports', consistency: 'strong' });
    let id;
    for (let attempt = 0; attempt < 5; attempt++){
      id = makeId();
      const existing = await store.get(id);   // vanishingly unlikely, but cheap to check
      if (!existing) break;
      id = null;
    }
    if (!id)
      return { statusCode:500, headers:cors, body:JSON.stringify({ error:'Could not allocate a report id. Try again.' }) };

    await store.set(id, JSON.stringify(record));
    return { statusCode:200, headers:cors, body:JSON.stringify({ id, savedAt: record.savedAt }) };
  } catch (e) {
    return { statusCode:500, headers:cors,
      body:JSON.stringify({ error:'Could not save the report: ' + (e.message || 'storage unavailable') }) };
  }
};
