package com.ssafy.yorr.game.teamyacht;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/**
 * 조별과제 야트 한 판의 전체 상태(S15P11A406-209). 방마다 하나씩 Redis에 직렬화되어 산다.
 * <p>
 * <b>이 값은 그대로 클라이언트에 나가지 않는다.</b> 앞 주자가 버린 주사위 눈은 뒷 주자에게
 * 숨겨야 하고, 숨기는 주체는 서버여야 한다 — 전부 내려보내고 화면에서 가리면 개발자 도구로
 * 다 보인다. 사람이 보는 모양은 {@link TeamYachtView}가 플레이어별로 만든다.
 * <p>
 * 일반 야추({@code YACHT_DICE})의 {@code RoundState}를 쓰지 않는 이유: 여기서 한 라운드는
 * "한 사람이 세 번 굴리기"가 아니라 "세 사람이 한 번씩 굴리기"이고, 기록도 개인이 아니라
 * 다수결이다. 같은 상태에 두 규칙을 얹으면 일반 야추가 깨진다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record TeamYachtState(
        int version,
        Stage stage,
        /** 이번 라운드의 주자 순서. 라운드마다 한 칸 로테이션된다(index 0 = 1번 주자). */
        List<String> seats,
        int round,
        /** 지금 굴릴/킵할 주자의 seats 인덱스(0~2). */
        int leg,
        /** 주사위 5개의 눈. 아직 굴리지 않은 자리는 0이다. */
        List<Integer> dice,
        /** 이미 킵돼 잠긴 주사위. 잠긴 눈은 모두에게 공개된다. */
        List<Boolean> kept,
        /** 이번 라운드의 족보 투표(playerId → 족보 apiKey). */
        Map<String, String> votes,
        /** 팀이 공유하는 점수판(족보 apiKey → 확정 점수). 기록된 칸만 들어 있다. */
        Map<String, Integer> recorded,
        /** 주사위·룰렛에 쓰는 LCG 시드. 굴릴 때마다 전진한다(프론트 dice.ts와 같은 상수). */
        long seed,
        /** 직전에 기록된 칸. 룰렛으로 결정됐으면 후보 3개가 함께 들어 있다. */
        Recorded last
) {
    public TeamYachtState {
        seats = seats == null ? List.of() : List.copyOf(seats);
        dice = dice == null ? List.of() : List.copyOf(dice);
        kept = kept == null ? List.of() : List.copyOf(kept);
        votes = votes == null ? Map.of() : Map.copyOf(votes);
        recorded = recorded == null ? Map.of() : Map.copyOf(recorded);
    }

    public boolean finished() {
        return stage == Stage.FINISHED;
    }

    /** 지금 굴리거나 킵할 사람. 투표·종료 단계에는 없다. */
    public String runnerId() {
        return stage == Stage.ROLL || stage == Stage.KEEP ? seats.get(leg) : null;
    }

    public enum Stage {
        /** 현재 주자가 굴릴 차례. */
        ROLL,
        /** 현재 주자가 킵을 고를 차례(마지막 주자는 이 단계를 건너뛴다). */
        KEEP,
        /** 주사위 5개가 확정됐다. 세 명이 족보를 지목한다. */
        VOTE,
        FINISHED
    }

    /**
     * 한 라운드의 기록 결과.
     *
     * @param rouletteCandidates 동표(1:1:1)라 룰렛으로 정한 경우의 후보 3개. 다수결로 정해졌으면 null.
     * @param rouletteSeed       룰렛을 돌린 시드. 클라이언트 연출이 같은 값에서 멈추게 하려고 함께 내린다.
     */
    public record Recorded(
            int round,
            String category,
            int score,
            List<String> rouletteCandidates,
            Long rouletteSeed
    ) {
    }
}
