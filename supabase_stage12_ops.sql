-- 12단계: 탈환 작전실(GET /api/ops)이 서버 키로 복구 사본·복원 감사 기록을 "읽기만" 하도록 권한을 줍니다.
-- 10단계 표는 RLS를 켜고 anon·authenticated 권한을 모두 회수했고, 이 프로젝트는 새 표에 service_role 권한이 자동으로 붙지 않습니다.
-- 브라우저(anon·authenticated) 권한은 그대로 없습니다. 쓰기·삭제 권한은 주지 않습니다(사본·감사 기록은 트리거와 복원 함수만 씀).
grant select on table public.note_versions to service_role;
grant select on table public.note_restore_audit to service_role;

-- 확인: service_role은 SELECT만, anon·authenticated는 없음이어야 합니다.
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('note_versions', 'note_restore_audit')
order by table_name, grantee, privilege_type;
