import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureRequests } from './fixture-7.mjs';

// 8단계 로컬 연습: 구역 규칙의 허용·거부를 가상 요청으로 확인합니다. 심판 판정이 아닙니다.
const base = () => ({ ...fixtureRequests().normal, requestId: randomUUID(), at: new Date().toISOString() });
const req = (service, method, path, route) => ({ ...base(), service, method, path, route });
export const cases = [
  ['내 메모 하나 읽기', req('notes', 'GET', '/notes/demo', 'GET /notes/:id'), 'allow'],
  ['내 메모 하나 수정', req('notes', 'PUT', '/notes/demo', 'PUT /notes/:id'), 'allow'],
  ['메모 전체 목록', req('notes', 'GET', '/notes', 'GET /notes'), 'deny'],
  ['메모 ID 없이 생성', req('notes', 'POST', '/notes', 'POST /notes'), 'deny'],
  ['메모 기능 경로(export)', req('notes', 'GET', '/notes/demo/export', 'GET /notes/:id/export'), 'deny'],
  ['10단계 메모 한 건 복원', req('notes', 'POST', '/notes/demo/restore', 'POST /notes/:id/restore'), 'allow'],
  ['10단계 GET 복원 경로', req('notes', 'GET', '/notes/demo/restore', 'GET /notes/:id/restore'), 'deny'],
  ['10단계 ID 없는 전체 복원', req('notes', 'POST', '/notes/restore', 'POST /notes/restore'), 'deny'],
  ['경로와 route 불일치', req('notes', 'GET', '/notes/a/b', 'GET /notes/:id'), 'deny'],
  ['반 공지 읽기', req('notices', 'GET', '/notices/n1', 'GET /notices/:id'), 'allow'],
  ['반 공지 목록 읽기', req('notices', 'GET', '/notices', 'GET /notices'), 'allow'],
  ['반 공지 수정', req('notices', 'PUT', '/notices/n1', 'PUT /notices/:id'), 'deny'],
  ['반 공지 PATCH', req('notices', 'PATCH', '/notices/n1', 'PATCH /notices/:id'), 'deny'],
  ['반 공지 삭제', req('notices', 'DELETE', '/notices/n1', 'DELETE /notices/:id'), 'deny'],
  ['강사 자료 읽기', req('materials', 'GET', '/materials/m1', 'GET /materials/:id'), 'deny'],
  ['알 수 없는 서비스', req('admin', 'GET', '/admin', 'GET /admin'), 'deny'],
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { decide, RULE_IDS } = await import('../src/decider.mjs');
  let failed = 0;
  for (const [name, request, expected] of cases) {
    const out = await decide(request);
    const ok = out.decision === expected && out.requestId === request.requestId
      && out.ruleIds.every(id => RULE_IDS.includes(id))
      && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema';
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? '통과' : '확인 필요'} · ${name} → ${out.decision}/${out.reasonCode}\n`);
  }
  process.stdout.write('이 명령은 가상 요청 연습이며 심판 통과 증거가 아닙니다.\n');
  if (failed) process.exitCode = 1;
}
