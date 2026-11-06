-- 2단계 스키마 전용: 메모 본문은 저장소에 두지 않습니다.
CREATE TABLE IF NOT EXISTS public.notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  title text NOT NULL,
  content text NOT NULL
);
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.notes FROM anon, authenticated;
-- 기존 SQL Editor에서 등록한 가상 메모 4건은 DB에 그대로 유지합니다.
