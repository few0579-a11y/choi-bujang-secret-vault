// 12단계 제작 2: 1~12단계 정상·금지 요청을 실제 배포 주소에 보내 한 표로 남깁니다.
// - 결과 칸에는 이번 실행에서 받은 HTTP 응답만 적습니다. 보내지 않은 요청은 "미실행"입니다.
// - 요청 ID = 응답의 x-vercel-id 헤더(없으면 "없음"), 확인 시각 = 응답을 받은 시각(UTC).
// - 로그인은 선택입니다. 이메일·비밀번호·토큰은 화면에만 입력받고 파일·로그에 남기지 않습니다.
// - 메모 내용을 바꾸는 요청(메모 PUT/DELETE, 내 메모 복원)은 자동으로 보내지 않습니다.
// - 심판 총공세 41종은 이 스크립트가 보내지 않습니다. 심판 판정 화면만 근거로 씁니다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(readFileSync(join(root, 'aleph.config.json'), 'utf8'));
const app = new URL(config.publicAppUrl);
// 10단계 복구 시험용 가상 메모. 주인은 A 계정(test-a)입니다(2026-11-06 DB에서 owner 확인).
const B_NOTE = '10b00000-0000-4000-8000-000000000001';
const NOTICE = '8a8a8a8a-0000-4000-8000-000000000001';
const commit = (() => { try { return execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '알 수 없음'; } })();

function ask(question, hidden = false) {
  if (!process.stdin.isTTY) return Promise.resolve('');
  return new Promise(done => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = text => { if (text.includes(question)) process.stdout.write(question); };
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); done(answer.trim()); });
  });
}

