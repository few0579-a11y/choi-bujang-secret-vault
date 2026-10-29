// 2단계 자체 점검: 실제 배포 주소에 요청하고 결과만 기록합니다.
export async function runAttackChecks(config) {
  if (config.step !== 2) throw new Error('현재 점검은 2단계 전용입니다.');
  let app;
  try { app = new URL(config.publicAppUrl); } catch { throw new Error('실제 Vercel 배포 URL을 설정하세요.'); }
  if (app.protocol !== 'https:' || app.hostname.endsWith('.example') || app.pathname !== '/') {
    throw new Error('실제 Vercel 배포 URL을 설정하세요.');
  }
  const get = path => fetch(new URL(path, app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
  const staticResponse = await get('/data.json');
  let exposed = false;
  if (staticResponse.ok) {
    try { const json = await staticResponse.json(); exposed = !!json?.notes?.length; } catch {}
  }
  const apiResponse = await get('/api/notes');
  const homeResponse = await get('/');
  const identityResponse = await get('/aleph.json');
  return [
    { attackId: 'static_note_exposure', expected: '공개 정적 메모 0건 또는 404', observed: exposed ? `정적 메모 노출 (HTTP ${staticResponse.status})` : `정적 메모 미노출 (HTTP ${staticResponse.status})` },
    { attackId: 'anonymous_api_access', expected: '2단계에서는 인증 없는 API 접근 가능(남은 취약점)', observed: `비로그인 API 응답 HTTP ${apiResponse.status}` },
    { attackId: 'deployment_identity', expected: '/aleph.json 응답 200', observed: `배포 식별 파일 HTTP ${identityResponse.status}` },
    { attackId: 'security_header', expected: '첫 화면에 X-Content-Type-Options: nosniff', observed: `첫 화면 HTTP ${homeResponse.status}, 헤더 ${homeResponse.headers.get('x-content-type-options') || '없음'}` },
  ];
}
