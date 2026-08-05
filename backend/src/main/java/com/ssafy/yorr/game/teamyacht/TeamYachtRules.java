package com.ssafy.yorr.game.teamyacht;

import com.ssafy.yorr.game.domain.ScoreBoard;
import com.ssafy.yorr.game.domain.ScoreCategory;
import com.ssafy.yorr.game.domain.YachtScoreCalculator;

import java.util.ArrayList;
import java.util.Collections;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 조별과제 야트의 규칙 전부(S15P11A406-209). 순수 함수만 — Redis도 소켓도 모른다.
 *
 * <h2>확정된 룰</h2>
 * 3인 1팀 · 점수판 1개 공유 · 12라운드. 일반 야추의 "1라운드 = 한 사람이 3굴림"을
 * "1라운드 = 세 사람이 1굴림씩"으로 치환한다.
 * <ol>
 *   <li><b>1번 주자</b>: 5개 전부 굴리고 1~3개를 킵한다.</li>
 *   <li><b>2번 주자</b>: 앞 사람이 킵한 눈만 보이고(버린 눈은 값이 가려진 채 넘어온다) 앞 사람의
 *       킵은 해제할 수 없다. 남은 걸 굴린 뒤 1개 ~ (남은 수 − 1)개를 킵한다 — 3번 주자가 굴릴
 *       주사위가 최소 1개는 남아야 한다.</li>
 *   <li><b>3번 주자</b>: 남은 걸 굴린다. 마지막 굴림이라 킵 선택 없이 5개가 확정된다.</li>
 *   <li><b>기록 = 다수결</b>: 세 명이 각자 족보를 지목해 2표 이상 받은 칸에 기록한다.
 *       전원 다른 족보면 <b>서버가</b> 룰렛으로 뽑는다.</li>
 *   <li>다음 라운드는 주자 순서가 한 칸 로테이션된다. 12라운드 = 각 좌석 정확히 4번.</li>
 * </ol>
 * 무임승차 방지는 킵 강제로 한다 — 아무것도 킵하지 않고 넘길 수 없다. 이 검증이 서버에
 * 있어야 하는 이유는 클라이언트 검증만으로는 우회되기 때문이다.
 * <p>
 * 점수 계산은 일반 야추 그대로 {@link YachtScoreCalculator}를 쓴다(족보·점수의 SSOT는 건드리지 않는다).
 */
public final class TeamYachtRules {

    public static final int ROUNDS = 12;
    public static final int DICE_COUNT = 5;
    public static final int SEATS = 3;

    /** LCG 상수 — 프론트 {@code yacht/domain/dice.ts}의 advanceSeed와 같은 값이어야 한다. */
    private static final long LCG_MULTIPLIER = 1_664_525L;
    private static final long LCG_INCREMENT = 1_013_904_223L;
    private static final long MODULUS = 1L << 32;

    private TeamYachtRules() {
    }

    public static TeamYachtState initial(List<String> players, long seed) {
        if (players == null || players.size() != SEATS) {
            throw new IllegalStateException("team_yacht_requires_three_players");
        }
        if (Set.copyOf(players).size() != SEATS) throw new IllegalStateException("team_yacht_duplicate_player");
        return new TeamYachtState(1, TeamYachtState.Stage.ROLL, players, 1, 0,
                unrolled(), locked(false), Map.of(), Map.of(), normalize(seed), null);
    }

    /** 현재 주자가 잠기지 않은 주사위를 굴린다. */
    public static TeamYachtState roll(TeamYachtState state, String actorId) {
        require(state.stage() == TeamYachtState.Stage.ROLL, "not_roll_stage");
        require(actorId.equals(state.runnerId()), "not_your_turn");

        long seed = state.seed();
        List<Integer> dice = new ArrayList<>(state.dice());
        for (int index = 0; index < DICE_COUNT; index++) {
            if (state.kept().get(index)) continue;
            seed = advance(seed);
            dice.set(index, face(seed));
        }

        // 마지막 주자는 킵을 고르지 않는다 — 굴린 눈이 그대로 확정되고 곧바로 투표로 넘어간다.
        boolean lastLeg = state.leg() == SEATS - 1;
        return new TeamYachtState(
                state.version() + 1,
                lastLeg ? TeamYachtState.Stage.VOTE : TeamYachtState.Stage.KEEP,
                state.seats(), state.round(), state.leg(),
                dice, lastLeg ? locked(true) : state.kept(),
                state.votes(), state.recorded(), seed, state.last());
    }