async function login(label) {
  const email = process.env[`ALEPH_${label}_EMAIL`] || await ask(`${label} 계정 이메일 (엔터 = 건너뛰기): `);
  if (!email) return null;
  const password = process.env[`ALEPH_${label}_PASSWORD`] || await ask(`${label} 계정 비밀번호 (화면에 안 보임): `, true);
  try {
    const cfg = await (await fetch(new URL('/api/auth-config', app), { signal: AbortSignal.timeout(10000) })).json();
    const res = await fetch(`${cfg.url}/auth/v1/token?grant_type=password`, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { apikey: cfg.publishableKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || typeof body.access_token !== 'string') { console.log(`${label} 로그인 실패(HTTP ${res.status}) → ${label} 요청은 미실행`); return null; }
    return body.access_token;
  } catch { console.log(`${label} 로그인 요청 실패 → ${label} 요청은 미실행`); return null; }
}

// [단계, 구분, 요청 설명, 기대, 보내기 함수(token) → Response, 통과 판단(res, json), 필요한 계정]
const cases = [
  ['1', '정상', 'GET / (첫 화면)', '200 + nosniff 헤더', () => req('GET', '/'), r => r.status === 200 && r.headers.get('x-content-type-options') === 'nosniff'],
  ['1', '정상', 'GET /aleph.json (배포 식별)', '200', () => req('GET', '/aleph.json'), r => r.status === 200],
  ['1', '금지', 'GET /data.json (공개 메모 파일)', '404 또는 메모 0건', () => req('GET', '/data.json'), (r, j) => r.status === 404 || !(j?.notes?.length)],
  ['5', '금지', '원본 Data API anon GET', '401·403·404 또는 0건', () => fetch(config.originalApiUrl, { headers: { apikey: anonKey }, redirect: 'error', signal: AbortSignal.timeout(10000) }), (r, j) => [401, 403, 404].includes(r.status) || (Array.isArray(j) && j.length === 0)],
  ['3', '금지', '무토큰 GET /api/notes', '401', () => req('GET', '/api/notes'), r => r.status === 401],
  ['3', '금지', '무토큰 POST /api/notes', '401', () => req('POST', '/api/notes', null, {}), r => r.status === 401],
  ['3', '금지', '위조 토큰 GET /api/notes/:id', '401', () => req('GET', `/api/notes/${B_NOTE}`, 'aaaa.bbbb.cccc'), r => r.status === 401],
  ['8', '금지', '무토큰 반 공지 PUT', '401 또는 403', () => req('PUT', `/api/notices/${NOTICE}`, null, { title: 'x', body: 'x' }), r => [401, 403].includes(r.status)],
  ['8', '금지', '무토큰 + 본문 role=instructor 강사 경로 PUT', '401 또는 403', () => req('PUT', `/api/admin/notices/${NOTICE}`, null, { title: 'x', body: 'x', role: 'instructor' }), r => [401, 403].includes(r.status)],
  ['10', '금지', '무토큰 복구 POST', '401', () => req('POST', `/api/notes/${B_NOTE}/restore`, null, {}), r => r.status === 401],
  ['11', '정상', 'GET /manifest.webmanifest', '200', () => req('GET', '/manifest.webmanifest'), r => r.status === 200],
  ['11', '금지', '무토큰 기기 상태 GET', '401', () => req('GET', '/api/device'), r => r.status === 401],
  ['11', '금지', '무토큰 + 본문 approved 기기 승인 POST', '401', () => req('POST', '/api/device', null, { status: 'approved', deviceId: 'aaaaaaaaaaaaaaaa' }), r => r.status === 401],
  ['12', '금지', '무토큰 작전실 GET /api/ops', '401', () => req('GET', '/api/ops'), r => r.status === 401],
  ['3·4', '정상', 'A가 자기 가상 메모 GET /api/notes/:id', '200 (본문은 기록 안 함)', t => req('GET', `/api/notes/${B_NOTE}`, t.A), r => r.status === 200, 'A'],
  ['11', '정상', 'B 기기 상태 GET /api/device', '200', t => req('GET', '/api/device', t.B), r => r.status === 200, 'B'],
  ['11', '금지', 'B 목록 GET /api/notes (승인 기기 쿠키 없음)', '403 DEVICE_NOT_APPROVED', t => req('GET', '/api/notes', t.B), (r, j) => r.status === 403 && j?.error === 'DEVICE_NOT_APPROVED', 'B'],
  ['12', '금지', 'B 작전실 GET /api/ops (승인 기기 쿠키 없음)', '403 DEVICE_NOT_APPROVED', t => req('GET', '/api/ops', t.B), (r, j) => r.status === 403 && j?.error === 'DEVICE_NOT_APPROVED', 'B'],
  ['4·8', '금지', 'B가 A 메모 GET /api/notes/:id', '403', t => req('GET', `/api/notes/${B_NOTE}`, t.B), r => r.status === 403, 'B'],
  ['10', '금지', 'B가 A 메모 복원 POST', '403', t => req('POST', `/api/notes/${B_NOTE}/restore`, t.B, {}), r => r.status === 403, 'B'],
];
const notSent = [
  ['4', '정상', 'A·B 자기 메모 수정·삭제 PUT/DELETE', '200', '미실행 — 메모를 바꾸는 요청은 자동으로 보내지 않음'],
  ['10', '정상', 'A 자기 메모 복원 POST', '200', '미실행 — 메모를 되돌리는 요청은 자동으로 보내지 않음(2026-11-06 첫 실행 때 주인을 잘못 가정해 1회 보냄: 결과 no_change, 내용 변화 없음)'],
  ['6·7', '금지', '미등록 기기 / 이상 접속 추가 확인', 'deny / step_up', '미실행(API) — 판정기는 반 엔진이 부름. 아래 로컬 연습만 실행'],
  ['9', '금지', '조회 폭주 → 회수 제안', 'propose_revocation', '미실행(API) — 운영 엔진 사건 전달 경로 없음. 아래 로컬 연습만 실행'],
  ['12', '금지', '심판 총공세 41종', '모두 차단', '미실행 — 이 스크립트가 보내지 않음. 심판 판정 화면만 근거'],
];
const local = [['6·7·8·11', 'npm run decider:test', 'scripts/decider-test.mjs'], ['7', 'npm run fixture:7', 'scripts/fixture-7.mjs'], ['8', 'npm run fixture:8', 'scripts/fixture-8.mjs'], ['11', 'npm run fixture:11', 'scripts/fixture-11.mjs'], ['9', 'npm run detect:test', 'scripts/detect-test.mjs'], ['10', 'npm run policy:verify', 'scripts/policy-backup.mjs', 'verify']];

let anonKey = '';
function req(method, path, token, body) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(new URL(path, app), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(10000) });
}

