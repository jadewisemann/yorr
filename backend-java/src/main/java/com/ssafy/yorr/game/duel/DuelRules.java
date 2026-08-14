package com.ssafy.yorr.game.duel;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 석양이 진다 — 결투 규칙. 순수 함수라 네트워크·Redis·연출을 전혀 모른다.
 *
 * <p>한 라운드 =
 * 신호등이 빨강 → (랜덤 대기) → 초록 → 더 빨리 뽑은 쪽이 쏜다 → 상대 체력 -1
 * → 체력이 0이 되면 쓰러진다(패배).
 *
 * <p>반응은 ms 정수로 비교하고, 1ms까지 같으면 TIE(체력 변화 없이 다음 라운드)다.
 *
 * <p><b>부정출발 — 매치 통산 2번이면 패배</b>: 신호 전에 뽑으면 1회차는 라운드 무효(상대
 * 무피해)이고 경고만 쌓인다. 경고는 라운드마다 초기화되지 않고 <b>매치 내내 누적</b>되며,
 * {@link #MAX_FOULS}개가 차는 순간 남은 총알과 무관하게 그 자리에서 결투를 잃는다.
 * 1회차를 무료로 두는 이유는 탭·폰 흔들기 입력이 손떨림으로 오작동하기 쉬워서다. 반대로
 * 계속 무료면 긴장이 사라지므로 두 번째는 곧바로 승부를 끝낸다. (신호 전에는 아무 정보도
 * 없어 "불리한 라운드를 파울로 회피"하는 악용은 불가능하다.)
 */
final class DuelRules {

    /** 결투에서 버틸 수 있는 총알 수. */
    static final int MAX_HP = 3;
    /** 매치 통산 이 횟수째 부정출발에서 자기 발을 쏘고 결투를 잃는다. */
    static final int MAX_FOULS = 2;

    /**
     * 반응 시간 센티넬 — 실제 ms는 0 이상이다.
     * FOUL은 신호 전에 뽑음, MISS는 신호 후에도 못 뽑음(얼어붙음)이다.
     */
    static final int FOUL = -1;
    static final int MISS = -2;

    /** 신호(초록)까지의 랜덤 대기 — 예측 못 하게 넉넉한 폭. */
    static final long MIN_WAIT_MILLIS = 1_400;
    static final long MAX_WAIT_MILLIS = 4_600;
    /** 한쪽이 먼저 뽑은 뒤, 상대가 뽑을 수 있는 마지막 유예. */
    static final long GRACE_MILLIS = 700;
    /** 신호 후 아무도 안 뽑으면 라운드를 무효로 넘긴다. */
    static final long FREEZE_MILLIS = 2_600;

    /* 연출 시간 — 프런트 duel.ts의 CSS 애니메이션 길이와 맞춰야 한다. */
    /** 아무도 맞지 않은 라운드(TIE·경고)는 짧게 보여준다. */
    static final long TIE_HOLD_MILLIS = 1_650;
    static final long RESULT_HOLD_MILLIS = 2_150;
    static final long KO_HOLD_MILLIS = 2_900;

    private DuelRules() {
    }

    static DuelState initial(List<String> players, long now, long wait) {
        if (players == null || players.size() != 2) throw new IllegalArgumentException("duel_requires_two_players");
        Map<String, Integer> hp = new LinkedHashMap<>();
        Map<String, Integer> fouls = new LinkedHashMap<>();
        Map<String, Long> sequences = new LinkedHashMap<>();
        players.forEach(player -> {
            hp.put(player, MAX_HP);
            fouls.put(player, 0);
            sequences.put(player, -1L);
        });
        return new DuelState(1, DuelState.Phase.WAITING, players, hp, fouls, Map.of(), sequences,
                1, 0, now + wait, null);
    }

    /** 신호등을 초록으로. 이후 {@link #FREEZE_MILLIS}까지 아무도 안 뽑으면 라운드가 무효다. */
    static DuelState signal(DuelState state, long now) {
        if (state.phase() != DuelState.Phase.WAITING) return state;
        return new DuelState(state.version() + 1, DuelState.Phase.SIGNAL, state.playerOrder(),
                state.hp(), state.fouls(), state.reactions(), state.lastInputSeq(),
                state.round(), now, now + FREEZE_MILLIS, null);
    }

    /**
     * 한 진영이 총을 뽑았다.
     *
     * <p>반응 시간은 <b>클라이언트가 측정한 값</b>을 쓴다. 서버 도착 시각으로 재면 왕복 지연이
     * 그대로 핸디캡이 되어 반응 게임의 공정성이 무너진다. 대신 서버가 흐른 시간을 상한으로
     * 잡아 "신호보다 늦게 도착했는데 더 빠른 기록"은 깎는다. 더 빠르게 신고하는 조작까지는
     * 막지 못하는데, 친구끼리 하는 파티 게임이라 지연 공정성을 택했다.
     */
    static DuelState draw(DuelState state, String playerId, long inputSeq, int reportedMs, long now) {
        if (!state.playerOrder().contains(playerId)) return state;
        if (inputSeq <= state.lastInputSeq().getOrDefault(playerId, -1L)) return state;

        Map<String, Long> sequences = new LinkedHashMap<>(state.lastInputSeq());
        sequences.put(playerId, inputSeq);

        boolean live = state.phase() == DuelState.Phase.WAITING || state.phase() == DuelState.Phase.SIGNAL;
        if (!live || state.reactions().containsKey(playerId)) return withSequences(state, sequences);

        Map<String, Integer> reactions = new LinkedHashMap<>(state.reactions());
        // 신호가 아직 빨강이면 payload가 뭐라 하든 부정출발이다 — 판정 권한은 서버에 있다.
        int value = state.phase() == DuelState.Phase.WAITING || reportedMs < 0
                ? FOUL
                : (int) Math.max(0, Math.min(reportedMs, Math.max(0, now - state.signalAt())));
        reactions.put(playerId, value);

        if (value == FOUL || reactions.size() == state.playerOrder().size()) {
            return resolve(state, sequences, reactions, now);
        }
        // 한쪽이 뽑았다 → 상대에게 마지막 유예. 못 뽑으면 그대로 맞는다.
        long deadline = Math.min(state.nextActionAt(), now + GRACE_MILLIS);
        return new DuelState(state.version() + 1, state.phase(), state.playerOrder(), state.hp(),
                state.fouls(), reactions, sequences, state.round(), state.signalAt(), deadline, null);
    }

    /** 유예·동결이 끝났다. 안 뽑은 쪽은 얼어붙은 것으로 기록한다. */
    static DuelState expire(DuelState state, long now) {
        if (state.phase() != DuelState.Phase.SIGNAL) return state;
        Map<String, Integer> reactions = new LinkedHashMap<>(state.reactions());
        state.playerOrder().forEach(player -> reactions.putIfAbsent(player, MISS));
        return resolve(state, state.lastInputSeq(), reactions, now);
    }

    /** 결과 연출이 끝났다 → 다음 라운드의 빨간 신호등으로. */
    static DuelState nextRound(DuelState state, long now, long wait) {
        if (state.phase() != DuelState.Phase.RESULT || state.lastRound() == null) return state;
        if (state.lastRound().over()) return state;
        return new DuelState(state.version() + 1, DuelState.Phase.WAITING, state.playerOrder(),
                state.hp(), state.fouls(), Map.of(), state.lastInputSeq(),
                state.round() + 1, 0, now + wait, null);
    }

    /** KO 연출이 끝났다 → 결과 화면으로. */
    static DuelState finish(DuelState state) {
        if (state.phase() != DuelState.Phase.RESULT || state.lastRound() == null) return state;
        if (!state.lastRound().over()) return state;
        return new DuelState(state.version() + 1, DuelState.Phase.FINISHED, state.playerOrder(),
                state.hp(), state.fouls(), state.reactions(), state.lastInputSeq(),
                state.round(), state.signalAt(), 0, state.lastRound());
    }

    /** 한쪽이 방을 떠났다 — 남은 쪽이 살아남는다. */
    static DuelState forfeit(DuelState state, String playerId, long now) {
        if (state.finished() || !state.playerOrder().contains(playerId)) return state;
        String survivor = other(state, playerId);
        Map<String, Integer> hp = new LinkedHashMap<>(state.hp());
        hp.put(playerId, 0);
        return new DuelState(state.version() + 1, DuelState.Phase.FINISHED, state.playerOrder(),
                hp, state.fouls(), Map.of(), state.lastInputSeq(), state.round(), 0, 0,
                new DuelState.Round(state.round(), DuelState.Kind.FORFEIT, survivor, playerId,
                        playerId, null, true, now));
    }

    /**
     * 두 반응을 비교 → 0=TIE · 1=첫 번째 승 · 2=두 번째 승.
     * 둘 다 정상이면 더 빠른 쪽이 이기고 1ms까지 같으면 TIE, 한쪽만 정상이면 그쪽이 이긴다.
     * 둘 다 실패면(둘 다 성급했거나 둘 다 얼어붙음) TIE다.
     */
    static int compareDraw(int a, int b) {
        boolean cleanA = a >= 0;
        boolean cleanB = b >= 0;
        if (cleanA && cleanB) return a == b ? 0 : a < b ? 1 : 2;
        if (cleanA) return 1;
        if (cleanB) return 2;
        return 0;
    }

    /** 연출을 붙잡아 둘 시간 — 실제로 맞은 라운드만 충분히 보여준다. */
    static long hold(DuelState.Round round) {
        if (round.over()) return KO_HOLD_MILLIS;
        return round.hitId() == null ? TIE_HOLD_MILLIS : RESULT_HOLD_MILLIS;
    }

    private static DuelState resolve(
            DuelState state,
            Map<String, Long> sequences,
            Map<String, Integer> reactions,
            long now
    ) {
        String first = state.playerOrder().get(0);
        String second = state.playerOrder().get(1);
        Map<String, Integer> hp = new LinkedHashMap<>(state.hp());
        Map<String, Integer> fouls = new LinkedHashMap<>(state.fouls());

        String foulId = foulSide(reactions, first, second);
        DuelState.Round round = foulId == null
                ? shootout(state, reactions, hp, first, second, now)
                : penalty(state, hp, fouls, foulId, now);

        return new DuelState(state.version() + 1, DuelState.Phase.RESULT, state.playerOrder(),
                hp, fouls, reactions, sequences, state.round(), state.signalAt(),
                now + hold(round), round);
    }

    /**
     * 부정출발 라운드. 상대는 무피해다 — 신호 전이라 총을 뽑지도 않았다.
     *
     * <p>경고는 라운드를 넘어 누적되고, 한도에 닿는 순간 자기 발을 쏘며 <b>남은 총알과
     * 무관하게</b> 결투가 끝난다. 총알 한 발로 환산하지 않는 이유는 그러면 "총알을 아끼는
     * 대신 파울을 쓴다"는 계산이 생기기 때문이다 — 부정출발은 값을 치르는 선택이 아니라
     * 하면 안 되는 일이어야 한다.
     */
    private static DuelState.Round penalty(
            DuelState state,
            Map<String, Integer> hp,
            Map<String, Integer> fouls,
            String foulId,
            long now
    ) {
        int count = fouls.getOrDefault(foulId, 0) + 1;
        fouls.put(foulId, count);
        if (count < MAX_FOULS) {
            return new DuelState.Round(state.round(), DuelState.Kind.WARNING, null, null, null,
                    foulId, false, now);
        }
        hp.put(foulId, Math.max(0, hp.getOrDefault(foulId, 0) - 1));
        return new DuelState.Round(state.round(), DuelState.Kind.SELF_SHOT, null, foulId,
                foulId, foulId, true, now);
    }

    /** 정상 승부 — 더 빨리 뽑은 쪽이 상대를 쏜다. */
    private static DuelState.Round shootout(
            DuelState state,
            Map<String, Integer> reactions,
            Map<String, Integer> hp,
            String first,
            String second,
            long now
    ) {
        int winner = compareDraw(reactions.getOrDefault(first, MISS), reactions.getOrDefault(second, MISS));
        if (winner == 0) {
            return new DuelState.Round(state.round(), DuelState.Kind.TIE, null, null, null, null, false, now);
        }
        String shooter = winner == 1 ? first : second;
        String hit = winner == 1 ? second : first;
        int left = Math.max(0, hp.getOrDefault(hit, 0) - 1);
        hp.put(hit, left);
        return new DuelState.Round(state.round(), DuelState.Kind.SHOT, shooter, hit,
                left <= 0 ? hit : null, null, left <= 0, now);
    }

    private static String foulSide(Map<String, Integer> reactions, String first, String second) {
        if (reactions.getOrDefault(first, MISS) == FOUL) return first;
        if (reactions.getOrDefault(second, MISS) == FOUL) return second;
        return null;
    }

    private static String other(DuelState state, String playerId) {
        return state.playerOrder().get(state.playerOrder().indexOf(playerId) == 0 ? 1 : 0);
    }

    /**
     * 판정에는 영향이 없지만 입력 번호는 남겨야 한다 — 그래야 같은 입력이 재전송돼도
     * 다음 라운드에서 되살아나지 않는다.
     */
    private static DuelState withSequences(DuelState state, Map<String, Long> sequences) {
        return new DuelState(state.version() + 1, state.phase(), state.playerOrder(), state.hp(),
                state.fouls(), state.reactions(), sequences, state.round(), state.signalAt(),
                state.nextActionAt(), state.lastRound());
    }
}
