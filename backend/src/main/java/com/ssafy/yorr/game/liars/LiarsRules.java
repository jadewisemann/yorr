package com.ssafy.yorr.game.liars;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * 라이어스 다이스 판정의 유일한 진실. 순수 함수만 있고 Spring·Redis·소켓을 모른다
 * (그래서 {@code LiarsRulesTest}가 서버 없이 판 전체를 돌린다).
 *
 * <p>룰: 각자 주사위 {@value #DICE_PER_PLAYER}개를 숨기고 굴린다 → 순서대로 선언(수량+눈,
 * 직전 선언보다 반드시 높게) 또는 직전 선언에 챌린지 → 챌린지가 나오면 전원 공개해 세고,
 * 선언이 사실이면 의심한 쪽, 거짓이면 선언한 쪽이 주사위 1개를 잃는다 → 0개면 탈락 →
 * 마지막 1인이 승자다.
 *
 * <p>1을 만능 눈으로 쓰는 변형은 넣지 않았다. 규칙이 하나 늘면 화면의 설명도 판정도 같이
 * 늘어나므로, 기본 룰로 한 판이 돌아간 뒤에 붙일 일이다.
 *
 * <p>잘못된 조작은 {@link IllegalArgumentException}으로 되돌린다 — 조용히 무시하면 선언한
 * 사람은 자기 선언이 왜 안 서는지 알 수 없다. 사유 문자열은 모듈이 WS 에러 코드로 옮긴다.
 */
public final class LiarsRules {

    public static final int DICE_PER_PLAYER = 5;
    public static final int FACES = 6;
    /** 공개 판정을 화면이 읽을 시간. 이 뒤에 다음 라운드가 시작된다. */
    public static final long REVEAL_MILLIS = 4_500;

    private LiarsRules() {
    }

    public static LiarsState initial(List<String> players, Random random, long now) {
        if (players == null || players.size() < 2) throw new IllegalStateException("liars_requires_two_players");
        Map<String, List<Integer>> hands = new LinkedHashMap<>();
        Map<String, Integer> dice = new LinkedHashMap<>();
        for (String playerId : players) {
            hands.put(playerId, roll(DICE_PER_PLAYER, random));
            dice.put(playerId, DICE_PER_PLAYER);
        }
        return new LiarsState(1, LiarsState.Phase.BIDDING, players, hands, dice,
                players.get(0), null, 1, null, null, 0);
    }

    /** 선언. 직전 선언보다 높아야 하고, 판에 있는 주사위 수를 넘을 수 없다. */
    public static LiarsState bid(LiarsState current, String playerId, int quantity, int face) {
        requireTurn(current, playerId);
        if (face < 1 || face > FACES) throw new IllegalArgumentException("invalid_face");
        if (quantity < 1 || quantity > current.totalDice()) throw new IllegalArgumentException("invalid_quantity");
        LiarsState.Bid standing = current.bid();
        if (standing != null && !raises(standing, quantity, face)) {
            throw new IllegalArgumentException("bid_not_higher");
        }
        return new LiarsState(current.version() + 1, LiarsState.Phase.BIDDING, current.playerOrder(),
                current.hands(), current.dice(), nextAlive(current, playerId),
                new LiarsState.Bid(playerId, quantity, face), current.round(),
                current.lastReveal(), null, 0);
    }

    /** 직전 선언보다 높은 선언인가. 수량이 오르거나, 같은 수량에서 눈이 커야 한다. */
    public static boolean raises(LiarsState.Bid standing, int quantity, int face) {
        return quantity > standing.quantity() || (quantity == standing.quantity() && face > standing.face());
    }

    /**
     * 챌린지. 전원 손패를 세어 판정하고 진 쪽의 주사위를 하나 줄인다.
     * 결과는 REVEAL로 공개하고, 다음 라운드·종료는 타이머가 잇는다({@link #resolveReveal}).
     */
    public static LiarsState challenge(LiarsState current, String playerId, long now) {
        requireTurn(current, playerId);
        LiarsState.Bid bid = current.bid();
        if (bid == null) throw new IllegalArgumentException("no_bid_to_challenge");

        int actual = count(current.hands(), bid.face());
        boolean bidTrue = actual >= bid.quantity();
        String loserId = bidTrue ? playerId : bid.playerId();

        Map<String, Integer> dice = new LinkedHashMap<>(current.dice());
        int left = Math.max(0, dice.getOrDefault(loserId, 0) - 1);
        dice.put(loserId, left);

        LiarsState.Reveal reveal = new LiarsState.Reveal(current.round(), bid, playerId, actual, bidTrue,
                loserId, left == 0 ? loserId : null, current.hands());

        return new LiarsState(current.version() + 1, LiarsState.Phase.REVEAL, current.playerOrder(),
                current.hands(), dice, null, bid, current.round(), reveal, null,
                now + REVEAL_MILLIS);
    }

