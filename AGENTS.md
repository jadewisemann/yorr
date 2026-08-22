# YORR(요르) 프로젝트 — 에이전트 작업 지침

> 이 파일은 저장소 공통 작업 방식과 Git 협업 규칙의 **단일 기준**이다.
> Claude Code · Codex 등 모든 코딩 에이전트는 작업 전에 이 파일을 따른다.
> 디렉터리별 규칙은 [`backend/AGENTS.md`](backend/AGENTS.md)와
> [`frontend/AGENTS.md`](frontend/AGENTS.md)를 추가로 따른다.

## 저장소와 브랜치

- GitHub: `github.com/jadewisemann/yorr`
- 흐름: `main`(기준·배포) ← 작업 브랜치. 별도 `develop`은 두지 않는다.
- `main`에 직접 커밋하거나 push하지 않는다. 최신 `main`에서 작업 브랜치를 만들고
  PR로 병합한다. GitHub 보호 설정이 대신 막아 줄 것이라고 가정하지 않는다.
- `main` 등 공유 브랜치는 rebase하거나 force push하지 않는다. rebase와
  `--force-with-lease`는 혼자 쓰는 작업 브랜치에서만 허용한다.
- 공유 히스토리 재작성은 사용자 승인과 원격 백업 브랜치 없이는 하지 않는다.
- 사용자가 명시적으로 요청하지 않으면 push, PR 생성, 병합을 하지 않는다.

## 브랜치 이름

형식은 `<prefix>/<짧은-영문-설명>`이다. 설명은 소문자 영문과 하이픈만 쓰며,
브랜치 하나에는 작업 하나만 담는다.

| 작업 | prefix | 예시 |
|---|---|---|
| 새 기능 | `feature/` | `feature/websocket-connection` |
| 버그 수정 | `fix/` | `fix/broadcast-npe` |
| 그 외 단일 목적 | `refactor/` · `docs/` · `chore/` · `test/` | `docs/api-spec` |

`style`은 보통 관련 작업에 포함하며 단독 브랜치를 만들지 않는다.

## 커밋 메시지

형식은 `<type>: <제목>`이다. 제목은 50자 내외로 간결하게 쓰고 마침표를 붙이지
않는다. 본문이 필요하면 무엇보다 **왜** 바꿨는지를 적는다.

| type | 용도 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서·주석 |
| `style` | 동작 변화 없는 포맷팅 |
| `refactor` | 기능 변화 없는 리팩터링 |
| `test` | 테스트 |
| `chore` | 빌드·설정·의존성·CI |

예: `feat: WebSocket 연결 핸들러 구현`

## Pull Request

- 방향은 `main` ← 작업 브랜치이며, 작업 하나당 작은 PR 하나를 만든다.
- 제목은 커밋과 같은 `type: 제목` 형식으로 쓰고 설명에 변경 이유·내용·검증 결과를
  남긴다.
- 현재 1인 작업에서는 리뷰어가 선택 사항이며 셀프 병합할 수 있다. 협업자가 생기면
  필수 리뷰와 `main` 보호 정책을 함께 재검토한다.
- 커밋 수와 무관하게 **항상 `Squash and merge`** 한다. merge commit과
  `Rebase and merge`는 사용하지 않는다. CLI에서는 `gh pr merge --squash`를 쓴다.
- squash 커밋 제목은 PR 제목을 사용하고, 병합 후 작업 브랜치를 삭제한다.

## 기본 작업 순서

1. `main`을 최신화하고 규칙에 맞는 작업 브랜치를 만든다.
2. 범위를 섞지 않고 변경·검증·커밋한다.
3. 사용자 요청이 있으면 push하고 PR을 만든다.
4. PR을 squash 병합하고 작업 브랜치를 삭제한다.
