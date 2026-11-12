// 보너스 xdr-02 제작 1: 웹 주입 Wazuh 경보 읽기 모듈(확인용).
// xdr/fixtures/web-injection.json 을 읽어 시각·출발 주소·계정·규칙 수준·설명만 뽑습니다.
// 원본 경보는 고치지 않습니다. decide.mjs 는 이 파일을 불러오지 않습니다.
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 필요한 다섯 칸만 고르므로 비밀번호·토큰 같은 다른 칸은 처음부터 읽지 않습니다.
// 고른 칸 안에 토큰·키처럼 보이는 값(JWT 모양, 32자 이상 무작위 문자열)이 있으면 가립니다.
const SECRET_VALUE = /^(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|[A-Za-z0-9+/_=-]{32,})$/u;

function safe(value) {
  if (typeof value !== 'string') return null;
  return SECRET_VALUE.test(value) ? '[가림]' : value;
}

export function extract(alert) {
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const rule = alert && typeof alert.rule === 'object' && alert.rule ? alert.rule : {};
  return {
    id: safe(alert?.id),
    timestamp: safe(alert?.timestamp),
    srcip: safe(data.srcip),
    srcuser: safe(data.srcuser),
    level: Number.isInteger(rule.level) ? rule.level : null,
    description: safe(rule.description),
  };
}

export async function readAlerts(root) {
  const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'web-injection.json'), 'utf8'));
  const alerts = Array.isArray(fixture.alerts) ? fixture.alerts : [];
  return { total: alerts.length, rows: alerts.map(extract) };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const { total, rows } = await readAlerts(root);
  for (const r of rows) console.log([r.id, r.timestamp, r.srcip, r.srcuser ?? '-', r.level, r.description].join(' | '));
  console.log(`경보 ${total}건 · 뽑은 줄 ${rows.length}줄 · ${total === rows.length ? '일치' : '불일치'}`);
  if (total !== rows.length) process.exitCode = 1;
}
