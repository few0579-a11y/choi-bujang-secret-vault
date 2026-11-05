# 검문소·탐지 규칙

실제로 구현한 규칙만 아래 표에 추가하세요. 규칙 이름, 단계, 어떤 요청을 막는지, 확인한 방법을 함께 적으세요.

| 규칙 | 단계 | 막는 공격 | 확인 방법 |
|---|---|---|---|
| `device_registered` | 6 | 미등록 기기의 요청 | `npm run decider:test` (가상 요청 연습) |
| `step_up_required` | 7 | 이상 신호가 2개 이상 겹친 접속 | `npm run fixture:7` (가상 요청 연습) |
| `resource_zone` | 8 | 메모 전체 목록, 반 공지 쓰기, 강사 자료, 알 수 없는 경로 | `npm run fixture:8` (가상 요청 연습) |
| API 소유자·강사 확인 | 8 | 다른 사람 메모 조회·수정, 학생의 공지 수정, 본문 `role` 주장 | `api/notes/[id].js`, `api/notices*.js`, `api/admin/notices/[id].js` 코드 (배포 후 직접 요청은 미실행) |

브라우저에서 버튼을 숨기는 것만으로 서버 접근이 차단됐다고 적지 마세요.
