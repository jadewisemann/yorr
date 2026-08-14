package com.ssafy.yorr.game.duel;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/**
 * 결투 한 판의 전체 상태. 방마다 하나씩 Redis에 직렬화되어 살아 있고, 그대로
 * WebSocket으로도 나간다 — 화면은 이 값만 보고 그린다.
 *
 * <p>진영 번호를 두지 않고 playerId를 키로 쓴다. "나를 왼쪽에 두는" 좌우 배치는
 * 화면의 몫이라 서버는 순서(playerOrder)만 알려준다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record DuelState(
        int version,
        Phase phase,
        List<String> playerOrder,
        /** 남은 총알. 0이 되면 쓰러진다. */
        Map<String, Integer> hp,
        /** 쌓인 부정출발 경고. 한도에 닿아 소진되면 0으로 돌아간다. */
        Map<String, Integer> fouls,
        /** 이번 라운드의 반응 시간(ms). FOUL·MISS 센티넬이 섞여 들어온다. 라운드마다 비운다. */
        Map<String, Integer> reactions,
        Map<String, Long> lastInputSeq,
        int round,
        /** 신호등이 초록으로 바뀐 서버 시각. 0이면 아직 빨강이다. */
        long signalAt,
        long nextActionAt,
        Round lastRound
) {
    public DuelState {
        playerOrder = playerOrder == null ? List.of() : List.copyOf(playerOrder);
        hp = hp == null ? Map.of() : Map.copyOf(hp);
        fouls = fouls == null ? Map.of() : Map.copyOf(fouls);
        reactions = reactions == null ? Map.of() : Map.copyOf(reactions);
        lastInputSeq = lastInputSeq == null ? Map.of() : Map.copyOf(lastInputSeq);
    }

    public boolean finished() {
        return phase == Phase.FINISHED;
    }

    public enum Phase {
        /** 신호등 빨강 — 여기서 뽑으면 부정출발이다. */
        WAITING,
        /** 신호등 초록 — 뽑는 순간이 기록된다. */
        SIGNAL,
        /** 판정 연출 중. */
        RESULT,
        FINISHED
    }

    /** 라운드 성격 — 규칙 근거는 {@link DuelRules} 주석에 있다. */
    public enum Kind {
        /** 정상 승부 — 더 빨리 뽑은 쪽이 상대를 쐈다. */
        SHOT,
        /** 1ms까지 동일하거나 둘 다 놓쳤다 — 체력 변화 없음. */
        TIE,
        /** 부정출발 1회차 — 라운드 무효 + 경고 적립. */
        WARNING,
        /** 경고가 차서 자기 발을 쐈다 — 본인 체력 -1. */
        SELF_SHOT,
        /** 상대가 방을 떠났다. */
        FORFEIT
    }

    /**
     * 직전 라운드 판정. 화면의 연출(총알 방향·피격·쓰러짐)이 전부 이 한 줄에서 나온다.
     * hp·fouls는 이미 판정이 반영된 값이므로, 총알이 닿기 전 프레임은 화면이 되돌려 그린다.
     */
    public record Round(
            int number,
            Kind kind,
            /** 상대를 쏜 쪽. TIE·부정출발 라운드에는 없다. */
            String shooterId,
            /** 체력을 잃은 쪽. self-shot이면 부정출발한 본인이다. */
            String hitId,
            String koId,
            String foulId,
            boolean over,
            long at
    ) {
    }
}