console.log(`대상: ${app.origin} · 검사 커밋 ${commit}`);
try { anonKey = (await (await fetch(new URL('/api/auth-config', app), { signal: AbortSignal.timeout(10000) })).json()).publishableKey ?? ''; } catch {}
const tokens = { A: await login('A'), B: await login('B') };

const rows = [];
for (const [stage, kind, label, expected, send, ok, need] of cases) {
  if (need && !tokens[need]) { rows.push({ stage, kind, label, expected, actual: `미실행 — ${need} 로그인 안 함`, verdict: '미실행', requestId: '—', at: '—' }); continue; }
  try {
    const res = await send(tokens);
    const at = new Date().toISOString();
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    const code = json && !Array.isArray(json) && typeof json.error === 'string' ? ` ${json.error}` : '';
    const reqId = res.headers.get('x-vercel-id') || res.headers.get('sb-request-id') || '없음';
    rows.push({ stage, kind, label, expected, actual: `HTTP ${res.status}${code}`, verdict: ok(res, json) ? '기대와 같음' : '기대와 다름', requestId: reqId, at });
  } catch (error) {
    rows.push({ stage, kind, label, expected, actual: `요청 실패 (${error.name})`, verdict: '기대와 다름', requestId: '—', at: new Date().toISOString() });
  }
}
for (const [stage, kind, label, expected, reason] of notSent) rows.push({ stage, kind, label, expected, actual: reason, verdict: '미실행', requestId: '—', at: '—' });

const localRows = local.map(([stage, cmd, file, arg]) => {
  try { execFileSync(process.execPath, [join(root, file), ...(arg ? [arg] : [])], { cwd: root, stdio: 'pipe', timeout: 60000 }); return { stage, cmd, result: '종료 코드 0', at: new Date().toISOString() }; }
  catch (error) { return { stage, cmd, result: `종료 코드 ${error.status ?? '실패'}`, at: new Date().toISOString() }; }
});

const sent = rows.filter(r => r.verdict !== '미실행');
const summary = { sent: sent.length, same: sent.filter(r => r.verdict === '기대와 같음').length, different: sent.filter(r => r.verdict === '기대와 다름').length, notRun: rows.length - sent.length };
const md = [
  '# 1~12단계 회귀 시험 표 (실측)', '',
  `- 대상 배포: ${app.origin} · 검사 커밋: \`${commit}\` · 실행 시각: ${new Date().toISOString()}`,
  `- 실제로 보낸 요청 ${summary.sent}건: 기대와 같음 ${summary.same} · 기대와 다름 ${summary.different} · 미실행 ${summary.notRun}건`,
  '- 결과 칸은 이번 실행에서 받은 HTTP 응답입니다. 요청 ID는 응답 헤더 `x-vercel-id`(원본 DB 요청은 `sb-request-id`)입니다.',
  '- 이 표는 학생 자기 점검이며 심판 판정이 아닙니다. 심판 총공세 41종은 이 표에서 실행하지 않았습니다.', '',
  '| 단계 | 구분 | 요청 | 기대 | 실제 결과 | 판단 | 요청 ID | 확인 시각(UTC) |', '|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.stage} | ${r.kind} | ${r.label} | ${r.expected} | ${r.actual} | ${r.verdict} | ${r.requestId} | ${r.at} |`), '',
  '## 로컬 가상 연습 (실제 API 아님)', '', '| 단계 | 명령 | 결과 | 시각(UTC) |', '|---|---|---|---|',
  ...localRows.map(r => `| ${r.stage} | \`${r.cmd}\` | ${r.result} | ${r.at} |`), '',
].join('\n');
mkdirSync(join(root, 'ops'), { recursive: true });
writeFileSync(join(root, 'ops', 'regression-latest.md'), md, 'utf8');
writeFileSync(join(root, 'ops', 'regression-latest.json'), `${JSON.stringify({ schema: 'aleph.regression.v1', target: app.origin, commit, summary, rows, local: localRows }, null, 2)}\n`, 'utf8');
console.log(`보낸 요청 ${summary.sent}건: 기대와 같음 ${summary.same} · 다름 ${summary.different} · 미실행 ${summary.notRun}`);
console.log('기록: ops/regression-latest.md, ops/regression-latest.json');
if (summary.different) process.exitCode = 1;
