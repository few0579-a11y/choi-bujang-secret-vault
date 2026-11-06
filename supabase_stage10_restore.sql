-- BYTE BACK 10단계: 메모 버전 기록(비공개 사본)과 한 건 복원 함수
-- 기존 public.notes 자료·정책은 바꾸지 않습니다. 새 테이블 2개와 함수·트리거만 추가합니다.
-- 버전 기록·감사 기록은 서버(secret key)만 접근합니다. anon·authenticated는 직접 읽거나 쓸 수 없습니다.

BEGIN;

-- 내용 해시: 제목 + 줄바꿈 + 본문의 SHA-256
CREATE OR REPLACE FUNCTION public.note_content_sha256(p_title text, p_content text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_catalog AS $$
  SELECT encode(sha256(convert_to(coalesce(p_title, '') || E'\n' || coalesce(p_content, ''), 'UTF8')), 'hex')
$$;

-- 비공개 메모 사본: 저장·수정·삭제마다 그 시점 내용을 한 줄씩 쌓습니다(덮어쓰지 않음).
CREATE TABLE IF NOT EXISTS public.note_versions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id uuid NOT NULL,
  owner_id uuid,
  title text NOT NULL,
  content text NOT NULL,
  content_sha256 text NOT NULL,
  op text NOT NULL CHECK (op IN ('baseline', 'insert', 'update', 'delete', 'restore')),
  captured_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_versions_note_idx ON public.note_versions (note_id, id DESC);

-- 복원 감사 기록: 추가만 합니다. 메모 본문·토큰은 남기지 않습니다.
CREATE TABLE IF NOT EXISTS public.note_restore_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note_id uuid NOT NULL,
  version_id bigint,
  outcome text NOT NULL,
  before_sha256 text,
  after_sha256 text,
  at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.note_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_restore_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.note_versions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.note_restore_audit FROM PUBLIC, anon, authenticated;

-- 지금 있는 메모 전부를 기준 사본(baseline)으로 한 번 떠 둡니다. 다시 실행해도 중복으로 쌓이지 않습니다.
INSERT INTO public.note_versions (note_id, owner_id, title, content, content_sha256, op)
SELECT n.id, n.owner_id, n.title, n.content, public.note_content_sha256(n.title, n.content), 'baseline'
FROM public.notes AS n
WHERE NOT EXISTS (SELECT 1 FROM public.note_versions AS v WHERE v.note_id = n.id);

-- 트리거: 메모가 바뀔 때마다 사본을 쌓습니다. 복원 함수가 쓴 것은 'restore'로 표시합니다.
CREATE OR REPLACE FUNCTION public.note_versions_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.note_versions (note_id, owner_id, title, content, content_sha256, op)
    VALUES (OLD.id, OLD.owner_id, OLD.title, OLD.content, public.note_content_sha256(OLD.title, OLD.content), 'delete');
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.title IS NOT DISTINCT FROM NEW.title
     AND OLD.content IS NOT DISTINCT FROM NEW.content AND OLD.owner_id IS NOT DISTINCT FROM NEW.owner_id THEN
    RETURN NEW; -- 내용이 같으면 쌓지 않음
  END IF;
  INSERT INTO public.note_versions (note_id, owner_id, title, content, content_sha256, op)
  VALUES (NEW.id, NEW.owner_id, NEW.title, NEW.content, public.note_content_sha256(NEW.title, NEW.content),
    CASE WHEN current_setting('app.note_restore', true) = 'on' THEN 'restore'
         WHEN TG_OP = 'INSERT' THEN 'insert' ELSE 'update' END);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notes_capture_versions ON public.notes;
CREATE TRIGGER notes_capture_versions
AFTER INSERT OR UPDATE OR DELETE ON public.notes
FOR EACH ROW EXECUTE FUNCTION public.note_versions_capture();

-- 한 건 복원: 지금 있으면 '마지막 수정 직전 버전'으로, 지워졌으면 '삭제 직전 버전'으로 되돌립니다.
-- ID·소유자·내용 해시를 대조하고, 다른 메모와 기록은 건드리지 않습니다.
CREATE OR REPLACE FUNCTION public.restore_note_version(p_note_id uuid, p_owner uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  cur public.notes%ROWTYPE;
  has_cur boolean;
  last_update bigint;
  target public.note_versions%ROWTYPE;
  before_hash text;
  after_row public.notes%ROWTYPE;
  after_hash text;
BEGIN
  SELECT * INTO cur FROM public.notes WHERE id = p_note_id FOR UPDATE;
  has_cur := FOUND;
  IF has_cur THEN
    IF cur.owner_id IS DISTINCT FROM p_owner THEN RAISE EXCEPTION 'not_owner'; END IF;
    before_hash := public.note_content_sha256(cur.title, cur.content);
    SELECT id INTO last_update FROM public.note_versions
      WHERE note_id = p_note_id AND op = 'update' ORDER BY id DESC LIMIT 1;
    IF last_update IS NOT NULL THEN
      SELECT * INTO target FROM public.note_versions
        WHERE note_id = p_note_id AND id < last_update AND op <> 'delete' ORDER BY id DESC LIMIT 1;
    END IF;
    IF target.id IS NULL THEN
      INSERT INTO public.note_restore_audit (note_id, outcome, before_sha256, after_sha256)
      VALUES (p_note_id, 'no_change', before_hash, before_hash);
      RETURN jsonb_build_object('outcome', 'no_change', 'noteId', p_note_id, 'versionId', null,
        'ownerMatches', true, 'contentSha256', before_hash);
    END IF;
  ELSE
    SELECT * INTO target FROM public.note_versions
      WHERE note_id = p_note_id AND op = 'delete' ORDER BY id DESC LIMIT 1;
    IF target.id IS NULL THEN RAISE EXCEPTION 'no_snapshot'; END IF;
  END IF;

  IF target.note_id IS DISTINCT FROM p_note_id OR target.owner_id IS DISTINCT FROM p_owner THEN
    RAISE EXCEPTION 'not_owner';
  END IF;
  IF target.content_sha256 <> public.note_content_sha256(target.title, target.content) THEN
    RAISE EXCEPTION 'snapshot_hash_mismatch';
  END IF;
  IF has_cur AND before_hash = target.content_sha256 THEN
    INSERT INTO public.note_restore_audit (note_id, version_id, outcome, before_sha256, after_sha256)
    VALUES (p_note_id, target.id, 'no_change', before_hash, before_hash);
    RETURN jsonb_build_object('outcome', 'no_change', 'noteId', p_note_id, 'versionId', target.id,
      'ownerMatches', true, 'contentSha256', before_hash);
  END IF;

  PERFORM set_config('app.note_restore', 'on', true);
  INSERT INTO public.notes (id, owner_id, title, content)
  VALUES (target.note_id, target.owner_id, target.title, target.content)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content
    WHERE public.notes.owner_id = EXCLUDED.owner_id;
  PERFORM set_config('app.note_restore', 'off', true);

  SELECT * INTO after_row FROM public.notes WHERE id = p_note_id;
  after_hash := public.note_content_sha256(after_row.title, after_row.content);
  IF after_row.id IS NULL OR after_row.owner_id IS DISTINCT FROM target.owner_id OR after_hash <> target.content_sha256 THEN
    RAISE EXCEPTION 'restore_verify_failed';
  END IF;

  INSERT INTO public.note_restore_audit (note_id, version_id, outcome, before_sha256, after_sha256)
  VALUES (p_note_id, target.id, CASE WHEN has_cur THEN 'restored' ELSE 'undeleted' END, before_hash, after_hash);
  RETURN jsonb_build_object('outcome', CASE WHEN has_cur THEN 'restored' ELSE 'undeleted' END,
    'noteId', p_note_id, 'versionId', target.id, 'ownerMatches', true, 'contentSha256', after_hash);
END $$;

REVOKE ALL ON FUNCTION public.restore_note_version(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.note_versions_capture() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.note_content_sha256(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_note_version(uuid, uuid) TO service_role;

COMMIT;

-- 시험 계정 B의 복구 대상 가상 메모 (ID 고정: 10b00000-0000-4000-8000-000000000001)
-- 아래 '<시험 계정 B 이메일>'만 SQL Editor에서 바꿔 실행하세요. 이메일은 저장소에 적지 않습니다.
-- INSERT INTO public.notes (id, owner_id, title, content)
-- SELECT '10b00000-0000-4000-8000-000000000001', u.id, '가상 메모 B-10 (복구 시험용)', '10단계 복구 시험용 가상 메모입니다. 실제 정보가 없습니다.'
-- FROM auth.users AS u WHERE u.email = '<시험 계정 B 이메일>'
-- ON CONFLICT (id) DO NOTHING;

-- 적용 후 확인 (기대: versions_exists = true, trigger_on = true, anon_select = false, auth_exec = false)
SELECT
  to_regclass('public.note_versions') IS NOT NULL                                   AS versions_exists,
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notes_capture_versions')         AS trigger_on,
  has_table_privilege('anon', 'public.note_versions', 'SELECT')                     AS anon_select,
  has_function_privilege('authenticated', 'public.restore_note_version(uuid, uuid)', 'EXECUTE') AS auth_exec;
