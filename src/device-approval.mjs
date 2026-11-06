import { createHash, randomBytes, randomInt } from 'node:crypto';

// 11단계: 기기 승인. 승인 여부는 서버(DB)가 정합니다.
// - 기기 증명값은 서버가 만든 무작위 값이며, JS가 읽을 수 없는 HttpOnly 쿠키로만 브라우저에 둡니다.
//   localStorage·sessionStorage·IndexedDB에는 넣지 않습니다.
// - DB에는 증명값 원문이 아니라 SHA-256 지문만 저장합니다.
// - 승인은 화면 버튼이 아니라, 자료실 주인이 Supabase에서 승인 코드를 승인해야 이루어집니다.
// - 앱 설치(manifest) 여부는 승인 근거로 쓰지 않습니다.
export const DEVICE_COOKIE = '__Host-vault_device';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const hashDeviceToken = token => createHash('sha256').update(token).digest('hex');

export function readDeviceToken(request) {
  let raw = request.headers?.cookie;
  if (Array.isArray(raw)) raw = raw.join('; ');
  if (typeof raw !== 'string') return null;
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === DEVICE_COOKIE) {
      const value = part.slice(index + 1).trim();
      return TOKEN.test(value) ? value : null;
    }
  }
  return null;
}

export function issueDeviceToken(response) {
  const token = randomBytes(32).toString('base64url');
  response.setHeader('Set-Cookie',
    `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; Secure; SameSite=Strict`);
  return token;
}

export function newApprovalCode() {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  const half = () => Array.from({ length: 4 }, pick).join('');
  return `${half()}-${half()}`;
}

// 이 기기가 이 사용자의 승인된 기기인지 DB로 확인합니다. 쿠키가 없거나 승인 전·취소면 null.
export async function findDevice(db, userId, token) {
  if (!token) return null;
  const { data, error } = await db.from('device_approvals')
    .select('id,status,approval_code,created_at,approved_at')
    .eq('user_id', userId).eq('device_hash', hashDeviceToken(token)).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function isApprovedDevice(db, userId, request) {
  const device = await findDevice(db, userId, readDeviceToken(request));
  return device?.status === 'approved';
}
