import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deploymentIdentity } from './deployment-identity.mjs';

const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
if (!Number.isInteger(config.step) || config.step < 1 || config.step > 12) {
  throw new Error('aleph.config.json의 단계를 확인해 주세요.');
}
await mkdir(resolve(root, 'public'), { recursive: true });
await rm(resolve(root, 'public', 'data.json'), { force: true });
await rm(resolve(root, 'public', 'aleph.json'), { force: true });
if (config.step === 1) {
  throw new Error('1단계 공개 메모 빌드는 이 보호 버전에서 지원하지 않습니다.');
}
console.log('공개 data.json 없이 정적 화면을 준비했습니다.');
if (!process.argv.includes('--local')) {
  const identity = deploymentIdentity(process.env, config);
  await writeFile(resolve(root, 'public', 'aleph.json'), `${JSON.stringify(identity, null, 2)}\n`, 'utf8');
  console.log('배포 식별 정보를 public/aleph.json에 기록했습니다.');
}
