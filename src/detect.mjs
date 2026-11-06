// 9단계 탐지 함수: 같은 가명 사용자의 조회(GET) 폭주를 찾아 권한 회수를 "제안"만 합니다.
// 계약: docs/DETECT_EVENTS.md — 사건마다 at · method · identity.sub 세 값만 읽습니다.
// 네트워크·기기·지역 값은 사건에 없으므로 만들거나 조건으로 쓰지 않습니다.
// 메모 내용·토큰·실명은 읽지도, 저장하거나 출력하지도 않습니다.
// 이 함수는 회수를 집행하지 않습니다(회수 API·기기 권한은 건드리지 않음).

export const BURST_WINDOW_MS = 10 * 60 * 1000; // 10분
export const BURST_LIMIT = 120;                 // 이 수를 "넘을 때만" 의심 (121건부터)

// 제작 1: 입력 처리 — 사건 하나에서 세 값만 꺼냅니다. 형식이 맞지 않는 사건은 세지 않습니다.
function readEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const time = typeof event.at === 'string' ? Date.parse(event.at) : NaN;
  const method = typeof event.method === 'string' ? event.method.toUpperCase() : '';
  const sub = event.identity && typeof event.identity.sub === 'string' ? event.identity.sub : '';
  if (!Number.isFinite(time) || !method || !sub) return null;
  return { time, method, sub };
}

// 제작 2: burst_read — 사용자별 GET 시각을 정렬한 뒤, 슬라이딩 창으로
// "어느 10분 구간"이든 121건 이상이 들어가는지 봅니다. 창 계산은 at 시각만 씁니다.
function hasBurst(times) {
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end] - times[start] >= BURST_WINDOW_MS) start += 1;
    if (end - start + 1 > BURST_LIMIT) return true;
  }
  return false;
}

export function detect(events) {
  if (!Array.isArray(events)) throw new TypeError('invalid_detection_events');

  const readsBySub = new Map(); // 다른 사용자의 사건은 합치지 않습니다.
  for (const raw of events) {
    const event = readEvent(raw);
    if (!event || event.method !== 'GET') continue;
    if (!readsBySub.has(event.sub)) readsBySub.set(event.sub, []);
    readsBySub.get(event.sub).push(event.time);
  }

  for (const [sub, times] of readsBySub) {
    times.sort((a, b) => a - b);
    // 제작 3: 의심이면 정확히 세 키만 돌려줍니다.
    if (hasBurst(times)) return { action: 'propose_revocation', reasonCode: 'burst_read', subject: sub };
  }
  return { action: 'observe' };
}
