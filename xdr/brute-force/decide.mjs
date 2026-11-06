// 보너스 제작 3: 무차별 로그인 판단 모듈.
// 심판은 인터넷 없이 이 파일 하나만 불러옵니다. import·파일 읽기/쓰기·바깥 요청을 하지 않습니다.
// 아래 PATTERNS 는 xdr/brute-force/patterns.json 을 그대로 옮겨 적은 상수입니다(두 곳을 함께 고칩니다).
// 판정기 연결과 alerts.log 기록은 respond.mjs 가 합니다. 이 파일은 판단 결과만 돌려줍니다.

const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'rapid_failures_same_source',
    technique: 'T1110.001',
    minFailures: 30,
    minLevel: 10,
  }),
  Object.freeze({
    name: 'password_spray_many_accounts',
    technique: 'T1110.003',
    minAccounts: 8,
    minLevel: 10,
  }),
]);
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const ALERT_CEILING = 0.84; // 패턴 기준을 못 넘은 경보는 확신도가 block 선을 넘지 않게 합니다.

const toInt = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,6}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function read(alert) {
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const description = typeof rule.description === 'string' ? rule.description.slice(0, 300) : '';
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const level = Number.isInteger(rule.level) ? rule.level : 0;

  let failures = toInt(data.count);
  if (failures === null) {
    const m = description.match(/실패\D{0,6}?(\d{1,6})\s*건/u);
    failures = m ? Number(m[1]) : 0;
  }

  let accounts = 0;
  if (typeof data.accounts === 'string') {
    accounts = new Set(data.accounts.split(',').map((s) => s.trim()).filter(Boolean)).size;
  }
  const m = description.match(/계정\s*(\d{1,5})\s*개/u);
  if (m) accounts = Math.max(accounts, Number(m[1]));
  if (/두\s*계정/u.test(description)) accounts = Math.max(accounts, 2);

  return {
    isT1110: mitre.some((t) => t === 'T1110' || t.startsWith('T1110.')),
    level,
    failures,
    accounts,
    succeededAfter: /뒤에?\s*(?:다시\s*)?(?:로그인이\s*)?성공/u.test(description),
  };
}

function scorePattern(pattern, s) {
  let score = 0;
  if (pattern.minFailures && s.failures >= pattern.minFailures) {
    score = 0.86 + Math.min(0.12, (s.failures - pattern.minFailures) / 500);
  }
  if (pattern.minAccounts && s.accounts >= pattern.minAccounts) {
    score = 0.88 + Math.min(0.1, (s.accounts - pattern.minAccounts) / 200);
  }
  if (score === 0) return 0;
  if (s.level < pattern.minLevel) score -= 0.3; // 규칙 수준이 낮으면 뚜렷하지 않음
  if (s.succeededAfter) score = Math.min(score, ALERT_CEILING); // 실패 뒤 성공 = 본인일 수도, 탈취일 수도 → 사람이 봄
  return score;
}

const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export function decide(alert) {
  const s = read(alert);
  if (!s.isT1110) {
    return { action: 'record', confidence: round(0.02 + s.level / 100), reason: '무차별 대입(T1110) 경보 아님 — 정상 이벤트로 기록' };
  }

  let best = { name: '', score: 0 };
  for (const pattern of PATTERNS) {
    const score = scorePattern(pattern, s);
    if (score > best.score) best = { name: pattern.name, score };
  }
  if (best.score >= BLOCK_AT) {
    return { action: 'block', confidence: round(best.score), reason: `${best.name}: 실패 ${s.failures || "?"}건 · 계정 ${s.accounts || 1}개 · 수준 ${s.level}` };
  }

  if (s.failures >= 3 || s.level >= 5 || best.score > 0) {
    const weak = s.accounts >= 2 ? 'password_spray_many_accounts' : 'rapid_failures_same_source';
    const confidence = Math.max(best.score, Math.min(ALERT_CEILING, ALERT_AT + s.failures / 40 + s.level / 100));
    const why = s.succeededAfter ? '실패 뒤 성공' : '기준 미달';
    return { action: 'alert', confidence: round(confidence), reason: `${weak} 약한 일치(${why}): 실패 ${s.failures}건 · 수준 ${s.level}` };
  }

  return { action: 'record', confidence: round(0.3), reason: 'T1110 경보지만 실패가 거의 없음 — 기록만' };
}
