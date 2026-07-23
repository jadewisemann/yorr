package com.ssafy.yorr.ws.dto;

/**
 * S→C: 전체 상태 스냅샷 브로드캐스트. (SSOT: StateSyncPayload)
 * MVP 권장: 인원이 적으니(2~6명) diff(state.patch) 없이 전체 스냅샷만 쏜다.
 */
public record StateSyncPayload(RoomSnapshot snapshot) {
}
