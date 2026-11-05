import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../../src/notes-auth.mjs';
import { denyAccess, noticeResourceId } from '../../src/zones.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function getId(request) {
  const queryId = request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return '';
}

// 8단계: 반 공지 하나 읽기. PUT·PATCH·POST·DELETE는 역할과 관계없이 거부합니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return denyAccess(response, { status: 403, error: 'FORBIDDEN', reason: 'notice_read_only', route: `${request.method} /api/notices/:id` });
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });
    const id = getId(request);
    if (!UUID.test(id)) return response.status(404).json({ error: 'NOTICE_NOT_FOUND' });
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from('notices').select('id,title,content').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return response.status(404).json({ error: 'NOTICE_NOT_FOUND' });
    return response.status(200).json({ id: data.id, resourceId: noticeResourceId(data.id), title: data.title, body: data.content });
  } catch {
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
