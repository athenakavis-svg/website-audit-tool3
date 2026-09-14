// places — look up the business's Google listing and reviews.
// Sells reputation management. Key stays server-side (Places has no CORS).
// Needs env var GOOGLE_PLACES_KEY.

const hits = new Map();
function rateLimited(ip){
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500){
    for (const [k,v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
  }
  return list.length > 8;
}

const json = (status, obj) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'Content-Type',
    'Access-Control-Allow-Methods':'POST, OPTIONS'
  }
});

const FIELDS = [
  'places.id','places.displayName','places.formattedAddress','places.rating',
  'places.userRatingCount','places.websiteUri','places.googleMapsUri',
  'places.businessStatus','places.primaryTypeDisplayName','places.nationalPhoneNumber'
].join(',');

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./,'').toLowerCase(); } catch { return ''; } };

async function textSearch(query, key){
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': FIELDS
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 5 }),
    signal: AbortSignal.timeout(9000)
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'Places request failed.');
  return j.places || [];
}

export default async (req) => {
  if (req.method === 'OPTIONS') return json(204, {});
  if (req.method !== 'POST')    return json(405, { error:'Use POST.' });

  const ip = req.headers.get('x-nf-client-connection-ip')
    || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return json(429, { error:'Too many lookups. Wait a minute.' });

  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return json(200, { notConfigured:true,
    error:'Business listing lookups are not set up. Add GOOGLE_PLACES_KEY in Netlify environment variables.' });

  let body = {};
  try { body = await req.json(); } catch {}

  const name    = (body.name || '').toString().trim().slice(0,90);
  const address = (body.address || '').toString().trim().slice(0,140);
  const domain  = (body.domain || '').toString().trim().toLowerCase().slice(0,120);

  if (!name && !domain) return json(400, { error:'Nothing to search for.' });

  try {
    // Try the most specific query first, then loosen.
    const queries = [];
    if (name && address) queries.push(`${name} ${address}`);
    if (name)            queries.push(name);
    if (domain)          queries.push(domain.replace(/\.[a-z.]+$/,'').replace(/[-_]/g,' '));

    let places = [];
    let usedQuery = null;
    for (const q of queries.slice(0,3)){
      places = await textSearch(q, key);
      if (places.length){ usedQuery = q; break; }
    }

    if (!places.length){
      return json(200, { found:false, searched: queries[0] || null,
        note:'No Google Business Profile matched this business.' });
    }

    // Prefer a result whose website matches the domain we scanned.
    const exact = domain ? places.find(p => hostOf(p.websiteUri) === domain) : null;
    const p = exact || places[0];

    return json(200, {
      found: true,
      confident: !!exact,
      searched: usedQuery,
      name: p.displayName?.text || null,
      category: p.primaryTypeDisplayName?.text || null,
      address: p.formattedAddress || null,
      phone: p.nationalPhoneNumber || null,
      rating: typeof p.rating === 'number' ? p.rating : null,
      reviewCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
      website: p.websiteUri || null,
      websiteMatches: domain ? hostOf(p.websiteUri) === domain : null,
      mapsUrl: p.googleMapsUri || null,
      status: p.businessStatus || null
    });
  } catch (e) {
    const m = e.message || '';
    if (/API key not valid|API_KEY_INVALID/i.test(m))
      return json(200, { error:'The Places API key is not valid. Check it is enabled for Places API (New).' });
    if (/PERMISSION_DENIED|not been used|disabled/i.test(m))
      return json(200, { error:'Places API (New) is not enabled on this Google Cloud project.' });
    if (/quota|RESOURCE_EXHAUSTED/i.test(m))
      return json(200, { error:'Places quota reached for today.' });
    return json(200, { error:'Could not look up the business listing: ' + (m || 'unknown error') });
  }
};
