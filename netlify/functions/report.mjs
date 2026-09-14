// report — read a saved report by id. Netlify Functions v2.
import { withStore, json } from './lib/store.mjs';

export default async (req) => {
  const id = (new URL(req.url).searchParams.get('id') || '').trim();
  if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{6,16}$/.test(id))
    return json(400, { error: 'That report link is not valid.' });

  try {
    const raw = await withStore(store => store.get(id));
    if (!raw)
      return json(404, { error: 'That report was not found. The link may be wrong, or the report may have been removed.' });

    return new Response(raw, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch (e) {
    return json(500, { error: e.configIssue ? e.message : 'Could not load the report: ' + (e.message || 'storage unavailable') });
  }
};