    /** 공개가 끝났다 — 한 명만 남았으면 종료, 아니면 다음 라운드. REVEAL에서만 부른다. */
    public static LiarsState resolveReveal(LiarsState current, Random random, long now) {
        if (current.phase() != LiarsState.Phase.REVEAL) return null;
        return current.aliveCount() <= 1 ? finish(current) : nextRound(current, random, now);
    }

    /**
     * 다음 라운드. 살아 있는 사람이 남은 개수만큼 다시 굴리고 선언을 비운다.
     * 선은 직전에 진 사람이다(탈락했으면 그 다음 생존자) — 잃은 쪽이 먼저 말하는 쪽이 흐름이 자연스럽다.
     */
    public static LiarsState nextRound(LiarsState current, Random random, long now) {
        Map<String, List<Integer>> hands = new LinkedHashMap<>();
        for (String playerId : current.playerOrder()) {
            int count = current.dice().getOrDefault(playerId, 0);
            if (count > 0) hands.put(playerId, roll(count, random));
        }
        String previousLoser = current.lastReveal() == null
                ? current.playerOrder().get(0)
                : current.lastReveal().loserId();
        String starter = hands.containsKey(previousLoser) ? previousLoser : nextAlive(current, previousLoser);
        return new LiarsState(current.version() + 1, LiarsState.Phase.BIDDING, current.playerOrder(),
                hands, current.dice(), starter, null, current.round() + 1,
                current.lastReveal(), null, 0);
    }

    /** 종료. 남은 손패는 버린다 — 끝난 판의 비밀을 상태에 남겨둘 이유가 없다. */
    public static LiarsState finish(LiarsState current) {
        String winnerId = current.dice().entrySet().stream()
                .filter(entry -> entry.getValue() > 0)
                .map(Map.Entry::getKey)
                .findFirst()
                .orElse(null);
        return new LiarsState(current.version() + 1, LiarsState.Phase.FINISHED, current.playerOrder(),
                Map.of(), current.dice(), null, current.bid(), current.round(),
                current.lastReveal(), winnerId, 0);
    }

    /**
     * 이탈. 그 사람을 탈락시키고, 한 명만 남으면 종료한다.
     *
     * <p>서 있던 선언을 물려받게 하지 않고 라운드를 다시 굴린다 — 떠난 사람의 선언에 챌린지가
     * 걸리면 이미 없는 사람에게서 주사위를 깎아야 하는 판정 구멍이 생긴다.
     *
     * @return 바뀔 게 없으면 null(이미 탈락·이미 종료).
     */
    public static LiarsState forfeit(LiarsState current, String playerId, Random random, long now) {
        if (current.finished() || current.dice().getOrDefault(playerId, 0) == 0) return null;
        Map<String, Integer> dice = new LinkedHashMap<>(current.dice());
        dice.put(playerId, 0);
        LiarsState dropped = new LiarsState(current.version(), current.phase(), current.playerOrder(),
                current.hands(), dice, current.turnId(), current.bid(), current.round(),
                current.lastReveal(), null, 0);
        return dropped.aliveCount() <= 1 ? finish(dropped) : nextRound(dropped, random, now);
    }

    /** 이 눈이 실제로 몇 개 있나. 판정의 전부다. */
    public static int count(Map<String, List<Integer>> hands, int face) {
        int total = 0;
        for (List<Integer> hand : hands.values()) {
            for (int value : hand) {
                if (value == face) total++;
            }
        }
        return total;
    }

    /** 눈이 오름차순으로 정렬된 손패. 정렬은 화면이 읽기 쉽게 하려는 것뿐이다. */
    static List<Integer> roll(int count, Random random) {
        List<Integer> dice = new ArrayList<>(count);
        for (int index = 0; index < count; index++) dice.add(random.nextInt(FACES) + 1);
        dice.sort(null);
        return List.copyOf(dice);
    }

    /** 자리 순서를 한 바퀴 돌며 다음 생존자를 찾는다. */
    private static String nextAlive(LiarsState state, String fromId) {
        List<String> order = state.playerOrder();
        int start = order.indexOf(fromId);
        for (int step = 1; step <= order.size(); step++) {
            String candidate = order.get(((start < 0 ? 0 : start) + step) % order.size());
            if (state.dice().getOrDefault(candidate, 0) > 0) return candidate;
        }
        return fromId;
    }

    private static void requireTurn(LiarsState state, String playerId) {
        if (state.phase() != LiarsState.Phase.BIDDING) throw new IllegalArgumentException("not_bidding_phase");
        if (!playerId.equals(state.turnId())) throw new IllegalArgumentException("not_your_turn");
    }
}
