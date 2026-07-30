package com.ssafy.yorr.room.dto;

public record JoinResult(String playerId, String sessionToken, RoomSnapshot snapshot) {}
