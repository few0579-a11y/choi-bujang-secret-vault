// 10단계 제작 3: 메모 한 건만 비공개 사본(public.note_versions)에서 복원합니다.
// POST /api/notes/:id/restore — 로그인한 주인만. ID·소유자·내용 해시 대조는 DB 함수 restore_note_version이 합니다.
// 다른 메모와 감사 기록은 건드리지 않습니다. 응답과 로그에 메모 본문·토큰·사용자 ID를 넣지 않습니다.
import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../../../src/notes-auth.mjs';
import { denyAccess, hasClaimField, noteResourceId } from '../../../src/zones.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ROUTE = 'POST /api/notes/:id/restore';

function getId(request) {
  const queryId = request.query?.id;
  if (typeof queryId === 'string') return queryId;
  if (Array.isArray(queryId) && typeof queryId[0] === 'string') return queryId[0];
  try {
    const parts = new URL(request.url, 'https://localhost').pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-2) ?? '');
  } catch {
    return '';
  }
}

function readBody(request) {
  if (request.body === undefined || request.body === null || request.body === '') return {};
  if (typeof request.body === 'string') return JSON.parse(request.body);
  return request.body;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });

    let input;
    try { input = readBody(request); } catch { return response.status(400).json({ error: 'INVALID_REQUEST' }); }
    // 복원할 내용·주인은 클라이언트가 정하지 않습니다. 본문의 권한 주장은 거부합니다.
    // 본문의 다른 값(title·body 등)은 읽지 않고 무시합니다. 복원 내용은 사본에서만 가져옵니다.
    if (hasClaimField(input)) {
      return denyAccess(response, { status: 400, error: 'RESTORE_INPUT_NOT_ALLOWED', reason: 'client_claim_ignored', route: ROUTE });
    }

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    const id = getId(request);
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });
    if (!UUID.test(id)) return response.status(404).json({ error: 'NOTE_NOT_FOUND' });

    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('restore_note_version', { p_note_id: id, p_owner: identity.userId });
    if (error) {
      const message = String(error.message ?? '');
      if (message.includes('not_owner')) {
        return denyAccess(response, { status: 403, error: 'FORBIDDEN', reason: 'not_owner', route: ROUTE });
      }
      if (message.includes('no_snapshot')) return response.status(404).json({ error: 'SNAPSHOT_NOT_FOUND' });
      if (message.includes('snapshot_hash_mismatch') || message.includes('restore_verify_failed')) {
        console.error('restore_stopped', { route: ROUTE, reason: message.includes('mismatch') ? 'snapshot_hash_mismatch' : 'restore_verify_failed' });
        return response.status(409).json({ error: 'RESTORE_STOPPED', reason: message.includes('mismatch') ? 'snapshot_hash_mismatch' : 'restore_verify_failed' });
      }
      throw error;
    }
    console.info('note_restore', { route: ROUTE, outcome: data?.outcome ?? null });
    return response.status(200).json({
      id,
      resourceId: noteResourceId(id),
      outcome: data.outcome,
      versionId: data.versionId,
      ownerMatches: data.ownerMatches === true,
      contentSha256: data.contentSha256,
    });
  } catch {
    return response.status(502).json({ error: 'DATA_UNAVAILABLE' });
  }
}
