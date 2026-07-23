package com.ssafy.yorr.room.dto;

public record RoomJoinResponse(String playerId, int members, int capacity, boolean rejoined) {}
