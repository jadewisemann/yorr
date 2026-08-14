package com.ssafy.yorr.room.dto;

public record QuickMatchResponse(Status status, String roomId, String gameCode) {

    public enum Status {
        NOT_QUEUED,
        WAITING,
        MATCHED,
        PLAYING
    }
}
