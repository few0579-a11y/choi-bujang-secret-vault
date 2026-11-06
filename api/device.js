import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../src/notes-auth.mjs';
import { findDevice, hashDeviceToken, issueDeviceToken, newApprovalCode, readDeviceToken } from '../src/device-approval.mjs';

// 11단계: 기기 승인 요청과 상태 확인.
// GET  /api/device → 이 기기의 승인 상태(none | pending | approved | revoked)
// POST /api/device → 승인 요청(대기 상태로 등록). 이 요청만으로는 절대 승인되지 않습니다.
// 본문의 approved·status·deviceId 같은 주장은 읽지 않습니다.
const PENDING_LIMIT = 5;

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

    const token = readDeviceToken(request);
    const device = await findDevice(db, identity.userId, token);

    if (request.method === 'GET') {
      if (!device) return response.status(200).json({ status: 'none' });
      return response.status(200).json({
        status: device.status,
        approvalCode: device.status === 'pending' ? device.approval_code : null,
      });
    }

    if (device) {
      return response.status(200).json({
        status: device.status,
        approvalCode: device.status === 'pending' ? device.approval_code : null,
      });
    }
    // 대기 요청이 너무 많으면 더 받지 않습니다(승인 화면 도배 방지).
    const { count, error: countError } = await db.from('device_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', identity.userId).eq('status', 'pending');
    if (countError) throw countError;
    if ((count ?? 0) >= PENDING_LIMIT) return response.status(429).json({ error: 'TOO_MANY_PENDING_DEVICES' });

    const fresh = token ?? issueDeviceToken(response);
    const approvalCode = newApprovalCode();
    const { error } = await db.from('device_approvals').insert({
      user_id: identity.userId,
      device_hash: hashDeviceToken(fresh),
      approval_code: approvalCode,
      status: 'pending',
    });
    if (error) throw error;
    console.info('device_approval_requested', { status: 'pending' });
    return response.status(201).json({ status: 'pending', approvalCode });
  } catch (error) {
    console.error('device_error', { code: error?.code ?? null });
    return response.status(502).json({ error: 'DEVICE_STATUS_UNAVAILABLE' });
  }
}
