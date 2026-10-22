import { NICKNAME_MAX_LENGTH } from '@/auth/nickname'
import type { GameKey } from '@/games'
import { useNicknameEntry } from '@/room/model/useNicknameEntry'
import { Alert } from '@/shared/components/Alert'
import { Button } from '@/shared/components/Button'
import { IconBack } from '@/shared/components/Icon'
import { Screen } from '@/shared/components/Screen'
import { TextField } from '@/shared/components/TextField'

interface NicknamePageProps {
  gameKey?: GameKey | undefined
  mode?: 'quick' | undefined
  party?: boolean | undefined
  roomCode?: string | undefined
}

/*
 * 200줄 기준선을 조금 넘긴다(원칙 7) — 이 화면은 방 만들기·초대 입장·빠른 대전
 * 세 의도가 같은 폼을 공유하는 자리라, intents 맵과 폼이 떨어지면 "의도가 문구와
 * 제출 동작을 함께 정한다"는 구조가 안 보인다.
 */
const intents = {
  join: {
    chip: null,
    subtitle: '같은 방 친구들에게 이 이름이 보여요',
    cta: '대기실 입장',
    busy: '입장하는 중이에요',
  },
  quick: {
    chip: '온라인 대전',
    subtitle: '지금 기다리는 다른 사람과 바로 이어드려요',
    cta: '상대 찾기',
    busy: '상대를 찾고 있어요',
  },
  create: {
    chip: '온라인 프라이빗 룸',
    subtitle: '방을 만들면 초대 링크가 바로 생성돼요',
    cta: '대기실 입장',
    busy: '방을 만들고 있어요',
  },
} as const

export function NicknamePage({ gameKey, mode, party = false, roomCode }: NicknamePageProps) {
  const entry = useNicknameEntry({ gameKey, mode, party, roomCode })
  const copy = intents[roomCode ? 'join' : entry.quick ? 'quick' : 'create']

  return (
    <Screen className="relative max-w-2xl overflow-hidden">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-32 -left-7 font-mono text-[11.875rem] leading-none font-bold tracking-[-0.04em] text-content/4 select-none"
      >
        {roomCode ?? 'YORR'}
      </span>

      <header className="relative flex items-center gap-3">
        <button
          aria-label="뒤로 가기"
          className="grid size-11 flex-none cursor-pointer place-items-center rounded-card border border-border bg-surface text-content transition-colors hover:bg-surface-raised focus-ring pressable"
          onClick={entry.goHome}
          type="button"
        >
          <IconBack className="size-4.5" />
        </button>
        <span className="inline-flex h-[2.125rem] items-center gap-2 rounded-full border border-border bg-surface-veil px-3.5 text-xs font-semibold">
          {roomCode ? (
            <>
              초대 코드{' '}
              <span className="font-mono font-bold tracking-[0.1em] text-content">{roomCode}</span>
            </>
          ) : (
            copy.chip
          )}
        </span>
      </header>

      <div className="relative mt-11 grid gap-2">
        <h1 className="m-0 text-2xl leading-[1.3] font-bold tracking-[-0.02em]">
          어떤 이름으로 참가할까요?
        </h1>
        <p className="m-0 text-sm text-content-muted">{copy.subtitle}</p>
      </div>

      <form
        className="relative mt-8 flex min-h-0 flex-1 flex-col gap-4"
        onSubmit={entry.handleSubmit}
        noValidate
      >
        <TextField
          label={<span className="sr-only">닉네임</span>}
          value={entry.nickname}
          placeholder={entry.suggestion}
          helpText={
            <>
              비워두면 <span className="font-semibold text-content">{entry.suggestion}</span>
              (으)로 입장해요 · 한글·영문·숫자 1~{NICKNAME_MAX_LENGTH}자
            </>
          }
          errorMessage={entry.validationError}
          maxLength={NICKNAME_MAX_LENGTH + 1}
          autoComplete="nickname"
          disabled={entry.task.isLoading}
          onChange={(event) => entry.handleNicknameChange(event.target.value)}
        />
        <div className="mt-auto grid gap-3">
          {entry.signInRequired && (
            <Alert tone="danger">
              빠른 대전은 로그인이 필요해요. 홈에서 로그인한 뒤 다시 시도해 주세요.
            </Alert>
          )}
          {!roomCode && !entry.quick && (
            <Alert className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="grid size-5 flex-none place-items-center rounded-chip bg-border text-2xs leading-none font-bold text-content"
              >
                1
              </span>
              방을 만든 사람이 호스트가 돼요
            </Alert>
          )}
          {entry.userError && (
            <Alert className="grid gap-2 text-left" tone="danger">
              {/* role은 Alert가 든다 — 여기 또 적으면 이중으로 읽힌다 */}
              <p className="m-0">{entry.userError.message}</p>
              {entry.userError.canChangeRoom && (
                <Button type="button" variant="secondary" onClick={entry.goHome}>
                  {roomCode ? '다른 코드 입력' : '홈으로'}
                </Button>
              )}
            </Alert>
          )}
          <Button
            className="w-full"
            disabled={entry.signInRequired}
            loading={entry.task.isLoading}
            size="cta"
            type="submit"
          >
            {entry.task.isLoading ? copy.busy : copy.cta}
          </Button>
        </div>
      </form>
    </Screen>
  )
}
