package com.ssafy.yorr.room;

public final class RoomRedisKeys {
    public static final String PREFIX = "room:";

    public static String roomKey(String roomCode) {
        return PREFIX + roomCode;
    }

    public static String playersKey(String roomCode) {
        return roomKey(roomCode) + ":players";
    }

    public static String scoresKey(String roomCode) {
        return roomKey(roomCode) + ":scores";
    }

    public static String gameKey(String gameId) {
        return "game:" + gameId;
    }

    private RoomRedisKeys() {}
}
