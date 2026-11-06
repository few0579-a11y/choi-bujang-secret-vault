# BYTE BACK 방어전 — 1~12단계 구현 기록

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

## 8단계 자료 구역 분리

- **자원 ID (제작 1):** 메모는 `note:<id>`, 반 공지는 `notice:<id>`로 응답에 `resourceId`를 붙입니다. 기존 메모 자료·주소는 그대로이며 화면 메뉴는 바꾸지 않았습니다.
- **판정기 구역 규칙 (제작 2, 규칙 ID `resource_zone`):** 엔진이 넘긴 `service`·`method`·`path`·`route`만 봅니다.
  - 메모(`notes`): `GET/PUT/DELETE /notes/:id`만 허용. ID 없는 목록(`GET /notes`)과 생성(`POST /notes`)은 거부.
  - 반 공지(`notices`): `GET /notices`, `GET /notices/:id`만 허용. 쓰기는 누구에게나 거부.
  - 강사 자료와 알 수 없는 서비스·경로, `:id` 아래 기능 경로(예: `/export`), `path`와 `route` 모양 불일치는 거부(`zone_not_allowed`).
  - 메모 주인 비교와 강사 여부는 판정기가 아니라 API에서 합니다. 쿼리로 기능을 고르지 않고, ID 형식은 좁히지 않습니다.
  - `allowedRoutes`에는 판정기가 허용하는 경로만 적었습니다.
- **API 재확인 (제작 3):**
  - `api/notes/[id].js`는 저장된 `owner_id`와 검증된 사용자를 비교해 `403 FORBIDDEN / reason: not_owner`를 반환합니다.
  - `api/notes.js`의 목록은 화면용으로 본인 메모만 반환합니다. 판정기 허용 경로에는 넣지 않았습니다.
  - `api/notices.js`, `api/notices/[id].js`는 로그인 사용자 읽기 전용이며, 쓰기 요청은 `403 / notice_read_only`입니다.
  - 강사의 공지 수정은 `PUT /api/admin/notices/:id`에서만 합니다. DB `public.class_roles`에 저장된 `instructor` 역할만 허용(`403 / not_instructor`)합니다. 본문의 `role`·`owner_id`·`updated_by`는 `400 ROLE_NOT_ALLOWED`로 거부합니다.
  - 거부 시 `access_denied {route, reason}`만 서버 로그에 남깁니다(사용자 ID·토큰·본문 제외).
- **DB:** `supabase_stage8_zones.sql`이 `notices`·`class_roles`를 만듭니다(RLS 켬, anon·authenticated 직접 권한 없음, 서버 secret key만 접근).
- **패키징 기준표:** 새 서버 함수 3개를 `package/baseline-functions.json`의 `allowedNew`에 적었습니다. `test/package-starter.test.mjs`는 목록이 코드에 고정돼 있어 계속 실패합니다(시작 틀 시험 원문은 수정하지 않음).
- 테스트 명령: `npm.cmd run decider:test`, `npm.cmd run fixture:7`, `npm.cmd run fixture:8` (모두 가상 요청 연습이며 심판 판정이 아닙니다).
- **미검증:** 배포에서 A/B 계정으로 다른 사람 메모 조회·수정, 강사 계정의 공지 수정 성공은 실행하지 않았습니다. 운영 `allowedReasonCodes`에 `zone_not_allowed`가 등록됐는지, 엔진이 쓰는 `service` 이름(`notes`·`notices`)이 실제와 같은지는 이 저장소에서 확인하지 못했습니다.

## 9단계 조회 폭주 탐지와 회수 제안

