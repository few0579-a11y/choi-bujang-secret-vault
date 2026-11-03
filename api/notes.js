import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';

let verifierPromise;

async function getVerifier() {
  if (!verifierPromise) {
    verifierPromise = readFile(new URL('../aleph.config.json', import.meta.url), 'utf8')
      .then(text => createLoginVerifier({
        config: JSON.parse(text),
        supabaseSecretKey: process.env.SUPABASE_SECRET_KEY,
      }));
  }
  return verifierPromise;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  let authorization = request.headers?.authorization;
  if (Array.isArray(authorization)) authorization = authorization[0];
  if (!authorization) return response.status(401).json({ error: 'UNAUTHORIZED' });
  if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });

  try {
    const verifier = await getVerifier();
    const identity = await verifier(authorization);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from('notes').select('title,content').order('id');
    if (error) throw error;
    return response.status(200).json({ notes: data });
  } catch {
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
