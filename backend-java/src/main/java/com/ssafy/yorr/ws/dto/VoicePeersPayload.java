package com.ssafy.yorr.ws.dto;

import java.util.List;

/**
 * S→C: 음성 채널 참가자 <b>전체 명단</b>. (SSOT: VoicePeersPayload)
 * <p>
 * 증분(joined/left)이 아니라 매번 통째로 보낸다 — state.sync와 같은 판단이다. 2~6인 규모에서
 * diff가 아끼는 것보다, 메시지 하나를 놓쳤을 때 명단이 영구히 어긋나는 위험이 크다.
 * 본인도 포함된다.
 */
public record VoicePeersPayload(List<String> peers) {
}
