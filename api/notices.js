import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../src/notes-auth.mjs';
import { denyAccess, noticeResourceId } from '../src/zones.mjs';

// 8단계: 반 공지 구역. 로그인한 사용자는 읽기만 합니다. 쓰기는 /api/admin/notices/:id 에서만.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return denyAccess(response, { status: 403, error: 'FORBIDDEN', reason: 'notice_read_only', route: `${request.method} /api/notices` });
    }
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.from('notices').select('id,title,content').order('id');
    if (error) throw error;
    return response.status(200).json({ notices: data.map(row => ({
      id: row.id, resourceId: noticeResourceId(row.id), title: row.title, body: row.content,
    })) });
  } catch {
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
