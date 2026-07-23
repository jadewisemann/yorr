package com.ssafy.yorr.room.dto;

public record RoomStatusDTO(boolean exists, int capacity, int members, boolean started) {
    public static RoomStatusDTO notFound() {
        return new RoomStatusDTO(false, 0, 0, false);
    }
}
