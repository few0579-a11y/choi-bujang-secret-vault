// 보너스 xdr-03 제작 3: 알려진 취약점(CVE-2021-44228 형태) 판단 모듈.
// 심판은 인터넷 없이 이 파일 하나만 불러옵니다. import·파일 읽기/쓰기·바깥 요청을 하지 않습니다.
// 아래 PATTERNS 는 xdr/known-cve/patterns.json 을 옮겨 적은 상수입니다(두 곳을 함께 고칩니다).
// 원격 조회 구문은 "들어 있는지"만 봅니다. 해석·실행·변형·전달하지 않습니다.
// 판정기 연결과 alerts.log 기록은 respond.mjs 가 합니다. 이 파일은 판단 결과만 돌려줍니다.

// 완전한 원격 조회 구문: 여는 표식 "${" 뒤에 jndi 와 조회 방식(ldap·rmi·dns 등)과 "://" 가 이어짐.
// 글자 사이에 끼운 중첩 표식(${lower:j}, ${::-n} 같은 우회)은 먼저 한 글자로 풀어 같은 구문으로 봅니다.
const LOOKUP = /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns|iiop|nis|nds|corba|https?)\s*:\/\//iu;
const NESTED = /\$\{[^${}]{0,30}?[:-]([^${}:-]{1,3})\}/gu;
function unwrap(value) {
  let text = value;
  for (let i = 0; i < 6; i += 1) {
    const next = text.replace(NESTED, '$1');
    if (next === text) break;
    text = next;
  }
  return text;
}

const PATTERNS = Object.freeze([
  Object.freeze({ name: 'jndi_lookup_in_header', technique: 'T1190', fields: Object.freeze(['useragent', 'referer', 'header', 'headers', 'xforwardedfor']) }),
  Object.freeze({ name: 'jndi_lookup_in_param', technique: 'T1190', fields: Object.freeze(['url', 'query', 'body', 'param', 'params']) }),
  Object.freeze({ name: 'cve_scanner_probe', technique: 'T1595.002', probe: /점검\s*(?:흔적|도구)|probe|scanner|\/health\?/iu }),
]);
const MIN_LEVEL = 10;
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const ALERT_CEILING = 0.84;

// 설명에 "구문은 없다·완전하지 않다"라고 밝힌 경보는 막지 않습니다.
const NO_EXPLOIT = /(?:조회|악용)\s*구문은\s*없|완전한\s*구문은\s*아니|구문은\s*없습니다/u;

const toInt = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,6}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const str = (v) => (typeof v === 'string' ? v.slice(0, 1000) : '');

function read(alert) {
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const description = str(rule.description).slice(0, 300);
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const level = Number.isInteger(rule.level) ? rule.level : 0;

  const lookupIn = (fields) => fields.some((f) => LOOKUP.test(unwrap(str(data[f]))));
  const matched = [];
  if (lookupIn(PATTERNS[0].fields)) matched.push(PATTERNS[0].name);
  if (lookupIn(PATTERNS[1].fields)) matched.push(PATTERNS[1].name);
  const anyLookup = matched.length > 0;
  const probe = PATTERNS[2].probe.test(`${description} ${str(data.url)}`);
  if (anyLookup && probe) matched.push(PATTERNS[2].name);

  let repeats = toInt(data.count);
  if (repeats === null) {
    const m = description.match(/(\d{1,6})\s*(?:번|회|건)/u);
    repeats = m ? Number(m[1]) : 1;
  }
  return {
    isT1190: mitre.some((t) => t === 'T1190' || t.startsWith('T1190.') || t.startsWith('T1595')),
    level,
    repeats,
    matched,
    anyLookup,
    noExploit: NO_EXPLOIT.test(description),
    mentionsCve: /CVE-\d{4}-\d{4,}|jndi|log4j|라이브러리|취약점|조회\s*형태|중괄호|점검/iu.test(`${description} ${str(data.url)}`),
  };
}

const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

export function decide(alert) {
  const s = read(alert);
  if (!s.isT1190 && !s.anyLookup) {
    return { action: 'record', confidence: round(0.02 + s.level / 100), reason: '알려진 취약점 악용(T1190) 경보 아님 — 정상 요청으로 기록' };
  }

  if (s.anyLookup && !s.noExploit) {
    let score = 0.9 + Math.min(0.05, (s.repeats - 1) / 100) + (s.matched.length > 1 ? 0.03 : 0);
    if (s.level < MIN_LEVEL) score -= 0.3; // 규칙 수준이 낮으면 뚜렷하지 않음
    if (score >= BLOCK_AT) {
      return { action: 'block', confidence: round(score), reason: `${s.matched.join('+')}: CVE-2021-44228 형태 원격 조회 구문 · 반복 ${s.repeats}번 · 수준 ${s.level}` };
    }
  }

  // T1190 경보지만 CVE 이름·jndi 단어·중괄호·잘린 조각처럼 완전한 구문이 없으면 알림만 남깁니다.
  const name = s.matched[0] ?? (/점검|probe|tool/iu.test(JSON.stringify(alert?.data ?? {})) ? 'cve_scanner_probe' : 'jndi_lookup_in_param');
  const confidence = Math.min(ALERT_CEILING, ALERT_AT + s.level / 100 + Math.min(s.repeats, 10) / 100 + (s.mentionsCve ? 0.03 : 0));
  const why = s.anyLookup ? `수준 ${s.level}(기준 ${MIN_LEVEL} 미만)` : '완전한 원격 조회 구문 없음';
  return { action: 'alert', confidence: round(confidence), reason: `${name} 약한 일치(${why}) — 사람이 확인` };
}
