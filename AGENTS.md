# YORR(요르) 프로젝트 — Codex 작업 지침

> 이 파일은 Codex가 이 저장소에서 작업하기 전에 **자동으로 읽어 지켜야 하는 규칙**이다.
> Git 협업 규칙의 **단일 기준(source of truth)은 [CONTRIBUTING.md](CONTRIBUTING.md)** 이며,
> Codex는 작업을 시작하기 전에 `CONTRIBUTING.md`를 읽고, 아래 규칙과 함께 적용한다.
> 아래는 그중 Codex가 Git 작업 시 반드시 지켜야 할 핵심을 요약한 것이다. 충돌 시 `CONTRIBUTING.md`가 우선한다.

## 저장소 정보
- GitHub: `github.com/jadewisemann/yorr`
- Jira 프로젝트 키: `S15P11A406`
- 브랜치 전략: `main`(배포) ← `develop`(통합) ← `feature/*` · `fix/*`(작업)

## 🚫 절대 규칙 (반드시 지킬 것)
1. **`main` · `develop`에 직접 커밋/push 금지.** 항상 `feature/*` 또는 `fix/*` 브랜치에서 작업하고 PR로 병합한다. (원격은 Protected Branch로 잠겨 있음)
2. **공유 브랜치(`main` · `develop`)는 rebase · force push 금지.** rebase는 "나만 쓰는 개인 브랜치"에서만.
3. 사용자가 명시적으로 요청하지 않는 한 **push · PR 생성은 임의로 하지 않고 먼저 확인**받는다.

## 🌿 브랜치 이름
```
<prefix>/<Jira번호>-<짧은-영문-설명>
```
- **prefix = 그 브랜치의 대표 커밋 type.** 새 기능은 `feature/`, 버그는 `fix/`, 그 외는 커밋 type 그대로 `refactor/` · `docs/` · `chore/` · `test/`.
  - 대부분은 `feature/` · `fix/`. 나머지는 브랜치 전체가 그 한 가지 작업일 때만. `style`은 단독 브랜치를 만들지 않는다.
- **소문자 + 하이픈 + 영문만** (한글·공백 금지)
- 앞에 Jira 티켓 번호, 브랜치 하나 = 작업 하나
- 예: `feature/22-websocket-connection`, `fix/26-broadcast-npe`, `refactor/31-wscodec-split`

## ✍️ 커밋 메시지
형식: `<type>: <제목>` (제목 50자 내외, 한글 OK, 끝에 마침표 X)

| type | 용도 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서·주석 |
| `style` | 포맷팅 (동작 변화 X) |
| `refactor` | 리팩터링 (기능 변화 X) |
| `test` | 테스트 |
| `chore` | 빌드·설정·의존성 |

예: `feat: WebSocket 연결 핸들러 및 JOIN 처리 구현`
(선택) 본문에 `Refs: S15P11A406-22`로 Jira 연동 가능.

## 🔀 Pull Request
- 방향: `develop` ← `feature/*`
- PR 제목도 커밋과 같은 형식: `feat: ...`
- 설명에 작업 내용 + 관련 Jira 번호, 리뷰어 1명 이상 지정 후 승인 시 병합
- 병합 방식: **커밋 1~2개 → Merge commit(`--no-ff`), 3개 이상 → Squash**(제목은 `type: 제목`). 병합 후 feature 브랜치 삭제
- PR은 작게 — 기능 하나 = PR 하나

## 📋 작업 사이클
```bash
git checkout develop && git pull origin develop      # 1. develop 최신화
git checkout -b feature/22-websocket-connection      # 2. 작업 브랜치 분기
# 3. 작업 → 커밋 (컨벤션대로)
git push -u origin feature/22-websocket-connection   # 4. push
# 5. GitHub에서 PR 생성 (develop ← feature) → 리뷰어 지정
```

---
_상세 내용·예외 상황은 [CONTRIBUTING.md](CONTRIBUTING.md) 참고._
