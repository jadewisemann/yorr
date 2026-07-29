package com.ssafy.yorr.game.round.application;

import com.ssafy.yorr.game.round.domain.RoundState;
import com.ssafy.yorr.game.round.domain.RoundSubmissionResult;

/**
 * 마감 시각이 지난 턴을 서버가 어떻게 처리했는지. 타이머는 이 결과만 보고 다음 동작을 정한다.
 */
public record RoundTimeoutResolution(Kind kind, RoundSubmissionResult advanced, RoundState rolled) {

    public enum Kind {
        /** 그 사이 플레이어가 직접 제출해 턴이 이미 넘어갔다 — 아무것도 하지 않는다. */
        STALE,
        /** 굴림이 남아 있어 서버가 한 번 대신 굴렸다. 턴 주인은 그대로, 시간만 다시 준다. */
        AUTO_ROLLED,
        /** 굴림을 다 써서 서버가 점수를 기록하고 턴을 넘겼다. */
        ADVANCED
    }

    public static RoundTimeoutResolution stale() {
        return new RoundTimeoutResolution(Kind.STALE, null, null);
    }

    /** 굴린 뒤 상태를 함께 넘긴다 — 같은 턴에 다시 걸 round.start가 턴 순서를 실어야 한다. */
    public static RoundTimeoutResolution autoRolled(RoundState rolled) {
        if (rolled == null) {
            throw new IllegalArgumentException("rolled state must not be null");
        }
        return new RoundTimeoutResolution(Kind.AUTO_ROLLED, null, rolled);
    }

    public static RoundTimeoutResolution advanced(RoundSubmissionResult result) {
        if (result == null) {
            throw new IllegalArgumentException("advanced result must not be null");
        }
        return new RoundTimeoutResolution(Kind.ADVANCED, result, null);
    }
}
