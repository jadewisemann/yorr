# 🌱 YORR(요르) Git 협업 컨벤션 v1.4

> 대상: 팀 전원 (BE · FE · AI · Infra)
> 저장소: GitHub (`github.com/jadewisemann/yorr`) · Jira 프로젝트: **S15P11A406**
> 이 문서가 브랜치 · 커밋 · PR의 **단일 기준**이다. 헷갈리면 여기부터.

---

## 🎯 왜 필요한가

규칙이 없으면 `main`이 깨지고, 히스토리가 꼬이고, "누가 뭘 바꿨는지"가 사라진다.
사실 **핵심 3개**만 지키면 나머지는 곁가지다:

1. **`main`엔 직접 push 안 한다 → 무조건 PR**
2. **PR은 언제나 `Squash and merge`로 병합한다** — 리뷰어 지정은 **선택**이다 (아래 참고)
3. **브랜치 · 커밋 이름은 아래 형식대로**

> **리뷰는 사람이 있을 때만 하는 것이다.** 이 저장소는 현재 **1인 작업** 상태라
> 리뷰어 승인을 병합 조건으로 두지 않는다. PR 자체는 그대로 쓴다 — 변경 단위가 남고,
> CI가 돌고, 나중에 "왜 이렇게 했지"를 되짚을 수 있다. 리뷰의 값어치는 승인 도장이
> 아니라 그 기록이다.
>
> **사람이 늘면 되돌린다.** 협업자가 생기는 시점에 이 문서에서 "선택"을
> "1명 이상 필수"로 바꾸고, `main`에 Branch Protection(Require pull request reviews)을
> 켠다. 그때까지는 셀프 병합이 정상이다.

---

## 🌿 브랜치 전략 (main 단일 기준)

| 브랜치 | 역할 | 직접 push | 흐름 |
|---|---|---|---|
| `main` | 🚀 기준 · 배포. 항상 동작하는 상태 | ❌ 금지 | 작업 브랜치 → `main` |
| `feature/*` | 🌱 새 기능 | ✅ 자유 | `main`에서 분기 → `main`으로 PR |
| `fix/*` | 🐛 버그 수정 | ✅ 자유 | 〃 |
| `refactor/*` · `docs/*` · `chore/*` · `test/*` | ♻️ 브랜치 전체가 그 한 가지 작업일 때 (리팩터링 · 문서 · 설정/의존성 · 테스트) | ✅ 자유 | 〃 |

> 별도 `develop` 통합 브랜치는 두지 않는다 — 작업 브랜치가 곧바로 `main`으로 합쳐진다.
> ⚠️ **`main`에 직접 push 금지는 규칙이지, 지금은 강제되지 않는다.** Protected Branch가
> **아직 안 켜져 있다**(2026-08-16 확인 — GitHub API `protected: false`). 즉 `git push
> origin main`이 **그냥 성공한다.** 막아 주는 것이 없으니 손으로 지켜야 한다.
>
> 켜지 않는 이유는 1인 작업이라서다 — 리뷰어 승인을 병합 조건에서 뺀 것(위 "왜 필요한가")과
> 같은 판단이고, 지금 켜면 셀프 병합이 막힌다. **협업자가 생기는 시점에 리뷰어 필수 복구와
> 함께 켠다.**
>
> 대부분의 작업은 `feature/*` · `fix/*`다. `refactor` · `docs` · `chore` · `test`는 **브랜치 전체가 순수하게 그 일만** 할 때만 쓴다(예: 리팩터링만 하는 브랜치). 포맷팅(`style`)은 보통 다른 작업에 딸려가므로 단독 브랜치를 거의 만들지 않는다.

### 브랜치 이름 규칙

```
<prefix>/<Jira번호>-<짧은-영문-설명>
```

