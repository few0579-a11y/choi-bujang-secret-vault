// 보너스 xdr-06 제작 3: 자료 빼돌리기(유출) 판단 모듈.
// 심판은 인터넷 없이 이 파일 하나만 불러옵니다. import·파일 읽기/쓰기·바깥 요청을 하지 않습니다.
// 아래 PATTERNS 는 xdr/exfiltration/patterns.json 을 옮겨 적은 상수입니다(두 곳을 함께 고칩니다).
// 판정기 연결과 alerts.log 기록은 respond.mjs 가 합니다. 이 파일은 판단 결과만 돌려줍니다.

const PATTERNS = Object.freeze([
  Object.freeze({ name: 'bulk_transfer_new_destination', technique: 'T1048', act: (t) => /처음\s*보는|외부\s*주소|같은\s*목적지|평소에?\s*쓰지\s*않던\s*포트|자료실\s*전체/u.test(t) }),
  Object.freeze({ name: 'off_hours_archive_exfil', technique: 'T1560', act: (t) => /압축\s*파일/u.test(t) && /(?:수업|업무)\s*시간\s*밖|처음\s*보는|연속|두\s*곳/u.test(t) }),
  Object.freeze({ name: 'c2_channel_exfil', technique: 'T1041', act: (t) => /명령\s*통로/u.test(t) }),
]);
const TECHNIQUES = /^T(?:1041|1048|1567|1020|1030|1560)(?:\.\d{3})?$/u;
const MIN_LEVEL = 10;
const MIN_BYTES = 50_000_000;
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const ALERT_CEILING = 0.84;

// 수상한 맥락
const SIGNALS = Object.freeze([
  Object.freeze({ key: '처음 보는 목적지', test: (t) => /처음\s*보는\s*(?:목적지|주소)|외부\s*주소/u.test(t) }),
  Object.freeze({ key: '시간 밖', test: (t) => /(?:수업|업무)\s*시간\s*밖/u.test(t) }),
  Object.freeze({ key: '반복 전송', test: (t, s) => s.repeats >= 5 || /반복|연속/u.test(t) }),
  Object.freeze({ key: '평소 안 쓰는 포트', test: (t) => /평소에?\s*쓰지\s*않던\s*포트/u.test(t) }),
  Object.freeze({ key: '다량 파일', test: (t, s) => s.files >= 50 || /자료실\s*전체/u.test(t) }),
  Object.freeze({ key: '짧은 시간', test: (t) => /\d+\s*분\s*안에|짧은\s*시간/u.test(t) }),
]);
// 평소 목적지·수업 자료 주소·실패·외부 전송 없음·1건뿐은 막지 않습니다.
const WEAK = /평소\s*목적지|수업\s*자료\s*주소|실패\s*\d*\s*건으로|외부\s*전송은\s*아직\s*없|큰\s*파일은\s*아닙|일부만|백업처럼/u;
const NORMAL = /수업\s*자료\s*주소로\s*작은\s*동기화|파일\s*전송은\s*없/u;

const toInt = (value) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,13}$/u.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
};

function read(alert) {
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const description = typeof rule.description === 'string' ? rule.description.slice(0, 300) : '';
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const level = Number.isInteger(rule.level) ? rule.level : 0;
  let files = toInt(data.files) ?? 0;
  const m = description.match(/자료\s*(\d{1,6})\s*건/u);
  if (m) files = Math.max(files, Number(m[1]));
  const s = { bytes: toInt(data.bytes) ?? 0, files, repeats: toInt(data.count) ?? 1 };
  const repeatMatch = description.match(/(\d{1,6})\s*번/u);
  if (repeatMatch) s.repeats = Math.max(s.repeats, Number(repeatMatch[1]));
  return {
    ...s,
    isExfil: mitre.some((t) => TECHNIQUES.test(t)),
    level,
    acts: PATTERNS.filter((p) => p.act(description)).map((p) => p.name),
    signals: SIGNALS.filter((x) => x.test(description, s)).map((x) => x.key),
    weak: WEAK.test(description),
    normal: NORMAL.test(description),
  };
}

const round = (n) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
const mb = (n) => (n >= 1_000_000 ? `${Math.round(n / 1_000_000)}MB` : `${Math.round(n / 1000)}KB`);

export function decide(alert) {
  const s = read(alert);
  if (!s.isExfil) {
    return { action: 'record', confidence: round(0.02 + s.level / 100), reason: '유출(T1041·T1048) 경보 아님 — 정상 이벤트로 기록' };
  }
  if (s.normal || (s.level <= 3 && s.bytes < 1_000_000)) {
    return { action: 'record', confidence: round(0.1 + s.level / 100), reason: '평소 목적지의 작은 동기화 — 정상 이벤트로 기록' };
  }

  const big = s.bytes >= MIN_BYTES || s.files >= 50;
  const name = s.acts[0] ?? 'bulk_transfer_new_destination';
  if (big && s.acts.length && s.signals.length && !s.weak) {
    let score = 0.86 + Math.min(0.08, (s.signals.length - 1) * 0.03) + Math.min(0.04, s.bytes / 10_000_000_000) + (s.acts.length > 1 ? 0.02 : 0);
    if (s.level < MIN_LEVEL) score -= 0.3; // 규칙 수준이 낮으면 뚜렷하지 않음
    if (score >= BLOCK_AT) {
      return { action: 'block', confidence: round(score), reason: `${s.acts.join('+')}: ${mb(s.bytes)} · 파일 ${s.files || '?'}개 · ${s.signals.join('·')} · 수준 ${s.level}` };
    }
  }

  // 유출 경보지만 작은 파일·1건·평소 목적지·실패면 알림만 남깁니다.
  const confidence = Math.min(ALERT_CEILING, ALERT_AT + s.level / 100 + s.signals.length * 0.03);
  const why = s.weak ? '평소 목적지·실패·일부 전송 등 약한 신호' : !big ? `작은 전송 ${mb(s.bytes)}` : !s.signals.length ? '수상한 맥락 없음' : `수준 ${s.level}(기준 ${MIN_LEVEL} 미만)`;
  return { action: 'alert', confidence: round(confidence), reason: `${name} 약한 일치(${why}) — 사람이 확인` };
}
