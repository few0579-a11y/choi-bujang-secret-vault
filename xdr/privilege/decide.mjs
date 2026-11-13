// 보너스 xdr-05 제작 3: 권한 가로채기 판단 모듈.
// 심판은 인터넷 없이 이 파일 하나만 불러옵니다. import·파일 읽기/쓰기·바깥 요청을 하지 않습니다.
// 아래 PATTERNS 는 xdr/privilege/patterns.json 을 옮겨 적은 상수입니다(두 곳을 함께 고칩니다).
// 판정기 연결과 alerts.log 기록은 respond.mjs 가 합니다. 이 파일은 판단 결과만 돌려줍니다.

const ADMIN_GROUP = /^(?:administrators?|admins?|domain admins|sudo|wheel|root)$/iu;
const PATTERNS = Object.freeze([
  Object.freeze({ name: 'admin_group_added', technique: 'T1078.003', act: (t, g) => /관리자\s*그룹(?:에|으로)?\s*(?:추가|들어|다시)|관리자로\s*들어/u.test(t) || (ADMIN_GROUP.test(g) && /추가|들어/u.test(t)) }),
  Object.freeze({ name: 'unfamiliar_admin_command', technique: 'T1068', act: (t) => /관리자\s*명령|권한\s*명령|관리자\s*권한으로\s*바뀌/u.test(t) }),
  Object.freeze({ name: 'off_hours_privilege_use', technique: 'T1078', act: (t) => /(?:수업|업무)\s*시간\s*밖|업무처럼\s*보이지\s*않는\s*시각/u.test(t) }),
]);
const TECHNIQUES = /^T(?:1068|1078|1098|1548|1134)(?:\.\d{3})?$/u;
const MIN_LEVEL = 10;
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const ALERT_CEILING = 0.84;

// 수상한 맥락(권한 행동과 겹치면 뚜렷함)
const SIGNALS = Object.freeze([
  Object.freeze({ key: '원격·처음 보는 주소', test: (t) => /원격\s*주소|처음\s*보는\s*주소|주소는\s*처음/u.test(t) }),
  Object.freeze({ key: '평범한 계정', test: (t) => /평범한\s*계정/u.test(t) }),
  Object.freeze({ key: '방금 관리자가 됨', test: (t) => /방금\s*관리자가\s*된|곧바로\s*(?:권한|관리자)\s*명령|추가와\s*명령\s*실행이\s*같이/u.test(t) }),
  Object.freeze({ key: '다른 계정 권한', test: (t) => /다른\s*계정의\s*권한/u.test(t) }),
  Object.freeze({ key: '시간 밖', test: (t) => /(?:수업|업무)\s*시간\s*밖|업무처럼\s*보이지\s*않는\s*시각/u.test(t) }),
  Object.freeze({ key: '여러 계정 한꺼번에', test: (t, n) => n >= 2 && /계정\s*\d+\s*개/u.test(t) }),
  Object.freeze({ key: '빠졌다가 다시 들어옴', test: (t) => /빠진\s*계정이.*다시\s*관리자/u.test(t) }),
  Object.freeze({ key: '세션 권한 전환', test: (t) => /세션이\s*관리자\s*권한으로\s*바뀌/u.test(t) }),
]);
// 한쪽 신호뿐인 경보(수업 중·관리자 아닌 그룹·평소 주소·실패·변경 없음)는 막지 않습니다.
const WEAK = /수업\s*(?:시간에|중)|관리자\s*그룹은\s*아닙|평소\s*주소|변경은\s*없|명령은\s*없|실패\s*\d*\s*건으로|설명만|취소됐/u;

const toInt = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,6}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function read(alert) {
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const description = typeof rule.description === 'string' ? rule.description.slice(0, 300) : '';
  const group = typeof data.group === 'string' ? data.group.slice(0, 80) : '';
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const level = Number.isInteger(rule.level) ? rule.level : 0;
  const repeats = toInt(data.count) ?? 1;
  return {
    isPrivilege: mitre.some((t) => TECHNIQUES.test(t)),
    level,
    repeats,
    acts: PATTERNS.filter((p) => p.act(description, group)).map((p) => p.name),
    signals: SIGNALS.filter((s) => s.test(description, repeats)).map((s) => s.key),
    weak: WEAK.test(description) || (group !== '' && !ADMIN_GROUP.test(group)),
  };
}

const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export function decide(alert) {
  const s = read(alert);
  if (!s.isPrivilege) {
    return { action: 'record', confidence: round(0.02 + s.level / 100), reason: '권한 상승·계정 도용(T1068·T1078) 경보 아님 — 정상 이벤트로 기록' };
  }

  const name = s.acts[0] ?? 'unfamiliar_admin_command';
  if (s.acts.length && s.signals.length && !s.weak) {
    let score = 0.86 + Math.min(0.08, (s.signals.length - 1) * 0.04) + (s.acts.length > 1 ? 0.03 : 0) + Math.min(0.03, (s.repeats - 1) / 100);
    if (s.level < MIN_LEVEL) score -= 0.3; // 규칙 수준이 낮으면 뚜렷하지 않음
    if (score >= BLOCK_AT) {
      return { action: 'block', confidence: round(score), reason: `${s.acts.join('+')}: ${s.signals.join('·')} · 수준 ${s.level}` };
    }
  }

  // 권한 경보지만 맥락이 한쪽뿐이면(수업 중 취소·관리자 아닌 그룹·평소 주소·실패) 알림만 남깁니다.
  const confidence = Math.min(ALERT_CEILING, ALERT_AT + s.level / 100 + s.signals.length * 0.03);
  const why = s.weak ? '한쪽 신호만 있음' : !s.signals.length ? '수상한 맥락 없음' : !s.acts.length ? '관리자 권한 행동 없음' : `수준 ${s.level}(기준 ${MIN_LEVEL} 미만)`;
  return { action: 'alert', confidence: round(confidence), reason: `${name} 약한 일치(${why}) — 사람이 확인` };
}
