import { readFile } from 'node:fs/promises';
import { createLoginVerifier } from './verify-login.mjs';

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

export async function verifyNotesRequest(request) {
  let authorization = request.headers?.authorization;
  if (Array.isArray(authorization)) authorization = authorization[0];
  if (!authorization) return null;
  const verifier = await getVerifier();
  return verifier(authorization);
}
