import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { verifyNotesRequest } from '../src/notes-auth.mjs';
import { denyAccess } from '../src/zones.mjs';
import { isApprovedDevice } from '../src/device-approval.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { BURST_LIMIT, BURST_WINDOW_MS } from '../src/detect.mjs';
import { readFile } from 'node:fs/promises';

// 12단계 탈환 작전실: 판정기 규칙·탐지·회수·복구의 "실제 서버 기록"을 가린 값으로 요약합니다.
// - 로그인 + 승인된 기기에서만 열립니다(11단계 화면 API와 같은 조건).
// - 내 계정의 기록만 읽습니다. 메모 제목·본문·기기 지문·토큰은 응답에 넣지 않습니다.
// - 읽지 못한 것은 0건으로 채우지 않고 status로 구분합니다:
//   measured(이번 요청에서 DB를 실제로 읽음) · code(배포된 코드의 설정값) · not_connected(연결된 경로 없음) · error(읽기 실패)
const MAX_ROWS = 200;
let configPromise;
const readConfig = () => (configPromise ??= readFile(new URL('../aleph.config.json', import.meta.url), 'utf8').then(JSON.parse));

const maskId = value => (typeof value === 'string' && value.length >= 8 ? `${value.slice(0, 8)}…` : '—');
const maskCode = value => (typeof value === 'string' && value.length >= 2 ? `${value.slice(0, 2)}**-****` : '—');
const countBy = (rows, key) => rows.reduce((acc, row) => {
  const k = String(row[key] ?? 'unknown');
  acc[k] = (acc[k] ?? 0) + 1;
  return acc;
}, {});
const failed = (source, error) => ({ status: 'error', source, error: String(error?.code || error?.message || 'READ_FAILED').slice(0, 60) });

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  try {
    const identity = await verifyNotesRequest(request);
    if (!identity) return response.status(401).json({ error: 'UNAUTHORIZED' });
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) return response.status(503).json({ error: 'SERVER_NOT_CONFIGURED' });
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    if (!(await isApprovedDevice(db, identity.userId, request))) {
      return denyAccess(response, { status: 403, error: 'DEVICE_NOT_APPROVED', reason: 'device_not_approved', route: 'GET /api/ops' });
    }

    const requestId = String(request.headers?.['x-vercel-id'] || randomUUID()).slice(0, 120);
    const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null;

    const config = await readConfig();
    // 1) 판정기 규칙: 배포된 코드의 값(실행 결과가 아님)
    const decider = {
      status: 'code', source: 'src/decider.mjs · aleph.config.json (배포 커밋)',
      step: config.step, ruleIds: [...RULE_IDS], allowedRoutes: [...(config.allowedRoutes ?? [])],
    };

    // 2) 탐지: 규칙은 코드에 있지만, 운영 엔진이 실제 사건을 넘겨주는 경로는 없음 → 사건 0건이 아니라 미연결
    const detection = {
      status: 'not_connected', source: 'src/detect.mjs',
      rule: { id: 'burst_read', windowMinutes: BURST_WINDOW_MS / 60000, limitOver: BURST_LIMIT },
      events: null, proposals: null,
      note: '실제 사건 전달 경로가 없어 탐지 사건·회수 제안은 미실행입니다(가상 사건 연습만 실행: npm run detect:test).',
    };

    // 3) 회수 상태: 내 계정의 기기 승인 표(pending/approved/revoked)
    let revocation;
    {
      const { data, error } = await db.from('device_approvals')
        .select('approval_code,status,created_at,approved_at')
        .eq('user_id', identity.userId).order('created_at', { ascending: false }).limit(MAX_ROWS);
      revocation = error ? failed('device_approvals', error) : {
        status: 'measured', source: 'device_approvals (내 계정)',
        total: data.length, truncated: data.length === MAX_ROWS, counts: countBy(data, 'status'),
        records: data.map(row => ({ code: maskCode(row.approval_code), status: row.status, createdAt: row.created_at, approvedAt: row.approved_at })),
      };
    }

    // 4) 복구 버전 + 복원 감사: 내 메모의 사본(제목·본문은 고르지도 않음)
    let recovery;
    {
      const { data: versions, error } = await db.from('note_versions')
        .select('id,note_id,op,captured_at')
        .eq('owner_id', identity.userId).order('id', { ascending: false }).limit(MAX_ROWS);
      if (error) recovery = failed('note_versions', error);
      else {
        const noteIds = [...new Set(versions.map(row => row.note_id))];
        let audit = { status: 'measured', source: 'note_restore_audit (내 메모)', total: 0, truncated: false, counts: {}, records: [] };
        if (noteIds.length) {
          const { data: rows, error: auditError } = await db.from('note_restore_audit')
            .select('id,note_id,version_id,outcome,at')
            .in('note_id', noteIds).order('id', { ascending: false }).limit(MAX_ROWS);
          audit = auditError ? failed('note_restore_audit', auditError) : {
            ...audit, total: rows.length, truncated: rows.length === MAX_ROWS, counts: countBy(rows, 'outcome'),
            records: rows.map(row => ({ note: maskId(row.note_id), versionId: row.version_id, outcome: row.outcome, at: row.at })),
          };
        }
        recovery = {
          status: 'measured', source: 'note_versions (내 메모)',
          total: versions.length, truncated: versions.length === MAX_ROWS, notes: noteIds.length, counts: countBy(versions, 'op'),
          records: versions.map(row => ({ versionId: row.id, note: maskId(row.note_id), op: row.op, capturedAt: row.captured_at })),
          audit,
        };
      }
    }

    return response.status(200).json({
      schema: 'aleph.ops.v1', requestId, checkedAt: new Date().toISOString(), commit,
      decider, detection, revocation, recovery,
    });
  } catch {
    return response.status(500).json({ error: 'OPS_READ_FAILED' });
  }
}
