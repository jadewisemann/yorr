import type { CompletionRoomSnapshot, Ranking } from '../completion/index.js'
import type { MatchArchiveStore, MatchParticipantRow, MatchRecord } from './matchArchiveStore.js'

/**
 * 끝난 판을 MySQL에 남긴다.
 * 여기까지 오지 않으면 결과는 Redis와 함께 40분 만에 사라진다.
 *
 * DESIGN.md 원칙 6의 **유일한 MySQL 쓰기 지점**이다: 게임이 진행되는 동안은 MySQL을
 * 만지지 않고, 종료 시점에만 기록한다. 호출자는 두 곳이다 —
 * ① `GameCompletionService`(`MatchArchivePort` 자리. 실패를 삼켜
 * `onArchiveFailure`로 흘린다) ② 탁구 AI 결과 REST(`archiveParticipants`).
 */

/** 서비스에 들어오는 참가자 — 이름이 없을 수 있다(게임 끝나기 전에 나간 사람). */
interface MatchArchiveParticipant {
  readonly playerId: string
  /** 방에서 보였던 이름. 없거나 공백이면 프로필 → playerId 순으로 내려간다. */
  readonly displayNickname?: string | null | undefined
  readonly totalScore: number
  readonly ranking: number
}

/** 방 없이 진행된 로컬 게임(탁구 AI)도 같은 경기·참가자 저장 규칙을 쓴다. */
export interface MatchArchiveInput {
  readonly gameId: string | null | undefined
  readonly gameCode: string | null | undefined
  readonly roomCode: string | null | undefined
  readonly participants: readonly MatchArchiveParticipant[]
}

/**
 * 주간 랭킹 캐시의 무효화 자리.
 *
 * 랭킹이 바뀔 수 있는 시점은 판이 끝날 때뿐이므로 주기적으로 다시 계산하는 대신
 * 여기서 알린다. **주입하지 않아도 보관은 동작한다** — 배선(`server.ts`)이 붙인다.
 */
interface RankingCacheInvalidator {
  invalidateAll(): void | Promise<void>
}

interface MatchArchivedEvent {
  readonly gameId: string
  readonly roomCode: string
  readonly playerCount: number
}

export interface MatchArchiveServiceOptions {
  /**
   * 보관 시각. **UTC 벽시계로 저장된다** — `Date`는 순간(instant)이고 UTC로 적는
   * 것은 풀의 `timezone: 'Z'`다. 주입 가능한 것은 주간 랭킹의 KST 주 경계 계산이
   * 이 값을 기준으로 시험되기 때문이다.
   */
  readonly now?: () => Date
  readonly rankingCache?: RankingCacheInvalidator
  /** 저장 성공 알림. */
  readonly onArchived?: (event: MatchArchivedEvent) => void
  /** 멱등이 실제로 걸렸다는 신호. */
  readonly onDuplicate?: (gameId: string) => void
}

/** display_nickname이 비었을 때 마지막으로 남기는 이름. */
export const FALLBACK_NICKNAME = '플레이어'

/** `match_participants.display_nickname`은 VARCHAR(20)이다. */
export const DISPLAY_NICKNAME_LIMIT = 20

/**
 * 닉네임 우선순위: **방 표시 이름 → 프로필 닉네임 → playerId 원문**.
 *
 * 그때 화면에 보였던 이름을 남기는 것이 목적이라(persistence.md의 dual-write 표)
 * 20자를 넘으면 거절하지 않고 **잘라서라도 남긴다**. 셋 다 비면 "플레이어".
 * 앞뒤 공백은 다듬지 않는다 — 방 이름은 이미
 * `normalizeNickname`(1~20자, trim)을 통과한 값이라 다듬을 것이 없다.
 */
export const resolveDisplayNickname = (
  roomNickname: string | null | undefined,
  profileNickname: string | null | undefined,
  playerId: string,
): string => {
  const chosen = isBlank(roomNickname)
    ? isBlank(profileNickname)
      ? playerId
      : profileNickname
    : roomNickname
  if (isBlank(chosen)) return FALLBACK_NICKNAME
  return chosen.length > DISPLAY_NICKNAME_LIMIT ? chosen.slice(0, DISPLAY_NICKNAME_LIMIT) : chosen
}

