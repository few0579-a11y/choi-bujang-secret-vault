-- 11단계: 기기 승인 표. Supabase SQL Editor에서 한 번 실행합니다.
-- 기기 증명값 원문은 저장하지 않고 SHA-256 지문(device_hash)만 저장합니다.
-- 브라우저(anon·authenticated)는 이 표를 직접 읽거나 쓸 수 없고, 서버(secret key)만 접근합니다.
create table if not exists public.device_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null check (device_hash ~ '^[0-9a-f]{64}$'),
  approval_code text not null check (approval_code ~ '^[A-Z2-9]{4}-[A-Z2-9]{4}$'),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  unique (user_id, device_hash)
);

alter table public.device_approvals enable row level security;
revoke all on table public.device_approvals from anon, authenticated;

-- 확인: 표가 생기고 RLS가 켜졌는지
select relname, relrowsecurity from pg_class where relname = 'device_approvals';

-- ───────── 아래는 승인할 때마다 따로 실행합니다(지금 같이 실행하지 마세요) ─────────
-- 1) 대기 중인 기기 보기
-- select approval_code, status, created_at from public.device_approvals where status = 'pending' order by created_at desc;
-- 2) 화면에 뜬 승인 코드가 맞는지 확인한 뒤 그 기기만 승인
-- update public.device_approvals set status = 'approved', approved_at = now()
--   where approval_code = 'ABCD-EFGH' and status = 'pending' returning approval_code, status;
-- 3) 잃어버린 기기 승인 취소
-- update public.device_approvals set status = 'revoked' where approval_code = 'ABCD-EFGH' returning approval_code, status;
