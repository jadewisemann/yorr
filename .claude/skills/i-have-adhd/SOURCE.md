# 출처

이 스킬은 외부 저장소에서 가져온 것이다. **`SKILL.md`는 원본과 바이트 단위로 동일하게 유지한다** —
직접 손대면 업스트림 갱신 때 diff가 지저분해진다. 우리 사정에 맞게 고칠 일이 생기면
이 파일에 사유를 적고 고친다.

| | |
|---|---|
| 원본 | https://github.com/ayghri/i-have-adhd |
| 경로 | `skills/i-have-adhd/SKILL.md` |
| 라이선스 | MIT (전문은 같은 폴더 `LICENSE`) |
| 가져온 날짜 | 2026-08-15 |

## 이게 뭔가

출력 형식만 바꾸는 스킬이다. 코드·빌드·CI에 아무 영향이 없다.
`disable-model-invocation: true`라 **모델이 스스로 켤 수 없다** — 쓰려는 사람이
`/i-have-adhd`를 직접 치면 그 세션 내내 유지되고, "stop adhd mode"라고 하면 꺼진다.
아무도 부르지 않으면 아무 일도 일어나지 않는다.

## 왜 저장소에 커밋했나

Claude Code 웹/클라우드 세션은 매번 새 컨테이너에서 저장소를 clone한다.
`claude plugin install`은 `~/.claude/`에 설치되므로 컨테이너가 회수되면 같이 사라진다.
`.claude/`는 저장소에 있으니 clone과 함께 따라온다 — 이미 `.claude/settings.json`과
`.claude/hooks/`가 같은 이유로 커밋돼 있다.

## 갱신하는 법

```bash
curl -sSL -o .claude/skills/i-have-adhd/SKILL.md \
  https://raw.githubusercontent.com/ayghri/i-have-adhd/main/skills/i-have-adhd/SKILL.md
```

받은 뒤 `git diff`로 무엇이 바뀌었는지 확인하고, 이 파일의 "가져온 날짜"를 고친다.
