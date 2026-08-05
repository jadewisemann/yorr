package com.ssafy.yorr.game.teamyacht;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TeamYachtRulesTest {

    private static final String A = "player-a";
    private static final String B = "player-b";
    private static final String C = "player-c";
    private static final long SEED = 12_345L;

    @Test
    void firstRunnerRollsEveryDieAndKeepsOneToThree() {
        TeamYachtState rolled = TeamYachtRules.roll(initial(), A);

        assertThat(rolled.dice()).allMatch(face -> face >= 1 && face <= 6);
        assertThat(rolled.stage()).isEqualTo(TeamYachtState.Stage.KEEP);
        assertThat(TeamYachtRules.keepBounds(rolled)).isEqualTo(new TeamYachtRules.KeepBounds(1, 3));
    }

    @Test
    void nothingKeptIsRejected() {
        TeamYachtState rolled = TeamYachtRules.roll(initial(), A);

        assertThatThrownBy(() -> TeamYachtRules.keep(rolled, A, List.of()))
                .hasMessage("invalid_keep_count");
    }

    @Test
    void firstRunnerCannotKeepFourBecauseTwoRunnersStillNeedDice() {
        TeamYachtState rolled = TeamYachtRules.roll(initial(), A);

        assertThatThrownBy(() -> TeamYachtRules.keep(rolled, A, List.of(0, 1, 2, 3)))
                .hasMessage("invalid_keep_count");
        assertThat(TeamYachtRules.keep(rolled, A, List.of(0, 1, 2)).leg()).isEqualTo(1);
    }

    /** 2번 주자는 남은 걸 전부 킵할 수 없다 — 3번 주자가 굴릴 주사위가 최소 1개 남아야 한다. */
    @Test
    void secondRunnerMustLeaveAtLeastOneDieForTheLastRunner() {
        TeamYachtState passed = TeamYachtRules.roll(
                TeamYachtRules.keep(TeamYachtRules.roll(initial(), A), A, List.of(0)), B);

        assertThat(TeamYachtRules.keepBounds(passed)).isEqualTo(new TeamYachtRules.KeepBounds(1, 3));
        assertThatThrownBy(() -> TeamYachtRules.keep(passed, B, List.of(1, 2, 3, 4)))
                .hasMessage("invalid_keep_count");
    }

    @Test
    void previousRunnerKeepCannotBeReleased() {
        TeamYachtState passed = TeamYachtRules.roll(
                TeamYachtRules.keep(TeamYachtRules.roll(initial(), A), A, List.of(0)), B);

        assertThatThrownBy(() -> TeamYachtRules.keep(passed, B, List.of(0)))
                .hasMessage("already_kept");
    }

    @Test
    void onlyTheCurrentRunnerMayRoll() {
        assertThatThrownBy(() -> TeamYachtRules.roll(initial(), B)).hasMessage("not_your_turn");
    }

    @Test
    void lastRunnerLocksEveryDieAndOpensTheVote() {
        TeamYachtState voting = untilVote(initial());

        assertThat(voting.stage()).isEqualTo(TeamYachtState.Stage.VOTE);
        assertThat(voting.kept()).allMatch(kept -> kept);
        assertThat(TeamYachtView.of(voting, B).dice()).doesNotContainNull();
    }

    /** 앞 사람이 버린 주사위는 값이 가려진 채 넘어간다 — 서버가 애초에 보내지 않는다. */
    @Test
    void onlyKeptDiceAreVisibleToPlayersWhoAreNotRolling() {
        TeamYachtState passed = TeamYachtRules.roll(
                TeamYachtRules.keep(TeamYachtRules.roll(initial(), A), A, List.of(0)), B);

        assertThat(TeamYachtView.of(passed, B).dice()).doesNotContainNull();
        List<Integer> seenByA = TeamYachtView.of(passed, A).dice();
        assertThat(seenByA.get(0)).isNotNull();
        assertThat(seenByA.subList(1, 5)).containsOnlyNulls();
    }

    @Test
    void twoVotesRecordTheCategory() {
        TeamYachtState voting = untilVote(initial());

        TeamYachtState recorded = vote(voting, "choice", "choice", "yacht");

        assertThat(recorded.last().category()).isEqualTo("choice");
        assertThat(recorded.last().rouletteCandidates()).isNull();
        assertThat(recorded.recorded()).containsKey("choice");
        assertThat(recorded.round()).isEqualTo(2);
    }

    @Test
    void threeDifferentVotesGoToTheRouletteAndTheServerPicks() {
        TeamYachtState voting = untilVote(initial());

        TeamYachtState recorded = vote(voting, "ones", "twos", "threes");

        assertThat(recorded.last().rouletteCandidates()).containsExactly("ones", "twos", "threes");
        assertThat(recorded.last().category()).isIn("ones", "twos", "threes");
        assertThat(recorded.recorded()).containsKey(recorded.last().category());
    }

    @Test
    void rouletteIsSeedDeterministic() {
        long seed = TeamYachtRules.advance(SEED);
        List<String> candidates = List.of("ones", "twos", "threes");

        assertThat(TeamYachtRules.rouletteWinner(seed, candidates))
                .isEqualTo(TeamYachtRules.rouletteWinner(seed, candidates));
        assertThat(TeamYachtRules.rouletteWinner(0L, candidates)).isEqualTo("ones");
        // 프론트 domain/teamProject.ts의 같은 시드·후보와 결과가 일치해야 한다(계산식 고정).
        assertThat(TeamYachtRules.rouletteWinner(2_863_311_530L, candidates)).isEqualTo("threes");
    }

    @Test
    void alreadyRecordedCategoryCannotBeVoted() {
        TeamYachtState second = vote(untilVote(initial()), "choice", "choice", "choice");

        TeamYachtState voting = untilVote(second);
        assertThatThrownBy(() -> TeamYachtRules.vote(voting, A, "choice"))
                .hasMessage("category_already_recorded");
    }

    /** 12라운드 = 각 좌석이 정확히 4번씩 1번 주자. */
    @Test
    void twelveRoundsRotateEverySeatThroughFirstRunnerFourTimes() {
        Map<String, Integer> firstRunnerCount = new HashMap<>();
        TeamYachtState state = initial();
        List<String> categories = new ArrayList<>(List.of(
                "ones", "twos", "threes", "fours", "fives", "sixes",
                "choice", "fourOfAKind", "fullHouse", "smallStraight", "largeStraight", "yacht"));

        for (String category : categories) {
            firstRunnerCount.merge(state.seats().get(0), 1, Integer::sum);
            state = untilVote(state);
            state = vote(state, category, category, category);
        }

        assertThat(firstRunnerCount).containsOnlyKeys(A, B, C).containsValues(4, 4, 4);
        assertThat(state.stage()).isEqualTo(TeamYachtState.Stage.FINISHED);
        assertThat(state.recorded()).hasSize(TeamYachtRules.ROUNDS);
        assertThat(TeamYachtRules.board(state.recorded()).total()).isPositive();
    }

    private static TeamYachtState initial() {
        return TeamYachtRules.initial(List.of(A, B, C), SEED);
    }

    /** 세 주자가 굴리고 킵해 주사위 5개가 확정된 상태까지 진행한다. */
    private static TeamYachtState untilVote(TeamYachtState state) {
        TeamYachtState current = state;
        for (int leg = 0; leg < TeamYachtRules.SEATS; leg++) {
            current = TeamYachtRules.roll(current, current.seats().get(leg));
            if (current.stage() == TeamYachtState.Stage.KEEP) {
                current = TeamYachtRules.keep(current, current.seats().get(leg), List.of(firstUnkept(current)));
            }
        }
        return current;
    }

    private static int firstUnkept(TeamYachtState state) {
        for (int index = 0; index < TeamYachtRules.DICE_COUNT; index++) {
            if (!state.kept().get(index)) return index;
        }
        throw new IllegalStateException("no unkept die");
    }

    private static TeamYachtState vote(TeamYachtState state, String byA, String byB, String byC) {
        TeamYachtState current = TeamYachtRules.vote(state, A, byA);
        current = TeamYachtRules.vote(current, B, byB);
        return TeamYachtRules.vote(current, C, byC);
    }
}
