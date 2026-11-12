// 보너스 xdr-02 제작 3: 웹 주입 판단 모듈.
// 심판은 인터넷 없이 이 파일 하나만 불러옵니다. import·파일 읽기/쓰기·바깥 요청을 하지 않습니다.
// 아래 PATTERNS 는 xdr/web-injection/patterns.json 을 옮겨 적은 상수입니다(두 곳을 함께 고칩니다).
// 판정기 연결과 alerts.log 기록은 respond.mjs 가 합니다. 이 파일은 판단 결과만 돌려줍니다.

const PATTERNS = Object.freeze([
  Object.freeze({
    name: 'sql_injection_repeated',
    technique: 'T1190',
    // 설명·주소에 나오는 SQL 구문 표기(OR 조건, SELECT·UNION 이어 붙이기, 구문 연결)
    marker: /SQL\s*(?:구문|표식|표기)|데이터베이스\s*조회를?\s*이어|union\s+select|'\s*or\s+['\d]|sql-(?:chain|or|select)|select-chain/iu,
  }),
  Object.freeze({
    name: 'script_injection_repeated',
    technique: 'T1190',
    marker: /스크립트\s*(?:삽입|표식)|<\s*script|script-marker|mixed-marker/iu,
  }),
  Object.freeze({
    name: 'path_traversal_repeated',
    technique: 'T1190',
    marker: /거슬러\s*올라가|경로\s*이탈|\.\.[\\/]|up-repeat/iu,
  }),
  Object.freeze({
    name: 'command_separator_repeated',
    technique: 'T1190',
    marker: /명령\s*구분자|cmd-separator|;\s*(?:cat|ls|rm|wget|curl)\b|&&|\|\|/iu,
  }),
]);
const MIN_REPEATS = 8;
const MIN_LEVEL = 10;
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const ALERT_CEILING = 0.84; // 기준을 못 넘은 경보는 확신도가 block 선을 넘지 않게 합니다.

// "공격 표식이 아니다"라고 밝힌 경보(수업 단어, 표기 없음, 반복 없음)는 막지 않고 사람이 보게 합니다.
const NOT_ATTACK = /수업|아닙니다|공격\s*표기는\s*없|반복은\s*없|반복되지\s*않|정상\s*조회가\s*있/u;

const toInt = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,6}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};

function read(alert) {
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const description = typeof rule.description === 'string' ? rule.description.slice(0, 300) : '';
  const url = typeof data.url === 'string' ? data.url.slice(0, 500) : '';
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const level = Number.isInteger(rule.level) ? rule.level : 0;

  let repeats = toInt(data.count);
  if (repeats === null) {
    const m = description.match(/(\d{1,6})\s*(?:번|회|건)/u);
    repeats = m ? Number(m[1]) : 0;
  }

  const text = `${description} ${url}`;
  const matched = PATTERNS.filter((p) => p.marker.test(text)).map((p) => p.name);
  // 뚜렷한 표식이 없을 때 가장 가까운 패턴 이름(알림 이유에만 씁니다).
  const weakHint = /스크립트|script/iu.test(text) ? 'script_injection_repeated'
    : /경로|path|up\b|up-/iu.test(text) ? 'path_traversal_repeated'
      : /구분\s*문자|구분자/u.test(text) ? 'command_separator_repeated'
        : 'sql_injection_repeated';
  return {
    weakHint,
    isT1190: mitre.some((t) => t === 'T1190' || t.startsWith('T1190.')),
    level,
    repeats,
    matched,
    notAttack: NOT_ATTACK.test(description),
  };
}

const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export function decide(alert) {
  const s = read(alert);
  if (!s.isT1190) {
    return { action: 'record', confidence: round(0.02 + s.level / 100), reason: '외부 공개 앱 악용(T1190) 경보 아님 — 정상 요청으로 기록' };
  }

  const name = s.matched[0] ?? s.weakHint;
  if (s.matched.length && !s.notAttack && s.repeats >= MIN_REPEATS) {
    let score = 0.86 + Math.min(0.1, (s.repeats - MIN_REPEATS) / 100) + (s.matched.length > 1 ? 0.02 : 0);
    if (s.level < MIN_LEVEL) score -= 0.3; // 규칙 수준이 낮으면 뚜렷하지 않음
    if (score >= BLOCK_AT) {
      return { action: 'block', confidence: round(score), reason: `${s.matched.join('+')}: 같은 주소 반복 ${s.repeats}번 · 수준 ${s.level}` };
    }
  }

  // T1190 경보지만 1건뿐이거나, 수업 단어·따옴표처럼 약한 표식이면 막지 않고 알림으로 남깁니다.
  const confidence = Math.min(ALERT_CEILING, ALERT_AT + s.level / 100 + Math.min(s.repeats, 10) / 100 + (s.matched.length ? 0.05 : 0));
  const why = s.notAttack ? '공격 표식 아님 명시' : s.repeats < MIN_REPEATS ? `반복 ${s.repeats}번(기준 ${MIN_REPEATS}번 미만)` : `수준 ${s.level}(기준 ${MIN_LEVEL} 미만)`;
  return { action: 'alert', confidence: round(confidence), reason: `${name} 약한 일치(${why}) — 사람이 확인` };
}
