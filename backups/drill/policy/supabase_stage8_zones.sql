-- BYTE BACK 8단계: 반 공지(notices)와 강사 권한(class_roles) 구역 분리 SQL
-- 서버 API만 secret key로 읽고 씁니다. anon·authenticated는 두 테이블에 직접 접근하지 못합니다.
-- 기존 public.notes와 그 자료는 건드리지 않습니다.

BEGIN;

CREATE TABLE IF NOT EXISTS public.notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.class_roles (
  user_id uuid PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('instructor'))
);

ALTER TABLE public.notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_roles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.class_roles FROM PUBLIC, anon, authenticated;

INSERT INTO public.notices (id, title, content)
VALUES ('8a8a8a8a-0000-4000-8000-000000000001', '가상 반 공지', '이 공지는 읽기만 할 수 있습니다. 수정은 강사 관리 경로에서만 합니다.')
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- 강사 지정은 이 SQL에 넣지 않습니다. 필요할 때만 SQL Editor에서 직접 실행하세요.
-- INSERT INTO public.class_roles (user_id, role) VALUES ('<강사 Supabase 사용자 UUID>', 'instructor');

-- 적용 후 확인 (한 줄: notices_rows = 1, class_roles_exists = true, anon_select = false, auth_update = false 기대)
SELECT
  (SELECT count(*) FROM public.notices)                            AS notices_rows,
  to_regclass('public.class_roles') IS NOT NULL                    AS class_roles_exists,
  has_table_privilege('anon', 'public.notices', 'SELECT')          AS anon_select,
  has_table_privilege('authenticated', 'public.notices', 'UPDATE') AS auth_update;