- **prefix = 그 브랜치의 대표 커밋 type을 그대로 쓴다.** (아래 [커밋 type 목록](#type-목록)과 동일한 단어 사용 → 외울 게 하나로 통일됨)
  - 단 새 기능은 관례상 `feat`가 아니라 **`feature/`**, 버그 수정은 **`fix/`**.
  - 나머지는 커밋 type 이름 그대로: `refactor/` · `docs/` · `chore/` · `test/`.
- **소문자 + 하이픈 + 영문**만. (한글 · 공백 브랜치명은 일부 환경에서 깨짐)
- 앞에 **Jira 티켓 번호** → Jira ↔ GitHub 추적이 쉬워짐.
- **브랜치 하나 = 티켓(작업) 하나.** 여러 작업 섞지 말 것.

| ✅ 좋은 예 | ❌ 나쁜 예 |
|---|---|
| `feature/22-websocket-connection` | `feature/정현작업` (한글) |
| `fix/26-broadcast-npe` | `feat` (설명 없음) |
| `refactor/31-wscodec-split` | `feature/작업중_이것저것` (범위 너무 큼) |
| `docs/12-api-spec` | `feature/12-docs` (prefix와 내용 불일치) |

---

## ✍️ 커밋 메시지 규칙

### 형식

```
<type>: <제목>

<본문(선택): 왜 / 무엇을 바꿨는지>
```

- **제목**: 50자 내외, 한글 OK, 끝에 마침표 X, 간결하게.
- **본문**: 필요할 때만. "왜" 바꿨는지 위주로.

### type 목록

| type | 쓰는 경우 |
|---|---|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `docs` | 문서 · 주석 (README, 이 컨벤션 등) |
| `style` | 포맷팅 · 세미콜론 등 (동작 변화 X) |
| `refactor` | 리팩터링 (기능 변화 X) |
| `test` | 테스트 추가 · 수정 |
| `chore` | 빌드 · 설정 · 의존성 · gitignore 등 (인프라 CI 포함) |

### 예시

```
feat: WebSocket 연결 핸들러 및 JOIN 처리 구현
fix: 방장 퇴장 시 hostId 갱신 누락 수정
docs: Git 협업 컨벤션 추가
refactor: WsCodec 디코드 로직 분리
chore: Spring Boot 4.1 의존성 추가
```

> 💡 (선택) Jira 자동 연동을 쓸 거면 본문에 `Refs: S15P11A406-22`처럼 티켓 키를 넣으면 커밋 ↔ 티켓 링크가 잡힌다. 안 넣어도 브랜치 번호로 추적 가능.

---

## 🔀 Pull Request (PR) 규칙

> PR = 작업 브랜치를 `main`에 합치기 전 **변경 단위를 기록**하는 절차.
> (협업자가 있으면 여기에 리뷰 요청이 얹힌다.)

1. **`main` ← `feature/*`** 방향으로 PR 생성.
2. **PR 제목**은 커밋과 같은 형식: `feat: WebSocket 연결 구현`
3. **설명**에 뭘 했는지 + 관련 Jira 번호(예: `S15P11A406-22`).
4. **리뷰어 지정은 선택.** 1인 작업 중이므로 **올린 사람이 그대로 merge**한다.
   봐줄 사람이 있으면 지정하고 승인 후 병합 — 그 경우에도 merge는 올린 사람이 한다
   (Developer 권한 있음 → 팀장 안 거쳐도 됨).
5. 병합 방식: **언제나 Squash. 예외 없음.**
   - GitHub PR 화면에서 **`Squash and merge`** 만 쓴다. `Create a merge commit`(`--no-ff`) ·
     `Rebase and merge`는 쓰지 않는다. CLI/API도 동일(`gh pr merge --squash`, API `merge_method: "squash"`).
   - 브랜치 안 커밋이 몇 개든 `main`에는 **커밋 1개**로 들어간다. 커밋 개수에 따른 분기는 없다.
   - **Squash 커밋 제목 = PR 제목**이므로 PR 제목을 커밋 컨벤션(`type: 제목`)대로 쓴다.
   - 브랜치 안에서는 WIP 커밋을 자유롭게 쌓아도 된다 — 어차피 하나로 합쳐진다.
   - 어떤 브랜치에서 왔는지는 squash 커밋에 붙는 `(#번호)`와 PR 페이지가 기록한다.
6. 병합 후 **feature 브랜치 삭제**(PR 화면의 Delete branch 버튼).
7. **PR은 작게.** 기능 하나 = PR 하나. 거대한 PR은 리뷰가 불가능 → 쪼갤 것.

---

## 🔁 rebase / merge 정책

> 🍶 비유: **내 방(개인 feature 브랜치)** 가구는 맘대로 재배치(rebase)해도 된다. 하지만 **공용 거실(`main`)** 가구는 절대 못 옮긴다 — 다른 사람 동선이 다 꼬인다.

- ✅ **개인 feature 브랜치**: `main`이 앞서갔으면 `git rebase main`으로 최신화 OK (히스토리 깔끔).
- ❌ **공유 브랜치(`main`)**: rebase · force push **절대 금지**.
- ⚠️ feature를 **남과 같이 쓰는 중**이면 rebase 대신 merge로. (rebase는 "나만 쓰는 브랜치"일 때만)

---

## 📋 작업 한 사이클 (복붙용)

```bash
# 1. main 최신화
git checkout main
git pull origin main

# 2. 작업 브랜치 분기 (Jira 번호 + 설명)
git checkout -b feature/22-websocket-connection

# 3. 작업 → 커밋 (컨벤션대로)
git add .
git commit -m "feat: WebSocket 연결 핸들러 구현"

# 4. 원격에 push
git push -u origin feature/22-websocket-connection

# 5. GitHub 웹에서 PR 생성 (main ← feature) → 그대로 merge
#    (봐줄 사람이 있으면 리뷰어 지정 후 승인 받고 merge)

# --- main이 그새 바뀌어 충돌 나면: 내 브랜치에서 ---
git checkout feature/22-websocket-connection
git pull --rebase origin main        # 개인 브랜치라 rebase OK
# 충돌 해결 후
git add .
git rebase --continue
git push --force-with-lease           # rebase했으니 강제 push (반드시 내 브랜치에만!)
```

> Jira 티켓은 작업 시작 시 **진행 중**, PR 병합 후 **완료**로 옮기기.

---

## 🚫 하지 말 것 (한눈에)

- ❌ `main`에 직접 push / force push
- ❌ PR 없이 merge (리뷰 없이 merge는 1인 작업 중이라 **괜찮다** — PR만 남기면 된다)
- ❌ 공유 브랜치(`main`) rebase
- ❌ 한글 · 공백 브랜치명
- ❌ 기능 여러 개를 묶은 거대 PR / 커밋

---

## 📎 부록

### .gitignore
Spring Boot · React/Vite · Python 멀티스택으로 **이미 설정됨**. 새 산출물(빌드 결과 · `.env` · IDE 설정)이 올라가면 여기 추가하고 `chore:` 커밋.

### PR 템플릿
레포의 **`.github/pull_request_template.md`** 에 저장돼 있어, PR을 열 때 이 체크리스트가 자동으로 채워진다(= 규칙이 행동 시점에 강제됨).

```markdown
## 📌 작업 내용
<!-- 무엇을 왜 했는지 간단히 -->

## 🔗 관련 티켓
- Jira: S15P11A406-<번호>

## ✅ 체크리스트
- [ ] 브랜치명 규칙 준수 (`feature/<번호>-<설명>`)
- [ ] 커밋 메시지 컨벤션 준수 (`type: 제목`)
- [ ] PR 제목이 `type: 제목` 형식 (**그대로 squash 커밋 제목이 된다**)
- [ ] 로컬에서 정상 동작 확인
- [ ] 병합은 **`Squash and merge`** 로 (merge commit · rebase 금지)

## 💬 메모
<!-- 나중의 내가 알아야 할 것 · 리뷰어가 있다면 봐줬으면 하는 부분 -->
```

---
_v1.4 · 규칙 변경 시 이 문서 갱신_
_v1.4 — 병합 방식을 **언제나 Squash**로 단일화(커밋 개수 기준 분기 폐지). 에이전트가 대행한
PR #9 · #10 · #11이 merge commit으로 들어가 `main`에 31커밋이 쏟아진 사고가 계기다._
_v1.3 — 1인 작업 전환: 리뷰어 승인을 병합 조건에서 뺐다. 협업자가 생기면 되돌린다._