- **입력 (제작 1):** `src/detect.mjs`는 사건마다 `at`·`method`·`identity.sub` 세 값만 읽습니다. 네트워크·기기·지역 값은 만들지 않고, 메모 내용·토큰·실명은 읽거나 출력하지 않습니다. 형식이 맞지 않는 사건은 세지 않습니다.
- **규칙 `burst_read` (제작 2):** 같은 `identity.sub`의 `GET` 시각을 정렬해 슬라이딩 창으로 셉니다. 어느 10분 구간(시작 포함, 정확히 10분 뒤는 다음 구간)이든 121건 이상이면 의심입니다. 120건 이하, 다른 사용자 합산, 10분 밖 사건은 의심이 아닙니다.
- **응답 (제작 3):** 의심이면 `{action:"propose_revocation", reasonCode:"burst_read", subject}` 세 키만, 아니면 `{action:"observe"}`입니다. 회수 집행·기기 권한 변경은 하지 않으며 `src/decider.mjs` 응답 형식은 그대로입니다.
- 테스트 명령: `npm.cmd run detect:test` (가상 사건 연습 6건, 심판 판정이 아닙니다). `src/attack-check.mjs`는 9단계에서도 8단계 점검을 그대로 실행합니다.
- **미검증:** 운영 반 엔진이 검증된 사건을 `detect`에 전달하는 경로와, 회수 제안을 실제 접속 회수로 집행하는 경로는 이 저장소에서 연결·시험하지 않았습니다.

## 10단계 백업에서 자료실을 되살립니다

### 제작 1·2 — 안전 정책 사본과 시험 정책 되돌리기 (`scripts/policy-backup.mjs`)

- **안전 정책:** `src/decider.mjs`(판정기 규칙), `aleph.config.json`(allowedRoutes), DB 접근 정책 SQL(`supabase_notes.sql`, `supabase_stage4_notes.sql`, `supabase_stage8_zones.sql`).
- **검증 사본:** `backups/policy/v1/` — 9단계 저장점 `642c8b3`의 파일을 그대로 떠 두고 `manifest.json`에 파일별 SHA-256을 적었습니다(줄바꿈 CRLF/LF 차이는 같은 내용으로 봄). 사본이 없거나 해시가 하나라도 다르면 모든 명령이 중단됩니다.
- **시험 정책:** `backups/drill/policy/` — 검증 사본을 복사한 뒤 메모 구역 규칙 한 줄에 `GET /notes`(전체 목록)를 끼워 넣어 침공을 흉내 냅니다. 실제 운영 정책 파일에는 쓰지 않습니다(쓰기 위치를 `backups/` 아래로 제한).
- **되돌리기:** 실행 전에 복원할 버전과 바뀔 줄(파일:줄, 지금 → 복원)을 보여 주고, `--yes`가 있을 때만 차이 난 줄만 바꿉니다. 다른 줄(다른 서비스 규칙)은 그대로이며 `backups/drill/audit.jsonl` 감사 기록은 추가만 합니다.

| 명령 | 하는 일 |
|---|---|
| `npm.cmd run policy:verify` | 사본을 다시 읽어 해시 대조 |
| `npm.cmd run policy:drill` | 시험 정책 만들기 + 규칙 한 줄 변조 + 차이 표시 |
| `npm.cmd run policy:diff` | 검증 사본 대비 시험 정책 차이만 표시 |
| `npm.cmd run policy:restore` | 바뀔 항목만 보여 주고 멈춤 (`-- --yes`로 실행) |
| `npm.cmd run policy:check` | 시험 정책 판정기에 가상 요청 4건(B의 목록 요청·내보내기 요청 거부, A의 단건 읽기·수정 허용) |

- 실행 결과(2026-11-06, 로컬): 변조 상태에서 `B가 목록 경로로 A 메모까지 요청`이 `allow`(확인 필요) → 복원 후 `deny/zone_not_allowed`, A 정상 요청 2건은 변조 전후 모두 `allow`. 사본 파일 한 줄을 일부러 바꾸자 `해시가 맞지 않습니다. 중단합니다.`로 멈춤을 확인했습니다. 가상 요청 연습이며 심판 판정이 아닙니다.
- 실제 Supabase DB의 정책 상태를 사본 SQL과 대조하는 일은 **미실행**입니다(이 저장소에서 DB에 접속하지 않음).

### 제작 3 — 메모 한 건 복원 경로

