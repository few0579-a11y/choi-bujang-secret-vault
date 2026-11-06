// 보너스 제작 4: 알림과 차단 연결.
// decide.mjs 의 판단 결과 가운데 block 만 ZTNA 판정기 거부 규칙 후보로 만들고,
// block·alert 는 xdr/alerts.log 에 한 줄씩 쌓습니다. decide.mjs 와 src/decider.mjs 는 고치지 않습니다.
//
// 한계(미연결): docs/DECIDER_REQUEST.md 계약에는 출발 주소(IP) 칸이 없어, src/decider.mjs 가
// 이 규칙을 직접 집행할 수 없습니다. 그래서 규칙은 xdr/ztna-deny-rules.json 에 따로 두고,
// isDenied(srcip, at) 로 "이 주소가 지금 막히는가"를 확인합니다. 엔진이 주소를 넘겨 주면 그때 꽂습니다.
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULES_FILE = join(ROOT, 'xdr', 'ztna-deny-rules.json');
const LOG_FILE = join(ROOT, 'xdr', 'alerts.log');
const BLOCK_TTL_MS = 60 * 60 * 1000; // 차단은 근거 경보 시각부터 1시간만. 공유 주소를 오래 막지 않습니다.
const IPV4 = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/u;

const ipOf = (alert) => (typeof alert?.data?.srcip === 'string' && IPV4.test(alert.data.srcip) ? alert.data.srcip : null);

export async function buildRules(alerts) {
  const decided = [];
  for (const alert of alerts) decided.push({ alert, out: await decide(alert) });

  // 정상(record) 이벤트에 나온 주소는 정상 사용자의 주소로 보고 막지 않습니다.
  const normalIps = new Set(decided.filter((d) => d.out.action === 'record').map((d) => ipOf(d.alert)).filter(Boolean));

  const byIp = new Map();
  const skipped = [];
  for (const { alert, out } of decided) {
    if (out.action !== 'block') continue;
    const ip = ipOf(alert);
    const at = Date.parse(alert.timestamp);
    if (!ip || !Number.isFinite(at)) { skipped.push({ alertId: alert.id, why: '주소·시각 형식 아님' }); continue; }
    if (normalIps.has(ip)) { skipped.push({ alertId: alert.id, why: '정상 이벤트에도 나온 주소' }); continue; }
    const rule = byIp.get(ip) ?? { type: 'deny', match: { srcip: ip }, startsAt: at, expiresAt: 0, alertIds: [], reason: out.reason.split(':')[0] };
    rule.startsAt = Math.min(rule.startsAt, at);
    rule.expiresAt = Math.max(rule.expiresAt, at + BLOCK_TTL_MS);
    rule.alertIds.push(alert.id);
    byIp.set(ip, rule);
  }
  const rules = [...byIp.values()].map((r) => ({ ...r, startsAt: new Date(r.startsAt).toISOString(), expiresAt: new Date(r.expiresAt).toISOString() }));
  return { decided, rules, skipped };
}

export function isDenied(rules, srcip, at) {
  const t = Date.parse(at);
  return rules.some((r) => r.match.srcip === srcip && t >= Date.parse(r.startsAt) && t < Date.parse(r.expiresAt));
}

async function appendAlerts(decided) {
  let existing = '';
  try { existing = await readFile(LOG_FILE, 'utf8'); } catch { /* 처음 */ }
  const seen = new Set(existing.split('\n').map((line) => line.split('\t')[1]).filter(Boolean));
  const lines = decided
    .filter(({ alert, out }) => out.action !== 'record' && !seen.has(alert.id))
    .map(({ alert, out }) => [alert.timestamp, alert.id, out.action, out.confidence, ipOf(alert) ?? '-', out.reason].join('\t'));
  if (lines.length) await appendFile(LOG_FILE, `${lines.join('\n')}\n`, 'utf8');
  return lines.length;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const fixture = JSON.parse(await readFile(join(ROOT, 'xdr', 'fixtures', 'brute-force.json'), 'utf8'));
  const { decided, rules, skipped } = await buildRules(fixture.alerts);
  await writeFile(RULES_FILE, `${JSON.stringify({ schema: 'aleph.xdr.deny-rules.v1', moduleKey: 'brute-force', rules }, null, 2)}\n`, 'utf8');
  const added = await appendAlerts(decided);

  // 다시 흘려 보기: 같은 경보 시각에 그 주소가 막히는지 확인합니다.
  let wrong = 0;
  for (const { alert, out } of decided) {
    const ip = ipOf(alert);
    if (!ip) continue;
    const denied = isDenied(rules, ip, alert.timestamp);
    const ok = out.action === 'block' ? denied : !denied;
    if (!ok) { wrong += 1; console.error(`어긋남: ${alert.id} ${out.action} denied=${denied}`); }
  }
  console.log(`거부 규칙 ${rules.length}개 · 건너뜀 ${skipped.length}개 · alerts.log 새 줄 ${added}줄 · 재생 어긋남 ${wrong}건`);
  if (wrong) process.exitCode = 1;
}
