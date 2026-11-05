import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../src/notes-auth.mjs';
import { denyAccess, noteResourceId } from '../src/zones.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function noteBody(row) {
  return { id: row.id, resourceId: noteResourceId(row.id), title: row.title, body: row.content };
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(request.method)) {
    response.setHeader('Allow', 'GET, POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });

    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if (request.method === 'POST') {
      let input;
      try {
        input = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {});
      } catch {
        return response.status(400).json({ error: 'INVALID_NOTE' });
      }
      if (Object.prototype.hasOwnProperty.call(input, 'owner_id')) {
        return response.status(400).json({ error: 'OWNER_ID_NOT_ALLOWED' });
      }
      if (Object.prototype.hasOwnProperty.call(input, 'role')) {
        return denyAccess(response, { status: 400, error: 'ROLE_NOT_ALLOWED', reason: 'client_claim_ignored', route: 'POST /api/notes' });
      }
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const body = typeof input.body === 'string' ? input.body : '';
      if (!title || !body) return response.status(400).json({ error: 'INVALID_NOTE' });
      if (input.id !== undefined && (typeof input.id !== 'string' || !UUID.test(input.id))) {
        return response.status(400).json({ error: 'INVALID_NOTE_ID' });
      }
      const row = { title, content: body, owner_id: identity.userId };
      if (input.id) row.id = input.id;
      const { data, error } = await db.from('notes').insert(row).select('id').single();
      if (error) throw error;
      return response.status(201).json({ id: data.id });
    }

    // 8단계: 목록은 화면용 '내 메모'만 돌려줍니다. 쿼리로 다른 구역·전체 목록을 고를 수 없습니다.
    const { data, error } = await db.from('notes')
      .select('id,title,content,owner_id')
      .eq('owner_id', identity.userId)
      .order('id');
    if (error) throw error;
    return response.status(200).json({ notes: data.filter(row => row.owner_id === identity.userId).map(noteBody) });
  } catch (error) {
    if (request.method === 'POST') {
      console.error('notes_post_error', {
        code: error?.code ?? null,
        message: error?.message ?? null,
      });
    }
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
