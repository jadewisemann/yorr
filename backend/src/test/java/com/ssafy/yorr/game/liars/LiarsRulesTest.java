package com.ssafy.yorr.game.liars;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Random;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class LiarsRulesTest {

    private static final String P1 = "player-1";
    private static final String P2 = "player-2";
    private static final String P3 = "player-3";

    @Test
    void initialDealsFiveDiceToEveryoneAndTheHostLeads() {
        LiarsState state = LiarsRules.initial(List.of(P1, P2, P3), new Random(7), 1_000);

        assertThat(state.phase()).isEqualTo(LiarsState.Phase.BIDDING);
        assertThat(state.turnId()).isEqualTo(P1);
        assertThat(state.bid()).isNull();
        assertThat(state.dice()).containsOnly(
                Map.entry(P1, LiarsRules.DICE_PER_PLAYER),
                Map.entry(P2, LiarsRules.DICE_PER_PLAYER),
                Map.entry(P3, LiarsRules.DICE_PER_PLAYER));
        assertThat(state.hands().values()).allSatisfy(hand -> {
            assertThat(hand).hasSize(LiarsRules.DICE_PER_PLAYER);
            assertThat(hand).allMatch(value -> value >= 1 && value <= LiarsRules.FACES);
        });
        assertThat(state.totalDice()).isEqualTo(15);
    }

    /** 화면이 보내면 안 되는 정보를 서버가 애초에 내보내지 않는지 — 이 게임의 유일한 보안 계약이다. */
    @Test
    void viewNeverCarriesAnyHand() {
        LiarsState state = LiarsRules.initial(List.of(P1, P2), new Random(1), 0);

        LiarsState.LiarsView view = state.view();

        assertThat(view.dice()).containsKeys(P1, P2);
        assertThat(view.getClass().getRecordComponents())
                .noneMatch(component -> component.getName().equals("hands"));
    }

    @Test
    void aBidMustRaiseTheStandingOne() {
        LiarsState opened = LiarsRules.bid(twoPlayers(P1), P1, 3, 4);

        // 수량이 오르거나, 같은 수량에서 눈이 커야 한다.
        assertThat(LiarsRules.raises(opened.bid(), 4, 2)).isTrue();
        assertThat(LiarsRules.raises(opened.bid(), 3, 5)).isTrue();
        assertThat(LiarsRules.raises(opened.bid(), 3, 4)).isFalse();
        assertThat(LiarsRules.raises(opened.bid(), 3, 3)).isFalse();
        assertThat(LiarsRules.raises(opened.bid(), 2, 6)).isFalse();

        assertThatThrownBy(() -> LiarsRules.bid(opened, P2, 3, 3))
                .hasMessage("bid_not_higher");
        assertThat(LiarsRules.bid(opened, P2, 3, 5).bid().playerId()).isEqualTo(P2);
    }

    @Test
    void onlyTheTurnHolderCanBidOrChallenge() {
        LiarsState state = twoPlayers(P1);

        assertThatThrownBy(() -> LiarsRules.bid(state, P2, 2, 3)).hasMessage("not_your_turn");
        assertThatThrownBy(() -> LiarsRules.challenge(state, P2, 0)).hasMessage("not_your_turn");
    }

    @Test
    void aBidCannotExceedTheDiceStillInPlay() {
        LiarsState state = twoPlayers(P1);

        assertThatThrownBy(() -> LiarsRules.bid(state, P1, state.totalDice() + 1, 3))
                .hasMessage("invalid_quantity");
        assertThatThrownBy(() -> LiarsRules.bid(state, P1, 1, 7)).hasMessage("invalid_face");
    }

    @Test
    void thereIsNothingToChallengeAtTheStartOfARound() {
        assertThatThrownBy(() -> LiarsRules.challenge(twoPlayers(P1), P1, 0))
                .hasMessage("no_bid_to_challenge");
    }

    /** 선언이 사실이면(실제 개수 ≥ 선언 수량) 의심한 쪽이 주사위를 잃는다. */
    @Test
    void aTruthfulBidCostsTheChallengerADie() {
        // 3이 P1에 2개, P2에 1개 = 3개. "3이 3개"는 사실이다.
        LiarsState standing = LiarsRules.bid(
                withHands(Map.of(P1, List.of(3, 3, 5), P2, List.of(1, 3, 6)), P1), P1, 3, 3);

        LiarsState revealed = LiarsRules.challenge(standing, P2, 9_000);

        assertThat(revealed.phase()).isEqualTo(LiarsState.Phase.REVEAL);
        assertThat(revealed.lastReveal().actual()).isEqualTo(3);
        assertThat(revealed.lastReveal().bidTrue()).isTrue();
        assertThat(revealed.lastReveal().loserId()).isEqualTo(P2);
        assertThat(revealed.lastReveal().eliminatedId()).isNull();
        assertThat(revealed.dice()).containsEntry(P1, 3).containsEntry(P2, 2);
        assertThat(revealed.nextActionAt()).isEqualTo(9_000 + LiarsRules.REVEAL_MILLIS);
        // 판정 순간에만 모두의 손패가 공개된다.
        assertThat(revealed.lastReveal().hands()).containsKeys(P1, P2);
    }

    /** 허풍이면(실제 개수 < 선언 수량) 선언한 쪽이 주사위를 잃는다. */
    @Test
    void aBluffCostsTheBidderADie() {
        LiarsState standing = LiarsRules.bid(
                withHands(Map.of(P1, List.of(2, 2, 5), P2, List.of(1, 4, 6)), P1), P1, 3, 2);

        LiarsState revealed = LiarsRules.challenge(standing, P2, 0);

        assertThat(revealed.lastReveal().actual()).isEqualTo(2);
        assertThat(revealed.lastReveal().bidTrue()).isFalse();
        assertThat(revealed.lastReveal().loserId()).isEqualTo(P1);
        assertThat(revealed.dice()).containsEntry(P1, 2).containsEntry(P2, 3);
    }

    @Test
    void nextRoundRerollsOnlyWhatIsLeftAndTheLoserLeads() {
        LiarsState standing = LiarsRules.bid(
                withHands(Map.of(P1, List.of(2, 2, 5), P2, List.of(1, 4, 6)), P1), P1, 3, 2);
        LiarsState revealed = LiarsRules.challenge(standing, P2, 0);

        LiarsState next = LiarsRules.resolveReveal(revealed, new Random(3), 1_000);

        assertThat(next.phase()).isEqualTo(LiarsState.Phase.BIDDING);
        assertThat(next.round()).isEqualTo(2);
        assertThat(next.bid()).isNull();
        // 진 사람이 다음 라운드의 선이다.
        assertThat(next.turnId()).isEqualTo(P1);
        assertThat(next.hands().get(P1)).hasSize(2);
        assertThat(next.hands().get(P2)).hasSize(3);
    }

    @Test
    void losingTheLastDieEndsTheGameAndLeavesOneWinner() {
        LiarsState standing = LiarsRules.bid(
                withHands(Map.of(P1, List.of(6), P2, List.of(1, 1)), P1), P1, 2, 6);

        LiarsState revealed = LiarsRules.challenge(standing, P2, 0);
        assertThat(revealed.lastReveal().loserId()).isEqualTo(P1);
        assertThat(revealed.lastReveal().eliminatedId()).isEqualTo(P1);

        LiarsState finished = LiarsRules.resolveReveal(revealed, new Random(1), 0);

        assertThat(finished.phase()).isEqualTo(LiarsState.Phase.FINISHED);
        assertThat(finished.winnerId()).isEqualTo(P2);
        assertThat(finished.dice()).containsEntry(P1, 0).containsEntry(P2, 2);
        // 끝난 판의 비밀은 상태에 남기지 않는다.
        assertThat(finished.hands()).isEmpty();
    }

    @Test
    void eliminationSkipsThatSeatButKeepsTheOrder() {
        LiarsState standing = LiarsRules.bid(
                withHands(Map.of(P1, List.of(6), P2, List.of(2, 2), P3, List.of(4, 4)), P1), P1, 5, 6);
        LiarsState revealed = LiarsRules.challenge(standing, P2, 0);

        LiarsState next = LiarsRules.resolveReveal(revealed, new Random(5), 0);

        assertThat(revealed.lastReveal().eliminatedId()).isEqualTo(P1);
        assertThat(next.phase()).isEqualTo(LiarsState.Phase.BIDDING);
        // 자리 순서는 그대로 두고, 탈락한 선 다음 생존자가 선을 잡는다.
        assertThat(next.playerOrder()).containsExactly(P1, P2, P3);
        assertThat(next.turnId()).isEqualTo(P2);
        assertThat(next.hands()).containsOnlyKeys(P2, P3);
    }

    @Test
    void leavingTheRoomEndsTheGameWhenOnlyOnePlayerRemains() {
        LiarsState state = twoPlayers(P1);

        LiarsState finished = LiarsRules.forfeit(state, P1, new Random(2), 0);

        assertThat(finished.phase()).isEqualTo(LiarsState.Phase.FINISHED);
        assertThat(finished.winnerId()).isEqualTo(P2);
        assertThat(LiarsRules.forfeit(finished, P2, new Random(2), 0)).isNull();
    }

    @Test
    void leavingRestartsTheRoundWhenTwoOrMoreRemain() {
        LiarsState state = LiarsRules.bid(
                withHands(Map.of(P1, List.of(1, 2), P2, List.of(3, 4), P3, List.of(5, 6)), P1), P1, 2, 3);

        LiarsState next = LiarsRules.forfeit(state, P2, new Random(4), 0);

        assertThat(next.phase()).isEqualTo(LiarsState.Phase.BIDDING);
        // 떠난 사람의 선언은 물려주지 않는다 — 없는 사람에게서 주사위를 깎을 수 없다.
        assertThat(next.bid()).isNull();
        assertThat(next.dice()).containsEntry(P2, 0);
        assertThat(next.hands()).containsOnlyKeys(P1, P3);
    }

    /** 판이 실제로 끝까지 간다 — 챌린지만으로도 주사위가 소진되어 승자가 나온다. */
    @Test
    void aGameAlwaysReachesASingleWinner() {
        Random random = new Random(11);
        LiarsState state = LiarsRules.initial(List.of(P1, P2), random, 0);

        for (int guard = 0; guard < 200 && !state.finished(); guard++) {
            if (state.phase() == LiarsState.Phase.REVEAL) {
                state = LiarsRules.resolveReveal(state, random, 0);
                continue;
            }
            state = state.bid() == null
                    ? LiarsRules.bid(state, state.turnId(), state.totalDice(), LiarsRules.FACES)
                    : LiarsRules.challenge(state, state.turnId(), 0);
        }

        assertThat(state.finished()).isTrue();
        assertThat(state.winnerId()).isNotNull();
        assertThat(state.aliveCount()).isEqualTo(1);
    }

    private static LiarsState twoPlayers(String turnId) {
        return withHands(Map.of(P1, List.of(1, 2, 3), P2, List.of(4, 5, 6)), turnId);
    }

    private static LiarsState withHands(Map<String, List<Integer>> hands, String turnId) {
        List<String> order = List.of(P1, P2, P3).stream().filter(hands::containsKey).toList();
        Map<String, Integer> dice = hands.entrySet().stream()
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, entry -> entry.getValue().size()));
        return new LiarsState(1, LiarsState.Phase.BIDDING, order, hands, dice, turnId, null, 1, null, null, 0);
    }
}
