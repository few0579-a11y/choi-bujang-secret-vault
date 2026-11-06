// 10단계 제작 1·2: 안전 정책(1~9단계 접근 규칙)의 검증된 사본을 만들고,
// 시험용 사본에서 침공을 흉내 낸 뒤 차이만 보여 주고, 검증된 버전으로 되돌립니다.
// 실제 운영 정책(src/decider.mjs, aleph.config.json, DB)은 읽기만 하고 절대 쓰지 않습니다.
// 쓰는 곳: backups/policy/vN/ (검증 사본), backups/drill/ (시험 정책 + 감사 기록)
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const BACKUP_DIR = join(root, 'backups', 'policy');
const DRILL_DIR = join(root, 'backups', 'drill');
const DRILL_POLICY = join(DRILL_DIR, 'policy');
const DRILL_MANIFEST = join(DRILL_DIR, 'drill.json');
const AUDIT = join(DRILL_DIR, 'audit.jsonl');

// 안전 정책 = 판정기 규칙 + 허용 경로 + DB 접근 정책 SQL
export const POLICY_FILES = Object.freeze([
  'src/decider.mjs',
  'aleph.config.json',
  'supabase_notes.sql',
  'supabase_stage4_notes.sql',
  'supabase_stage8_zones.sql',
]);

// 줄바꿈(CRLF/LF)이 달라도 같은 내용이면 같은 해시가 나오게 맞춥니다.
const normalize = text => text.replace(/\r\n/gu, '\n');
export const sha256 = text => createHash('sha256').update(normalize(text), 'utf8').digest('hex');
const stop = message => { const error = new Error(message); error.stop = true; throw error; };
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true }).trim();
const out = line => process.stdout.write(`${line}\n`);

function inside(base, target) {
  const rel = relative(base, target);
  if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) stop(`허용되지 않은 쓰기 위치: ${target}`);
  return target;
}

function versions() {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR).filter(name => /^v\d+$/u.test(name))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

// 사본을 다시 읽어 해시를 대조합니다. 사본이 없거나 하나라도 다르면 중단합니다.
export function verifySnapshot(version = versions().at(-1)) {
  if (!version) stop('검증된 사본이 없습니다. 먼저 `npm run policy:snapshot`을 실행하세요.');
  const dir = join(BACKUP_DIR, version);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) stop(`사본 ${version}의 manifest.json이 없습니다. 중단합니다.`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = {};
  for (const item of manifest.files) {
    const path = join(dir, item.path);
    if (!existsSync(path)) stop(`사본 ${version}에 ${item.path}가 없습니다. 중단합니다.`);
    const text = normalize(readFileSync(path, 'utf8'));
    if (sha256(text) !== item.sha256) stop(`사본 ${version}의 ${item.path} 해시가 맞지 않습니다. 중단합니다.`);
    files[item.path] = text;
  }
  return { version, manifest, files };
}