- **서비스·경로:** 메모(`notes`) 서비스, `POST /api/notes/:id/restore` (`api/notes/[id]/restore.js`). `aleph.config.json`의 `restoreRoute`와 `allowedRoutes`에 적었고, 판정기 메모 구역에 `POST /notes/:id/restore`만 추가했습니다(ID 없는 전체 복원·GET은 거부).
- **복원 대상(시험 계정 B의 가상 메모):** `10b00000-0000-4000-8000-000000000001` (제목 「가상 메모 B-10 (복구 시험용)」, 실제 정보 없음). `supabase_stage10_restore.sql` 끝의 주석 SQL로 B 계정 소유로 만듭니다(이메일은 SQL Editor에서만 입력).
- **비공개 사본:** DB `public.note_versions`. 트리거가 메모 저장·수정·삭제 때마다 그 시점 내용과 내용 해시를 한 줄씩 쌓습니다(덮어쓰지 않음, 내용이 같은 수정은 쌓지 않음). SQL 적용 시점의 기존 메모는 `baseline`으로 한 번 떠 둡니다. anon·authenticated는 읽기·쓰기 모두 불가.
- **복원 규칙 (결정: 수정마다 버전 기록):** 메모가 있으면 마지막 수정 직전 버전으로, 지워졌으면 삭제 직전 버전으로 되돌립니다. DB 함수 `restore_note_version`이 ① 메모 ID ② 소유자(검증된 로그인 사용자 = 사본의 `owner_id`) ③ 사본 내용 해시를 다시 계산해 대조하고, 복원 후 실제 행의 해시가 사본과 같은지 한 번 더 확인합니다. 하나라도 다르면 바꾸지 않고 멈춥니다.
- **응답:** `200 {id, resourceId, outcome(restored|undeleted|no_change), versionId, ownerMatches, contentSha256}` / 무토큰 `401` / 다른 사람 메모 `403 not_owner` / 사본 없음 `404 SNAPSHOT_NOT_FOUND` / 해시 불일치 `409 RESTORE_STOPPED` / 본문 `role`·`owner_id` 주장 `400`. 본문의 다른 값은 읽지 않습니다.
- **보존:** 한 건만 바꾸며 다른 메모·`note_versions`·`note_restore_audit`(복원 감사 기록: 메모 ID·버전·결과·전후 해시, 본문 없음)는 지우지 않습니다.
- 로컬 확인(2026-11-06): PGlite(PostgreSQL 17)에 SQL을 두 번 적용해 변조→복원, 삭제→복원, 다른 사람 복원 거부(`not_owner`), 사본 변조 시 중단(`snapshot_hash_mismatch`), 없는 메모(`no_snapshot`), anon·authenticated 권한 없음을 확인했습니다. 실제 Supabase 적용과 배포 경로 호출은 **미실행**입니다.

### 제작 4 — 복구 뒤 다시 실행할 순서

복구 후 아래를 위에서부터 실행합니다. 결과 칸은 실제로 실행한 것만 채우고 나머지는 미실행으로 둡니다.

| # | 단계 | 요청 | 기대 | 결과 |
|---|---|---|---|---|
| 1 | 10 | B 로그인 → `POST /api/notes/10b00000-…0001/restore` 뒤 `GET /api/notes/10b00000-…0001` | 200, 내용 해시 = 사본 | 미실행 |
| 2 | 10 | 무토큰 `POST /api/notes/:id/restore` | 401 | `npm run bundle` 자기 점검에서 확인 |
| 3 | 10 | A 로그인으로 B 메모 복원 | 403 not_owner | 미실행 |
| 4 | 1·5 | `/data.json`, 원본 Data API anon GET | 404 또는 0건 / 거부 | `npm run bundle` 자기 점검 |
| 5 | 3 | 무토큰 `GET`·`POST /api/notes` | 401 | `npm run bundle` 자기 점검 |
| 6 | 4·8 | B가 A 메모 `GET/PUT/DELETE /api/notes/:id` | 403 not_owner | 미실행 |
| 7 | 4 | A가 자기 메모 읽기·수정 | 200 | 미실행 |
| 8 | 8 | 반 공지 직접 PUT, 본문 role로 강사 경로 PUT | 401 또는 403 | `npm run bundle` 자기 점검 |
| 9 | 6·7·8 | `npm.cmd run decider:test`, `fixture:7`, `fixture:8` | 모두 통과 | 2026-11-06 로컬 통과 (가상 요청) |
| 10 | 9 | `npm.cmd run detect:test` | 6건 통과 | 2026-11-06 로컬 통과 (가상 사건) |
| 11 | 10 | `npm.cmd run policy:verify`, `policy:check` | 해시 일치, 4건 통과 | 2026-11-06 로컬 통과 |

