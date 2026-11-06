// 자체 점검: 실제 배포 주소에 요청하고 결과만 기록합니다. 심판 판정이 아닙니다.
// 12단계 규칙(심판 격리 환경):
// - 공개 HTTPS 주소에 GET만 보냅니다. 쓰기 요청(POST·PUT)이 필요한 점검은 보내지 않고 observed = 'not_run'.
// - 요청을 보낸 점검은 한 점검에 요청 하나, observed = 'GET <주소> → HTTP <받은 상태> · x-request-id <UUID>'.
// - 점검 목록 밖의 요청은 보내지 않습니다(보낸 요청과 기록이 1:1로 맞아야 함). 순서도 기록 순서와 같습니다.
import { randomUUID } from 'node:crypto';

const NOT_RUN = 'not_run';

export async function runAttackChecks(config) {
  if (![4, 5, 6, 7, 8, 9, 10, 11, 12].includes(config.step)) throw new Error('현재 점검은 4~12단계 전용입니다.');
  let app;
  try { app = new URL(config.publicAppUrl); } catch { throw new Error('실제 Vercel 배포 URL을 설정하세요.'); }
  if (app.protocol !== 'https:' || app.hostname.endsWith('.example') || app.pathname !== '/') {
    throw new Error('실제 Vercel 배포 URL을 설정하세요.');
  }
  const results = [];
  // 심판이 실제 요청과 대조할 수 있게 기록에 "보낸 요청(방법·주소) + 받은 상태 + 요청 ID"를 남깁니다.
  // 요청 ID는 이 점검이 만든 UUID를 x-request-id 헤더로 함께 보낸 값입니다(응답 내용·토큰은 기록하지 않음).
  const sent = async (attackId, expected, url, headers = {}) => {
    const requestId = randomUUID();
    const target = new URL(url);
    const response = await fetch(target, { method: 'GET', headers: { ...headers, 'x-request-id': requestId }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    results.push({ attackId, expected, observed: `GET ${target.origin}${target.pathname} → HTTP ${response.status} · x-request-id ${requestId}` });
    return response;
  };
  const notRun = (attackId, expected) => results.push({ attackId, expected, observed: NOT_RUN });
  const at = path => new URL(path, app);

  // 1단계: 공개 정적 메모 파일
  await sent('static_note_exposure', '공개 정적 메모 파일 GET 404', at('/data.json'));
  // 3단계: 무토큰 메모 목록
  await sent('anonymous_api_access', '무토큰 메모 목록 GET 401', at('/api/notes'));
  notRun('anonymous_api_post', '무토큰 메모 생성 POST 401 (쓰기 요청이라 보내지 않음)');
  // 5단계: 원본 Data API를 공개 키(anon)로 직접 조회. 공개 키는 화면용 공개 설정에서 받습니다.
  const configResponse = await sent('public_auth_config', '화면용 공개 로그인 설정 GET 200', at('/api/auth-config'));
  let publishableKey = '';
  try { publishableKey = (await configResponse.json())?.publishableKey ?? ''; } catch {}
  const directUrl = config.step >= 5 && typeof config.originalApiUrl === 'string' ? config.originalApiUrl : '';
  if (directUrl && publishableKey) {
    await sent('direct_data_api_anon', '원본 Data API anon GET 401 또는 403', directUrl, { apikey: publishableKey });
  } else {
    notRun('direct_data_api_anon', '원본 Data API anon GET 401 또는 403 (공개 키를 읽지 못해 보내지 않음)');
  }
  // 1단계: 배포 식별 파일
  await sent('deployment_identity', '배포 식별 파일 /aleph.json GET 200', at('/aleph.json'));
  // 8·10단계: 쓰기 경로는 보내지 않음
  if (config.step >= 8) {
    notRun('notice_write_direct_api', '반 공지 직접 PUT 401 또는 403 (쓰기 요청이라 보내지 않음)');
    notRun('admin_notice_body_role', '본문 role 주장으로 강사 관리 경로 PUT 401 또는 403 (쓰기 요청이라 보내지 않음)');
  }
  if (config.step >= 10) notRun('restore_route_anonymous', '무토큰 복구 POST 401 (쓰기 요청이라 보내지 않음)');
  // 11단계: 설치형 앱 설정은 공개, 기기 상태는 로그인 필요
  if (config.step >= 11) {
    await sent('install_manifest_public', '설치형 앱 manifest GET 200', at('/manifest.webmanifest'));
    await sent('device_status_anonymous', '무토큰 기기 상태 GET 401', at('/api/device'));
    notRun('device_approval_body_claim', '무토큰 + 본문 approved 주장 기기 승인 POST 401 (쓰기 요청이라 보내지 않음)');
  }
  // 12단계: 탈환 작전실은 로그인 없이 아무것도 보여 주지 않음
  if (config.step >= 12) await sent('ops_room_anonymous', '무토큰 탈환 작전실 GET 401', at('/api/ops'));
  // 첫 화면 (nosniff 헤더 확인은 npm run ops:regress 표에 기록)
  await sent('security_header', '첫 화면 GET 200', at('/'));
  return results;
}
