package com.ssafy.yorr.game.repository;

import java.util.Map;

/**
 * 게임 종료 전이의 권위. "끝났는지 판정"과 "phase를 FINISHED로 바꾸기"를 한 원자 연산으로 묶는다.
 * <p>
 * 판정을 서버 메모리가 아니라 저장소에서 하는 이유:
 * <ul>
 *   <li>점수판이 곧 진행도다 — 클라이언트가 보내는 값이 아니라 서버가 확정해 저장한 값으로 판정한다.</li>
 *   <li>인스턴스가 재시작·증설돼도 판정 기준이 흔들리지 않는다.</li>
 *   <li>전이가 CAS라, 마지막 제출과 타임아웃 만료가 동시에 도착해도 {@code true}는 한 번만 나온다.
 *       즉 {@code game.over} 중복 방송이 구조적으로 불가능하다.</li>
 * </ul>
 */
public interface GameCompletionStore {

    /**
     * 게임이 끝났으면 phase를 PLAYING → FINISHED로 바꾼다.
     *
     * @param force {@code true}면 점수판 완료 검사를 건너뛴다. 라운드 상한에 도달한 경우로,
     *              타임아웃 때문에 빈 칸이 남아도 게임이 끝나지 않는 상황을 막는 안전망이다.
     * @return 이 호출이 실제로 전이를 수행했는지. {@code true}인 호출자만 종료를 방송해야 한다.
     */
    boolean finishIfComplete(String roomCode, String gameId, boolean force);

    /** 방의 플레이어별 최종 총점(playerId → total). 순위 산출용. */
    Map<String, Integer> readTotals(String roomCode);
}
