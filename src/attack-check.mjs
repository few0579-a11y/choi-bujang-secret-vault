// 자체 점검: 실제 배포 주소에 요청하고 결과만 기록합니다.
export async function runAttackChecks(config) {
  if (![4, 5].includes(config.step)) throw new Error('현재 점검은 4~5단계 전용입니다.');
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
  const postResponse = await fetch(new URL('/api/notes', app), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: '{}', redirect: 'error', signal: AbortSignal.timeout(10000),
  });
  const configResponse = await get('/api/auth-config');
  let directDataStatus = 0;
  if (configResponse.ok) {
    try {
      const authConfig = await configResponse.json();
      if (typeof authConfig.url === 'string' && typeof authConfig.publishableKey === 'string') {
        const directUrl = config.step >= 5 && typeof config.originalApiUrl === 'string'
          ? config.originalApiUrl
          : `${authConfig.url}/rest/v1/notes`;
        const directResponse = await fetch(directUrl, {
          method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { apikey: authConfig.publishableKey },
        });
        directDataStatus = directResponse.status;
      }
    } catch {}
  }
  const homeResponse = await get('/');
  const identityResponse = await get('/aleph.json');
  return [
    { attackId: 'static_note_exposure', expected: '공개 정적 메모 0건 또는 404', observed: exposed ? `정적 메모 노출 (HTTP ${staticResponse.status})` : `정적 메모 미노출 (HTTP ${staticResponse.status})` },
    { attackId: 'anonymous_api_access', expected: '무토큰 GET과 POST 모두 401', observed: `GET HTTP ${apiResponse.status}, POST HTTP ${postResponse.status}` },
    { attackId: 'direct_data_api_anon', expected: 'anon Data API GET 거부', observed: directDataStatus ? `Data API HTTP ${directDataStatus}` : '공개 설정을 읽지 못함' },
    { attackId: 'deployment_identity', expected: '/aleph.json 응답 200', observed: `배포 식별 파일 HTTP ${identityResponse.status}` },
    { attackId: 'security_header', expected: '첫 화면에 X-Content-Type-Options: nosniff', observed: `첫 화면 HTTP ${homeResponse.status}, 헤더 ${homeResponse.headers.get('x-content-type-options') || '없음'}` },
  ];
}
