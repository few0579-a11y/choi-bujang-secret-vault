-- BYTE BACK 4단계: public.notes 소유자 RLS 재현 SQL
-- 적용 전 조회, 적용, 적용 후 조회를 분리합니다. 이 파일은 SQL 실행 전에 검토용입니다.

-- =============================================================
-- A. 적용 전 조회
-- =============================================================

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS force_rls
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'notes';

SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'notes'
ORDER BY ordinal_position;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'notes'
ORDER BY grantee, privilege_type;

SELECT
  'anon' AS role_name,
  has_table_privilege('anon', 'public.notes', 'SELECT') AS can_select,
  has_table_privilege('anon', 'public.notes', 'INSERT') AS can_insert,
  has_table_privilege('anon', 'public.notes', 'UPDATE') AS can_update,
  has_table_privilege('anon', 'public.notes', 'DELETE') AS can_delete
UNION ALL
SELECT
  'authenticated',
  has_table_privilege('authenticated', 'public.notes', 'SELECT'),
  has_table_privilege('authenticated', 'public.notes', 'INSERT'),
  has_table_privilege('authenticated', 'public.notes', 'UPDATE'),
  has_table_privilege('authenticated', 'public.notes', 'DELETE');

SELECT policyname, permissive, roles, cmd, qual AS using_expression, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'notes'
ORDER BY cmd, policyname;

-- =============================================================
-- B. 적용 SQL
-- =============================================================

BEGIN;

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.notes FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.notes
TO authenticated;

DROP POLICY IF EXISTS notes_select_owner ON public.notes;
DROP POLICY IF EXISTS notes_insert_owner ON public.notes;
DROP POLICY IF EXISTS notes_update_owner ON public.notes;
DROP POLICY IF EXISTS notes_delete_owner ON public.notes;

CREATE POLICY notes_select_owner
ON public.notes
FOR SELECT
TO authenticated
USING (auth.uid() = owner_id);

CREATE POLICY notes_insert_owner
ON public.notes
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY notes_update_owner
ON public.notes
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_id)
WITH CHECK (auth.uid() = owner_id);

CREATE POLICY notes_delete_owner
ON public.notes
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);

COMMIT;

-- =============================================================
-- C. 적용 후 조회
-- =============================================================

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'notes'
ORDER BY grantee, privilege_type;

SELECT
  'anon' AS role_name,
  has_table_privilege('anon', 'public.notes', 'SELECT') AS can_select,
  has_table_privilege('anon', 'public.notes', 'INSERT') AS can_insert,
  has_table_privilege('anon', 'public.notes', 'UPDATE') AS can_update,
  has_table_privilege('anon', 'public.notes', 'DELETE') AS can_delete
UNION ALL
SELECT
  'authenticated',
  has_table_privilege('authenticated', 'public.notes', 'SELECT'),
  has_table_privilege('authenticated', 'public.notes', 'INSERT'),
  has_table_privilege('authenticated', 'public.notes', 'UPDATE'),
  has_table_privilege('authenticated', 'public.notes', 'DELETE');

SELECT policyname, permissive, roles, cmd, qual AS using_expression, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'notes'
ORDER BY cmd, policyname;
