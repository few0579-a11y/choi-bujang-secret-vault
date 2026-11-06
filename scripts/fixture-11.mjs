import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureRequests } from './fixture-7.mjs';

// 11단계 로컬 연습: 서명 뒤 경로·쿼리가 바뀐 요청과 미등록 기기 요청이 허용되지 않는지 가상 요청으로 확인합니다.
// 실제 기기 서명 검증은 운영 엔진(릴레이)이 하며, 이 연습은 심판 판정이 아닙니다.
const base = () => ({ ...fixtureRequests().normal, requestId: randomUUID(), at: new Date().toISOString() });
const sha = text => createHash('sha256').update(text).digest('hex');
export const cases = [
  ['등록 기기의 정상 요청', base(), 'allow'],
  ['서명 없는(미등록) 기기 요청', { ...base(), deviceRegistered: false }, 'deny'],
  ['기기 ID 형식이 아님', { ...base(), deviceId: 'not-a-device' }, 'deny'],
  ['서명 뒤 경로를 다른 메모 하위 경로로', { ...base(), path: '/notes/demo/export' }, 'deny'],
  ['서명 뒤 경로에 ../ 끼워 넣기', { ...base(), path: '/notes/../notices/n1' }, 'deny'],
  ['서명 뒤 경로에 인코딩된 / 넣기', { ...base(), path: '/notes/demo%2Fexport' }, 'deny'],
  ['쿼리 없다면서 지문이 다름', { ...base(), querySha256: sha('id=other') }, 'deny'],
  ['계약에 없는 이름(device) 추가', { ...base(), device: { approved: true } }, 'deny'],
  ['계약에 없는 이름(role) 추가', { ...base(), role: 'instructor' }, 'deny'],
  ['쿼리가 있고 지문 형식이 맞음', { ...base(), queryLength: 7, querySha256: sha('a=1&b=2') }, 'allow'],
];

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { decide, RULE_IDS } = await import('../src/decider.mjs');
  let failed = 0;
  for (const [name, request, expected] of cases) {
    const out = await decide(request);
    const ok = out.decision === expected && out.requestId === request.requestId
      && out.ruleIds.length > 0 && out.ruleIds.every(id => RULE_IDS.includes(id))
      && Object.keys(out).sort().join(',') === 'decision,reasonCode,requestId,ruleIds,schema';
    if (!ok) failed += 1;
    process.stdout.write(`${ok ? '통과' : '확인 필요'} · ${name} → ${out.decision}/${out.reasonCode}\n`);
  }
  process.stdout.write('이 명령은 가상 요청 연습이며 심판 통과 증거가 아닙니다.\n');
  if (failed) process.exitCode = 1;
}