- 심판의 실제 공격 결과는 이 표에 적지 않습니다.

## 11단계 나만의 접속 앱 (설치형 웹앱 + 기기 승인)

- **설치형 웹앱:** `public/manifest.webmanifest`(앱 이름·아이콘), `public/sw.js`(오프라인 안내 `public/offline.html`과 아이콘만 저장, `/api/` 응답·메모·토큰은 저장 안 함). 따로 설치하는 접속 프로그램은 없습니다. 화면은 "설치형으로 열림"을 안내만 하고, **설치 여부를 기기 확인 근거로 쓰지 않습니다.**
- **기기 승인 흐름:** 로그인 → `GET /api/device`로 상태 확인 → 미등록이면 「이 기기 승인 요청」(`POST /api/device`) → 승인 코드 표시(대기) → 자료실 주인이 Supabase SQL Editor에서 그 코드만 `approved`로 바꿈(`supabase_stage11_devices.sql` 아래쪽 주석) → 「승인 상태 다시 확인」 → 승인된 경우에만 메모를 불러옵니다.
  - 승인 요청 버튼은 `pending`만 만듭니다. 본문의 `status`·`approved`·`deviceId` 주장은 읽지 않습니다.
  - 기기 증명값은 서버가 만든 무작위 값이며 `HttpOnly; Secure; SameSite=Strict` 쿠키(`__Host-vault_device`)로만 브라우저에 둡니다. JS로 읽을 수 없고, DB에는 SHA-256 지문만 저장합니다.
  - 로그인 토큰도 `persistSession: false`로 바꿔 localStorage에 남기지 않습니다(새로 고치면 다시 로그인).
  - `device_approvals` 표는 RLS를 켜고 anon·authenticated 권한을 모두 회수했습니다. 서버(secret key)만 접근합니다.
