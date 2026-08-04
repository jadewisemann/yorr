package com.ssafy.yorr.game.pingpong;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class PingPongRules {

    static final double NORMAL_SPEED = 1.0;
    static final double SMASH_SPEED = 1.95;
    static final double WEAK_SPEED = 0.82;
    static final int WIN_SCORE = 11;
    static final long POINT_COUNTDOWN_MILLIS = 2_600;

    private static final double IDEAL_1 = 0.9;
    private static final double WINDOW_1_LOW = 0.72;
    private static final double WINDOW_1_HIGH = 1.06;
    private static final double MISS_1 = 1.1;
    private static final double IDEAL_2 = 1 - IDEAL_1;
    private static final double WINDOW_2_LOW = 1 - WINDOW_1_HIGH;
    private static final double WINDOW_2_HIGH = 1 - WINDOW_1_LOW;
    private static final double MISS_2 = 1 - MISS_1;
    private static final double PERFECT_DISTANCE = 0.06;
    private static final double GOOD_DISTANCE = 0.1;
    private static final double FAULT_BAND = 0.04;
    private static final double EARLY_MARGIN = IDEAL_1 - WINDOW_1_LOW;
    private static final double LATE_MARGIN = WINDOW_1_HIGH - IDEAL_1;

    private PingPongRules() {
    }

    static PingPongState initial(List<String> players, long now) {
        if (players == null || players.size() != 2) throw new IllegalArgumentException("ping_pong_requires_two_players");
        Map<String, Integer> scores = new LinkedHashMap<>();
        Map<String, Long> sequences = new LinkedHashMap<>();
        players.forEach(player -> {
            scores.put(player, 0);
            sequences.put(player, -1L);
        });
        return new PingPongState(
                1,
                PingPongState.Phase.PREPARING,
                players,
                scores,
                sequences,
                Set.of(),
                new PingPongState.Ball(0, 1, NORMAL_SPEED, false, null, 0, 0.5, 0.5, now),
                0,
                players.getFirst(),
                0,
                new PingPongState.Event(1, PingPongState.EventType.READY, players.getFirst(), now)
        );
    }

    static PingPongState ready(PingPongState state, String playerId, long now) {
        if (state.phase() != PingPongState.Phase.PREPARING
                || !state.playerOrder().contains(playerId)
                || state.lastInputSeq().getOrDefault(playerId, -1L) < 0
                || state.readyPlayerIds().contains(playerId)) {
            return state;
        }
        Set<String> readyPlayers = new LinkedHashSet<>(state.readyPlayerIds());
        readyPlayers.add(playerId);
        int version = state.version() + 1;
        boolean everyoneReady = readyPlayers.containsAll(state.playerOrder());
        return copy(state, version,
                everyoneReady ? PingPongState.Phase.COUNTDOWN : PingPongState.Phase.PREPARING,
                state.scores(), state.lastInputSeq(), readyPlayers, state.ball(), state.rally(),
                state.serveReceiverId(), everyoneReady ? now + POINT_COUNTDOWN_MILLIS : 0,
                event(version, PingPongState.EventType.PLAYER_READY, playerId, now));
    }

    static PingPongState serve(PingPongState state, long now, double targetX) {
        if (state.phase() != PingPongState.Phase.COUNTDOWN) return state;
        int receiver = state.playerOrder().indexOf(state.serveReceiverId());
        int direction = receiver == 0 ? 1 : -1;
        double start = direction > 0 ? 0 : 1;
        PingPongState.Ball ball = new PingPongState.Ball(
                start, direction, NORMAL_SPEED, false, null, 0, 0.5, targetX, now);
        int version = state.version() + 1;
        return copy(state, version, PingPongState.Phase.PLAYING, state.scores(), state.lastInputSeq(), ball,
                0, state.serveReceiverId(), missDeadline(ball, now),
                event(version, PingPongState.EventType.SERVE, state.serveReceiverId(), now));
    }

    static PingPongState swing(PingPongState state, String playerId, long inputSeq, long now, double targetX) {
        int player = state.playerOrder().indexOf(playerId);
        if (player < 0 || inputSeq <= state.lastInputSeq().getOrDefault(playerId, -1L)) return state;

        Map<String, Long> sequences = new LinkedHashMap<>(state.lastInputSeq());
        sequences.put(playerId, inputSeq);
        if (state.phase() == PingPongState.Phase.PREPARING) {
            int version = state.version() + 1;
            return copy(state, version, state.phase(), state.scores(), sequences, state.readyPlayerIds(),
                    state.ball(), state.rally(), state.serveReceiverId(), 0,
                    event(version, PingPongState.EventType.PRACTICE, playerId, now));
        }
        if (state.phase() != PingPongState.Phase.PLAYING || state.ball().fault() != null) {
            return copy(state, state.version() + 1, state.phase(), state.scores(), sequences, state.ball(),
                    state.rally(), state.serveReceiverId(), state.nextActionAt(), state.lastEvent());
        }

        PingPongState.Ball current = at(state.ball(), now);
        boolean incoming = player == 0 ? current.direction() > 0 : current.direction() < 0;
        if (!incoming) {
            return copy(state, state.version() + 1, state.phase(), state.scores(), sequences, current,
                    state.rally(), state.serveReceiverId(), state.nextActionAt(), state.lastEvent());
        }

        boolean tooEarly = player == 0 ? current.pos() < WINDOW_1_LOW : current.pos() > WINDOW_2_HIGH;
        boolean tooLate = player == 0 ? current.pos() > WINDOW_1_HIGH : current.pos() < WINDOW_2_LOW;
        if (tooEarly || tooLate) {
            int version = state.version() + 1;
            PingPongState.EventType type = tooEarly
                    ? PingPongState.EventType.TOO_EARLY : PingPongState.EventType.TOO_LATE;
            return copy(state, version, state.phase(), state.scores(), sequences, current,
                    state.rally(), state.serveReceiverId(), state.nextActionAt(), event(version, type, playerId, now));
        }

        double ideal = player == 0 ? IDEAL_1 : IDEAL_2;
        double distance = Math.abs(current.pos() - ideal);
        boolean early = player == 0 ? current.pos() < ideal : current.pos() > ideal;
        PingPongState.Fault fault = fault(distance, early);
        int direction = player == 0 ? -1 : 1;
        double x = ballX(current);
        double speed;
        boolean smash;
        PingPongState.EventType type;
        if (fault == PingPongState.Fault.OUT) {
            speed = NORMAL_SPEED;
            smash = false;
            type = PingPongState.EventType.OUT;
        } else if (fault == PingPongState.Fault.NET) {
            speed = WEAK_SPEED;
            smash = false;
            type = PingPongState.EventType.NET;
        } else if (distance <= PERFECT_DISTANCE) {
            speed = SMASH_SPEED;
            smash = true;
            type = PingPongState.EventType.SMASH;
        } else if (distance <= GOOD_DISTANCE) {
            speed = NORMAL_SPEED;
            smash = false;
            type = PingPongState.EventType.NICE;
        } else {
            speed = WEAK_SPEED;
            smash = false;
            type = PingPongState.EventType.OK;
        }

        PingPongState.Ball returned = new PingPongState.Ball(
                current.pos(), direction, speed, smash, fault,
                progress(current.pos(), direction), x, targetX, now);
        int version = state.version() + 1;
        return copy(state, version, state.phase(), state.scores(), sequences, returned,
                fault == null ? state.rally() + 1 : state.rally(), state.serveReceiverId(),
                flightDeadline(returned, now), event(version, type, playerId, now));
    }

    static PingPongState expire(PingPongState state, long now) {
        if (state.phase() != PingPongState.Phase.PLAYING) return state;
        PingPongState.Ball ball = at(state.ball(), now);
        int scorer;
        if (ball.fault() != null) {
            scorer = ball.direction() < 0 ? 1 : 0;
        } else {
            scorer = ball.direction() > 0 ? 1 : 0;
        }
        return point(state, scorer, ball, now, null);
    }

    static PingPongState forfeit(PingPongState state, String playerId, long now) {
        int loser = state.playerOrder().indexOf(playerId);
        if (loser < 0 || state.finished()) return state;
        int winner = loser == 0 ? 1 : 0;
        Map<String, Integer> scores = new LinkedHashMap<>(state.scores());
        scores.put(state.playerOrder().get(winner), WIN_SCORE);
        int version = state.version() + 1;
        return copy(state, version, PingPongState.Phase.FINISHED, scores, state.lastInputSeq(), state.ball(),
                state.rally(), null, 0,
                event(version, PingPongState.EventType.OPPONENT_LEFT, state.playerOrder().get(winner), now));
    }

    private static PingPongState point(
            PingPongState state,
            int scorer,
            PingPongState.Ball ball,
            long now,
            PingPongState.EventType forcedType
    ) {
        Map<String, Integer> scores = new LinkedHashMap<>(state.scores());
        String scorerId = state.playerOrder().get(scorer);
        int score = scores.getOrDefault(scorerId, 0) + 1;
        scores.put(scorerId, score);
        int version = state.version() + 1;
        int opponentScore = scores.getOrDefault(state.playerOrder().get(scorer == 0 ? 1 : 0), 0);
        if (score >= WIN_SCORE && score - opponentScore >= 2) {
            return copy(state, version, PingPongState.Phase.FINISHED, scores, state.lastInputSeq(), ball,
                    state.rally(), null, 0,
                    event(version, PingPongState.EventType.GAME_OVER, scorerId, now));
        }
        return copy(state, version, PingPongState.Phase.COUNTDOWN, scores, state.lastInputSeq(), ball,
                state.rally(), serveReceiver(state.playerOrder(), scores), now + POINT_COUNTDOWN_MILLIS,
                event(version, forcedType == null ? PingPongState.EventType.POINT : forcedType, scorerId, now));
    }

    /**
     * 실제 탁구의 서브 교대 규칙. 서버가 직접 서브권을 소유하지 않고 "다음 서브를 받을 사람"을
     * 저장하므로, 같은 인덱스를 2점 동안 유지한 뒤 바꾼다. 10:10부터는 매 점마다 바뀐다.
     */
    static String serveReceiver(List<String> playerOrder, Map<String, Integer> scores) {
        int first = scores.getOrDefault(playerOrder.getFirst(), 0);
        int second = scores.getOrDefault(playerOrder.get(1), 0);
        int total = first + second;
        int serviceTurn = total < 20 ? total / 2 : 10 + (total - 20);
        return playerOrder.get(serviceTurn % 2);
    }

    private static PingPongState.Fault fault(double distance, boolean early) {
        double limit = (early ? EARLY_MARGIN : LATE_MARGIN) - FAULT_BAND;
        if (distance <= limit) return null;
        return early ? PingPongState.Fault.OUT : PingPongState.Fault.NET;
    }

    private static PingPongState.Ball at(PingPongState.Ball ball, long now) {
        double elapsed = Math.max(0, now - ball.launchedAt()) / 1_000d;
        double pos = ball.pos() + ball.direction() * ball.speed() * elapsed;
        return new PingPongState.Ball(pos, ball.direction(), ball.speed(), ball.smash(), ball.fault(),
                ball.faultFrom(), ball.x0(), ball.x1(), now);
    }

    private static double ballX(PingPongState.Ball ball) {
        double p = progress(ball.pos(), ball.direction());
        return ball.x0() + (ball.x1() - ball.x0()) * Math.max(0, Math.min(1, p));
    }

    private static double progress(double pos, int direction) {
        return direction > 0 ? pos : 1 - pos;
    }

    private static long missDeadline(PingPongState.Ball ball, long now) {
        double target = ball.direction() > 0 ? MISS_1 : MISS_2;
        return now + duration(ball.pos(), target, ball.speed());
    }

    private static long flightDeadline(PingPongState.Ball ball, long now) {
        double target;
        if (ball.fault() == PingPongState.Fault.NET) target = 0.5;
        else if (ball.fault() == PingPongState.Fault.OUT) target = ball.direction() > 0 ? 1.5 : -0.5;
        else target = ball.direction() > 0 ? MISS_1 : MISS_2;
        return now + duration(ball.pos(), target, ball.speed());
    }

    private static long duration(double from, double to, double speed) {
        return Math.max(1, Math.round(Math.abs(to - from) / speed * 1_000));
    }

    private static PingPongState.Event event(
            int version, PingPongState.EventType type, String playerId, long now) {
        return new PingPongState.Event(version, type, playerId, now);
    }

    private static PingPongState copy(
            PingPongState state,
            int version,
            PingPongState.Phase phase,
            Map<String, Integer> scores,
            Map<String, Long> sequences,
            Set<String> readyPlayers,
            PingPongState.Ball ball,
            int rally,
            String receiver,
            long nextActionAt,
            PingPongState.Event event
    ) {
        return new PingPongState(version, phase, state.playerOrder(), scores, sequences, readyPlayers, ball, rally,
                receiver, nextActionAt, event);
    }

    private static PingPongState copy(
            PingPongState state,
            int version,
            PingPongState.Phase phase,
            Map<String, Integer> scores,
            Map<String, Long> sequences,
            PingPongState.Ball ball,
            int rally,
            String receiver,
            long nextActionAt,
            PingPongState.Event event
    ) {
        return copy(state, version, phase, scores, sequences, state.readyPlayerIds(), ball, rally,
                receiver, nextActionAt, event);
    }
}
