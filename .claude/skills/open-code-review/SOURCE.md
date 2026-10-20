# 출처

이 스킬은 외부 저장소에서 가져온 것이다. **`SKILL.md`는 원본과 바이트 단위로 동일하게 유지한다** —
직접 손대면 업스트림 갱신 때 diff가 지저분해진다. 우리 사정에 맞게 고칠 일이 생기면
이 파일에 사유를 적고 고친다.

| | |
|---|---|
| 원본 | https://github.com/alibaba/open-code-review |
| 경로 | `skills/open-code-review/SKILL.md` |
| 라이선스 | Apache-2.0 |
| 가져온 커밋 | `55450a95e5999dfd00ec2d582c23d76e269922fb` |
| 가져온 날짜 | 2026-10-19 |

## 이게 뭔가

`ocr` CLI로 Git diff를 AI 리뷰하는 스킬이다. 코드·빌드·CI에는 영향이 없고, 리뷰를
요청할 때만 쓰인다. 실행에는 `ocr` CLI와 LLM 제공자 설정(`~/.opencodereview/config.json`)이
필요하다 — 자격증명은 저장소에 넣지 않는다.

## 왜 저장소에 커밋했나

Claude Code 웹/클라우드 세션은 매번 새 컨테이너에서 저장소를 clone한다.
`~/.claude/`에만 설치하면 컨테이너가 회수될 때 같이 사라진다. `.claude/`는 저장소에
있으니 clone과 함께 따라온다 — 다른 스킬·훅과 같은 이유다.

## 갱신하는 법

```bash
curl -sSL -o .claude/skills/open-code-review/SKILL.md \
  https://raw.githubusercontent.com/alibaba/open-code-review/main/skills/open-code-review/SKILL.md
```

받은 뒤 `git diff`로 무엇이 바뀌었는지 확인하고, 이 파일의 "가져온 커밋"과 "가져온 날짜"를 고친다.
