// 보너스 xdr-04 제작 3: 몰래 심은 프로그램(지속성) 판단 모듈.
// 심판은 인터넷 없이 이 파일 하나만 불러옵니다. import·파일 읽기/쓰기·바깥 요청을 하지 않습니다.
// 아래 PATTERNS 는 xdr/persistence/patterns.json 을 옮겨 적은 상수입니다(두 곳을 함께 고칩니다).
// 판정기 연결과 alerts.log 기록은 respond.mjs 가 합니다. 이 파일은 판단 결과만 돌려줍니다.

const PATTERNS = Object.freeze([
  Object.freeze({ name: 'unsigned_service_from_temp', technique: 'T1543.003', mechanism: /서비스/u }),
  Object.freeze({ name: 'suspicious_scheduled_task', technique: 'T1053.005', mechanism: /예약\s*작업|schtask|scheduled/iu }),
  Object.freeze({ name: 'startup_folder_autostart', technique: 'T1547.001', mechanism: /시작\s*(?:폴더|프로그램|항목)|Start\s*Menu\\Programs\\Startup|\\Run\b/iu }),
]);
const TECHNIQUES = /^T(?:1543|1053|1547)(?:\.\d{3})?$/u;
const MIN_LEVEL = 10;
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const ALERT_CEILING = 0.84;

// 수상한 신호(지속 기법과 겹치면 뚜렷함)
const SIGNALS = Object.freeze([
  Object.freeze({ key: '서명 없음', test: (t) => /서명\s*(?:이\s*)?없/u.test(t) }),
  Object.freeze({ key: '임시 폴더', test: (t, p) => /임시\s*폴더/u.test(t) || /\\(?:AppData\\Local\\)?Temp\\/iu.test(p) }),
  Object.freeze({ key: '처음 봄', test: (t) => /처음\s*보는|평소\s*목록에\s*없|임의\s*문자열/u.test(t) }),
  Object.freeze({ key: '재부팅 뒤 유지', test: (t) => /다시\s*켜도\s*남/u.test(t) }),
  Object.freeze({ key: '실행 파일 바뀜', test: (t) => /실행\s*파일이\s*바뀌/u.test(t) }),
  Object.freeze({ key: '시간 밖 실행', test: (t) => /(?:수업|업무)\s*시간\s*밖/u.test(t) }),
  Object.freeze({ key: '여러 기법이 같은 파일', test: (t) => /같은\s*(?:임시\s*)?파일을\s*함께/u.test(t) }),
  Object.freeze({ key: '원격 연속 등록', test: (t) => /원격\s*주소.*연속/u.test(t) }),
]);
// 기존·평소·서명된 항목은 정상 운영으로 봅니다.
const NORMAL = /기존\s*.*(?:서명된|마쳤|그대로)|평소\s*(?:시각|저장소)|서명된\s*채로|읽기만/u;
// "등록은 없다·실행 기록은 없다·설명만 바뀜·수업 도구"처럼 한쪽 신호만 있는 경보는 막지 않습니다.
const WEAK = /등록은\s*없|실행된\s*기록은\s*없|설명만|그대로입니다|수업\s*(?:중|도구|과제|시간입니다)|서명은\s*(?:확인되지\s*않|아직\s*모)|같은\s*파일로\s*다시/u;

const toInt = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,6}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function read(alert) {
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const description = typeof rule.description === 'string' ? rule.description.slice(0, 300) : '';
  const path = typeof data.path === 'string' ? data.path.slice(0, 400) : '';
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const level = Number.isInteger(rule.level) ? rule.level : 0;
  const text = `${description} ${path}`;
  return {
    isPersistence: mitre.some((t) => TECHNIQUES.test(t)),
    level,
    repeats: toInt(data.count) ?? 1,
    mechanisms: PATTERNS.filter((p) => p.mechanism.test(text)).map((p) => p.name),
    signals: SIGNALS.filter((s) => s.test(description, path)).map((s) => s.key),
    normal: NORMAL.test(description),
    weak: WEAK.test(description),
  };
}

const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export function decide(alert) {
  const s = read(alert);
  if (!s.isPersistence) {
    return { action: 'record', confidence: round(0.02 + s.level / 100), reason: '지속 기법(T1543·T1053·T1547) 경보 아님 — 정상 이벤트로 기록' };
  }
  if (s.normal || (s.level <= 3 && s.signals.length === 0)) {
    return { action: 'record', confidence: round(0.1 + s.level / 100), reason: '기존·평소 운영 항목(서명됨·평소 시각) — 정상 이벤트로 기록' };
  }

  const name = s.mechanisms[0] ?? (s.signals.includes('임시 폴더') ? 'unsigned_service_from_temp' : 'suspicious_scheduled_task');
  if (s.mechanisms.length && s.signals.length && !s.weak) {
    let score = 0.86 + Math.min(0.08, (s.signals.length - 1) * 0.04) + (s.mechanisms.length > 1 ? 0.03 : 0) + Math.min(0.03, (s.repeats - 1) / 100);
    if (s.level < MIN_LEVEL) score -= 0.3; // 규칙 수준이 낮으면 뚜렷하지 않음
    if (score >= BLOCK_AT) {
      return { action: 'block', confidence: round(score), reason: `${s.mechanisms.join('+')}: ${s.signals.join('·')} · 수준 ${s.level}` };
    }
  }

  // 지속 기법 경보지만 신호가 한쪽뿐이거나 수업 도구·서명 미확인이면 알림만 남깁니다.
  const confidence = Math.min(ALERT_CEILING, ALERT_AT + s.level / 100 + s.signals.length * 0.03);
  const why = s.weak ? '한쪽 신호만 있음' : !s.signals.length ? '수상한 신호 없음' : !s.mechanisms.length ? '지속 등록 없음' : `수준 ${s.level}(기준 ${MIN_LEVEL} 미만)`;
  return { action: 'alert', confidence: round(confidence), reason: `${name} 약한 일치(${why}) — 사람이 확인` };
}
