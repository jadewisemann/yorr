package com.ssafy.yorr.game.liars;

import com.fasterxml.jackson.annotation.JsonInclude;

import java.util.List;
import java.util.Map;

/**
 * 라이어스 다이스 한 판의 전체 상태. 방마다 하나씩 Redis에 직렬화되어 살아 있다.
 *
 * <p><b>⚠️ 이 레코드는 그대로 방송하면 안 된다.</b> {@link #hands}가 이 게임의 숨긴 정보 전부라,
 * 브로드캐스트에는 반드시 {@link #view()}가 돌려주는 {@link LiarsView}만 싣는다 —
 * "보내고 프론트에서 가리기"는 개발자 도구로 그대로 뚫린다. 내 손패는 나에게만 가는
 * {@code game.liars.hand}로, 남의 손패는 챌린지로 공개되는 순간에만
 * {@link Reveal#hands()}에 실려 나간다.
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record LiarsState(
        int version,
        Phase phase,
        /** 자리 순서. 탈락자도 남는다 — 화면의 자리가 판 중간에 밀리지 않게 한다. */
        List<String> playerOrder,
        /** 🔒 비밀. 살아 있는 사람만 들어 있다. */
        Map<String, List<Integer>> hands,
        /** 남은 주사위 개수. 0이면 탈락. 다음 라운드에 굴릴 개수이기도 하다. */
        Map<String, Integer> dice,
        /** 지금 선언·의심할 차례. REVEAL·FINISHED에는 없다. */
        String turnId,
        /** 현재 서 있는 선언. 라운드 시작에는 없다. */
        Bid bid,
        int round,
        Reveal lastReveal,
        String winnerId,
        /** REVEAL이 끝나 다음 라운드로 넘어갈 서버 시각. 0이면 대기 없음. */
        long nextActionAt
) {
    public LiarsState {
        playerOrder = playerOrder == null ? List.of() : List.copyOf(playerOrder);
        hands = hands == null ? Map.of() : Map.copyOf(hands);
        dice = dice == null ? Map.of() : Map.copyOf(dice);
    }

    public boolean finished() {
        return phase == Phase.FINISHED;
    }

    /** 판에 남아 있는 주사위 총합 — 선언 수량의 상한이다. */
    public int totalDice() {
        return dice.values().stream().mapToInt(Integer::intValue).sum();
    }

    public long aliveCount() {
        return dice.values().stream().filter(count -> count > 0).count();
    }

    /** 방송용 상태. 손패를 뺀 것이 전부다 — 이 변환이 이 게임의 보안 경계다. */
    public LiarsView view() {
        return new LiarsView(version, phase, playerOrder, dice, turnId, bid, round,
                lastReveal, winnerId, nextActionAt);
    }

    public enum Phase {
        /** 선언하거나 의심할 차례. */
        BIDDING,
        /** 챌린지 판정 공개 중. 타이머가 다음 라운드(또는 종료)로 잇는다. */
        REVEAL,
        FINISHED
    }

    /** 선언 = "이 눈이 판 전체에 최소 quantity개 있다". */
    public record Bid(String playerId, int quantity, int face) {
    }

    /** 챌린지 판정. 이 순간에만 모두의 손패가 공개된다. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Reveal(
            int round,
            Bid bid,
            String challengerId,
            /** 실제로 세어 나온 개수. */
            int actual,
            /** 선언이 사실이었나. 사실이면 의심한 쪽이 주사위를 잃는다. */
            boolean bidTrue,
            String loserId,
            /** 주사위가 0개가 되어 탈락한 사람(있으면). */
            String eliminatedId,
            /** 공개된 손패 전부. 여기 담기는 순간부터 공개 정보다. */
            Map<String, List<Integer>> hands
    ) {
        public Reveal {
            hands = hands == null ? Map.of() : Map.copyOf(hands);
        }
    }

    /** 방송되는 상태. {@link LiarsState}에서 손패만 빠졌다. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LiarsView(
            int version,
            Phase phase,
            List<String> playerOrder,
            Map<String, Integer> dice,
            String turnId,
            Bid bid,
            int round,
            Reveal lastReveal,
            String winnerId,
            long nextActionAt
    ) {
    }
}
