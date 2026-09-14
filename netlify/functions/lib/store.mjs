// Shared Blobs bootstrap.
// Netlify injects blob credentials automatically into v2 functions. If that
// context is missing (older runtimes, some bundling setups), fall back to
// explicit credentials from environment variables.
import { getStore } from '@netlify/blobs';

export function reportStore(){
  try {
    return getStore({ name: 'reports', consistency: 'strong' });
  } catch (e) {
    const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token  = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_API_TOKEN;
    if (siteID && token){
      return getStore({ name:'reports', consistency:'strong', siteID, token });
    }
    const err = new Error(
      'Report storage is not configured. In Netlify, add environment variables ' +
      'NETLIFY_SITE_ID (Site configuration > General > Site ID) and ' +
      'NETLIFY_BLOBS_TOKEN (a personal access token from User settings > Applications), then redeploy.'
    );
    err.configIssue = true;
    throw err;
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
