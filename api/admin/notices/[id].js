import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../../../src/notes-auth.mjs';
import { denyAccess, hasClaimField, noticeResourceId } from '../../../src/zones.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROUTE = 'PUT /api/admin/notices/:id';

function getId(request) {
  const queryId = request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  return '';
}

// 8단계: 강사의 반 공지 수정 관리 경로.
// 강사 여부는 화면 메뉴나 요청 본문의 role이 아니라 DB(public.class_roles)에 저장된 값으로만 판단합니다.
export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'PUT') {
    response.setHeader('Allow', 'PUT');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });

    let input;
    try {
      input = typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {});
    } catch {
      return response.status(400).json({ error: 'INVALID_NOTICE' });
    }
    if (hasClaimField(input)) {
      return denyAccess(response, { status: 400, error: 'ROLE_NOT_ALLOWED', reason: 'client_claim_ignored', route: ROUTE });
    }

    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: roleRow, error: roleError } = await db.from('class_roles')
      .select('role').eq('user_id', identity.userId).maybeSingle();
    if (roleError) throw roleError;
    if (roleRow?.role !== 'instructor') {
      return denyAccess(response, { status: 403, error: 'FORBIDDEN', reason: 'not_instructor', route: ROUTE });
    }

    const id = getId(request);
    if (!UUID.test(id)) return response.status(404).json({ error: 'NOTICE_NOT_FOUND' });
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    const body = typeof input.body === 'string' ? input.body : '';
    if (!title || !body) return response.status(400).json({ error: 'INVALID_NOTICE' });

    const { data, error } = await db.from('notices')
      .update({ title, content: body, updated_by: identity.userId, updated_at: new Date().toISOString() })
      .eq('id', id).select('id,title,content').maybeSingle();
    if (error) throw error;
    if (!data) return response.status(404).json({ error: 'NOTICE_NOT_FOUND' });
    return response.status(200).json({ id: data.id, resourceId: noticeResourceId(data.id), title: data.title, body: data.content });
  } catch {
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
