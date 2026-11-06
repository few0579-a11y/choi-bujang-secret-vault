// 자체 점검: 실제 배포 주소에 요청하고 결과만 기록합니다.
export async function runAttackChecks(config) {
  if (![4, 5, 6, 7, 8, 9, 10, 11].includes(config.step)) throw new Error('현재 점검은 4~11단계 전용입니다.');
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
  // 8단계: 반 공지 쓰기·강사 관리 경로를 무토큰으로 직접 호출해 자료가 나오지 않는지 확인합니다.
  let noticeWriteStatus = 0;
  let adminWriteStatus = 0;
  if (config.step >= 8) {
    const put = path => fetch(new URL(path, app), {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: '{"title":"x","body":"x","role":"instructor"}', redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    noticeWriteStatus = (await put('/api/notices/8a8a8a8a-0000-4000-8000-000000000001')).status;
    adminWriteStatus = (await put('/api/admin/notices/8a8a8a8a-0000-4000-8000-000000000001')).status;
  }
  // 10단계: 로그인 없이 복구 경로를 부르면 자료 없이 거부되는지 확인합니다.
  let restoreAnonStatus = 0;
  if (config.step >= 10) {
    restoreAnonStatus = (await fetch(new URL('/api/notes/10b00000-0000-4000-8000-000000000001/restore', app), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      redirect: 'error', signal: AbortSignal.timeout(10000),
    })).status;
  }
  // 11단계: 설치형 앱 설정 파일이 공개되고, 로그인 없이 기기 승인을 요청·조회할 수 없는지 확인합니다.
  let manifestStatus = 0;
  let deviceAnonStatus = 0;
  let deviceForgedStatus = 0;
  if (config.step >= 11) {
    manifestStatus = (await get('/manifest.webmanifest')).status;
    deviceAnonStatus = (await get('/api/device')).status;
    deviceForgedStatus = (await fetch(new URL('/api/device', app), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: '{"status":"approved","deviceId":"aaaaaaaaaaaaaaaa"}', redirect: 'error', signal: AbortSignal.timeout(10000),
    })).status;
  }
  const homeResponse = await get('/');
  const identityResponse = await get('/aleph.json');
  return [
    { attackId: 'static_note_exposure', expected: '공개 정적 메모 0건 또는 404', observed: exposed ? `정적 메모 노출 (HTTP ${staticResponse.status})` : `정적 메모 미노출 (HTTP ${staticResponse.status})` },
    { attackId: 'anonymous_api_access', expected: '무토큰 GET과 POST 모두 401', observed: `GET HTTP ${apiResponse.status}, POST HTTP ${postResponse.status}` },
    { attackId: 'direct_data_api_anon', expected: 'anon Data API GET 거부', observed: directDataStatus ? `Data API HTTP ${directDataStatus}` : '공개 설정을 읽지 못함' },
    { attackId: 'deployment_identity', expected: '/aleph.json 응답 200', observed: `배포 식별 파일 HTTP ${identityResponse.status}` },
    ...(config.step >= 8 ? [
      { attackId: 'notice_write_direct_api', expected: '반 공지 직접 PUT 401 또는 403', observed: `공지 PUT HTTP ${noticeWriteStatus}` },
      { attackId: 'admin_notice_body_role', expected: '본문 role 주장으로 강사 관리 경로 PUT 401 또는 403', observed: `관리 경로 PUT HTTP ${adminWriteStatus}` },
    ] : []),
    ...(config.step >= 10 ? [
      { attackId: 'restore_route_anonymous', expected: '무토큰 복구 POST 401', observed: `복구 POST HTTP ${restoreAnonStatus}` },
    ] : []),
    ...(config.step >= 11 ? [
      { attackId: 'install_manifest_public', expected: '설치형 앱 manifest 응답 200', observed: `manifest HTTP ${manifestStatus}` },
      { attackId: 'device_status_anonymous', expected: '무토큰 기기 상태 조회 401', observed: `기기 상태 GET HTTP ${deviceAnonStatus}` },
      { attackId: 'device_approval_body_claim', expected: '무토큰 + 본문 approved 주장 기기 승인 POST 401', observed: `기기 승인 POST HTTP ${deviceForgedStatus}` },
    ] : []),
    { attackId: 'security_header', expected: '첫 화면에 X-Content-Type-Options: nosniff', observed: `첫 화면 HTTP ${homeResponse.status}, 헤더 ${homeResponse.headers.get('x-content-type-options') || '없음'}` },
  ];
}
