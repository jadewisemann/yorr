# YORR(요르) 프로젝트 — Claude Code 작업 지침

> 이 파일은 Claude Code가 이 저장소에서 작업할 때 **자동으로 읽어 지켜야 하는 규칙**이다.
> Git 협업 규칙의 **단일 기준(source of truth)은 [CONTRIBUTING.md](CONTRIBUTING.md)** 이며,
> 아래는 그중 Claude가 git 작업 시 반드시 지켜야 할 핵심을 요약한 것이다. 충돌 시 CONTRIBUTING.md가 우선한다.

## 저장소 정보
- GitLab: `lab.ssafy.com/s15-webmobile1-sub1/S15P11A406`
- Jira 프로젝트 키: `S15P11A406`
- 브랜치 전략: `main`(배포) ← `develop`(통합) ← `feature/*` · `fix/*`(작업)

## 🚫 절대 규칙 (반드시 지킬 것)
1. **`main` · `develop`에 직접 커밋/push 금지.** 항상 `feature/*` 또는 `fix/*` 브랜치에서 작업하고 MR로 병합한다. (원격은 Protected Branch로 잠겨 있음)
2. **공유 브랜치(`main` · `develop`)는 rebase · force push 금지.** rebase는 "나만 쓰는 개인 브랜치"에서만.
3. 사용자가 명시적으로 요청하지 않는 한 **push · MR 생성은 임의로 하지 않고 먼저 확인**받는다.

## 🌿 브랜치 이름
```
feature/<Jira번호>-<짧은-영문-설명>
fix/<Jira번호>-<짧은-영문-설명>
```
- **소문자 + 하이픈 + 영문만** (한글·공백 금지)
- 앞에 Jira 티켓 번호, 브랜치 하나 = 티켓 하나
- 예: `feature/22-websocket-connection`, `fix/26-broadcast-npe`

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

## 🔀 Merge Request
- 방향: `develop` ← `feature/*`
- MR 제목도 커밋과 같은 형식: `feat: ...`
- 설명에 작업 내용 + 관련 Jira 번호, 리뷰어 1명 이상 지정 후 승인 시 병합
- 병합 방식: **Merge commit(`--no-ff`) 기본**, 병합 후 feature 브랜치 삭제
- MR은 작게 — 기능 하나 = MR 하나

## 📋 작업 사이클
```bash
git checkout develop && git pull origin develop      # 1. develop 최신화
git checkout -b feature/22-websocket-connection      # 2. 작업 브랜치 분기
# 3. 작업 → 커밋 (컨벤션대로)
git push -u origin feature/22-websocket-connection   # 4. push
# 5. GitLab에서 MR 생성 (develop ← feature) → 리뷰어 지정
```

---
_상세 내용·예외 상황은 [CONTRIBUTING.md](CONTRIBUTING.md) 참고._
