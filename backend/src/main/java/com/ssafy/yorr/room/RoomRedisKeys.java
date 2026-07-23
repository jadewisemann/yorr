package com.ssafy.yorr.room;

public final class RoomRedisKeys {
    public static final String PREFIX = "room:";
    public static final String CAPACITY = "capacity";
    public static final String MEMBERS = "members";
    public static final String STARTED = "started";

    public static String membersKey(String roomId) {
        return PREFIX + roomId + ":members";
    }

    private RoomRedisKeys() {}
}
