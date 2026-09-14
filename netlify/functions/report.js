// report.js — fetch a saved report by id.
const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Content-Type':'application/json',
    'Access-Control-Allow-Origin':'*',
    'Cache-Control':'public, max-age=300'
  };

  const id = (event.queryStringParameters && event.queryStringParameters.id || '').trim();
  if (!/^[23456789abcdefghjkmnpqrstuvwxyz]{6,16}$/.test(id))
    return { statusCode:400, headers, body:JSON.stringify({ error:'That report link is not valid.' }) };

  try {
    const store = getStore({ name:'reports', consistency:'strong' });
    const raw = await store.get(id);
    if (!raw)
      return { statusCode:404, headers, body:JSON.stringify({ error:'That report was not found. The link may be wrong, or the report may have been removed.' }) };
    return { statusCode:200, headers, body: raw };
  } catch (e) {
    return { statusCode:500, headers, body:JSON.stringify({ error:'Could not load the report: ' + (e.message || 'storage unavailable') }) };
  }
};