    /** 현재 주자가 킵을 확정하고 다음 주자에게 넘긴다. */
    public static TeamYachtState keep(TeamYachtState state, String actorId, List<Integer> picks) {
        require(state.stage() == TeamYachtState.Stage.KEEP, "not_keep_stage");
        require(actorId.equals(state.runnerId()), "not_your_turn");

        require(picks != null && !picks.contains(null), "invalid_keep_index");
        Set<Integer> picked = new LinkedHashSet<>(picks);
        require(picked.size() == picks.size(), "duplicate_keep_index");
        for (int index : picked) {
            require(index >= 0 && index < DICE_COUNT, "invalid_keep_index");
            // 앞 사람의 킵은 해제도 재선택도 할 수 없다.
            require(!state.kept().get(index), "already_kept");
        }
        KeepBounds bounds = keepBounds(state);
        require(picked.size() >= bounds.min() && picked.size() <= bounds.max(), "invalid_keep_count");

        List<Boolean> kept = new ArrayList<>(state.kept());
        for (int index : picked) kept.set(index, true);

        return new TeamYachtState(
                state.version() + 1, TeamYachtState.Stage.ROLL,
                state.seats(), state.round(), state.leg() + 1,
                state.dice(), kept, state.votes(), state.recorded(), state.seed(), state.last());
    }

    /**
     * 이번 라운드에 현재 주자가 킵해야 하는 개수의 범위.
     * <p>
     * 최소 1개는 무임승차 방지다. 최대치는 "뒤에 남은 주자 수만큼은 굴릴 주사위를 남긴다"로
     * 정해진다 — 1번 주자는 5개 중 최대 3개(뒤에 두 명), 2번 주자는 남은 수 − 1개다.
     */
    public static KeepBounds keepBounds(TeamYachtState state) {
        int rollable = 0;
        for (boolean locked : state.kept()) if (!locked) rollable++;
        int runnersAfter = SEATS - 1 - state.leg();
        return new KeepBounds(1, Math.max(1, rollable - runnersAfter));
    }

    /**
     * 족보 한 표. 세 표가 모이면 곧바로 기록까지 진행한다.
     * 아직 다 안 모였으면 표만 담긴 상태를 돌려준다(누가 냈는지는 모두에게 보인다).
     */
    public static TeamYachtState vote(TeamYachtState state, String actorId, String category) {
        require(state.stage() == TeamYachtState.Stage.VOTE, "not_vote_stage");
        require(state.seats().contains(actorId), "not_in_team");
        ScoreCategory.fromApiKey(category);
        require(!state.recorded().containsKey(category), "category_already_recorded");

        Map<String, String> votes = new LinkedHashMap<>(state.votes());
        votes.put(actorId, category);
        if (votes.size() < SEATS) {
            return new TeamYachtState(
                    state.version() + 1, state.stage(), state.seats(), state.round(), state.leg(),
                    state.dice(), state.kept(), votes, state.recorded(), state.seed(), state.last());
        }
        return record(state, votes);
    }

    /** 팀원이 방을 떠나면 판이 성립하지 않는다 — 그 자리에서 끝낸다. */
    public static TeamYachtState forfeit(TeamYachtState state) {
        if (state.finished()) return state;
        return new TeamYachtState(
                state.version() + 1, TeamYachtState.Stage.FINISHED, state.seats(), state.round(), state.leg(),
                state.dice(), state.kept(), state.votes(), state.recorded(), state.seed(), state.last());
    }

