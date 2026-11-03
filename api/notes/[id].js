import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../../src/notes-auth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function getId(request) {
  const queryId = request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  try {
    const pathname = new URL(request.url, 'https://localhost').pathname;
    return decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) ?? '');
  } catch {
    return '';
  }
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
    response.setHeader('Allow', 'GET, PUT, DELETE');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    const id = getId(request);
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });
    if (!UUID.test(id)) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });

    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if (request.method === 'DELETE') {
      const { data, error } = await db.from('notes').delete().eq('id', id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
      return response.status(200).json({ id: data.id });
    }

    if (request.method === 'PUT') {
      let input;
      try {
        input = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {});
      } catch {
        return response.status(400).json({ error: 'INVALID_NOTE' });
      }
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const body = typeof input.body === 'string' ? input.body : '';
      if (!title || !body) return response.status(400).json({ error: 'INVALID_NOTE' });
      const { data, error } = await db.from('notes').update({ title, content: body })
        .eq('id', id).select('id,title,content').maybeSingle();
      if (error) throw error;
      if (!data) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
      return response.status(200).json({ id: data.id, title: data.title, body: data.content });
    }

    const { data, error } = await db.from('notes').select('id,title,content').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });
    return response.status(200).json({ id: data.id, title: data.title, body: data.content });
  } catch {
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