export class MatchArchiveService {
  private readonly now: () => Date

  constructor(
    private readonly store: MatchArchiveStore,
    private readonly options: MatchArchiveServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date())
  }

  /**
   * 게임 종료 경로 — `MatchArchivePort`를 **구조적으로** 만족한다(어댑터 없음).
   *
   * @param room 끝난 게임의 방 스냅샷. 닉네임은 여기서 가져온다 — 순위 payload에는
   *   점수만 있다.
   * @param rankings 서버가 확정한 최종 순위.
   * @returns 이 호출이 실제로 저장했는지. 이미 저장된 판이면 false.
   */
  async archive(
    room: CompletionRoomSnapshot | null | undefined,
    rankings: readonly Ranking[] | null | undefined,
  ): Promise<boolean> {
    return this.withCacheEviction(async () => {
      if (room == null || isBlank(room.gameId)) return false
      if (rankings == null || rankings.length === 0) return false

      // 같은 playerId가 두 번 있으면 먼저 온 이름을 쓴다.
      const roomNicknames = new Map<string, string>()
      for (const player of room.players) {
        if (!roomNicknames.has(player.playerId)) roomNicknames.set(player.playerId, player.nickname)
      }
      return this.save({
        gameId: room.gameId,
        gameCode: room.gameCode,
        roomCode: room.roomCode,
        participants: rankings.map((ranking) => ({
          playerId: ranking.playerId,
          displayNickname: roomNicknames.get(ranking.playerId),
          totalScore: ranking.total,
          ranking: ranking.rank,
        })),
      })
    })
  }

  /** 방 없이 진행된 로컬 게임(탁구 AI 결과 REST)의 진입점. */
  async archiveParticipants(input: MatchArchiveInput): Promise<boolean> {
    return this.withCacheEviction(async () => this.save(input))
  }

  private async save(input: MatchArchiveInput): Promise<boolean> {
    const { gameId, gameCode, roomCode, participants } = input
    if (isBlank(gameId) || isBlank(gameCode) || isBlank(roomCode) || participants.length === 0) {
      return false
    }

    const members = await this.store.findMemberNicknames(participants.map((it) => it.playerId))
    const rows: MatchParticipantRow[] = participants.map((participant) => ({
      playerId: participant.playerId,
      // 회원 판정은 users 테이블의 존재 여부다 — Redis 세션이 아니다.
      userId: members.has(participant.playerId) ? participant.playerId : null,
      displayNickname: resolveDisplayNickname(
        participant.displayNickname,
        members.get(participant.playerId),
        participant.playerId,
      ),
      totalScore: participant.totalScore,
      ranking: participant.ranking,
    }))

    const record: MatchRecord = {
      gameId,
      gameCode,
      roomCode,
      finishedAt: this.now(),
      participants: rows,
    }
    const saved = await this.store.insert(record)
    if (saved) {
      this.options.onArchived?.({ gameId, roomCode, playerCount: rows.length })
    } else {
      this.options.onDuplicate?.(gameId)
    }
    return saved
  }

  /**
   * **저장하지 않은 호출(중복 판·검증 실패)에도** 캐시를 비운다 — 반환값으로 조건을
   * 거는 복잡함보다 캐시 미스 한 번이 싸다.
   *
   * 무효화 실패는 보관 결과를 뒤집지 않는다. 행은 이미 커밋됐고, 캐시가 남아 있다는
   * 이유로 종료 경로에 실패를 보고하면 거짓말이 된다.
   */
  private async withCacheEviction(work: () => Promise<boolean>): Promise<boolean> {
    const result = await work()
    try {
      await this.options.rankingCache?.invalidateAll()
    } catch {
      // 캐시는 다음 조회에서 저절로 맞춰진다.
    }
    return result
  }
}

const isBlank = (value: string | null | undefined): value is null | undefined =>
  value == null || value.trim().length === 0
