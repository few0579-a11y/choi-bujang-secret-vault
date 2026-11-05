// 8단계: 자료 구역과 자원 ID, 거부 사유 기록을 한곳에 둡니다.
// 구역마다 자원 ID 접두어가 달라서 서버가 요청마다 어떤 구역의 자료인지 구별할 수 있습니다.
export const ZONES = Object.freeze({ note: 'note', notice: 'notice' });

export const noteResourceId = id => `${ZONES.note}:${id}`;
export const noticeResourceId = id => `${ZONES.notice}:${id}`;

// 클라이언트가 보낸 권한 주장은 믿지 않습니다. 본문에 들어 있으면 거부합니다.
export const CLAIM_FIELDS = Object.freeze(['owner_id', 'role', 'updated_by']);
export const hasClaimField = input => !!input && typeof input === 'object'
  && CLAIM_FIELDS.some(field => Object.prototype.hasOwnProperty.call(input, field));

// 거부 사유를 짧게 남깁니다. 사용자 ID·토큰·자료 본문은 기록하지 않습니다.
export function denyAccess(response, { status, error, reason, route }) {
  console.warn('access_denied', { route, reason });
  return response.status(status).json({ error, reason });
}
