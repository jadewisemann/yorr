# YORR(요르) 프로젝트 — 에이전트 작업 지침

> 이 파일이 이 저장소에서 **코딩 에이전트가 일하는 방식의 정본**이다.
> Claude Code · Codex 등 어떤 에이전트든 작업을 시작하기 전에 이 파일을 읽고 그대로 따른다.
> ([`CLAUDE.md`](CLAUDE.md)는 이 파일을 가리키는 포인터일 뿐 내용을 갖지 않는다.)
>
> Git 협업 규칙의 **단일 기준(source of truth)은 [CONTRIBUTING.md](CONTRIBUTING.md)** 이며,
> 아래는 그중 에이전트가 Git 작업 시 반드시 지켜야 할 핵심을 요약한 것이다. 충돌 시 `CONTRIBUTING.md`가 우선한다.
>
> 디렉터리별 작업 프로토콜은 각 폴더의 `AGENTS.md`에 있다 —
> [`backend/AGENTS.md`](backend/AGENTS.md) · [`frontend/AGENTS.md`](frontend/AGENTS.md).

## 저장소 정보
- GitHub: `github.com/jadewisemann/yorr`
- 브랜치 전략: `main`(기준·배포) ← `feature/*` · `fix/*`(작업) — 별도 `develop` 없음

## 🚫 절대 규칙 (반드시 지킬 것)
1. **`main`에 직접 커밋/push 금지.** 항상 `feature/*` 또는 `fix/*` 브랜치에서 작업하고 PR로 병합한다.
   ⚠️ Protected Branch는 **켜져 있지 않다** — 막아 주는 것이 없으니 규칙으로 지킨다.
2. **공유 브랜치(`main`)는 rebase · force push 금지.** rebase는 "나만 쓰는 개인 브랜치"에서만.
   히스토리 재작성이 필요하면 **먼저 사용자 승인**을 받고, 백업 브랜치를 원격에 남긴 뒤 진행한다.
3. 사용자가 명시적으로 요청하지 않는 한 **push · PR 생성은 임의로 하지 않고 먼저 확인**받는다.

## 🌿 브랜치 이름
```
<prefix>/<짧은-영문-설명>
```
- **prefix = 그 브랜치의 대표 커밋 type.** 새 기능은 `feature/`, 버그는 `fix/`, 그 외는 커밋 type 그대로 `refactor/` · `docs/` · `chore/` · `test/`.
  - 대부분은 `feature/` · `fix/`. 나머지는 브랜치 전체가 그 한 가지 작업일 때만. `style`은 단독 브랜치를 만들지 않는다.
- **소문자 + 하이픈 + 영문만** (한글·공백 금지)
- 브랜치 하나 = 작업 하나
- 예: `feature/websocket-connection`, `fix/broadcast-npe`, `refactor/wscodec-split`

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

## 🔀 Pull Request — **병합은 언제나 Squash**

- 방향: `main` ← `feature/*`
- PR 제목도 커밋과 같은 형식: `feat: ...` — **이 제목이 그대로 squash 커밋 제목이 된다.**
- 설명에 작업 내용. **리뷰어 지정은 선택** — 현재 1인 작업이라
  올린 사람이 그대로 병합한다 (협업자가 생기면 CONTRIBUTING.md에서 되돌린다)
- **PR은 작게** — 기능 하나 = PR 하나

### 병합 방식 (예외 없음)

1. **PR을 올릴 때부터 squash를 전제한다.** 브랜치 안의 커밋이 몇 개든 `main`에는
   **커밋 1개**로 들어간다. 그러니 PR 제목을 `type: 제목` 컨벤션에 맞춰 쓰고,
   브랜치 안에서는 WIP 커밋을 자유롭게 쌓아도 된다.
2. **병합(승인)도 반드시 Squash로 한다.** GitHub PR 화면에서 **`Squash and merge`**
   만 사용한다. `Create a merge commit`(`--no-ff`)·`Rebase and merge`는 쓰지 않는다.
   - CLI/API로 병합할 때도 동일: `merge_method: "squash"`
     (`gh pr merge --squash`, GitHub MCP `merge_pull_request`의 `merge_method: "squash"`).
   - **에이전트가 병합을 대행할 때 이 규칙을 어기면 `main` 히스토리가 오염된다.**
     실제로 PR #9 · #10 · #11이 merge commit으로 들어가 31개 커밋이 `main`에 쏟아졌고,
     히스토리를 재작성해 되돌려야 했다. 같은 실수를 반복하지 않는다.
3. 커밋 개수에 따른 분기는 **없다.** 1개짜리 PR도 squash로 병합한다.
4. 병합 후 **작업 브랜치 삭제**.

## 📋 작업 사이클
```bash
git checkout main && git pull origin main            # 1. main 최신화
git checkout -b feature/websocket-connection         # 2. 작업 브랜치 분기
# 3. 작업 → 커밋 (컨벤션대로, 개수 신경 안 써도 됨 — 어차피 squash)
git push -u origin feature/websocket-connection      # 4. push
# 5. PR 생성 (main ← feature) → Squash and merge → 브랜치 삭제
```

---
_상세 내용·예외 상황은 [CONTRIBUTING.md](CONTRIBUTING.md) 참고._
