package com.ssafy.yorr.game.liars;

import java.util.List;

/**
 * S→C {@code game.liars.hand} — 내 주사위.
 * <b>이 payload는 브로드캐스트에 실리지 않는다</b>(개인 소켓 전송 전용).
 */
public record LiarsHandPayload(int round, List<Integer> dice) {
}
