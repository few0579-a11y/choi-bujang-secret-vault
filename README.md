# BYTE BACK 방어전 — 1~7단계 구현 기록

1~3단계의 인증·CRUD 구조에 사용자별 소유자 검사와 DB RLS 재현 자료를 추가했습니다.

## 5단계 이력

- 근거 저장점 커밋 `44dc0b54cf434bc14524f78ea47ae05c2628067c` (`44dc0b5 5단계 저장점`)에서 `aleph.config.json`의 단계와 원본 REST 테이블 경로를 기록했습니다.
- 후속 커밋 `83f60ee160c2257b5e3725694eea24e37cd3d664` (`83f60ee 5단계 점검 수정`)에서 제출 자기 점검의 5단계 실행을 지원했습니다.
- 해당 이력을 5단계 제출 작업으로 요약합니다. 운영 심판 판정이나 실제 Vercel 재배포 완료는 이 README 기록만으로 증명하지 않습니다.

## 6단계 기기 등록 규칙

- 판정 규칙 ID는 `device_registered`입니다.
- `deviceRegistered === true`인 가상 정상 요청은 `allow / approved`를 반환합니다.
- `deviceRegistered`가 `false`이거나 누락된 가상 요청은 `deny / device_not_registered`를 반환합니다.
- 응답은 `schema`, `requestId`, `decision`, `reasonCode`, `ruleIds` 다섯 필드만 사용하고, `ruleIds`에는 `RULE_IDS`의 값만 사용합니다.
- 테스트 명령: `npm.cmd run decider:test`
- 이 명령은 계약의 가상 요청 연습이며 운영 반 엔진 또는 심판 판정 성공을 증명하지 않습니다.
- 운영 `allowedReasonCodes` 등록부가 이 저장소에서 확인되지 않았으므로 `device_not_registered`의 실제 심판 등록 여부를 검증 완료라고 기록하지 않습니다.

## 7단계 평소와 다른 접속 추가 확인 규칙

- 판정 규칙 ID는 `device_registered`, `step_up_required` 두 개입니다.
- 접속 신호(`signals`)는 엔진이 넘긴 `source: "judge_fixture"`(심판 가상 사건)일 때만 근거로 씁니다. 브라우저·클라이언트 헤더 등 다른 출처, 누락·형식 오류, `unknown` 값은 근거 없음으로 두고 정상값으로 채우지 않습니다.
- 새벽 시각(0~5시), 처음 보는 네트워크, 지역 변경, 최근 5분 내 10건 이상 요청 중 두 가지 이상이 겹치면 `step_up / step_up_required`를 반환합니다. 지역 하나만으로는 거부하지 않습니다.
- 엔진이 `stepUp.verified === true`, `authAgeSeconds` 300초 이내를 넘기면 같은 사건도 `allow`입니다. 기존 기기 규칙은 유지합니다.
- 테스트 명령: `npm.cmd run decider:test`, `npm.cmd run fixture:7` (가상 요청 연습이며 심판 판정이 아닙니다).
- 제공 엔진이 같은 로그인으로 다시 로그인한 시각을 검증해 주는 계약이 이 저장소에 없으므로, 실제 자료 차단·새 로그인 뒤 재판정은 **미실행**입니다.
- 운영 `allowedReasonCodes`에 `step_up_required`가 등록됐는지는 이 저장소에서 확인하지 못했습니다.

## 현재 구조

