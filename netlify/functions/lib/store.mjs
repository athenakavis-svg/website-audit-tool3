// Shared Blobs bootstrap.
//
// Netlify usually injects blob credentials automatically. When it does not, the
// failure appears on the first read/write, NOT when the store is created, so the
// retry has to wrap the operation itself.
import { getStore } from '@netlify/blobs';

const NAME = 'reports';
const OPTS = { name: NAME, consistency: 'strong' };

const HELP =
  'Report storage is not configured. In Netlify go to Site configuration > ' +
  'Environment variables and add NETLIFY_SITE_ID (found under Site configuration > ' +
  'General > Project details) and NETLIFY_BLOBS_TOKEN (create one at User settings > ' +
  'Applications > Personal access tokens), then redeploy.';

const looksUnconfigured = e =>
  /has not been configured|siteID|token|MissingBlobsEnvironmentError/i.test(e?.message || '') ||
  e?.name === 'MissingBlobsEnvironmentError';

function manualStore(){
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
  if (!siteID || !token){
    const err = new Error(HELP);
    err.configIssue = true;
    throw err;
  }
  return getStore({ ...OPTS, siteID, token });
}

// Runs fn against the store, retrying with explicit credentials if the
// automatic environment turns out to be missing.
export async function withStore(fn){
  let store;
  try { store = getStore(OPTS); }
  catch (e) {
    if (!looksUnconfigured(e)) throw e;
    store = manualStore();
    return await fn(store);
  }

  try {
    return await fn(store);
  } catch (e) {
    if (!looksUnconfigured(e)) throw e;
    return await fn(manualStore());
  }
}

export const json = (status, obj, extra = {}) => new Response(JSON.stringify(obj), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    ...extra
  }
});
