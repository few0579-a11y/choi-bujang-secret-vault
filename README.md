# BYTE BACK 방어전 — 3단계 저장점

1~3단계의 Supabase 로그인 화면과 서버 자료 구조를 유지하고, 인증된 메모 CRUD를 완성했습니다.

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
- 3단계에서는 A와 B 메모의 소유자 간 접근 제한을 추가하지 않았습니다.
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