function snapshot(fromCommit) {
  const commit = git('rev-parse', '--verify', `${fromCommit}^{commit}`);
  const version = `v${(versions().length ? Number(versions().at(-1).slice(1)) : 0) + 1}`;
  const dir = inside(BACKUP_DIR, join(BACKUP_DIR, version));
  const files = POLICY_FILES.map(path => {
    const text = normalize(git('show', `${commit}:${path}`) + '\n');
    const target = inside(dir, join(dir, path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
    return { path, sha256: sha256(text), lines: text.split('\n').length - 1 };
  });
  const manifest = { schema: 'byteback.policy-snapshot.v1', version, sourceCommit: commit,
    createdAt: new Date().toISOString(), note: '1~9단계 안전 정책(판정기 규칙·허용 경로·DB 접근 정책)', files };
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const checked = verifySnapshot(version); // 사전 백업을 다시 읽어 검증
  out(`사본 ${version} 생성 · 기준 커밋 ${commit.slice(0, 7)} · 파일 ${files.length}개`);
  for (const item of checked.manifest.files) out(`  ${item.sha256.slice(0, 16)}…  ${item.path}`);
  out('다시 읽어 해시 대조: 모두 일치');
}

function audit(event) {
  mkdirSync(DRILL_DIR, { recursive: true });
  appendFileSync(inside(DRILL_DIR, AUDIT), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, 'utf8');
}
const auditCount = () => (existsSync(AUDIT) ? readFileSync(AUDIT, 'utf8').split('\n').filter(Boolean).length : 0);

// 침공 흉내: 메모 구역에 ID 없는 전체 목록(GET /notes)을 끼워 넣습니다. 줄 수는 그대로입니다.
const TAMPER = Object.freeze({
  file: 'src/decider.mjs',
  from: "{ service: 'notes', routes: ['GET /notes/:id',",
  to: "{ service: 'notes', routes: ['GET /notes', 'GET /notes/:id',",
  meaning: '메모 구역에 전체 목록 경로를 허용 → 다른 사람 메모까지 쓸어 담을 수 있음',
});

function drill() {
  const base = verifySnapshot();
  for (const [path, text] of Object.entries(base.files)) {
    const target = inside(DRILL_POLICY, join(DRILL_POLICY, path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, path === TAMPER.file ? text.replace(TAMPER.from, TAMPER.to) : text, 'utf8');
  }
  const tampered = readFileSync(join(DRILL_POLICY, TAMPER.file), 'utf8');
  if (!tampered.includes(TAMPER.to)) stop('시험 정책에서 바꿀 규칙 줄을 찾지 못했습니다.');
  writeFileSync(DRILL_MANIFEST, `${JSON.stringify({ baseVersion: base.version, baseCommit: base.manifest.sourceCommit,
    tamper: { file: TAMPER.file, meaning: TAMPER.meaning } }, null, 2)}\n`, 'utf8');
  audit({ action: 'drill_tamper', baseVersion: base.version, file: TAMPER.file, meaning: TAMPER.meaning });
  out(`시험 정책 생성: backups/drill/policy (기준 ${base.version}) · 규칙 한 줄을 일부러 바꿈`);
  showPlan(plan());
}

// 검증한 사본과 시험 정책의 차이(줄 단위)를 계산합니다.
function plan() {
  if (!existsSync(DRILL_MANIFEST)) stop('시험 정책이 없습니다. 먼저 `npm run policy:drill`을 실행하세요.');
  const { baseVersion } = JSON.parse(readFileSync(DRILL_MANIFEST, 'utf8'));
  const base = verifySnapshot(baseVersion);
  const changes = [];
  for (const [path, expected] of Object.entries(base.files)) {
    const target = join(DRILL_POLICY, path);
    const current = existsSync(target) ? normalize(readFileSync(target, 'utf8')) : null;
    if (current === expected) continue;
    const a = expected.split('\n');
    const b = current === null ? [] : current.split('\n');
    const lineLevel = current !== null && a.length === b.length;
    const lines = lineLevel
      ? a.flatMap((line, i) => (line === b[i] ? [] : [{ line: i + 1, now: b[i], restore: line }]))
      : [];
    changes.push({ path, lineLevel, lines, missing: current === null });
  }
  return { base, changes };
}

function showPlan({ base, changes }) {
  out(`복원할 버전: ${base.version} (커밋 ${base.manifest.sourceCommit.slice(0, 7)}, 사본 해시 검증 통과)`);
  if (!changes.length) { out('변경 범위: 없음 (시험 정책 = 검증 사본)'); return; }
  out(`변경 범위: 파일 ${changes.length}개`);
  for (const change of changes) {
    if (change.missing) { out(`  ${change.path}: 시험 정책에 없음 → 파일 전체 복원`); continue; }
    if (!change.lineLevel) { out(`  ${change.path}: 줄 수가 달라 파일 전체 복원`); continue; }
    for (const item of change.lines) {
      out(`  ${change.path}:${item.line}`);
      out(`    - 지금  ${item.now.trim()}`);
      out(`    + 복원  ${item.restore.trim()}`);
    }
  }
}

function restore(execute) {
  const current = plan();
  showPlan(current);
  if (!current.changes.length) return;
  if (!execute) { out('\n아직 실행하지 않았습니다. 위 항목만 바꾸려면 `npm run policy:restore -- --yes`'); return; }
  const before = auditCount();
  for (const change of current.changes) {
    const target = inside(DRILL_POLICY, join(DRILL_POLICY, change.path));
    if (change.lineLevel) {
      // 다른 줄(다른 서비스 규칙 등)은 그대로 두고, 차이 난 줄만 검증 사본 값으로 바꿉니다.
      const lines = normalize(readFileSync(target, 'utf8')).split('\n');
      for (const item of change.lines) lines[item.line - 1] = item.restore;
      writeFileSync(target, lines.join('\n'), 'utf8');
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, current.base.files[change.path], 'utf8');
    }
  }
  const after = plan();
  if (after.changes.length) stop('복원 뒤에도 차이가 남았습니다. 중단합니다.');
  audit({ action: 'restore', toVersion: current.base.version,
    files: current.changes.map(change => change.path), lines: current.changes.reduce((n, c) => n + c.lines.length, 0) });
  out(`\n복원 완료: 시험 정책 = ${current.base.version} (해시 일치) · 감사 기록 ${before}건 보존 → ${auditCount()}건`);
}

// 시험 정책의 판정기를 불러와 정상·금지 요청을 다시 보냅니다(가상 요청 연습, 심판 판정 아님).
async function check() {
  if (!existsSync(DRILL_MANIFEST)) stop('시험 정책이 없습니다. 먼저 `npm run policy:drill`을 실행하세요.');
  const { fixtureRequests } = await import('./fixture-7.mjs');
  const url = `${pathToFileURL(join(DRILL_POLICY, 'src', 'decider.mjs')).href}?t=${Date.now()}`;
  const { decide } = await import(url);
  const req = (method, path, route) => ({ ...fixtureRequests().normal, requestId: crypto.randomUUID(),
    at: new Date().toISOString(), service: 'notes', method, path, route });
  const cases = [
    ['B가 목록 경로로 A 메모까지 요청 (GET /notes)', req('GET', '/notes', 'GET /notes'), 'deny'],
    ['B가 A 메모 내보내기 경로 요청', req('GET', '/notes/a1/export', 'GET /notes/:id/export'), 'deny'],
    ['A가 자기 메모 하나 읽기', req('GET', '/notes/a1', 'GET /notes/:id'), 'allow'],
    ['A가 자기 메모 수정', req('PUT', '/notes/a1', 'PUT /notes/:id'), 'allow'],
  ];
  let failed = 0;
  for (const [name, request, expected] of cases) {
    const result = await decide(request);
    const ok = result.decision === expected;
    if (!ok) failed += 1;
    out(`${ok ? '통과' : '확인 필요'} · ${name} → ${result.decision}/${result.reasonCode} (기대 ${expected})`);
  }
  out('시험 정책 판정기에 보낸 가상 요청 연습이며 심판 판정이 아닙니다.');
  return failed;
}

const [command = 'help', ...rest] = process.argv.slice(2);
try {
  if (command === 'snapshot') snapshot(rest[0] ?? 'HEAD');
  else if (command === 'verify') { const { version } = verifySnapshot(rest[0]); out(`사본 ${version}: 다시 읽어 해시 대조 모두 일치`); }
  else if (command === 'drill') drill();
  else if (command === 'diff') showPlan(plan());
  else if (command === 'restore') restore(rest.includes('--yes'));
  else if (command === 'check') { if (await check()) process.exitCode = 1; }
  else out('사용법: node scripts/policy-backup.mjs snapshot [커밋] | verify [vN] | drill | diff | restore [--yes] | check');
} catch (error) {
  if (!error.stop) throw error;
  process.stderr.write(`중단: ${error.message}\n`);
  process.exitCode = 1;
}