- **서버 강제 범위(결정: A안):** 화면 전용 `GET/POST /api/notes`(목록·생성)는 승인 기기가 아니면 `403 DEVICE_NOT_APPROVED`. 판정기 허용 경로인 단건 `/api/notes/:id`·복원 경로는 기존대로 엔진(기기 서명·판정기)+토큰+주인 확인을 유지합니다(심판·엔진 요청에는 이 앱의 기기 쿠키가 없기 때문).
- **판정기 `request_integrity` 규칙:** 계약 18개 이름 밖의 이름이 끼었거나, `deviceId`가 16자리 16진수가 아니거나, 경로에 `../`·`//`·인코딩된 `/`·`\`가 있거나, 쿼리가 비었다면서 지문이 빈 문자열 지문이 아니면 `deny / request_integrity_failed`. 기존 구역 규칙의 경로-route 대조와 함께 "서명 뒤 경로 변경"을 거부합니다. 서명 검증과 본문 대조 자체는 엔진(릴레이) 몫이며 계약에 본문 지문이 없어 판정기는 본문을 보지 않습니다.
- 테스트 명령: `npm.cmd run fixture:11`(10건), `npm.cmd run fixture:8`, `npm.cmd run decider:test` — 모두 가상 요청 연습이며 심판 판정이 아닙니다.
- **미실행:** Supabase에 `supabase_stage11_devices.sql` 적용 전에는 배포에서 기기 승인 흐름이 동작하지 않습니다(`DEVICE_STATUS_UNAVAILABLE`). 배포에서 승인 전 자료 없음·승인 후 기존 화면 정상은 학생이 직접 확인한 뒤에만 기록합니다.

## 12단계 탈환 작전실 · 회귀 시험 표 · 운영 안내

### 제작 1 — 탈환 작전실 (`api/ops.js` + 첫 화면 「탈환 작전실」 칸)
- 로그인 + **서버가 승인한 기기**에서만 열립니다(무토큰 `401`, 미승인 기기 `403 DEVICE_NOT_APPROVED`). 내 계정의 기록만 읽습니다.
- 칸 다섯 개와 표시: 판정기 규칙 `코드`(배포된 `RULE_IDS`·허용 경로, 실행 결과 아님) · 탐지 사건 `미실행`(규칙은 있으나 운영 엔진이 실제 사건을 넘기는 경로가 없음 → "0건"으로 쓰지 않음) · 회수 상태 `실측`(`device_approvals`의 대기·승인·회수) · 복구 버전 `실측`(`note_versions`) · 복원 감사 `실측`(`note_restore_audit`).
- 가리기: 메모 ID는 앞 8자리, 승인 코드는 앞 2자리만. 메모 제목·본문·기기 지문·토큰은 API가 고르지도 않습니다.
- 대조: 화면이 서버가 보낸 기록을 다시 세어 「서버 집계 N건 = 받은 기록 N건」을 표시하고, 다르면 「대조 불일치」를 띄웁니다. 화면 스스로 성공 문구를 만들지 않으며, API 실패 시 칸을 비우고 실패를 적습니다. 요청 ID(`x-vercel-id`)·확인 시각·배포 커밋을 함께 보여 줍니다.

### 제작 2 — 1~12단계 회귀 시험 표 (`npm.cmd run ops:regress`)
- 실제 배포 주소에 정상·금지 요청 20건을 보내 `ops/regression-latest.md`(표)·`.json`에 단계·구분·기대·실제 HTTP 결과·요청 ID·확인 시각(UTC)을 남깁니다.
- A·B 계정 로그인은 선택입니다. 실행하면 이메일·비밀번호를 묻고(비밀번호는 화면에 안 보임), 토큰은 메모리에만 둡니다. 건너뛴 계정의 요청은 `미실행`.
- 메모를 바꾸는 요청(수정·삭제·내 메모 복원), 판정기·탐지 API 경로(엔진 몫), **심판 총공세 41종은 보내지 않고 `미실행`으로 적습니다.** 6~11단계 로컬 가상 연습(decider·fixture·detect·policy:verify)은 별도 칸에 "실제 API 아님"으로 적습니다.
- 기대와 다른 결과가 하나라도 있으면 종료 코드 1. 이 표는 학생 자기 점검이며 심판 판정이 아닙니다.

### 제작 3 — 설치·실행·중지·복구 안내
검사 기준: 이 README가 포함된 커밋(`git log -1 --oneline`, 12단계 저장점). 출처 구분은 아래와 같습니다.

| 부분 | 만든 쪽 | 파일 |
|---|---|---|
| SDP 엔진(신원·기기 서명 확인, 릴레이, 판정기 호출, 사건 전달, 회수 집행) | **ALEPH SDP 엔진 사용(제공)** — 이 저장소에 없음 | `docs/DECIDER_REQUEST.md`·`docs/DETECT_EVENTS.md` 계약만 |
| 시작 틀(제출 묶음·검증 도우미·XDR 실행기) | ALEPH 제공 | `scripts/bundle.mjs`, `src/verify-login.mjs`, `scripts/xdr-run.mjs` |
| 학생 판정기 | 학생 | `src/decider.mjs`(규칙 4개), `src/zones.mjs` |
| 탐지 규칙 | 학생 | `src/detect.mjs`(10분 120건 초과 → 회수 제안만) |
| 접속 앱 | 학생 | `public/`(설치형 웹앱·기기 승인·작전실 화면), `api/device.js` |
| 자료실 | 학생 | `api/notes*`, `api/notices*`, `api/admin/`, `api/ops.js`, `supabase_*.sql`, `scripts/policy-backup.mjs`, `scripts/regression.mjs` |

1. **설치**: Node 22 이상 → `npm install`(의존성 `@supabase/supabase-js`, `jose` 두 개). Supabase SQL Editor에서 `supabase_notes.sql` → `supabase_stage4_notes.sql` → `supabase_stage8_zones.sql` → `supabase_stage10_restore.sql` → `supabase_stage11_devices.sql` → `supabase_stage12_ops.sql`(작전실 읽기 권한) 순서로 실행(각 파일 아래쪽 확인용 SELECT로 결과 확인).
2. **비밀값**: Vercel Settings → Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`만 직접 입력합니다. 저장소·제출 묶음·채팅에 넣지 않습니다(`.env*`, `bundle-notes.json`, `artifacts/`는 `.gitignore`).
3. **실행**: GitHub `main`에 push → Vercel이 `npm run build`로 배포. 로컬 점검: `npm.cmd run decider:test` · `fixture:7` · `fixture:8` · `fixture:11` · `detect:test` · `policy:verify` → 배포 뒤 `npm.cmd run ops:regress`.
4. **기기 승인·회수(접속 앱)**: 승인 = `supabase_stage11_devices.sql` 아래 주석의 `update … set status = 'approved'`, 회수 = 같은 파일의 `set status = 'revoked'`. 회수하면 그 기기에서 목록·작전실이 즉시 403.
5. **중지**: 자료실 전체는 Vercel Deployments 화면에서 직전 정상 배포로 Instant Rollback(또는 `SUPABASE_SECRET_KEY`를 지워 모든 자료 API를 `503`으로 닫음). 판정기만 멈출 때는 `decide()`가 모든 요청을 `deny`하는 시작 틀 상태로 되돌립니다(엔진은 판정기 실패·지연 시에도 허용하지 않음 = 닫힌 쪽으로 실패).
6. **복구**: 정책은 `npm.cmd run policy:verify` → `policy:diff` → `policy:restore`(해시가 맞는 사본에서 바뀐 줄만), 메모는 로그인 후 `POST /api/notes/:id/restore`(한 건만). 복구 뒤 `npm.cmd run ops:regress`로 1~12단계 요청을 다시 보내 표를 갱신합니다.
7. **코드 되돌리기**: `git status`·`git diff`로 범위를 확인한 뒤 `git restore --source <직전 저장점> -- <파일>`. `git reset --hard`는 쓰지 않습니다.