- 첫 화면 `/`은 로그인한 사용자의 세션 토큰으로 `/api/notes`를 호출합니다. 기존 가상 메모 4건과 사용자가 추가한 메모를 목록으로 표시합니다.
- `api/notes.js`는 `GET /api/notes`와 `POST /api/notes`를 제공합니다.
- `api/notes/[id].js`는 `GET`, `PUT`, `DELETE /api/notes/:id`를 제공합니다.
- 모든 메모 API는 `src/verify-login.mjs`의 `createLoginVerifier()`로 Bearer 토큰을 검증합니다.
- 새 메모의 `owner_id`에는 클라이언트 입력이 아니라 검증된 Supabase 사용자 ID를 저장합니다.
- 무토큰 또는 잘못된 토큰 요청은 메모 데이터 없이 `401 {"error":"UNAUTHORIZED"}`를 반환합니다.
- Supabase 테이블 권한 오류를 해결한 뒤 A 계정의 메모 추가·조회·수정·삭제가 배포에서 정상 동작합니다.
- 공개 `data.json` 및 `public/data.json`을 제거했고 빌드는 `public/data.json`을 생성하지 않습니다.
- `notes` 테이블은 `owner_id uuid`를 포함하며 기존 인증과 DB 자료는 보존됩니다.
- 4단계에서는 목록 GET과 단일 GET/PUT/DELETE에서 검증된 사용자 소유자를 확인합니다.
- 상대 메모 GET/PUT/DELETE는 `403 FORBIDDEN`, POST 본문의 `owner_id` 변조는 `400 OWNER_ID_NOT_ALLOWED`입니다.
- A/B 임시 메모 CRUD와 삭제 후 `404 NOTE_NOT_FOUND`를 Production에서 검증했습니다.
- `public.notes`의 4개 소유자 정책, 최소 권한 GRANT, 직접 Data API anon 거부를 제작 3에서 검증했습니다.
- 미검증 항목은 없음을 주장하지 않고, 실행하지 않은 신규 배포 또는 심판 제출은 기록하지 않습니다.
- **과거 노출:** GitHub 과거 공개 커밋과 기존 Vercel 배포 이력은 이번 변경으로 삭제되지 않습니다. 과거 노출이 해소되었다고 주장하지 않습니다.

## 실행 / 환경 변수 설정

1. Supabase SQL Editor에서 `supabase_notes.sql`의 스키마/RLS를 확인합니다. 앞서 등록한 가상 메모 4건은 DB에 유지합니다.
2. Vercel 프로젝트 Settings → Environment Variables에서 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 서버 환경변수로 입력합니다. 값을 채팅, Git, 클라이언트 파일에 넣지 않습니다.
3. Vercel에서 재배포합니다. 실제 배포 URL을 `aleph.config.json`의 `publicAppUrl`에 반영한 뒤 저장점 커밋을 만듭니다.
4. `npm run build -- --local`로 로컬 정적 빌드 점검. 배포에서 `npm run build`로 `/aleph.json` 생성. `npm run bundle`은 커밋 후 실행합니다.
5. 로컬 테스트는 서버 API 배포를 대신하지 않습니다.

## 최신 파일 및 공개 배포 검색 절차

- 최신 추적 파일: `git grep -n '실습용 가상' HEAD -- .` (가상 메모 본문에 공통으로 들어간 단어 검색) → 결과 0건 기대.
- 새 배포: `/data.json`에 HTTP 404 또는 메모 0건, `/aleph.json`에 HTTP 200, `/`에 `X-Content-Type-Options: nosniff` 확인.
- 새 배포의 `/api/notes`는 비로그인과 잘못된 토큰에 `401 UNAUTHORIZED`를 반환하고, 정상 로그인 세션에는 가상 메모를 반환합니다.
- 배포 HTML/JS와 GitHub 최신 버전에서도 메모 본문과 `SUPABASE_SECRET_KEY`의 실제 값을 검색해 노출되지 않았는지 확인합니다.
- 과거 GitHub 커밋 및 이전 배포 버전은 별도 이력이며 이 검사로 제거되지 않습니다.

## 제출

`bundle-notes.json`은 로컬에서만 작성하고 커밋하지 않습니다. `npm run bundle`을 실행하면 직접 수행한 공격 점검 결과로 `artifacts/submission.json`을 생성합니다. 이는 운영 심판 판정이 아닙니다.
