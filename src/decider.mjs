// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
// docs/DECIDER_REQUEST.md 계약의 이름(deviceRegistered, stepUp, recentEvents, signals 등)만 읽습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required', 'resource_zone', 'request_integrity']);

// 7단계 제작 1: 엔진이 검증해 넘긴 가상 접속 정보만 신호로 인정합니다.
// 'judge_fixture'는 심판이 보낸 가상 사건이며 실제 위치 증거가 아닙니다.
// 그 밖의 출처(브라우저·클라이언트 헤더 등)나 형식이 어긋난 값은 '근거 없음'으로 두고 정상값으로 채우지 않습니다.
const TRUSTED_SIGNAL_SOURCES = new Set(['judge_fixture']);
const LABEL = /^[a-z][a-z0-9_-]{0,31}$/u;

function readSignals(request) {
  const raw = request.signals;
  const none = { trusted: false, region: null, network: null, hour: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return none;
  if (typeof raw.source !== 'string' || !TRUSTED_SIGNAL_SOURCES.has(raw.source)) return none;
  const label = value => (typeof value === 'string' && LABEL.test(value) && value !== 'unknown' ? value : null);
  const hour = Number.isInteger(raw.hour) && raw.hour >= 0 && raw.hour <= 23 ? raw.hour : null;
  return { trusted: true, region: label(raw.region), network: label(raw.network), hour };
}

function readRecentEvents(request) {
  if (!Array.isArray(request.recentEvents)) return [];
  return request.recentEvents.slice(0, 12).filter(event => event && typeof event === 'object'
    && typeof event.kind === 'string'
    && Number.isFinite(event.ageSeconds) && event.ageSeconds >= 0
    && Number.isInteger(event.count) && event.count >= 0);
}

function freshStepUp(request) {
  const s = request.stepUp;
  return !!s && typeof s === 'object' && s.verified === true
    && Number.isFinite(s.authAgeSeconds) && s.authAgeSeconds >= 0 && s.authAgeSeconds <= 300;
}

// 7단계 제작 2: 평소와 다른 시각 · 처음 보는 네트워크 · 지역 급변 · 짧은 시간 대량 요청 중
// 두 가지 이상이 겹치면 추가 확인(step_up)을 요구합니다. 지역 하나만으로는 거부하지 않습니다.
const BURST_COUNT = 10;
const BURST_WINDOW_SECONDS = 300;

function anomalyReasons(request) {
  const signals = readSignals(request);
  const reasons = [];
  if (signals.trusted) {
    if (signals.hour !== null && signals.hour < 6) reasons.push('unusual_hour');
    if (signals.network !== null && signals.network !== 'usual') reasons.push('new_network');
    if (signals.region !== null && signals.region !== 'local') reasons.push('region_change');
  }
  const burst = readRecentEvents(request)
    .filter(event => event.ageSeconds <= BURST_WINDOW_SECONDS)
    .reduce((sum, event) => sum + event.count, 0);
  if (burst >= BURST_COUNT) reasons.push('request_burst');
  return reasons;
}


// 8단계 제작 2: 자료 구역 규칙. 엔진이 확인한 service·method·path·route만 봅니다.
// - 메모(notes): 자료 ID 하나를 고르는 경로만 허용. ID 없는 전체 목록·생성 경로는 거부.
//   메모 주인 비교는 판정기가 아니라 자료 API(api/notes/[id].js)에서 합니다.
// - 반 공지(notices): 읽기(GET)만 허용. 쓰기는 누구에게나 거부. 강사 수정은 서버 관리 경로에서 처리.
// - 강사 자료(materials)와 알 수 없는 서비스·경로: 모두 거부.
// 쿼리 문자열로 기능을 고르지 않으며, 메모 ID 형식(UUID 여부)은 좁히지 않습니다.
// 10단계: 메모 한 건 복원(POST /notes/:id/restore)만 추가로 허용합니다. 주인 확인과 해시 대조는 API·DB에서 합니다.
const ONE_SEGMENT = '[^/?#]+';
const ZONE_RULES = Object.freeze([
  { service: 'notes', routes: ['GET /notes/:id', 'PUT /notes/:id', 'DELETE /notes/:id', 'POST /notes/:id/restore'] },
  { service: 'notices', routes: ['GET /notices', 'GET /notices/:id'] },
]);

function routePattern(shape) {
  const [method, template] = shape.split(' ');
  const body = template.split('/').map(part => (part === ':id' ? ONE_SEGMENT : part)).join('/');
  return { method, template, path: new RegExp(`^(?:/api)?${body}$`, 'u') };
}

const ALLOWED = ZONE_RULES.flatMap(rule => rule.routes.map(shape => ({ service: rule.service, ...routePattern(shape) })));

function zoneAllows(request) {
  const { service, method, path, route } = request;
  if (typeof service !== 'string' || typeof method !== 'string'
      || typeof path !== 'string' || typeof route !== 'string') return false;
  const routeMatch = /^([A-Z]+) (?:\/api)?(\/[^?#\s]*)$/u.exec(route);
  if (!routeMatch) return false;
  return ALLOWED.some(rule => rule.service === service
    && rule.method === method && routeMatch[1] === method
    && routeMatch[2] === rule.template
    && rule.path.test(path));
}

// 11단계: 엔진이 기기 서명을 확인한 뒤 넘긴 요청의 "모양"을 다시 대조합니다.
// 서명 뒤 경로·쿼리가 바뀌었거나 계약에 없는 이름이 끼어 있으면 허용하지 않습니다.
// 서명 검증 자체와 본문 대조는 엔진(릴레이)의 일이며, 판정기는 계약 18개 이름만 읽습니다.
const CONTRACT_KEYS = new Set(['schema', 'requestId', 'classId', 'projectId', 'subjectId', 'deviceId',
  'service', 'method', 'path', 'route', 'queryLength', 'querySha256', 'at', 'policyRevision',
  'deviceRegistered', 'stepUp', 'recentEvents', 'signals']);
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const DEVICE_ID = /^[0-9a-f]{16}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const UNSAFE_PATH = /%2f|%5c|\\|\/\.{1,2}(?:\/|$)|\/\//iu;

function requestIntact(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return false;
  if (Object.keys(request).some(key => !CONTRACT_KEYS.has(key))) return false;
  if (request.schema !== 'aleph.decision.v1') return false;
  if (typeof request.deviceId !== 'string' || !DEVICE_ID.test(request.deviceId)) return false;
  if (typeof request.path !== 'string' || !request.path.startsWith('/') || UNSAFE_PATH.test(request.path)) return false;
  if (!Number.isInteger(request.queryLength) || request.queryLength < 0) return false;
  if (typeof request.querySha256 !== 'string' || !SHA256_HEX.test(request.querySha256)) return false;
  // 쿼리가 비었다고 하면서 지문이 빈 문자열의 지문이 아니면, 서명 뒤 쿼리가 바뀐 것으로 봅니다.
  if (request.queryLength === 0 && request.querySha256 !== EMPTY_SHA256) return false;
  return true;
}

const respond = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1',
  requestId: request.requestId,
  decision,
  reasonCode,
  ruleIds,
});

export async function decide(request) {
  if (!requestIntact(request)) {
    return respond(request ?? {}, 'deny', 'request_integrity_failed', [RULE_IDS[3]]);
  }

  if (request.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', [RULE_IDS[0]]);
  }

  if (!zoneAllows(request)) {
    return respond(request, 'deny', 'zone_not_allowed', [RULE_IDS[2]]);
  }

  // 사유(어떤 신호가 겹쳤는지)는 응답 다섯 항목을 바꾸지 않기 위해 reasonCode와 ruleIds로만 남깁니다.
  const reasons = anomalyReasons(request);
  if (reasons.length >= 2 && !freshStepUp(request)) {
    return respond(request, 'step_up', 'step_up_required', [RULE_IDS[1]]);
  }

  return respond(request, 'allow', 'approved', [...RULE_IDS]);
}