### 12단계 미실행
- `npm run bundle` 자기 점검(`src/attack-check.mjs`)은 심판 격리 환경 규칙(공개 HTTPS에 GET·HEAD만)에 맞춰 GET만 보냅니다. 무토큰 POST·PUT 점검 4건과 무토큰 POST /api/notes는 `not_run`으로 남기며, 같은 요청은 `ops:regress`에서 학생 PC로 실측합니다(첫 제출 S12_BUNDLE_UNSUPPORTED 0점 → 수정).
- 자기 점검 기록 형식: 요청을 보낸 점검은 한 점검에 요청 하나, `observed`는 받은 상태만(`HTTP 401` 형식), 보내지 않은 점검은 `not_run`. 공개 로그인 설정 조회(`/api/auth-config`)도 점검 하나로 기록해 보낸 요청 9건과 기록 9건이 1:1로 맞습니다(두 번째 제출 S12_SCREEN_MISMATCH 53점 → 수정: 이전에는 설명 문구와 상태가 섞이고 기록되지 않은 요청 1건이 있었음).
- 작전실 화면의 실제 배포 확인과 `ops:regress` 실측은 이 커밋을 push·배포한 뒤 학생이 실행합니다. 실행 전에는 `ops/` 표가 없거나 이전 결과입니다.
- 회수된 신원·미등록 기기의 재전송 차단은 엔진(기기 서명·신원 확인)과 판정기 `device_registered`·`request_integrity` 규칙에 의존하며, 판정기 계약에 "회수됨" 값이 없어 판정기에 새 규칙을 더하지 않았습니다.

## 현재 구조

- 첫 화면 `/`은 로그인한 뒤 서버가 기기를 승인한 경우에만 세션 토큰으로 `/api/notes`를 호출합니다(11단계). 기존 가상 메모 4건과 사용자가 추가한 메모를 목록으로 표시합니다.
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