    /** 팀이 공유하는 점수판. 상단 보너스까지 일반 야추와 같은 규칙이다. */
    public static ScoreBoard board(Map<String, Integer> recorded) {
        Map<ScoreCategory, Integer> byCategory = new EnumMap<>(ScoreCategory.class);
        recorded.forEach((apiKey, score) -> byCategory.put(ScoreCategory.fromApiKey(apiKey), score));
        int upperSubtotal = YachtScoreCalculator.calculateUpperSubtotal(byCategory);
        int upperBonus = YachtScoreCalculator.calculateUpperBonus(byCategory);
        int total = recorded.values().stream().mapToInt(Integer::intValue).sum() + upperBonus;
        return new ScoreBoard(recorded, upperSubtotal, upperBonus, total);
    }

    /**
     * 동표(1:1:1) 룰렛. <b>결과는 서버가 정한다</b> — 클라이언트가 뽑으면 클라마다 다른 칸에 멈춘다.
     * 프론트 {@code yacht/domain/teamProject.ts}의 같은 이름 함수와 결과가 일치해야 한다.
     */
    public static String rouletteWinner(long seed, List<String> candidates) {
        return candidates.get((int) (normalize(seed) * candidates.size() / MODULUS));
    }

    public static long advance(long seed) {
        return (normalize(seed) * LCG_MULTIPLIER + LCG_INCREMENT) % MODULUS;
    }

    private static TeamYachtState record(TeamYachtState state, Map<String, String> votes) {
        List<String> candidates = state.seats().stream().map(votes::get).toList();
        String winner = majority(candidates);
        long seed = state.seed();
        List<String> roulette = null;
        if (winner == null) {
            seed = advance(seed);
            winner = rouletteWinner(seed, candidates);
            roulette = candidates;
        }

        int score = YachtScoreCalculator.calculateScore(ScoreCategory.fromApiKey(winner), faces(state.dice()));
        Map<String, Integer> recorded = new LinkedHashMap<>(state.recorded());
        recorded.put(winner, score);
        TeamYachtState.Recorded last = new TeamYachtState.Recorded(
                state.round(), winner, score, roulette, roulette == null ? null : seed);

        if (state.round() >= ROUNDS) {
            return new TeamYachtState(
                    state.version() + 1, TeamYachtState.Stage.FINISHED, state.seats(), state.round(), state.leg(),
                    state.dice(), state.kept(), votes, recorded, seed, last);
        }
        return new TeamYachtState(
                state.version() + 1, TeamYachtState.Stage.ROLL, rotate(state.seats()), state.round() + 1, 0,
                unrolled(), locked(false), Map.of(), recorded, seed, last);
    }

    /** 2표 이상 받은 족보. 전원 다른 족보면 null(= 룰렛으로 넘긴다). */
    private static String majority(List<String> candidates) {
        for (String candidate : candidates) {
            if (Collections.frequency(candidates, candidate) >= 2) return candidate;
        }
        return null;
    }

    /** 주자 순서를 한 칸 당긴다: 1→2→3번 주자가 2→3→1번이 된다. */
    public static List<String> rotate(List<String> seats) {
        List<String> rotated = new ArrayList<>(seats.subList(1, seats.size()));
        rotated.add(seats.get(0));
        return List.copyOf(rotated);
    }

    private static int[] faces(List<Integer> dice) {
        int[] faces = new int[DICE_COUNT];
        for (int index = 0; index < DICE_COUNT; index++) faces[index] = dice.get(index);
        return faces;
    }

    private static int face(long seed) {
        return (int) (seed * 6 / MODULUS) + 1;
    }

    private static long normalize(long seed) {
        return ((seed % MODULUS) + MODULUS) % MODULUS;
    }

    private static List<Integer> unrolled() {
        return List.of(0, 0, 0, 0, 0);
    }

    private static List<Boolean> locked(boolean value) {
        return List.of(value, value, value, value, value);
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }

    public record KeepBounds(int min, int max) {
    }
}
